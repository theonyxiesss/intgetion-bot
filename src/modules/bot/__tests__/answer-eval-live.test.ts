import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chat,
  isFreeModel,
  llmFromEnv,
  MAX_OUTPUT_TOKENS,
  wrapUntrusted,
} from "@intgetion/llm";
import { systemPrompt } from "../prompts/system";
import { askJevNouls } from "@intgetion/llm/jev";
import {
  baselineVerdict,
  jevQuestionsFor,
  scoreGroundedAnswer,
  scoreJevAnswers,
  sharedIssues,
  type BaselineCase,
} from "../service/answer-eval";
import { routeDomains } from "../service/routing";
import { toolsFor } from "../service/tools";
import { ANSWER_EVAL_CASES } from "./answer-eval-cases";

const live = process.env.ANSWER_QUALITY_LIVE === "1";
const PAUSE_MS = 3500;
const USER = "00000000-0000-4000-8000-0000000000a1";
/** TZ 36, C4: Jev judges the answers too, only with JEV_EVAL=true. */
const jevOn = process.env.JEV_EVAL === "true";
/** Founder's budget is $1 a month; one run stops asking Jev above this. */
const JEV_RUN_MAX_USD = Number(process.env.JEV_EVAL_MAX_USD ?? "0.02");

/** At most two free-model requests per synthetic case, no live catalog data. */
describe.skipIf(!live)("Spoki live answer quality baseline", () => {
  it("records tool selection, grounding, language, empty answers and errors", async () => {
    const setup = llmFromEnv();
    if (!setup) throw new Error("No configured LLM provider");
    if (setup.name !== "openrouter" || !isFreeModel(setup.models.chat)) {
      throw new Error("This baseline only runs on a free OpenRouter model");
    }
    if (ANSWER_EVAL_CASES.length > 10) {
      throw new Error("Answer baseline is capped at twenty requests");
    }

    const rows: string[] = [];
    const baseline: BaselineCase[] = [];
    let routingResponses = 0;
    let answerResponses = 0;
    let jevCost = 0;
    for (const item of ANSWER_EVAL_CASES) {
      const system = systemPrompt({
        locale: item.locale,
        signedIn: item.signedIn,
      });
      const userMessage = {
        role: "user" as const,
        content: wrapUntrusted("user_message", item.userText),
      };
      let tokensIn = 0;
      let tokensOut = 0;
      let called = "";
      let routeHit = false;
      let routeReply = "none";
      const issues: string[] = [];
      let jev = "off";
      let agree = "-";
      let caseJevIssues: string[] | null = null;
      const routeStarted = performance.now();
      try {
        const response = await chat(setup.provider, {
          model: setup.models.chat,
          system,
          messages: [userMessage],
          tools: toolsFor(
            item.signedIn ? USER : null,
            {},
            routeDomains({ text: item.userText }),
          ),
          maxTokens: MAX_OUTPUT_TOKENS,
        });
        routingResponses += 1;
        if (process.env.ANSWER_EVAL_TEXT_FILE)
          appendFileSync(
            process.env.ANSWER_EVAL_TEXT_FILE,
            `--- ${item.id} routing
${response.text}
calls: ${response.toolCalls.map((c) => c.name).join(",")}
`,
          );
        routeReply =
          response.toolCalls.length > 0
            ? "tool"
            : response.text.trim()
              ? "text"
              : "none";
        tokensIn += response.usage.tokensIn;
        tokensOut += response.usage.tokensOut;
        called = response.toolCalls.map((call) => call.name).join(",");
        routeHit = response.toolCalls.some(
          (call) => call.name === item.toolName,
        );
        if (!routeHit) issues.push("wrong_tool");
      } catch (error) {
        issues.push("routing_error");
        routeReply = `error:${error instanceof Error ? error.name : "unknown"}`;
      }
      const routeMs = Math.round(performance.now() - routeStarted);
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

      const answerStarted = performance.now();
      try {
        const callId = `eval_${item.id}`;
        const response = await chat(setup.provider, {
          model: setup.models.chat,
          system,
          messages: [
            userMessage,
            {
              role: "assistant",
              content: "",
              toolCalls: [{ id: callId, name: item.toolName, input: {} }],
            },
            { role: "tool", toolCallId: callId, content: item.toolResult },
          ],
          maxTokens: MAX_OUTPUT_TOKENS,
        });
        answerResponses += 1;
        if (process.env.ANSWER_EVAL_TEXT_FILE)
          appendFileSync(
            process.env.ANSWER_EVAL_TEXT_FILE,
            `--- ${item.id} answer
${response.text}
`,
          );
        tokensIn += response.usage.tokensIn;
        tokensOut += response.usage.tokensOut;
        const patternIssues = scoreGroundedAnswer({
          ...item,
          answer: response.text,
        }).issues;
        issues.push(...patternIssues);
        const questions = jevQuestionsFor(item);
        if (jevOn && response.text.trim() && Object.keys(questions).length) {
          if (jevCost >= JEV_RUN_MAX_USD) jev = "skipped:budget";
          else {
            try {
              const judged = await askJevNouls({
                apiKey: process.env.OPENROUTER_API_KEY ?? "",
                state: {
                  tool_result: item.toolResult,
                  assistant_reply: response.text,
                },
                questions,
              });
              jevCost += judged.costUsd;
              const jevIssues = scoreJevAnswers(item, judged.answers).sort();
              caseJevIssues = jevIssues;
              jev = jevIssues.length ? jevIssues.join("|") : "pass";
              agree = String(
                jevIssues.join("|") ===
                  sharedIssues(item, patternIssues).join("|"),
              );
            } catch (error) {
              jev = `error:${(error as { status?: number }).status ?? "network"}`;
            }
          }
        } else if (jevOn) jev = "no_question";
        if (!response.text.trim()) issues.push("empty_model_output");
      } catch {
        issues.push("answer_error");
      }
      const answerMs = Math.round(performance.now() - answerStarted);
      rows.push(
        [
          item.id,
          item.domain,
          item.locale,
          called || "-",
          routeHit,
          tokensIn,
          tokensOut,
          routeReply,
          routeMs,
          answerMs,
          issues.length ? issues.join("|") : "pass",
          jev,
          agree,
        ].join("\t"),
      );
      baseline.push({
        routeHit,
        patternIssues: [...issues],
        jevIssues: caseJevIssues,
      });
      if (rows.length < ANSWER_EVAL_CASES.length) {
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      }
    }

    const verdict = baselineVerdict(baseline);
    const reportPath = join(tmpdir(), "spoki-answer-quality-live.tsv");
    writeFileSync(
      reportPath,
      [
        `model\t${setup.models.chat}`,
        "id\tdomain\tlocale\tcalled\trouteHit\ttokensIn\ttokensOut\trouteReply\trouteMs\tanswerMs\tresult\tjev\tagree",
        ...rows,
        ...(jevOn ? [`jevCostUsd\t${jevCost.toFixed(6)}`] : []),
        `routing\t${verdict.routeHits}/${verdict.total}`,
        `critical\t${verdict.critical}`,
        `verdict\t${verdict.pass ? "pass" : "fail"}`,
      ].join("\n"),
    );
    expect(rows).toHaveLength(ANSWER_EVAL_CASES.length);
    expect(
      routingResponses,
      `All routing requests failed; inspect ${reportPath}`,
    ).toBeGreaterThan(0);
    expect(
      answerResponses,
      `All answer requests failed; inspect ${reportPath}`,
    ).toBeGreaterThan(0);
  }, 600_000);
});
