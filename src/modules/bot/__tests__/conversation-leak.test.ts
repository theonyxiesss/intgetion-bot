import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeLLMProvider, fakeText, fakeToolCall } from "@intgetion/llm";
import { setVacancyReaderForTests } from "../service/fit";
import { searchFiltersFromDraft } from "../service/memory";
import type { BotEvent } from "../service/conversation";

const LEAKED_OFFER = `<tool_call>
<function=offer_step>
<parameter=step>
pay_plus
</parameter>
</function>
</tool_call>`;

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
  return {
    ...actual,
    enforceRateLimit: () => Promise.resolve(),
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

const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(1),
    outputMicroUsdPerMTok: BigInt(1),
  },
};

const readyDraft = {
  country: "IT",
  desiredTitles: ["community manager"],
  workFormats: ["remote"],
};

function conversation(draft: Record<string, unknown>) {
  return {
    id: "c1",
    userId: null,
    channel: "web",
    sessionTokenHash: "hash",
    jobId: null,
    campaignId: null,
    inviteId: null,
    locale: "ru",
    state: { draft },
    summary: null,
    linkedAt: null,
    createdAt: new Date(),
    lastMessageAt: new Date(),
  };
}

function visibleText(events: BotEvent[]): string {
  return events.map((event) => ("text" in event ? event.text : "")).join("\n");
}

describe("a tool call written as text (D381)", () => {
  beforeEach(() => {
    messages.length = 0;
    setVacancyReaderForTests(async () => null);
    runToolMock.mockReset();
    runToolMock.mockResolvedValue({
      llm: "one job",
      client: {
        kind: "jobs",
        data: [
          {
            id: "job-1",
            title: "Community Manager",
            companyName: "Acme",
          },
        ],
      },
    });
    setBotLLMForTests({
      provider: new FakeLLMProvider([fakeText(LEAKED_OFFER)]),
      model: "fake-model",
      prices,
    });
  });

  it("searches instead of forwarding the fake offer_step", async () => {
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation(readyDraft),
        text: "комюнити менеджер",
        ip: "203.0.113.9",
        locale: "ru",
      },
      (event) => events.push(event),
    );

    const shown = visibleText(events);
    expect(shown).not.toContain("<tool_call");
    expect(shown).not.toContain("</tool_call>");
    expect(shown).not.toContain("function=");
    expect(shown).not.toContain("<parameter=");
    expect(shown).not.toContain("pay_plus");
    expect(runToolMock).toHaveBeenCalledTimes(1);
    expect(runToolMock.mock.calls[0]?.[1]).toBe("search_jobs");
    expect(runToolMock.mock.calls[0]?.[2]).toEqual({});
    const draft = (
      runToolMock.mock.calls[0]?.[0] as {
        state: { draft: Record<string, unknown> };
      }
    ).state.draft;
    expect(searchFiltersFromDraft(draft)).toMatchObject({
      q: "community manager",
      workFormat: "remote",
      country: undefined,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        name: "search_jobs",
        kind: "jobs",
      }),
    );
    expect(
      messages
        .filter((row) => row.role === "assistant")
        .every((row) => !row.content.includes("<tool_call")),
    ).toBe(true);
  });

  it("does not search when the draft is not ready, and still hides the markup", async () => {
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation({ country: "IT" }),
        text: "комюнити менеджер",
        ip: "203.0.113.10",
        locale: "ru",
      },
      (event) => events.push(event),
    );
    expect(runToolMock).not.toHaveBeenCalled();
    expect(visibleText(events)).not.toContain("<tool_call");
    expect(visibleText(events)).toContain("какую работу");
  });

  it("does not replace a real search_jobs call", async () => {
    setBotLLMForTests({
      provider: new FakeLLMProvider([
        fakeToolCall("search_jobs", { q: "community manager" }),
        fakeText("One role."),
      ]),
      model: "fake-model",
      prices,
    });
    const events: BotEvent[] = [];
    await handleMessage(
      {
        userId: null,
        conversation: conversation(readyDraft),
        text: "покажи вакансии",
        ip: "203.0.113.11",
        locale: "ru",
      },
      (event) => events.push(event),
    );
    const names = runToolMock.mock.calls.map((call) => call[1]);
    expect(names).toEqual(["search_jobs"]);
    expect(runToolMock.mock.calls[0]?.[2]).toEqual({
      q: "community manager",
    });
    expect(visibleText(events)).toContain("One role.");
  });

  it("strips the same markup from the web transcript", async () => {
    messages.push(
      {
        id: "old",
        role: "assistant",
        content: LEAKED_OFFER,
        toolCall: null,
        createdAt: new Date(),
      },
      {
        id: "mixed",
        role: "assistant",
        content: `Look at this.\n${LEAKED_OFFER}`,
        toolCall: null,
        createdAt: new Date(),
      },
    );
    const history = await conversationHistory("c1");
    expect(history.find((row) => row.id === "old")).toBeUndefined();
    expect(history.find((row) => row.id === "mixed")?.content).toBe(
      "Look at this.",
    );
    expect(history.some((row) => row.content.includes("<tool_call"))).toBe(
      false,
    );
  });
});
