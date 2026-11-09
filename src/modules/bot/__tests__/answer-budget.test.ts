import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeLLMProvider,
  FREE_REASONING_HEADROOM,
  MAX_OUTPUT_TOKENS,
  toOpenRouterRequest,
  type LLMResponse,
} from "@intgetion/llm";
import type { BotState } from "../service/tools";
import type { BotEvent } from "../service/conversation";

const JOB = "00000000-0000-4000-8000-0000000000aa";
const australian = null;

const runToolMock = vi.hoisted(() => vi.fn());
const savedStates = vi.hoisted(() => [] as BotState[]);
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
    listOwnApplications: () => Promise.resolve([]),
  };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform")
  >("../../../platform");
  return {
    ...actual,
    isJobSavedForUser: () => Promise.resolve(false),
    getHiddenSetsForViewer: () =>
      Promise.resolve({
        hiddenJobIds: new Set<string>(),
        hiddenCompanyIds: new Set<string>(),
      }),
  };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<typeof import("../../../platform")>(
    "../../../platform",
  );
  return {
    ...actual,
    getJobForPublic: (id: string) =>
      Promise.resolve(id === JOB ? australian : null),
  };
}) as (...args: unknown[]) => unknown)(importOriginal),
  ]);
  // A part that spreads the original must not undo the mocks before it.
  const changed = (parts as Record<string, unknown>[]).map((part) =>
    Object.fromEntries(Object.entries(part).filter(([key, value]) => value !== actual[key])),
  );
  return Object.assign({}, actual, ...changed);
});




vi.mock("../repo/bot-repo", () => ({
  takeResumeAck: () => Promise.resolve(undefined),
  takeDraftOfferFlag: () => Promise.resolve(undefined),
  spentSince: () => Promise.resolve(BigInt(0)),
  updateConversation: (_id: string, patch: { state?: BotState }) => {
    if (patch.state) savedStates.push(patch.state);
    return Promise.resolve();
  },
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

vi.mock("../service/tools", async () => {
  const actual =
    await vi.importActual<typeof import("../service/tools")>(
      "../service/tools",
    );
  return {
    ...actual,
    runTool: (...args: unknown[]) => runToolMock(...args),
  };
});

const { handleMessage, setBotLLMForTests } =
  await import("../service/conversation");

const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(1),
    outputMicroUsdPerMTok: BigInt(1),
  },
};

function conversation(state: BotState, jobId: string | null = null) {
  return {
    id: "c-spoki",
    userId: null,
    channel: "web",
    sessionTokenHash: "hash",
    jobId,
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

function cut(): LLMResponse {
  return {
    text: "",
    toolCalls: [],
    usage: { tokensIn: 7000, tokensOut: MAX_OUTPUT_TOKENS },
    stopReason: "max_tokens",
  };
}

function said(text: string): LLMResponse {
  return {
    text,
    toolCalls: [],
    usage: { tokensIn: 7000, tokensOut: 40 },
    stopReason: "end",
  };
}

async function turn(state: BotState, script: LLMResponse[]) {
  const provider = new FakeLLMProvider(script);
  setBotLLMForTests({ provider, model: "fake-model", prices });
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId: null,
      conversation: conversation(state),
      text: "Привет! Что ты умеешь?",
      ip: "203.0.113.40",
      locale: "ru",
    },
    (event) => events.push(event),
  );
  const chatCalls = provider.requests.filter(
    (request) => request.toolChoice !== "record_result",
  );
  return {
    shown: events.map((e) => ("text" in e ? e.text : "")).join(" "),
    chatCalls: chatCalls.length,
  };
}

describe("answer budget ran out (hotfix D513)", () => {
  beforeEach(() => {
    messages.length = 0;
    savedStates.length = 0;
    runToolMock.mockReset();
  });

  it("gives a free reasoning model room above the answer budget and asks for short reasoning", () => {
    const base = {
      system: "s",
      messages: [{ role: "user" as const, content: "x" }],
      maxTokens: MAX_OUTPUT_TOKENS,
    };
    const free = toOpenRouterRequest({ ...base, model: "a/b:free" });
    expect(free.max_tokens).toBe(MAX_OUTPUT_TOKENS + FREE_REASONING_HEADROOM);
    expect(free.reasoning).toEqual({ effort: "low", exclude: true });
    const paid = toOpenRouterRequest({ ...base, model: "openai/gpt-5" });
    expect(paid.max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it("asks the model once more when it ran out before any text", async () => {
    const result = await turn({}, [cut(), said("Я подбираю вакансии.")]);
    expect(result.chatCalls).toBe(2);
    expect(result.shown).toContain("Я подбираю вакансии.");
    expect(
      messages.some(
        (row) =>
          (row.toolCall as { retried?: string } | null)?.retried === "length",
      ),
    ).toBe(true);
  });

  it("retries only once, then a UGC thread hears no job-search line", async () => {
    const result = await turn({ topic: "ugc" }, [cut(), cut(), cut()]);
    expect(result.chatCalls).toBe(2);
    expect(result.shown).toContain("Отправьте его ещё раз");
    expect(result.shown).not.toContain("вакансии");
  });
});
