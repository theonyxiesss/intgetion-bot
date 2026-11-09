import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLLMProvider, type LLMResponse } from "@intgetion/llm";
import type { BotState } from "../service/tools";
import type { BotEvent } from "../service/conversation";

const USER = "00000000-0000-4000-8000-000000000001";
const CARD = "00000000-0000-4000-8000-0000000000c1";

const limits = vi.hoisted(() => vi.fn());
const found = vi.hoisted(() => ({ value: undefined as unknown }));
const messages = vi.hoisted(
  () =>
    [] as Array<{
      id: string;
      role: string;
      content: string;
      toolCall: unknown;
      createdAt: Date;
    }>,
);

vi.mock("../../../platform", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const parts = await Promise.all([
    ((async () => {
  const actual =
    await vi.importActual<typeof import("../../../platform")>(
      "../../../platform",
    );
  return {
    ...actual,
    enforceRateLimit: (...args: unknown[]) => {
      limits(...args);
      return Promise.resolve();
    },
  };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform")
  >("../../../platform");
  return { ...actual, getOwnCandidate: () => Promise.resolve(null) };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform")
  >("../../../platform");
  return { ...actual, readSharedProfile: () => Promise.resolve(null) };
}) as (...args: unknown[]) => unknown)(importOriginal),
  ]);
  // A part that spreads the original must not undo the mocks before it.
  const changed = (parts as Record<string, unknown>[]).map((part) =>
    Object.fromEntries(Object.entries(part).filter(([key, value]) => value !== actual[key])),
  );
  return Object.assign({}, actual, ...changed);
});



vi.mock("../service/user-memory", async () => {
  const actual = await vi.importActual<typeof import("../service/user-memory")>(
    "../service/user-memory",
  );
  return { ...actual, listMemory: () => Promise.resolve([]) };
});

vi.mock("../repo/bot-repo", () => ({
  findConfirmationWithConversation: () => Promise.resolve(found.value),
  takeResumeAck: () => Promise.resolve(undefined),
  takeDraftOfferFlag: () => Promise.resolve(undefined),
  spentSince: () => Promise.resolve(BigInt(0)),
  updateConversation: () => Promise.resolve(),
  userDailyCosts: () => Promise.resolve([]),
  insertMessage: (input: {
    role: string;
    content: string;
    toolCall?: unknown;
  }) => {
    const row = {
      id: `m${messages.length + 1}`,
      role: input.role,
      content: input.content,
      toolCall: input.toolCall ?? null,
      createdAt: new Date(),
    };
    messages.push(row);
    return Promise.resolve(row);
  },
  listMessages: () => Promise.resolve(messages.map((row) => ({ ...row }))),
}));

const { continueAfterCard, setBotLLMForTests } =
  await import("../service/conversation");

const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(1),
    outputMicroUsdPerMTok: BigInt(1),
  },
};

const NOW = new Date("2026-10-21T07:38:20Z");

function card(decidedAt: Date | null, state: BotState = { topic: "ugc" }) {
  return {
    confirmation: {
      id: CARD,
      conversationId: "c-card",
      userId: USER,
      tool: "withdraw_ugc_campaign",
      args: {},
      argsHash: "h",
      expiresAt: new Date(NOW.getTime() + 60_000),
      decidedAt,
      accepted: decidedAt ? true : null,
      createdAt: new Date(NOW.getTime() - 10_000),
    },
    conversation: {
      id: "c-card",
      userId: USER,
      channel: "web",
      sessionTokenHash: "hash",
      jobId: null,
      campaignId: null,
      inviteId: null,
      locale: "ru",
      state,
      summary: null,
      linkedAt: null,
      createdAt: new Date(),
      lastMessageAt: new Date(),
    },
  };
}

function said(text: string): LLMResponse {
  return {
    text,
    toolCalls: [],
    usage: { tokensIn: 100, tokensOut: 20 },
    stopReason: "end",
  };
}

async function run(script: LLMResponse[]) {
  const provider = new FakeLLMProvider(script);
  setBotLLMForTests({ provider, model: "fake-model", prices });
  const events: BotEvent[] = [];
  const result = await continueAfterCard(
    { userId: USER, confirmationId: CARD, ip: "203.0.113.7" },
    (event) => events.push(event),
    NOW,
  ).catch((error: unknown) => error);
  const chats = provider.requests.filter(
    (request) => request.toolChoice !== "record_result",
  );
  return {
    result,
    events,
    chats,
    shown: events.map((e) => ("text" in e ? e.text : "")).join(" "),
  };
}

describe("Spoki's turn after a card (D515)", () => {
  beforeEach(() => {
    messages.length = 0;
    limits.mockReset();
    messages.push({
      id: "m0",
      role: "system_event",
      content:
        "The user confirmed withdraw_ugc_campaign. The brief is back in the draft.",
      toolCall: null,
      createdAt: new Date(),
    });
  });

  it("answers right after the card: what is done and the next step", async () => {
    found.value = card(new Date(NOW.getTime() - 3_000));
    const { result, chats, shown, events } = await run([
      said(
        "Бриф вернулся в черновик. Поменяем вознаграждение и число роликов?",
      ),
    ]);
    expect(result).toBeUndefined();
    expect(shown).toContain("Бриф вернулся в черновик");
    expect(chats).toHaveLength(1);
    expect(chats[0]!.system).toContain("answer on a confirmation card");
    expect(events.at(-1)).toMatchObject({ type: "done" });
    // Nothing is stored as if the person had typed it.
    expect(messages.some((row) => row.role === "user")).toBe(false);
    // Metered once per card, not against the daily message limit.
    expect(limits.mock.calls).toEqual([["botAfterCard", CARD, NOW]]);
  });

  it("stays quiet when the model has nothing to add: no fallback line", async () => {
    found.value = card(new Date(NOW.getTime() - 3_000));
    const { shown } = await run([said("")]);
    expect(shown.trim()).toBe("");
  });

  it("refuses an unanswered card, an old answer and someone else's card", async () => {
    found.value = card(null);
    const open = await run([said("x")]);
    expect(open.result).toMatchObject({ status: 409 });
    expect(open.chats).toHaveLength(0);

    found.value = card(new Date(NOW.getTime() - 5 * 60_000));
    const old = await run([said("x")]);
    expect(old.result).toMatchObject({ status: 409 });
    expect(old.chats).toHaveLength(0);

    found.value = undefined;
    const other = await run([said("x")]);
    expect(other.result).toMatchObject({ status: 404 });
    expect(limits).not.toHaveBeenCalled();
  });
});
