import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { FakeLLMProvider, fakeText, fakeToolCall } from "@intgetion/llm";
import { candidateStandIn, useTestPorts } from "../../test-support";
import {
  MEMORY_MAX_FACTS,
  clearMemory,
  editFact,
  forgetFact,
  handleMessage,
  listMemory,
  rememberFact,
  resolveConversation,
  runTool,
  setBotLLMForTests,
  type BotEvent,
} from "./service";

/** Spoki memory (D469) against a real database. */
const userId = randomUUID();
const otherId = randomUUID();
const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(3_000_000),
    outputMicroUsdPerMTok: BigInt(15_000_000),
  },
};

async function send(provider: FakeLLMProvider, text: string) {
  setBotLLMForTests({ provider, model: "fake-model", prices });
  const { conversation } = await resolveConversation({
    userId,
    token: undefined,
    locale: "en",
  });
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId,
      conversation,
      text,
      ip: "198.51.100.69",
      locale: "en",
    },
    (event) => events.push(event),
  );
  return events;
}

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("Memory integration tests require a loopback database");
  }
  const db = getDb();
  for (const id of [userId, otherId]) {
    await db.execute(sql`
      insert into public.users (id, auth_uid, terms_accepted_at, terms_version)
      values (${id}, ${randomUUID()}, now(), 'test')
    `);
  }
  useTestPorts({
    candidates: candidateStandIn(userId, {
      headline: "Support lead",
      desiredTitles: ["Customer support lead"],
      country: "PT",
      timezone: "Europe/Lisbon",
      workFormats: ["remote"],
      employmentTypes: ["full_time"],
      experienceYears: 6,
      languages: [{ lang: "en", level: "C1" }],
    }),
  });
});

afterEach(async () => {
  setBotLLMForTests(undefined);
  await clearMemory(userId);
  await clearMemory(otherId);
});

afterAll(async () => {
  const db = getDb();
  await db.execute(
    sql`delete from public.bot_conversations where user_id in (${userId}, ${otherId})`,
  );
  await db.execute(
    sql`delete from public.audit_logs where actor_id in (${userId}, ${otherId})`,
  );
  await db.execute(
    sql`delete from public.users where id in (${userId}, ${otherId})`,
  );
});

describe("Spoki memory (D469)", () => {
  it("keeps a fact once and lists only the owner's facts", async () => {
    const first = await rememberFact(userId, "Wants a four-day week", "chat");
    const again = await rememberFact(userId, "wants a four-day week", "site");
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    await rememberFact(otherId, "Another person's goal", "chat");
    const mine = await listMemory(userId);
    expect(mine.map((fact) => fact.fact)).toEqual(["Wants a four-day week"]);
  });

  it("never stores contacts or secrets", async () => {
    expect(
      await rememberFact(userId, "Write to me at ada@example.com", "chat"),
    ).toEqual({ ok: false, reason: "contacts" });
    expect(
      await rememberFact(userId, "My password is hunter22", "chat"),
    ).toEqual({ ok: false, reason: "secret" });
    expect(await listMemory(userId)).toHaveLength(0);
  });

  it("stops at the limit", async () => {
    for (let i = 0; i < MEMORY_MAX_FACTS; i += 1) {
      await rememberFact(userId, `Goal number ${i}`, "site");
    }
    expect(await rememberFact(userId, "One more goal", "site")).toEqual({
      ok: false,
      reason: "full",
    });
  });

  it("does not let one person edit or erase another person's fact", async () => {
    const theirs = await rememberFact(otherId, "Prefers small teams", "chat");
    if (!theirs.ok) throw new Error("setup failed");
    await expect(
      editFact(userId, theirs.fact.id, "Hijacked"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(forgetFact(userId, theirs.fact.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await listMemory(otherId))[0]?.fact).toBe("Prefers small teams");
  });

  it("remembers and forgets through the tools without a card", async () => {
    const ctx = {
      userId,
      conversationId: randomUUID(),
      locale: "en",
      state: {},
    };
    const kept = await runTool(ctx, "remember_fact", {
      fact: "Interviews only after 14:00 Lisbon time",
    });
    expect(kept.client).toEqual({ kind: "offer", data: { action: "memory" } });
    const [fact] = await listMemory(userId);
    const ref = fact!.id.replace(/-/g, "").slice(0, 8);
    expect(kept.llm).toContain(ref);
    const gone = await runTool(ctx, "forget_fact", { ref });
    expect(gone.llm).toBe("Erased from memory.");
    expect(await listMemory(userId)).toHaveLength(0);
    await expect(
      runTool({ ...ctx, userId: null }, "remember_fact", { fact: "x" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("puts the saved profile and memory into a fresh thread", async () => {
    await rememberFact(userId, "Wants to move into team management", "chat");
    const provider = new FakeLLMProvider([
      fakeText("Do you want me to look for lead roles?"),
    ]);
    await send(provider, "anything new for me?");
    const chat = provider.requests.find(
      (request) => request.toolChoice !== "record_result",
    );
    expect(chat?.system).toContain('"country":"PT"');
    expect(chat?.system).toContain("Customer support lead");
    expect(chat?.system).not.toContain("about: country");
    expect(chat?.system).toContain("Wants to move into team management");
    expect(chat?.system).toContain('<untrusted_data source="user_message">');
    expect(chat?.tools?.map((tool) => tool.name)).toContain("remember_fact");
  });

  it("stores what the model keeps and tells the chat where memory lives", async () => {
    const provider = new FakeLLMProvider([
      fakeToolCall("remember_fact", { fact: "Has a cat allergy at offices" }),
      fakeText("Kept that. You can see it in settings."),
    ]);
    const events = await send(provider, "remember that I am allergic to cats");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        kind: "offer",
        data: { action: "memory" },
      }),
    );
    expect((await listMemory(userId)).map((fact) => fact.fact)).toEqual([
      "Has a cat allergy at offices",
    ]);
  });
});
