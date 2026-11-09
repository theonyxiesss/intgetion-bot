import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LLMOutputError,
  MAX_OUTPUT_TOKENS,
  chat,
  isFreeModel,
  llmFromEnv,
  wrapUntrusted,
} from "@intgetion/llm";
import { systemPrompt } from "../prompts/system";
import { routeDomains } from "../service/routing";
import { toolsFor, type BotState } from "../service/tools";
import { SCENARIOS, evalCases } from "./routing-cases";

/**
 * The live routing check (D522): the same requests on the configured free
 * OpenRouter model, once with the full tool set and once routed. One model
 * call per request and mode: the first tool the model picks, the provider's
 * input tokens and the time. A routed `use_tools` call counts as a load
 * (one more call in a real turn). Paid models are refused: the founder has
 * not approved paid runs. Run: `ROUTING_LIVE=1 pnpm eval:routing`.
 */

const live = process.env.ROUTING_LIVE === "1";
const USER = "00000000-0000-4000-8000-0000000000a1";
const PAUSE_MS = 3500;

type Row = {
  id: string;
  mode: "full" | "routed";
  tools: number;
  tokensIn: number;
  ms: number;
  called: string;
  hit: boolean;
  load: boolean;
  error?: string;
};

describe.skipIf(!live)("live routing check (D522)", () => {
  it("compares the full set and routing on a free model", async () => {
    const setup = llmFromEnv();
    if (!setup) throw new Error("No model configured: OPENROUTER_API_KEY");
    if (setup.name !== "openrouter" || !isFreeModel(setup.models.chat))
      throw new Error("Only a free OpenRouter model may run this check");
    const system = systemPrompt({ locale: "ru", signedIn: true });
    const cases = [
      ...evalCases().map((c) => ({ ...c, topic: undefined })),
      ...SCENARIOS.map((s, i) => ({ id: `scenario-${i + 1}`, ...s })),
    ];
    const rows: Row[] = [];
    for (const item of cases) {
      const state: BotState = item.topic ? { topic: item.topic } : {};
      for (const mode of ["full", "routed"] as const) {
        const tools =
          mode === "full"
            ? toolsFor(USER, state)
            : toolsFor(
                USER,
                state,
                routeDomains({ text: item.text, topic: state.topic }),
              );
        const started = performance.now();
        const row: Row = {
          id: item.id,
          mode,
          tools: tools.length,
          tokensIn: 0,
          ms: 0,
          called: "",
          hit: false,
          load: false,
        };
        try {
          const response = await chat(setup.provider, {
            model: setup.models.chat,
            system,
            messages: [
              {
                role: "user",
                content: wrapUntrusted("user_message", item.text),
              },
            ],
            tools,
            maxTokens: MAX_OUTPUT_TOKENS,
          });
          row.tokensIn = response.usage.tokensIn;
          row.called = response.toolCalls.map((c) => c.name).join(",");
          row.load = response.toolCalls.some((c) => c.name === "use_tools");
          row.hit = response.toolCalls.some((c) => item.tools.includes(c.name));
        } catch (error) {
          row.error =
            error instanceof LLMOutputError
              ? error.message.slice(0, 80)
              : "call failed";
        }
        row.ms = Math.round(performance.now() - started);
        rows.push(row);
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
    }
    const sum = (mode: Row["mode"]) => {
      const list = rows.filter((r) => r.mode === mode);
      const ok = list.filter((r) => !r.error);
      const avg = (pick: (r: Row) => number) =>
        Math.round(
          ok.reduce((n, r) => n + pick(r), 0) / Math.max(ok.length, 1),
        );
      return `${mode}: ${list.length} calls, ${list.length - ok.length} errors, avg ${avg((r) => r.tools)} tools, avg ${avg((r) => r.tokensIn)} input tokens, avg ${avg((r) => r.ms)} ms, expected tool picked ${list.filter((r) => r.hit).length}/${list.length}, use_tools ${list.filter((r) => r.load).length}`;
    };
    const report = [
      `model: ${setup.models.chat}`,
      sum("full"),
      sum("routed"),
      "id\tmode\ttools\ttokensIn\tms\tcalled\thit\terror",
      ...rows.map(
        (r) =>
          `${r.id}\t${r.mode}\t${r.tools}\t${r.tokensIn}\t${r.ms}\t${r.called || "-"}\t${r.hit}\t${r.error ?? ""}`,
      ),
    ].join("\n");
    writeFileSync(process.env.ROUTING_REPORT ?? "routing-live.txt", report);
    expect(rows).toHaveLength(cases.length * 2);
  }, 1_800_000);
});
