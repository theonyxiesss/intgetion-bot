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
import { FakeLLMProvider, fakeText, fakeToolCall } from "@intgetion/llm";
import {
  conversationHistory,
  handleMessage,
  resolveConversation,
  runUiAction,
  setBotLLMForTests,
  type BotEvent,
} from "./service";
import type { UiBlock } from "./ui/types";
import { platformToolFixtures, registerToolFixtures } from "../../test-support";

/** Spoki blocks (D523) against a real database: owner, journal, history. */
const userId = randomUUID();
const otherId = randomUUID();
const companyId = randomUUID();
const jobId = randomUUID();
const token = randomUUID().replace(/\D/g, "").padEnd(8, "0").slice(0, 8);
const title = `Block role ${token}`;
const prices = {
  "fake-model": {
    inputMicroUsdPerMTok: BigInt(1),
    outputMicroUsdPerMTok: BigInt(1),
  },
};

const rowsOf = async <T>(query: ReturnType<typeof sql>) =>
  (await getDb().execute(query)) as unknown as T[];

let block: UiBlock;
/** What the save_job stand-in was asked to save. */
const saved: { userId: string | null; jobId: string }[] = [];
let conversationId: string;

beforeAll(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (
    !dbUrl ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      new URL(dbUrl).hostname,
    )
  ) {
    throw new Error("Block integration tests require a loopback database");
  }
  const db = getDb();
  for (const id of [userId, otherId]) {
    await db.execute(sql`
      insert into public.users (id, auth_uid, terms_accepted_at, terms_version)
      values (${id}, ${randomUUID()}, now(), 'test')
    `);
  }
  await db.execute(sql`insert into public.jobs (id) values (${jobId})`);
  // Stand-ins for the jobs tools: the search returns this job as a card,
  // the save records what it was asked.
  registerToolFixtures(platformToolFixtures(), {
    search_jobs: async () => ({
      llm: "One job.",
      client: {
        kind: "jobs",
        data: [
          {
            id: jobId,
            title,
            companyName: `Block Co ${token}`,
            company: { id: companyId, slug: `block-${token}`, logoPath: null },
            workFormat: "remote",
            location: null,
            locationCountry: null,
            salaryMin: null,
            salaryMax: null,
          },
        ],
      },
    }),
    save_job: async (ctx, input) => {
      saved.push({ userId: ctx.userId, ...(input as { jobId: string }) });
      return { llm: "Saved." };
    },
  });

  // One real turn with the flag on: the search's cards come as a block.
  vi.stubEnv("SPOKI_INTERACTIVE_UI", "true");
  setBotLLMForTests({
    provider: new FakeLLMProvider([
      fakeToolCall("search_jobs", { q: title }),
      fakeText("Here is one job."),
    ]),
    model: "fake-model",
    prices,
  });
  const { conversation } = await resolveConversation({
    userId,
    token: undefined,
    locale: "en",
  });
  conversationId = conversation.id;
  const events: BotEvent[] = [];
  await handleMessage(
    {
      userId,
      conversation,
      text: `Find ${title}`,
      ip: "198.51.100.77",
      locale: "en",
    },
    (event) => events.push(event),
  );
  const ui = events.find(
    (event): event is Extract<BotEvent, { type: "ui" }> => event.type === "ui",
  );
  if (!ui) throw new Error(`no block: ${JSON.stringify(events)}`);
  block = ui.block;
});

afterEach(() => {
  setBotLLMForTests(undefined);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const db = getDb();
  await db.execute(
    sql`delete from public.bot_conversations where user_id in (${userId}, ${otherId})`,
  );
  await db.execute(
    sql`delete from public.bot_actions where user_id in (${userId}, ${otherId})`,
  );
  await db.execute(
    sql`delete from public.audit_logs where actor_id in (${userId}, ${otherId})`,
  );
  await db.execute(sql`delete from public.jobs where id = ${jobId}`);
  await db.execute(
    sql`delete from public.users where id in (${userId}, ${otherId})`,
  );
});

const press = (who: string | null, actionId: string, blockId = block.id) =>
  runUiAction({
    userId: who,
    token: undefined,
    ip: "198.51.100.78",
    blockId,
    actionId,
  });

describe("Spoki blocks (D523)", () => {
  it("draws the search block again from the history", async () => {
    expect(block.component).toBe("job_cards");
    const history = await conversationHistory(conversationId);
    const row = history.find((message) => message.role === "ui");
    expect(row).toMatchObject({ block: { id: block.id }, done: [] });
  });

  it("does not let another person press a button of this block", async () => {
    await expect(press(otherId, `save:${jobId}`)).rejects.toMatchObject({
      status: 404,
    });
    await expect(press(null, `save:${jobId}`)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("saves the job, writes the journal and keeps the button done", async () => {
    const result = await press(userId, `save:${jobId}`);
    expect(result).toMatchObject({ kind: "done", actionId: `save:${jobId}` });
    expect(saved).toEqual([{ userId, jobId }]);
    const journal = await rowsOf<{
      tool: string;
      kind: string;
      status: string;
    }>(
      sql`select tool, kind, status from public.bot_actions where user_id = ${userId}`,
    );
    expect(journal).toContainEqual({
      tool: "save_job",
      kind: "direct",
      status: "completed",
    });
    const history = await conversationHistory(conversationId);
    expect(history.find((message) => message.role === "ui")).toMatchObject({
      done: [`save:${jobId}`],
    });
    expect(
      history.some(
        (message) =>
          message.role === "system_event" &&
          message.content.startsWith("The person pressed Save"),
      ),
    ).toBe(true);
  });

  it("refuses a write from a block whose data is old", async () => {
    await getDb().execute(sql`
      update public.bot_messages
      set tool_call = jsonb_set(tool_call, '{ui,source,at}', to_jsonb(to_char((now() - interval '2 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      where conversation_id = ${conversationId} and tool_call -> 'ui' ->> 'id' = ${block.id}
    `);
    await expect(press(userId, `save:${jobId}`)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refreshes the old block in place with fresh data", async () => {
    const result = await press(userId, "refresh");
    expect(result.kind).toBe("refreshed");
    const fresh = (result as { block: UiBlock }).block;
    expect(fresh.id).toBe(block.id);
    expect(Date.now() - Date.parse(fresh.source.at)).toBeLessThan(60_000);
    // Fresh data: the write works again.
    await expect(press(userId, `save:${jobId}`)).resolves.toMatchObject({
      kind: "done",
    });
  });

  it("forgets a block after 24 hours with its text (D471)", async () => {
    await getDb().execute(sql`
      update public.bot_messages set created_at = now() - interval '25 hours'
      where conversation_id = ${conversationId} and tool_call -> 'ui' ->> 'id' = ${block.id}
    `);
    await expect(press(userId, "refresh")).rejects.toMatchObject({
      status: 404,
    });
  });
});
