import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLLMProvider, fakeText, fakeToolCall } from "@intgetion/llm";
import { setVacancyReaderForTests } from "../service/fit";
import type { BotEvent } from "../service/conversation";

/** D523: a data tool's cards become a block, kept with the tool row. */

const runToolMock = vi.hoisted(() => vi.fn());
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

const { conversationHistory, handleMessage, setBotLLMForTests } =
  await import("../service/conversation");

const JOB = "11111111-1111-4111-8111-111111111111";
const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(1),
    outputMicroUsdPerMTok: BigInt(1),
  },
};

const conversation = {
  id: "c1",
  userId: null,
  channel: "web",
  sessionTokenHash: "hash",
  jobId: null,
  campaignId: null,
  inviteId: null,
  locale: "en",
  state: {
    draft: {
      country: "IT",
      desiredTitles: ["solidity engineer"],
      workFormats: ["remote"],
    },
  },
  summary: null,
  linkedAt: null,
  createdAt: new Date(),
  lastMessageAt: new Date(),
};

async function turn(channel?: "web" | "telegram") {
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId: null,
      conversation,
      text: "show solidity jobs",
      ip: "203.0.113.20",
      locale: "en",
      ...(channel ? { channel } : {}),
    },
    (event) => events.push(event),
  );
  return events;
}

describe("Spoki blocks in the chat (D523)", () => {
  beforeEach(() => {
    messages.length = 0;
    setVacancyReaderForTests(async () => null);
    runToolMock.mockReset();
    runToolMock.mockResolvedValue({
      llm: "one job",
      client: {
        kind: "jobs",
        data: [{ id: JOB, title: "Solidity Engineer", companyName: "Acme" }],
      },
    });
    setBotLLMForTests({
      provider: new FakeLLMProvider([
        fakeToolCall("search_jobs", { q: "solidity" }),
        fakeText("One role."),
      ]),
      model: "fake-model",
      prices,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the old cards while the flag is off", async () => {
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "false");
    const events = await turn();
    expect(events.some((event) => event.type === "ui")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_result", kind: "jobs" }),
    );
    const tool = messages.find((row) => row.role === "tool");
    expect(tool?.toolCall).not.toHaveProperty("ui");
  });

  it("reports tool completion even when its result becomes an interactive block", async () => {
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "true");
    const events = await turn();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_end",
        name: "search_jobs",
        status: "completed",
      }),
    );
    const start = events.find((event) => event.type === "tool_start");
    expect(start).toHaveProperty("id");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_end",
        id: (start as unknown as { id: string }).id,
      }),
    );
  });

  it("reports a failed tool without exposing its arguments or error details", async () => {
    const { HttpError } = await import("@intgetion/kit");
    runToolMock.mockRejectedValue(
      new HttpError(422, "VALIDATION_ERROR", "private details"),
    );
    const events = await turn();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_end",
        name: "search_jobs",
        status: "failed",
      }),
    );
    expect(
      JSON.stringify(
        events.filter(
          (event) =>
            event.type === "tool_start" ||
            (event as { type: string }).type === "tool_end",
        ),
      ),
    ).not.toContain("private details");
  });

  it("sends a checked block instead of the cards and keeps it for the history", async () => {
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "true");
    const events = await turn();
    const ui = events.find(
      (event): event is Extract<BotEvent, { type: "ui" }> =>
        event.type === "ui",
    );
    expect(ui?.block.component).toBe("job_cards");
    expect(
      events.some(
        (event) => event.type === "tool_result" && event.kind === "jobs",
      ),
    ).toBe(false);
    // The model reads only the tool text; the block waits with the row.
    const tool = messages.find((row) => row.role === "tool");
    expect(tool?.content).toBe("one job");
    expect((tool?.toolCall as { ui?: { id: string } }).ui?.id).toBe(
      ui?.block.id,
    );

    const history = await conversationHistory("c1");
    const shown = history.find((row) => row.role === "ui");
    expect(shown).toMatchObject({
      role: "ui",
      block: { id: ui?.block.id, component: "job_cards" },
      done: [],
    });
    expect(shown?.content).toContain("Solidity Engineer — Acme");
    // Old messages are where they were.
    expect(history.map((row) => row.role).slice(0, 3)).toEqual([
      "user",
      "ui",
      "assistant",
    ]);
  });

  it("keeps the Telegram cards: no block from a data tool there", async () => {
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "true");
    const events = await turn("telegram");
    expect(events.some((event) => event.type === "ui")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_result", kind: "jobs" }),
    );
  });

  it("draws nothing from a kept block that fails the check", async () => {
    messages.push({
      id: "bad",
      role: "tool",
      content: "x",
      toolCall: {
        toolCallId: "t",
        name: "search_jobs",
        ui: { v: 1, html: "<b>" },
      },
      createdAt: new Date(),
    });
    const history = await conversationHistory("c1");
    expect(history.find((row) => row.id === "bad")).toBeUndefined();
  });

  it("answers an employer's hiring question with the calculator, not a job search", async () => {
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "true");
    const { blockFromShowUi } = await import("../ui/build");
    const ui = await blockFromShowUi(
      { component: "calculator", formula: "hiring_cost", jobsPerMonth: 4 },
      { userId: null, locale: "ru" },
    );
    runToolMock.mockReset();
    runToolMock.mockResolvedValue({
      llm: "A calculator block is on the screen now.",
      ui,
    });
    setBotLLMForTests({
      provider: new FakeLLMProvider([
        fakeToolCall("show_ui", {
          component: "calculator",
          formula: "hiring_cost",
          jobsPerMonth: 4,
        }),
        fakeText("Команда выгоднее."),
      ]),
      model: "fake-model",
      prices,
    });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        // The candidate draft of this thread is ready to search.
        conversation,
        text: "Нанимаю 4 человека в месяц. Что дешевле: Hire или Team? Посчитай.",
        ip: "203.0.113.21",
        locale: "ru",
      },
      (event) => events.push(event),
    );
    expect(runToolMock.mock.calls.map((call) => call[1])).toEqual(["show_ui"]);
    expect(
      events.flatMap((event) =>
        event.type === "ui" ? [event.block.component] : [],
      ),
    ).toEqual(["calculator"]);
  });

  it("offers show_ui and the BLOCKS line only while the flag is on", async () => {
    const { toolsFor } = await import("../service/tools");
    const names = (userId: string | null) =>
      [
        ...toolsFor(userId),
        ...(userId ? toolsFor(userId, {}, ["jobs"]) : []),
      ].map((tool) => tool.name);
    const user = "44444444-4444-4444-8444-444444444444";
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "false");
    expect(names(null)).not.toContain("show_ui");
    expect(names(user)).not.toContain("show_ui");
    vi.stubEnv("SPOKI_INTERACTIVE_UI", "true");
    expect(names(null)).toContain("show_ui");
    expect(names(user)).toContain("show_ui");
  });
});
