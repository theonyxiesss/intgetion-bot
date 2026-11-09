import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { FakeLLMProvider, fakeText } from "@intgetion/llm";
import {
  handleMessage,
  resolveConversation,
  setBotLLMForTests,
  type BotEvent,
} from "./service";

/** A question answered with a bare greeting is asked once more. */
const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(3_000_000),
    outputMicroUsdPerMTok: BigInt(15_000_000),
  },
};
const created: string[] = [];

async function send(provider: FakeLLMProvider, text: string, ip: string) {
  setBotLLMForTests({ provider, model: "fake-model", prices });
  const { conversation } = await resolveConversation({
    userId: null,
    token: undefined,
    locale: "ru",
  });
  created.push(conversation.id);
  const events: BotEvent[] = [];
  await handleMessage(
    { userId: null, conversation, text, ip, locale: "ru" },
    (event) => events.push(event),
  );
  return events
    .filter((event) => event.type === "token")
    .map((event) => (event as { text: string }).text);
}

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("Greeting tests require a loopback database");
  }
});

afterEach(() => setBotLLMForTests(undefined));

afterAll(async () => {
  for (const id of created) {
    await getDb().execute(
      sql`delete from public.bot_conversations where id = ${id}`,
    );
  }
});

describe("bare greeting on a question (hotfix 2026-10-17)", () => {
  it("does not show the greeting and answers on the second try", async () => {
    const provider = new FakeLLMProvider([
      fakeText("Привет! Чем могу помочь?"),
      fakeText("Для начинающих чаще открыты поддержка, QA и контент."),
    ]);
    const texts = await send(
      provider,
      "Я только начинаю. Какие есть роли для джуниоров?",
      "198.51.100.81",
    );
    expect(texts).toEqual([
      "Для начинающих чаще открыты поддержка, QA и контент.",
    ]);
    const chats = provider.requests.filter(
      (request) => request.toolChoice !== "record_result",
    );
    expect(chats).toHaveLength(2);
    expect(chats[1]!.system).toContain("not a greeting");
  });

  it("keeps a greeting answer to a greeting", async () => {
    const provider = new FakeLLMProvider([
      fakeText("Привет! Чем могу помочь?"),
    ]);
    const texts = await send(provider, "Привет", "198.51.100.82");
    expect(texts).toEqual(["Привет! Чем могу помочь?"]);
  });
});
