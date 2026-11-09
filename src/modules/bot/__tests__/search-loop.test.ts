import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLLMProvider, type LLMResponse } from "@intgetion/llm";
import { setVacancyReaderForTests, vacancyFromPublic } from "../service/fit";
import { createJobGoal } from "../service/job-goal";
import type { BotState } from "../service/tools";
import type { BotEvent } from "../service/conversation";

const JOB = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";

const australian = {
  id: JOB,
  title: "Content and sales contractor",
  description: "Australian hours with flexibility.",
  company: { name: "Australian real-estate agency" },
  location: null,
  locationCountry: "AU",
  workFormat: "remote",
  employmentType: "contract",
  experienceMin: null,
  skills: [
    { id: "1", name: "content" },
    { id: "2", name: "sales" },
    { id: "3", name: "client support" },
  ],
  languages: [],
  salaryMin: {
    amountMinor: "150000",
    currency: "AUD",
    period: "month",
    basis: "gross",
  },
  salaryMax: {
    amountMinor: "200000",
    currency: "AUD",
    period: "month",
    basis: "gross",
  },
  timezoneRequired: "Australia/Sydney",
  workHoursStart: "09:00:00",
  workHoursEnd: "17:00:00",
  minOverlapHours: 4,
  perks: [],
  source: { type: "internal", name: null, url: null },
};

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

function visibleText(events: BotEvent[]): string {
  return events.map((event) => ("text" in event ? event.text : "")).join("\n");
}

function reply(text: string, toolName?: string, input?: unknown): LLMResponse {
  return {
    text,
    toolCalls: toolName
      ? [{ id: `call_${toolName}`, name: toolName, input: input ?? {} }]
      : [],
    usage: { tokensIn: 0, tokensOut: 0 },
    stopReason: toolName ? "tool_use" : "end",
  };
}

describe("Spoki search loop", () => {
  beforeEach(() => {
    messages.length = 0;
    savedStates.length = 0;
    runToolMock.mockReset();
    setVacancyReaderForTests(async (id) =>
      id === JOB ? vacancyFromPublic(australian) : null,
    );
  });

  it("states the Australian vacancy in Russian and does not apply", async () => {
    setBotLLMForTests({
      provider: new FakeLLMProvider([
        reply(
          "Могу написать сопроводительное письмо и вопросы для работодателя. A cover letter and interview questions.",
          "apply_to_job",
          { jobId: JOB, coverNote: "hire me" },
        ),
      ]),
      model: "fake-model",
      prices,
    });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: "user-1",
        conversation: conversation({}, JOB),
        text: "Посмотри эту вакансию",
        ip: "203.0.113.20",
        locale: "en",
      },
      (event) => events.push(event),
    );
    const shown = visibleText(events);
    expect(shown).toContain("Удалённый подряд");
    expect(shown).toContain("Australian real-estate agency");
    expect(shown).toContain("1.5–2k AUD");
    expect(shown).toContain("Часы AU 9–17");
    expect(shown).toContain("с гибкостью");
    expect(shown).toContain("content");
    expect(shown).toContain("sales");
    expect(shown).toContain("client support");
    expect(shown.trim().endsWith("Вам подходит эта вакансия?")).toBe(true);
    for (const banned of [
      "осопроводительн",
      "сопроводительн",
      "cover note",
      "cover letter",
      "вопросы для работодателя",
      "interview questions",
      "отклик отправлен",
    ]) {
      expect(shown.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    expect(runToolMock.mock.calls.map((call) => call[1])).not.toContain(
      "apply_to_job",
    );
  });

  it("does not call apply_to_job on a polite yes", async () => {
    setBotLLMForTests({
      provider: new FakeLLMProvider([
        reply("", "apply_to_job", { jobId: JOB, coverNote: "please" }),
      ]),
      model: "fake-model",
      prices,
    });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: "user-1",
        conversation: conversation({ presentedJobId: JOB, draft: {} }, null),
        text: "да, мне подходит",
        ip: "203.0.113.21",
        locale: "en",
      },
      (event) => events.push(event),
    );
    expect(runToolMock).not.toHaveBeenCalled();
    expect(visibleText(events)).not.toContain("отклик отправлен");
    expect(savedStates.at(-1)?.verdict).toBe("suits");
    expect(savedStates.at(-1)?.presentedJobId).toBe(JOB);
  });

  it("searches again after no and does not repeat the passed id", async () => {
    runToolMock.mockResolvedValue({
      llm: "two jobs",
      client: {
        kind: "jobs",
        data: [
          {
            id: JOB,
            title: "First",
            companyName: "Kept",
            workFormat: "remote",
          },
          {
            id: OTHER,
            title: "Second",
            companyName: "Next agency",
            workFormat: "remote",
          },
        ],
      },
    });
    setBotLLMForTests({
      provider: new FakeLLMProvider([reply("")]),
      model: "fake-model",
      prices,
    });
    const draft = {
      country: "IT",
      desiredTitles: ["support"],
      workFormats: ["remote"],
    };
    const first: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation({ draft }),
        text: "покажи вакансии",
        ip: "203.0.113.22",
        locale: "ru",
      },
      (event) => first.push(event),
    );
    expect(visibleText(first)).toContain("Australian real-estate agency");
    expect(visibleText(first)).not.toContain("Next agency");
    const after = savedStates.at(-1);
    expect(after?.presentedJobId).toBe(JOB);

    messages.length = 0;
    const second: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation(after ?? { draft }),
        text: "нет",
        ip: "203.0.113.23",
        locale: "ru",
      },
      (event) => second.push(event),
    );
    const shown = visibleText(second);
    expect(shown).toContain("Next agency");
    expect(shown).not.toContain("Australian real-estate agency");
    expect(savedStates.at(-1)?.passedJobIds).toContain(JOB);
    expect(savedStates.at(-1)?.presentedJobId).toBe(OTHER);
    expect(runToolMock.mock.calls.map((call) => call[1])).not.toContain(
      "apply_to_job",
    );
  });

  it("does not show the server's job question twice when the model copies it (D557)", async () => {
    runToolMock.mockResolvedValue({
      llm: "one job",
      client: {
        kind: "jobs",
        data: [
          {
            id: JOB,
            title: "First",
            companyName: "Kept",
            workFormat: "remote",
          },
        ],
      },
    });
    const turn = async (responses: LLMResponse[]) => {
      messages.length = 0;
      setBotLLMForTests({
        provider: new FakeLLMProvider(responses),
        model: "fake-model",
        prices,
      });
      const events: BotEvent[] = [];
      await handleMessage(
        {
          userId: null,
          conversation: conversation({
            draft: {
              country: "IT",
              desiredTitles: ["designer"],
              workFormats: ["remote"],
            },
          }),
          text: "Найди удалённые вакансии дизайнера",
          ip: "203.0.113.30",
          locale: "ru",
        },
        (event) => events.push(event),
      );
      return events.flatMap((event) =>
        event.type === "token" ? [event.text] : [],
      );
    };
    const [line] = await turn([reply("", "search_jobs", {}), reply("")]);
    expect(line).toContain("Вам подходит эта вакансия?");

    const shown = await turn([
      reply("", "search_jobs", {}),
      reply(` ${line}\n`),
    ]);
    expect(shown.filter((text) => text.trim() === line!.trim())).toHaveLength(
      1,
    );
  });

  it("sends the goal event only to a thread that has a goal", async () => {
    const turn = async (state: BotState) => {
      messages.length = 0;
      setBotLLMForTests({
        provider: new FakeLLMProvider([reply("Готово.")]),
        model: "fake-model",
        prices,
      });
      const events: BotEvent[] = [];
      await handleMessage(
        {
          userId: null,
          conversation: conversation(state),
          text: "Привет, что нового?",
          ip: "203.0.113.31",
          locale: "ru",
        },
        (event) => events.push(event),
      );
      return events.filter((event) => event.type === "job_goal");
    };
    expect(await turn({})).toHaveLength(0);
    expect(
      await turn({ jobGoal: createJobGoal({ remoteOnly: true }, new Date()) }),
    ).toHaveLength(1);
  });

  it("gives the model one more try after a tool this thread does not offer (D502)", async () => {
    const provider = new FakeLLMProvider([
      reply("", "patch_brief", { productName: "North" }),
      reply("Ask me about events or jobs."),
    ]);
    setBotLLMForTests({ provider, model: "fake-model", prices });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation({}),
        text: "what conferences are there?",
        ip: "203.0.113.21",
        locale: "en",
      },
      (event) => events.push(event),
    );
    expect(events).not.toContainEqual({ type: "error", code: "BOT_TRY_LATER" });
    expect(visibleText(events)).toContain("Ask me about events or jobs.");
    const retry = provider.requests
      .filter((r) => r.toolChoice !== "record_result")
      .at(-1)!;
    expect(retry.system).toContain("Unknown tool patch_brief");
    expect(runToolMock).not.toHaveBeenCalled();
  });

  it("stops after a second invalid call instead of looping", async () => {
    setBotLLMForTests({
      provider: new FakeLLMProvider([
        reply("", "patch_brief", {}),
        reply("", "patch_brief", {}),
      ]),
      model: "fake-model",
      prices,
    });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation({}),
        text: "what conferences are there?",
        ip: "203.0.113.22",
        locale: "en",
      },
      (event) => events.push(event),
    );
    expect(events).toContainEqual({ type: "error", code: "BOT_TRY_LATER" });
    expect(runToolMock).not.toHaveBeenCalled();
  });
});
