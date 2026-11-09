import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@intgetion/kit";
import { users } from "../../test-support";
import * as repo from "./repo/bot-repo";

/**
 * The Spoki action journal on a real database (D521, migration 0070): one
 * card is one row, a finished action is not rewritten, and nobody reads or
 * moves another person's rows.
 */

const owner = randomUUID();
const stranger = randomUUID();
const now = new Date();

beforeAll(async () => {
  for (const id of [owner, stranger]) {
    await getDb().insert(users).values({
      id,
      authUid: randomUUID(),
      termsAcceptedAt: now,
      termsVersion: "2026-10-03",
      locale: "en",
    });
  }
});

afterAll(async () => {
  await getDb()
    .delete(users)
    .where(inArray(users.id, [owner, stranger]));
});

describe("bot_actions (D521)", () => {
  it("keeps one row per card and moves it only forward", async () => {
    const confirmationId = randomUUID();
    const base = {
      userId: owner,
      conversationId: null,
      channel: "web" as const,
      tool: "apply_to_job",
      kind: "card" as const,
      status: "awaiting_confirmation" as const,
      confirmationId,
      argsHash: "h",
      now,
    };
    await repo.insertAction(base);
    await repo.insertAction(base);
    expect(
      (await repo.listActionsForUser(owner, 50)).filter(
        (row) => row.confirmationId === confirmationId,
      ),
    ).toHaveLength(1);

    expect(
      await repo.moveCardAction(
        confirmationId,
        stranger,
        ["awaiting_confirmation"],
        { status: "executing" },
        now,
      ),
    ).toBe(false);
    expect(
      await repo.moveCardAction(
        confirmationId,
        owner,
        ["awaiting_confirmation"],
        { status: "executing", confirmedAt: now },
        now,
      ),
    ).toBe(true);
    expect(
      await repo.moveCardAction(
        confirmationId,
        owner,
        ["executing"],
        {
          status: "completed",
          finishedAt: now,
          entityType: "application",
          entityId: "a1",
        },
        now,
      ),
    ).toBe(true);
    // A late or repeated step does not rewrite the finished action.
    expect(
      await repo.moveCardAction(
        confirmationId,
        owner,
        ["awaiting_confirmation", "executing"],
        { status: "failed", errorCode: "CONFLICT" },
        now,
      ),
    ).toBe(false);
    const [row] = (await repo.listActionsForUser(owner, 50)).filter(
      (item) => item.confirmationId === confirmationId,
    );
    expect(row).toMatchObject({ status: "completed", entityId: "a1" });
  });

  it("never lists another person's actions", async () => {
    expect(await repo.listActionsForUser(stranger, 50)).toEqual([]);
  });

  it("expires an unanswered card and interrupts a stuck action", async () => {
    const old = new Date(now.getTime() - 60 * 60 * 1000);
    const waiting = randomUUID();
    const stuck = randomUUID();
    for (const [confirmationId, status] of [
      [waiting, "awaiting_confirmation"],
      [stuck, "executing"],
    ] as const) {
      await repo.insertAction({
        userId: owner,
        conversationId: null,
        channel: "web",
        tool: "follow_company",
        kind: "card",
        status,
        confirmationId,
        now: old,
      });
    }
    await repo.sweepActions({
      awaitingBefore: new Date(now.getTime() - 10 * 60 * 1000),
      executingBefore: new Date(now.getTime() - 10 * 60 * 1000),
      deleteBefore: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
      now,
    });
    const rows = await repo.listActionsForUser(owner, 50);
    expect(rows.find((r) => r.confirmationId === waiting)?.status).toBe(
      "expired",
    );
    expect(rows.find((r) => r.confirmationId === stuck)?.status).toBe(
      "interrupted",
    );
  });
});
