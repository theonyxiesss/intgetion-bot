import { HttpError, notFound, unauthenticated } from "@intgetion/kit";
import { enforceRateLimit } from "../../../platform";
import { blockFromShowUi, blockFromTool } from "../ui/build";
import { checkBlock, showUiInput } from "../ui/schemas";
import { blockIsStale, type UiBlock } from "../ui/types";
import * as repo from "../repo/bot-repo";
import { hashSessionToken } from "./conversation";
import { journalDirect } from "./journal";
import {
  hashArgs,
  runTool,
  toolNeedsConfirmation,
  type BotState,
  type ToolContext,
} from "./tools";

/**
 * A button pressed on a Spoki block (D523). The server keeps the block, so
 * the browser sends only the block's id and the button's id: the tool and
 * its arguments are the ones the server stored. Writes go only to tools on
 * this list, with the person's own rights and the action journal (D521);
 * anything that needs a card goes back to Spoki as a reply button instead.
 */
const ACTION_TOOLS = new Set(["save_job"]);
/** Reads a block may run again to show fresh data. */
const REFRESH_TOOLS = new Set([
  "search_jobs",
  "get_matches",
  "find_services",
  // Only the catalog comparison is read again; other show_ui blocks are not.
  "show_ui",
]);

export type UiActionResult =
  | { kind: "done"; actionId: string; label: string }
  | { kind: "refreshed"; block: UiBlock };

export async function runUiAction(
  input: {
    userId: string | null;
    token: string | undefined;
    ip: string;
    blockId: string;
    actionId: string;
  },
  now = new Date(),
): Promise<UiActionResult> {
  const tokenHash = input.token ? hashSessionToken(input.token) : null;
  await enforceRateLimit(
    "botUiAction",
    input.userId ?? `${input.ip}:${tokenHash ?? "-"}`,
    now,
  );
  const found = await repo.findBlockRow({
    blockId: input.blockId,
    userId: input.userId,
    tokenHash,
    now,
  });
  if (!found) throw notFound();
  const { message: row, conversation } = found;
  const block = checkBlock((row.toolCall as { ui?: unknown } | null)?.ui);
  if (!block) throw notFound();
  const action = block.actions.find((item) => item.id === input.actionId);
  if (!action) throw notFound();
  const ctx: ToolContext = {
    userId: input.userId,
    conversationId: conversation.id,
    locale: conversation.locale ?? "en",
    state: conversation.state as BotState,
    channel: "web",
  };

  if (action.type === "refresh") {
    const source = block.source.refresh;
    if (!source || !REFRESH_TOOLS.has(source.tool)) throw invalid();
    let fresh: UiBlock | null;
    if (source.tool === "show_ui") {
      const asked = showUiInput.safeParse(source.args);
      if (!asked.success || asked.data.component !== "compare_jobs")
        throw invalid();
      fresh = await blockFromShowUi(
        asked.data,
        { userId: input.userId, locale: ctx.locale },
        now,
      );
    } else {
      const outcome = await runTool(ctx, source.tool, source.args);
      fresh = blockFromTool(
        source.tool,
        outcome.client,
        source.args,
        { userId: input.userId, locale: ctx.locale },
        now,
      );
    }
    if (!fresh) {
      throw new HttpError(409, "BLOCK_EMPTY", "Nothing to show any more");
    }
    // The same id: the chat swaps the block in place and its buttons work.
    const kept = { ...fresh, id: block.id };
    await repo.updateBlockRow(row.id, { ui: kept });
    return { kind: "refreshed", block: kept };
  }

  if (action.type !== "action" || !ACTION_TOOLS.has(action.tool)) {
    throw invalid();
  }
  if (!input.userId) throw unauthenticated();
  // A write from an old block could act on data that has changed.
  if (action.write && blockIsStale(block, now.getTime())) {
    throw new HttpError(409, "BLOCK_STALE", "This block is out of date");
  }
  if (toolNeedsConfirmation(ctx, action.tool)) throw invalid();
  const journal = (ok: boolean, extra: { entity?: unknown; error?: unknown }) =>
    journalDirect({
      userId: input.userId!,
      conversationId: conversation.id,
      channel: "web",
      tool: action.tool,
      argsHash: hashArgs(action.tool, action.args),
      ok,
      entity: extra.entity as never,
      error: extra.error,
      now,
    });
  try {
    const outcome = await runTool(ctx, action.tool, action.args);
    await journal(true, { entity: outcome.audit });
    await repo.updateBlockRow(row.id, { done: action.id });
    // Spoki reads what the person did on the block in the next turn.
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "system_event",
      content: `The person pressed ${action.label} on a block. ${outcome.llm}`,
    });
    return { kind: "done", actionId: action.id, label: action.doneLabel };
  } catch (error) {
    await journal(false, { error });
    throw error;
  }
}

function invalid() {
  return new HttpError(
    400,
    "BLOCK_ACTION_INVALID",
    "This button does nothing here",
  );
}
