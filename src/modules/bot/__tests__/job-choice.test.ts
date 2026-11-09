import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLLMProvider } from "@intgetion/llm";
import type { BotState } from "../service/tools";
import type { BotEvent } from "../service/conversation";

const USER = "00000000-0000-4000-8000-000000000001";

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

vi.mock("../repo/bot-repo", () => ({
  takeResumeAck: () => Promise.resolve(undefined),
  takeDraftOfferFlag: () => Promise.resolve(undefined),
  spentSince: () => Promise.resolve(BigInt(0)),
  updateConversation: (_id: string, patch: { state?: BotState }) => {
    if (patch.state) savedStates.push(patch.state);
    return Promise.resolve();
  },
  userDailyCosts: () => Promise.resolve([]),
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

const { handleMessage, setBotLLMForTests } =
  await import("../service/conversation");
const { isJobDraftRequest } = await import("../service/job-draft-focus");
const { fillQuestion, fillRequestOf } = await import("../service/fill-choice");
const { fillPaths, offerPath } = await import("../service/offers");

function conversation(state: BotState) {
  return {
    id: "c-job",
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
  };
}

async function ask(text: string, state: BotState = {}) {
  const provider = new FakeLLMProvider([]);
  setBotLLMForTests({ provider, model: "fake-model", prices: {} });
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId: USER,
      conversation: conversation(state),
      text,
      ip: "203.0.113.9",
      locale: "ru",
    },
    (event) => events.push(event),
  );
  return { events, requests: provider.requests.length };
}

describe("filling something in starts with a choice (D516)", () => {
  beforeEach(() => {
    messages.length = 0;
    savedStates.length = 0;
  });

  it("hears each kind of request, and not a job search", () => {
    expect(isJobDraftRequest("а ты можешь выставить вакансию")).toBe(true);
    expect(fillRequestOf("а ты можешь выставить вакансию")).toBe("job");
    expect(fillRequestOf("can you post a job for us?")).toBe("job");
    expect(fillRequestOf("помоги создать бриф на ролики")).toBe("brief");
    expect(fillRequestOf("хочу разместить свою услугу")).toBe("service");
    expect(fillRequestOf("заполни мой профиль")).toBe("profile");
    expect(fillRequestOf("help me fill in my profile")).toBe("profile");
    expect(fillRequestOf("хочу заполнить анкету креатора")).toBe("creator");
    expect(fillRequestOf("заполнить карточку компании")).toBe("company");
    expect(fillRequestOf("ищу вакансию дизайнера")).toBeNull();
    expect(fillRequestOf("покажи мой профиль")).toBeNull();
  });

  it("asks: together in the chat or alone in the form, before any draft", async () => {
    const { events, requests } = await ask("а ты можешь выставить вакансию", {
      topic: "ugc",
    });
    expect(requests).toBe(0);
    const said = events.find((event) => event.type === "token");
    expect(said).toMatchObject({ text: fillQuestion("job", "ru") });
    expect(fillQuestion("job", "ru")).toContain("вакансию вместе здесь в чате");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        kind: "fill_choice",
        data: { kind: "job" },
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(savedStates.at(-1)?.jobDraftMode).toBeFalsy();
    expect(savedStates.at(-1)?.fillOffered).toBe("job");
  });

  it("asks the same for a profile, and not when Spoki already fills it", async () => {
    const first = await ask("заполни мой профиль");
    expect(first.events).toContainEqual(
      expect.objectContaining({ data: { kind: "profile" } }),
    );
    expect(fillQuestion("profile", "ru")).toContain("профиль");
    messages.length = 0;
    const filling = await ask("заполни мой профиль", { fillMode: "spoki" });
    expect(
      filling.events.some(
        (event) => event.type === "tool_result" && event.kind === "fill_choice",
      ),
    ).toBe(false);
  });

  it("after the question, the same request means: here in the chat", async () => {
    const provider = new FakeLLMProvider([
      {
        text: "Начнём. Как вас представить?",
        toolCalls: [],
        usage: { tokensIn: 1, tokensOut: 1 },
        stopReason: "end",
      },
    ]);
    setBotLLMForTests({
      provider,
      model: "fake-model",
      prices: {
        "fake-model": {
          inputMicroUsdPerMTok: BigInt(1),
          outputMicroUsdPerMTok: BigInt(1),
        },
      },
    });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: USER,
        conversation: conversation({ fillOffered: "creator" }),
        text: "Давай заполним анкету креатора здесь в чате.",
        ip: "203.0.113.9",
        locale: "ru",
      },
      (event) => events.push(event),
    );
    expect(
      events.some(
        (event) => event.type === "tool_result" && event.kind === "fill_choice",
      ),
    ).toBe(false);
    const chat = provider.requests.find(
      (request) => request.toolChoice !== "record_result",
    );
    expect(chat?.system).toContain("They chose to fill in creator");
    expect(savedStates.at(-1)?.fillOffered).toBeUndefined();
  });

  it("does not ask inside a draft", async () => {
    const provider = new FakeLLMProvider([]);
    setBotLLMForTests({ provider, model: "fake-model", prices: {} });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: USER,
        conversation: conversation({ ugcDraftMode: true }),
        text: "разместить вакансию",
        ip: "203.0.113.9",
        locale: "ru",
      },
      (event) => events.push(event),
    ).catch(() => undefined);
    expect(
      events.some(
        (event) => event.type === "tool_result" && event.kind === "fill_choice",
      ),
    ).toBe(false);
  });

  it("each choice has a form; a draft thread or this chat for the chat way", () => {
    expect(fillPaths("job", true)).toEqual({
      chat: "/chat?from=post_job",
      form: "/post-job",
    });
    expect(fillPaths("brief", true).chat).toBe("/chat?from=campaigns");
    expect(fillPaths("service", true).chat).toBe("/chat?from=freelance_sell");
    expect(fillPaths("profile", true)).toEqual({
      chat: null,
      form: "/profile/edit",
    });
    expect(fillPaths("company", false).form).toBe("/login?next=chat");
    expect(offerPath("fill_creator", true)).toBe("/creator");
  });
});
