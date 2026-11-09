import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLLMProvider, type LLMResponse } from "@intgetion/llm";
import { HttpError } from "@intgetion/kit";
import type { BotState } from "../service/tools";
import type { BotEvent } from "../service/conversation";

const USER = "00000000-0000-4000-8000-0000000000a1";
const JOB = "00000000-0000-4000-8000-0000000000b2";

const runToolMock = vi.hoisted(() => vi.fn());
const insertAction = vi.hoisted(() => vi.fn());
const moveCardAction = vi.hoisted(() => vi.fn());
const sweepActions = vi.hoisted(() => vi.fn());
const decided = vi.hoisted(() => ({ row: undefined as unknown }));
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
  return { ...actual, enforceRateLimit: () => Promise.resolve() };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform")
  >("../../../platform");
  return {
    ...actual,
    billingMe: () => Promise.resolve({ candidatePlan: "free" }),
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
vi.mock("../service/tools", async () => {
  const actual =
    await vi.importActual<typeof import("../service/tools")>(
      "../service/tools",
    );
  return {
    ...actual,
    runTool: (...args: unknown[]) => runToolMock(...args),
    toolPreview: () => Promise.resolve("Senior Python developer"),
  };
});
vi.mock("../repo/bot-repo", () => ({
  takeResumeAck: () => Promise.resolve(undefined),
  takeDraftOfferFlag: () => Promise.resolve(undefined),
  spentSince: () => Promise.resolve(BigInt(0)),
  updateConversation: () => Promise.resolve(),
  userDailyCosts: () => Promise.resolve([]),
  createConfirmation: (input: { expiresAt: Date }) =>
    Promise.resolve({ id: "c0nf1rm0-0000-4000-8000-000000000001", ...input }),
  decideConfirmation: () => Promise.resolve(decided.row),
  insertAction: (...args: unknown[]) => insertAction(...args),
  moveCardAction: (...args: unknown[]) => moveCardAction(...args),
  sweepActions: (...args: unknown[]) => sweepActions(...args),
  insertMessage: (input: { role: string; content: string }) => {
    const row = {
      id: `m${messages.length + 1}`,
      role: input.role,
      content: input.content,
      toolCall: null,
      createdAt: new Date(),
    };
    messages.push(row);
    return Promise.resolve(row);
  },
  listMessages: () => Promise.resolve(messages.map((row) => ({ ...row }))),
}));

const { confirmAction, handleMessage, setBotLLMForTests } =
  await import("../service/conversation");
const { sweepBotActions } = await import("../service/journal");

const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(1),
    outputMicroUsdPerMTok: BigInt(1),
  },
};

function conversation(state: BotState = {}) {
  return {
    id: "c-journal",
    userId: USER,
    channel: "web",
    sessionTokenHash: "hash",
    jobId: null,
    campaignId: null,
    inviteId: null,
    locale: "en",
    state,
    summary: null,
    linkedAt: null,
    createdAt: new Date(),
    lastMessageAt: new Date(),
  };
}

function calls(name: string, input: unknown): LLMResponse {
  return {
    text: "",
    toolCalls: [{ id: "call_1", name, input }],
    usage: { tokensIn: 1, tokensOut: 1 },
    stopReason: "tool_use",
  };
}

function said(text: string): LLMResponse {
  return {
    text,
    toolCalls: [],
    usage: { tokensIn: 1, tokensOut: 1 },
    stopReason: "end",
  };
}

async function turn(
  script: LLMResponse[],
  channel?: "web" | "telegram",
): Promise<BotEvent[]> {
  setBotLLMForTests({
    provider: new FakeLLMProvider(script),
    model: "fake-model",
    prices,
  });
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId: USER,
      conversation: conversation(),
      text: "please do it",
      ip: "203.0.113.5",
      locale: "en",
      ...(channel ? { channel } : {}),
    },
    (event) => events.push(event),
  );
  return events;
}

const cardRow = {
  id: "c0nf1rm0-0000-4000-8000-000000000001",
  conversationId: "c-journal",
  userId: USER,
  tool: "apply_to_job",
  args: { jobId: JOB, coverNote: "Hello" },
  argsHash: "h",
};

describe("Spoki action journal (D521)", () => {
  beforeEach(() => {
    messages.length = 0;
    runToolMock.mockReset();
    insertAction.mockReset();
    moveCardAction.mockReset();
    sweepActions.mockReset();
    insertAction.mockResolvedValue(undefined);
    moveCardAction.mockResolvedValue(true);
  });

  it("records a shown card as awaiting, with the channel and no arguments", async () => {
    await turn(
      [calls("follow_company", { slug: "acme" }), said("Card on screen.")],
      "telegram",
    );
    expect(insertAction).toHaveBeenCalledTimes(1);
    const row = insertAction.mock.calls[0]![0];
    expect(row).toMatchObject({
      userId: USER,
      tool: "follow_company",
      kind: "card",
      status: "awaiting_confirmation",
      confirmationId: cardRow.id,
      channel: "telegram",
    });
    expect(JSON.stringify(row)).not.toContain("acme");
    expect(runToolMock).not.toHaveBeenCalled();
  });

  it("moves a confirmed card to executing, then completed with the item", async () => {
    decided.row = cardRow;
    runToolMock.mockResolvedValue({
      llm: "Applied.",
      audit: { entityType: "application", entityId: "app-1" },
    });
    await confirmAction({
      userId: USER,
      conversation: conversation(),
      confirmationId: cardRow.id,
      accept: true,
    });
    const steps = moveCardAction.mock.calls.map((call) => call[3]);
    expect(steps[0]).toMatchObject({ status: "executing" });
    expect(steps[1]).toMatchObject({
      status: "completed",
      entityType: "application",
      entityId: "app-1",
    });
    expect(moveCardAction.mock.calls[0]![2]).toEqual(["awaiting_confirmation"]);
  });

  it("records a declined card as cancelled and a failed one with a safe code", async () => {
    decided.row = cardRow;
    await confirmAction({
      userId: USER,
      conversation: conversation(),
      confirmationId: cardRow.id,
      accept: false,
    });
    expect(moveCardAction.mock.calls[0]![3]).toMatchObject({
      status: "cancelled",
    });
    moveCardAction.mockClear();
    runToolMock.mockRejectedValue(
      new HttpError(409, "CONFLICT", "secret detail about Alice"),
    );
    await expect(
      confirmAction({
        userId: USER,
        conversation: conversation(),
        confirmationId: cardRow.id,
        accept: true,
      }),
    ).rejects.toBeInstanceOf(HttpError);
    const failed = moveCardAction.mock.calls[1]![3];
    expect(failed).toMatchObject({ status: "failed", errorCode: "CONFLICT" });
    expect(JSON.stringify(failed)).not.toContain("Alice");
  });

  it("records a direct write, and not a read", async () => {
    runToolMock.mockResolvedValue({ llm: "Saved." });
    await turn([calls("save_job", { jobId: JOB }), said("Saved it.")]);
    expect(insertAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "save_job",
        kind: "direct",
        status: "completed",
      }),
    );
    insertAction.mockClear();
    runToolMock.mockResolvedValue({ llm: "{}" });
    await turn([calls("get_my_profile", {}), said("Here it is.")]);
    expect(insertAction).not.toHaveBeenCalled();
  });

  it("never lets a journal failure break the action", async () => {
    insertAction.mockRejectedValue(new Error("relation does not exist"));
    runToolMock.mockResolvedValue({ llm: "Saved." });
    const events = await turn([
      calls("save_job", { jobId: JOB }),
      said("Saved it."),
    ]);
    expect(runToolMock).toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("keeps the journal 180 days unless configured", async () => {
    sweepActions.mockResolvedValue({ expired: 0, interrupted: 0, deleted: 0 });
    const now = new Date("2026-10-21T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    await sweepBotActions(now);
    expect(sweepActions.mock.calls[0]![0].deleteBefore).toEqual(
      new Date(now.getTime() - 180 * day),
    );
    vi.stubEnv("BOT_ACTIONS_RETENTION_DAYS", "30");
    await sweepBotActions(now);
    expect(sweepActions.mock.calls[1]![0].deleteBefore).toEqual(
      new Date(now.getTime() - 30 * day),
    );
    vi.unstubAllEnvs();
  });
});
