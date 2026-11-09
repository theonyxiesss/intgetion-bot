import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@intgetion/kit";
import {
  FakeLLMProvider,
  fakeText,
  fakeToolCall,
  type LLMProvider,
} from "@intgetion/llm";
import {
  candidateStandIn,
  platformToolFixtures,
  registerToolFixtures,
  useTestPorts,
} from "../../test-support";
import {
  confirmAction,
  handleMessage,
  resolveConversation,
  setBotLLMForTests,
  type BotEvent,
} from "./service";

const userId = randomUUID();
const applied: { userId: string | null; jobId: string }[] = [];
const profilePatches: Record<string, unknown>[] = [];
const jobId = randomUUID();
// Digits only: letters of a hex id ("caf", "be") read as a country in the
// guest's text, which adds a signup hint and broke ~1.4% of runs.
const token = randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(3_000_000),
    outputMicroUsdPerMTok: BigInt(15_000_000),
  },
};

function useModel(provider: LLMProvider) {
  setBotLLMForTests({ provider, model: "fake-model", prices });
}

async function send(user: string | null, text: string, sessionToken?: string) {
  const { conversation, token: session } = await resolveConversation({
    userId: user,
    token: sessionToken,
    locale: "en",
  });
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId: user,
      conversation,
      text,
      ip: `198.51.100.${token.length}`,
      locale: "en",
    },
    (event) => events.push(event),
  );
  return { events, conversation, session };
}

const rowsOf = async <T>(query: ReturnType<typeof sql>) =>
  (await getDb().execute(query)) as unknown as T[];

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("7A integration tests require a loopback database");
  }
  const db = getDb();
  await db.execute(sql`
    insert into public.users (id, auth_uid, terms_accepted_at, terms_version)
    values (${userId}, ${randomUUID()}, now(), 'test')
  `);
  await db.execute(sql`insert into public.jobs (id) values (${jobId})`);
  // The candidate and the tool sets are stand-ins; the tools record their runs.
  useTestPorts({
    candidates: candidateStandIn(userId, { headline: "Engineer", desiredTitles: ["Backend engineer"] }),
  });
  registerToolFixtures(platformToolFixtures(), {
    apply_to_job: async (ctx, input) => {
      applied.push({ userId: ctx.userId, ...(input as { jobId: string }) });
      return { llm: "Applied." };
    },
    // As the real tool: a guest's changes stay in the draft (no card).
    propose_profile_update: async (ctx, input) => {
      if (!ctx.userId) {
        const draft = { ...ctx.state.draft, ...(input as Record<string, unknown>) };
        return {
          llm: "The draft profile was updated.",
          client: { kind: "draft", data: draft },
          state: { ...ctx.state, draft },
        };
      }
      profilePatches.push(input as Record<string, unknown>);
      return { llm: "The profile was saved.", client: { kind: "profile_saved", data: null } };
    },
  });
});

afterEach(() => {
  setBotLLMForTests(undefined);
  vi.unstubAllEnvs();
});

afterAll(async () => {
  const db = getDb();
  await db.execute(sql`
    delete from public.bot_conversations
    where user_id = ${userId}
       or (user_id is null and created_at > now() - interval '1 hour')
  `);
  await db.execute(sql`delete from public.jobs where id = ${jobId}`);
  await db.execute(
    sql`delete from public.audit_logs where actor_id = ${userId}`,
  );
  await db.execute(sql`delete from public.users where id = ${userId}`);
});

describe("bot conversation (7A)", () => {

  it("P11: a guest whose model calls apply gets no application", async () => {
    useModel(new FakeLLMProvider([fakeToolCall("apply_to_job", { jobId })]));
    const { events } = await send(null, "apply for me");
    expect(events).toContainEqual({ type: "error", code: "BOT_TRY_LATER" });
    expect(applied).toHaveLength(0);
  });

  it("P8: apply waits for the card; the confirmation works once", async () => {
    useModel(
      new FakeLLMProvider([
        fakeToolCall("apply_to_job", { jobId }),
        fakeText("unused"),
      ]),
    );
    const { events, conversation } = await send(userId, "apply to it");
    const request = events.find((event) => event.type === "confirm_request");
    expect(request).toMatchObject({ tool: "apply_to_job", args: { jobId } });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_end",
        name: "apply_to_job",
        status: "waiting",
      }),
    );
    expect(applied).toHaveLength(0);

    const confirmationId = (request as { confirmationId: string })
      .confirmationId;
    await expect(
      confirmAction({
        userId,
        conversation,
        confirmationId,
        accept: true,
      }),
    ).resolves.toMatchObject({ accepted: true });
    expect(applied).toEqual([{ userId, jobId }]);
    await expect(
      confirmAction({ userId, conversation, confirmationId, accept: true }),
    ).rejects.toMatchObject({ status: 410, code: "CONFIRMATION_EXPIRED" });
  });

  it("an expired confirmation does nothing", async () => {
    useModel(
      new FakeLLMProvider([
        fakeToolCall("propose_profile_update", { headline: "Data engineer" }),
      ]),
    );
    const { events, conversation } = await send(userId, "update my headline");
    const request = events.find(
      (event) => event.type === "confirm_request",
    ) as {
      confirmationId: string;
    };
    await expect(
      confirmAction(
        {
          userId,
          conversation,
          confirmationId: request.confirmationId,
          accept: true,
        },
        new Date(Date.now() + 11 * 60 * 1000),
      ),
    ).rejects.toMatchObject({ status: 410 });
    expect(profilePatches).toHaveLength(0);
  });

  it("refuses politely without a model or over the daily budget", async () => {
    setBotLLMForTests(null);
    expect((await send(null, "hello")).events).toContainEqual({
      type: "error",
      code: "BOT_UNAVAILABLE",
    });
    // One paid answer today, then a budget below it.
    useModel(
      new FakeLLMProvider([fakeText("Hello! How can I help?", { tokensIn: 1000, tokensOut: 100 })]),
    );
    await send(null, "hello");
    useModel(new FakeLLMProvider([]));
    vi.stubEnv("LLM_DAILY_BUDGET_USD", "0.000001");
    expect((await send(null, "hello")).events).toContainEqual({
      type: "error",
      code: "BOT_BUDGET_EXCEEDED",
    });
  });

  it("binds a guest draft to the signed-in user and offers a save card", async () => {
    useModel(
      new FakeLLMProvider([
        fakeToolCall("propose_profile_update", {
          headline: "Backend engineer",
          timezone: "Europe/Berlin",
        }),
      ]),
    );
    const guest = await send(null, "I am a backend engineer in Berlin");
    expect(guest.events.some((event) => event.type === "tool_result")).toBe(
      true,
    );
    setBotLLMForTests(null);
    const bound = await send(userId, "I signed in", guest.session);
    expect(bound.events).toContainEqual(
      expect.objectContaining({ type: "fill_choice" }),
    );
    expect(bound.events).toContainEqual(
      expect.objectContaining({
        type: "resume_ack",
        text: expect.stringContaining("already told"),
      }),
    );
    expect(bound.events).toContainEqual({
      type: "error",
      code: "BOT_UNAVAILABLE",
    });
    expect(bound.conversation.id).toBe(guest.conversation.id);
    const [row] = await rowsOf<{ user_id: string }>(
      sql`select user_id from public.bot_conversations where id = ${guest.conversation.id}`,
    );
    expect(row?.user_id).toBe(userId);
  });

  it("keeps Italy across a refresh and does not ask for it again", async () => {
    useModel(
      new FakeLLMProvider([
        fakeToolCall("record_result", { country: "Италии" }),
        fakeText(""),
      ]),
    );
    const first = await send(null, "В Италии");
    expect(first.events).toContainEqual(
      expect.objectContaining({
        type: "token",
        text: expect.stringContaining("Italy"),
      }),
    );
    const [stored] = await rowsOf<{ state: { draft?: { country?: string } } }>(
      sql`select state from public.bot_conversations where id = ${first.conversation.id}`,
    );
    expect(stored?.state.draft?.country).toBe("IT");

    const provider = new FakeLLMProvider([
      fakeToolCall("record_result", {}),
      fakeText("What kind of work are you looking for?"),
    ]);
    useModel(provider);
    const second = await send(null, "customer support", first.session);
    expect(second.conversation.id).toBe(first.conversation.id);
    const chat = provider.requests.find(
      (request) => request.toolChoice !== "record_result",
    );
    expect(chat?.system).toContain('"country":"IT"');
    expect(chat?.system).not.toContain("about: country");
    const [again] = await rowsOf<{ state: { draft?: { country?: string } } }>(
      sql`select state from public.bot_conversations where id = ${first.conversation.id}`,
    );
    expect(again?.state.draft?.country).toBe("IT");
  });

  it("resumes the signed-in conversation when the cookie is gone", async () => {
    setBotLLMForTests(null);
    const first = await send(userId, "hello from a saved thread");
    const again = await resolveConversation({
      userId,
      token: undefined,
      locale: "en",
    });
    expect(again.conversation.id).toBe(first.conversation.id);
    expect(again.token).not.toBe(first.session);
  });

});
