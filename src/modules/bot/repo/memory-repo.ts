import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@intgetion/kit";
import { botMemoryFacts } from "../../../db/owned";

/** Spoki memory (D469). Every query is scoped by the owner's user id. */
export type MemoryFactRow = typeof botMemoryFacts.$inferSelect;

export async function listFacts(userId: string): Promise<MemoryFactRow[]> {
  return getDb()
    .select()
    .from(botMemoryFacts)
    .where(eq(botMemoryFacts.userId, userId))
    .orderBy(asc(botMemoryFacts.createdAt), asc(botMemoryFacts.id));
}

export async function countFacts(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(botMemoryFacts)
    .where(eq(botMemoryFacts.userId, userId));
  return row?.n ?? 0;
}

export async function insertFact(input: {
  userId: string;
  fact: string;
  source: "chat" | "site";
}): Promise<MemoryFactRow> {
  const [row] = await getDb()
    .insert(botMemoryFacts)
    .values({ userId: input.userId, fact: input.fact, source: input.source })
    .returning();
  return row!;
}

export async function updateFact(
  userId: string,
  id: string,
  fact: string,
): Promise<MemoryFactRow | undefined> {
  const [row] = await getDb()
    .update(botMemoryFacts)
    .set({ fact, updatedAt: new Date() })
    .where(and(eq(botMemoryFacts.id, id), eq(botMemoryFacts.userId, userId)))
    .returning();
  return row;
}

export async function deleteFact(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(botMemoryFacts)
    .where(and(eq(botMemoryFacts.id, id), eq(botMemoryFacts.userId, userId)))
    .returning({ id: botMemoryFacts.id });
  return rows.length > 0;
}

export async function deleteAllFacts(userId: string): Promise<number> {
  const rows = await getDb()
    .delete(botMemoryFacts)
    .where(eq(botMemoryFacts.userId, userId))
    .returning({ id: botMemoryFacts.id });
  return rows.length;
}
