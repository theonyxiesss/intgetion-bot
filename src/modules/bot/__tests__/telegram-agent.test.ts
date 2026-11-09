import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotEvent } from "../service/conversation";

const sent: Array<{
  chatId: number;
  text: string;
  links?: { label: string; url: string }[];
}> = [];
const actions: string[] = [];
let linkedUserId: string | null = null;
let turn: (emit: (event: BotEvent) => void) => void | Promise<void> = () => {};
let lastInput: Record<string, unknown> | null = null;

vi.mock("../../../platform", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const parts = await Promise.all([
    ((() => ({
  sendTelegramMessage: (_token: string, chatId: number, text: string) => {
    sent.push({ chatId, text });
    return Promise.resolve();
  },
  sendTelegramLinks: (
    _token: string,
    chatId: number,
    text: string,
    links: { label: string; url: string }[],
  ) => {
    sent.push({ chatId, text, links });
    return Promise.resolve();
  },
  sendTelegramChatAction: (_t: string, _c: number, action: string) => {
    actions.push(action);
    return Promise.resolve();
  },
  userIdForTelegramId: () => Promise.resolve(linkedUserId),
})) as (...args: unknown[]) => unknown)(importOriginal),
  ]);
  // A part that spreads the original must not undo the mocks before it.
  const changed = (parts as Record<string, unknown>[]).map((part) =>
    Object.fromEntries(Object.entries(part).filter(([key, value]) => value !== actual[key])),
  );
  return Object.assign({}, actual, ...changed);
});

vi.mock("../service/conversation", () => ({
  openJobDraftConversation: () =>
    Promise.resolve({ conversation: { id: "c1", state: {} }, token: "tg" }),
  resolveConversation: (input: Record<string, unknown>) =>
    Promise.resolve({
      conversation: { id: "c1", state: {}, sessionTokenHash: "h" },
      token: String(input.token),
    }),
  handleMessage: async (
    input: Record<string, unknown>,
    emit: (event: BotEvent) => void,
  ) => {
    lastInput = input;
    await turn(emit);
  },
}));

const { handleTelegramAgentUpdate } = await import("../service/telegram-agent");

/** The reply a person saw in Telegram on 2026-10-09. It is text, not a tool call. */
const LEAKED_OFFER = `<tool_call>
<function=offer_step>
<parameter=step>
pay_plus
</parameter>
</function>
</tool_call>`;

function assertNoToolMarkup(text: string) {
  expect(text).not.toContain("<tool_call");
  expect(text).not.toContain("</tool_call>");
  expect(text).not.toContain("function=");
  expect(text).not.toContain("<parameter=");
}

const update = (text: string, language = "en") => ({
  message: {
    text,
    chat: { id: 42 },
    from: { id: 7, is_bot: false, language_code: language },
  },
});

describe("the agent inside the Telegram bot (D311)", () => {
  beforeEach(() => {
    sent.length = 0;
    actions.length = 0;
    linkedUserId = null;
    lastInput = null;
    turn = () => {};
    process.env.PRIVACY_HASH_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  });

  it("answers an ordinary question and shows it is working", async () => {
    turn = (emit) => {
      emit({ type: "token", text: "Three remote " });
      emit({ type: "token", text: "Solidity roles." });
    };
    await handleTelegramAgentUpdate("token", update("solidity jobs"));
    expect(actions).toEqual(["typing"]);
    expect(sent).toEqual([
      { chatId: 42, text: "Three remote Solidity roles." },
    ]);
    expect(lastInput).toMatchObject({ text: "solidity jobs", locale: "en" });
  });

  it("does not send a tool call the model only wrote as text", async () => {
    turn = (emit) => {
      emit({ type: "token", text: LEAKED_OFFER });
    };
    await handleTelegramAgentUpdate("token", update("комюнити менеджер", "ru"));
    expect(sent.length).toBeGreaterThan(0);
    assertNoToolMarkup(sent.map((item) => item.text).join("\n"));
    expect(sent.map((item) => item.text).join("\n")).not.toContain("pay_plus");
  });

  it("sends job cards as links to our own pages", async () => {
    turn = (emit) => {
      emit({ type: "token", text: "Here you go." });
      emit({
        type: "tool_result",
        kind: "jobs",
        data: [
          { id: "job-1", title: "Solidity Engineer", companyName: "Acme" },
        ],
      } as BotEvent);
    };
    await handleTelegramAgentUpdate("token", update("solidity"));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("Solidity Engineer — Acme");
    expect(sent[1].text).not.toContain("http");
    expect(sent[1].links).toEqual([
      {
        label: "Solidity Engineer",
        url: "https://example.test/jobs/job-1",
      },
    ]);
  });

  it("shows a Spoki block as its text and one link to our page (D523)", async () => {
    turn = (emit) => {
      emit({ type: "token", text: "Here is the cost." });
      emit({
        type: "ui",
        block: {
          fallback: { text: "4 videos × $50 = $200.", path: "/campaigns" },
        },
      } as unknown as BotEvent);
    };
    await handleTelegramAgentUpdate("token", update("ugc budget"));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      chatId: 42,
      text: "4 videos × $50 = $200.",
      links: [{ label: "Open", url: "https://example.test/campaigns" }],
    });
  });

  it("keeps the job line and link when the same turn also leaked tool markup", async () => {
    turn = (emit) => {
      emit({ type: "token", text: `Here you go.\n${LEAKED_OFFER}` });
      emit({
        type: "tool_result",
        kind: "jobs",
        data: [
          {
            id: "job-1",
            title: "Community Manager",
            companyName: "Acme",
          },
        ],
      } as BotEvent);
    };
    await handleTelegramAgentUpdate("token", update("community manager"));
    const blob = sent.map((item) => item.text).join("\n");
    assertNoToolMarkup(blob);
    expect(blob).toContain("Here you go.");
    expect(blob).toContain("Community Manager — Acme");
    expect(sent.some((item) => item.links?.[0]?.url)).toBe(true);
    expect(sent.find((item) => item.links?.length)?.links).toEqual([
      {
        label: "Community Manager",
        url: "https://example.test/jobs/job-1",
      },
    ]);
  });

  it("answers in Russian when Telegram says the person speaks it", async () => {
    turn = (emit) => emit({ type: "error", code: "BOT_UNAVAILABLE" });
    await handleTelegramAgentUpdate("token", update("вакансии", "ru-RU"));
    expect(sent[0].text).toContain("Агент сейчас недоступен");
    expect(lastInput).toMatchObject({ locale: "ru" });
  });

  it("answers in Brazilian Portuguese for pt and pt-br (D350)", async () => {
    turn = (emit) => emit({ type: "error", code: "BOT_UNAVAILABLE" });
    await handleTelegramAgentUpdate("token", update("vagas", "pt-br"));
    expect(sent[0].text).toContain("O agente está descansando");
    expect(lastInput).toMatchObject({ locale: "pt-BR" });
    sent.length = 0;
    await handleTelegramAgentUpdate("token", update("vagas", "pt"));
    expect(sent[0].text).toContain("/pt-BR/jobs");
  });

  it("answers in German for de and de-at (D373)", async () => {
    turn = (emit) => emit({ type: "error", code: "BOT_UNAVAILABLE" });
    await handleTelegramAgentUpdate("token", update("Jobs", "de"));
    expect(sent[0].text).toContain("Der Agent ruht gerade");
    expect(sent[0].text).toContain("/de/jobs");
    expect(lastInput).toMatchObject({ locale: "de" });
    sent.length = 0;
    await handleTelegramAgentUpdate("token", update("Jobs", "de-at"));
    expect(lastInput).toMatchObject({ locale: "de" });
  });

  it("answers in French for fr, fr-fr, fr-ca, fr-be and fr-ch (D374)", async () => {
    turn = (emit) => emit({ type: "error", code: "BOT_UNAVAILABLE" });
    for (const code of ["fr", "fr-fr", "fr-ca", "fr-be", "fr-ch"]) {
      sent.length = 0;
      await handleTelegramAgentUpdate("token", update("offres", code));
      expect(sent[0].text).toContain("L’agent se repose");
      expect(sent[0].text).toContain("/fr/jobs");
      expect(lastInput).toMatchObject({ locale: "fr" });
    }
  });

  it("answers in Italian for it, it-it and it-ch (D379)", async () => {
    turn = (emit) => emit({ type: "error", code: "BOT_UNAVAILABLE" });
    for (const code of ["it", "it-it", "it-ch"]) {
      sent.length = 0;
      await handleTelegramAgentUpdate("token", update("offerte", code));
      expect(sent[0].text).toContain("L’agente sta riposando");
      expect(sent[0].text).toContain("/it/jobs");
      expect(lastInput).toMatchObject({ locale: "it" });
    }
  });

  it("falls back to English for languages without their own copy", async () => {
    turn = (emit) => emit({ type: "error", code: "BOT_UNAVAILABLE" });
    await handleTelegramAgentUpdate("token", update("empleos", "es"));
    expect(sent[0].text).toContain("The agent is resting");
    expect(lastInput).toMatchObject({ locale: "en" });
  });

  it("sends a pay step as a sign-in link when the chat is not linked", async () => {
    turn = (emit) => {
      emit({ type: "token", text: "Plus is a 30-day payment." });
      emit({
        type: "tool_result",
        name: "offer_step",
        kind: "offer",
        data: { action: "pay_plus" },
      });
    };
    await handleTelegramAgentUpdate("token", update("how do I pay for plus"));
    expect(sent[1].links).toEqual([
      {
        label: "Pay for Plus",
        url: "https://example.test/login?next=billing-plus",
      },
    ]);
  });

  it("points a write action at the site instead of guessing consent", async () => {
    turn = (emit) =>
      emit({
        type: "confirm_request",
        confirmationId: "x",
        tool: "apply_to_job",
      } as BotEvent);
    await handleTelegramAgentUpdate("token", update("apply to the first one"));
    expect(sent[0].links?.[0]?.url).toBe(
      "https://example.test/login?next=chat",
    );
  });

  it("opens the site chat when this Telegram account is already linked", async () => {
    linkedUserId = "user-1";
    turn = (emit) =>
      emit({
        type: "confirm_request",
        confirmationId: "x",
        tool: "apply_to_job",
      } as BotEvent);
    await handleTelegramAgentUpdate("token", update("откликнуться", "ru"));
    expect(sent[0].text).toContain("Подтвердите это на сайте");
    expect(sent[0].links?.[0]).toEqual({
      label: "Открыть чат",
      url: "https://example.test/ru/chat?confirm=x",
    });
  });

  it("keeps one thread per chat and starts a new one on /reset", async () => {
    turn = (emit) => emit({ type: "token", text: "ok" });
    await handleTelegramAgentUpdate("token", update("first"));
    const first = lastInput;
    await handleTelegramAgentUpdate("token", update("second"));
    expect(lastInput).toMatchObject({ ip: "tg:42" });
    expect(
      (lastInput as { conversation: { id: string } }).conversation.id,
    ).toBe((first as { conversation: { id: string } }).conversation.id);

    sent.length = 0;
    await handleTelegramAgentUpdate("token", update("/reset"));
    expect(sent[0].text).toContain("Forgotten");
  });

  it("opens the shared vacancy draft from the Telegram command for a linked user", async () => {
    linkedUserId = "user-1";
    await handleTelegramAgentUpdate("token", update("/post_job", "ru"));
    expect(sent).toEqual([
      {
        chatId: 42,
        text: expect.stringContaining("черновик вакансии"),
      },
    ]);
    expect(lastInput).toBeNull();
  });

  it("offers the form and the /post_job command when someone asks to post a job (D516)", async () => {
    linkedUserId = "user-1";
    turn = (emit) => {
      emit({ type: "token", text: "Как удобнее?" });
      emit({
        type: "tool_result",
        name: "offer_step",
        kind: "fill_choice",
        data: { kind: "job" },
      });
    };
    await handleTelegramAgentUpdate(
      "token",
      update("можешь выставить вакансию", "ru"),
    );
    const choice = sent.find((row) => row.text.includes("/post_job"));
    expect(choice?.links?.[0]?.url).toBe("https://example.test/ru/post-job");
  });

  it("asks an unlinked Telegram user to sign in before creating a vacancy", async () => {
    await handleTelegramAgentUpdate("token", update("/post_job", "ru"));
    expect(sent[0].text).toContain("Войдите");
    expect(sent[0].links?.[0]?.url).toBe(
      "https://example.test/ru/login?next=post-job",
    );
    expect(lastInput).toBeNull();
  });

  it("explains itself on /help and ignores commands that are not ours", async () => {
    await handleTelegramAgentUpdate("token", update("/help"));
    expect(sent[0].text).toContain("/reset");
    sent.length = 0;
    await handleTelegramAgentUpdate("token", update("/settings"));
    expect(sent).toHaveLength(0);
  });

  it("says nothing to another bot or to an empty message", async () => {
    await handleTelegramAgentUpdate("token", {
      message: {
        text: "hi",
        chat: { id: 42 },
        from: { id: 9, is_bot: true, language_code: "en" },
      },
    });
    await handleTelegramAgentUpdate("token", update("   "));
    expect(sent).toHaveLength(0);
    expect(actions).toHaveLength(0);
  });
});
