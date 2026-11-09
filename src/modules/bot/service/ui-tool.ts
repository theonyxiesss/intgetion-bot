import { blockFromShowUi } from "../ui/build";
import { showUiInput, type ShowUiInput } from "../ui/schemas";
import type { BotTool, ToolContext, ToolOutcome } from "./tools";

/**
 * `show_ui` (D523): the model asks for a block where a picture beats words —
 * plans side by side, a cost with sliders, a pick from options, sections to
 * open. It names the component and its choices only; prices, ranges and the
 * person's plan come from the server, and the block is checked before it is
 * sent. Reads nothing private, writes nothing.
 */
export const showUiTool: BotTool<typeof showUiInput> = {
  name: "show_ui",
  description:
    "Show an interactive block in the chat instead of writing it out. compare_plans: plans for companies or job seekers side by side, with the person's own plan. compare_jobs: 2 to 4 jobs already found in this chat, by their ids, on the same fields (pay, format, employment, level, place, date) read from the catalog; use it when they ask to compare jobs or choose between them, and do not search for jobs again in that reply. Take the ids of exactly the jobs the person named, matching their titles and companies; if a named job is not among those found, say so and do not compare another one in its place. calculator: ugc_budget (videos × reward per video), freelance_order (package price × how many), hiring_cost (Hire per job against Team per month). Show it at once: niche, platform and category are optional and the person moves the sliders, so do not ask for them first. Pass videos, rewardUsd, priceUsd, quantity or jobsPerMonth only when the person said them, as plain numbers. choice: 2 to 5 answers the person can tap; each reply is sent as their message. details: sections the person can open. Prices and ranges come from the server: never type a price into the block or into your reply. After the block, say one short sentence; do not repeat its numbers.",
  input: showUiInput,
  access: "guest",
  confirm: () => false,
  async run(ctx: ToolContext, input: ShowUiInput): Promise<ToolOutcome> {
    const ui = await blockFromShowUi(input, {
      userId: ctx.userId,
      locale: ctx.locale,
    });
    if (!ui) {
      return {
        llm: "The block could not be shown. Answer in words, without inventing prices.",
      };
    }
    return {
      llm: `A ${input.component.replace("_", " ")} block is on the screen now. Its numbers come from the platform. Add one short sentence or ask the next question; do not repeat the numbers.\nWhat it shows: ${ui.fallback.text}`,
      ui,
    };
  },
};
