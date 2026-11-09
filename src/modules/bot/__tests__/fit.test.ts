import { describe, expect, it } from "vitest";
import {
  isPoliteYes,
  judgeFit,
  pickVacancy,
  presentVacancy,
  shapeToolCalls,
  speaksAsEmployer,
  stripOffGoalEnding,
  type VacancyFacts,
} from "../service/fit";

const NOW = new Date("2026-10-12T00:00:00Z");

function vacancy(patch: Partial<VacancyFacts> & { id: string }): VacancyFacts {
  return {
    title: "Role",
    company: "Acme",
    workFormat: "remote",
    skills: [],
    ...patch,
  };
}

describe("one fitting vacancy", () => {
  it("does not repeat a passed id across two searches", () => {
    const first = vacancy({ id: "a", company: "First" });
    const second = vacancy({ id: "b", company: "Second" });
    const person = { workFormats: ["remote"] };
    const opening = pickVacancy([first, second], person, [], NOW);
    expect(opening.kind).toBe("show");
    if (opening.kind !== "show") return;
    expect(opening.job.id).toBe("a");
    const again = pickVacancy([first, second], person, ["a"], NOW);
    expect(again.kind).toBe("show");
    if (again.kind !== "show") return;
    expect(again.job.id).toBe("b");
    expect(pickVacancy([first, second], person, ["a", "b"], NOW).kind).toBe(
      "repeat",
    );
  });

  it("skips a hard format contradiction and shows the next", () => {
    const picked = pickVacancy(
      [
        vacancy({ id: "office", workFormat: "onsite" }),
        vacancy({ id: "home", workFormat: "remote" }),
      ],
      { workFormats: ["remote"] },
      [],
      NOW,
    );
    expect(picked.kind).toBe("show");
    if (picked.kind !== "show") return;
    expect(picked.job.id).toBe("home");
  });

  it("treats a lower salary ceiling as a hard contradiction when both sides compare", () => {
    const job = vacancy({
      id: "low",
      salaryMinMinor: "150000",
      salaryMaxMinor: "200000",
      salaryCurrency: "AUD",
      salaryPeriod: "month",
      salaryBasis: "gross",
    });
    const hard = judgeFit(
      {
        salaryMinMinor: "300000",
        salaryCurrency: "AUD",
        salaryPeriod: "month",
        salaryBasis: "gross",
      },
      job,
      NOW,
    );
    expect(hard).toEqual({ show: false, hard: "pay" });
    const ok = judgeFit(
      {
        salaryMinMinor: "100000",
        salaryCurrency: "AUD",
        salaryPeriod: "month",
        salaryBasis: "gross",
      },
      job,
      NOW,
    );
    expect(ok.show).toBe(true);
    if (!ok.show) return;
    expect(ok.matches).toContain("pay");
  });

  it("rejects hours only when both sides have them and the overlap is too small", () => {
    const job = vacancy({
      id: "day",
      timezone: "Europe/Berlin",
      workHoursStart: "09:00",
      workHoursEnd: "10:00",
      minOverlapHours: 1,
    });
    const hard = judgeFit(
      {
        timezone: "Europe/Berlin",
        workHoursStart: "22:00",
        workHoursEnd: "23:00",
        workDays: [1, 2, 3, 4, 5],
      },
      job,
      NOW,
    );
    expect(hard).toEqual({ show: false, hard: "hours" });
    const unknown = judgeFit(
      { workHoursStart: "22:00", workHoursEnd: "23:00" },
      job,
      NOW,
    );
    expect(unknown.show).toBe(true);
  });

  it("shows a partial skill overlap and names the gap", () => {
    const judged = judgeFit(
      { skills: ["content", "design"] },
      vacancy({ id: "s", skills: ["content", "sales"] }),
      NOW,
    );
    expect(judged.show).toBe(true);
    if (!judged.show) return;
    expect(judged.kind).toBe("good");
    expect(judged.matches).toContain("skill");
    expect(judged.gaps).toContain("skills");
  });

  it("shows the first result when nothing matches and nothing contradicts", () => {
    const picked = pickVacancy(
      [
        vacancy({ id: "first", company: "First" }),
        vacancy({ id: "second", company: "Second" }),
      ],
      {},
      [],
      NOW,
    );
    expect(picked.kind).toBe("show");
    if (picked.kind !== "show") return;
    expect(picked.job.id).toBe("first");
    expect(picked.judgement.kind).toBe("neutral");
    expect(presentVacancy("ru", picked.job, picked.judgement)).toContain(
      "не противоречит",
    );
  });

  it("strips a cover letter the person did not ask for and keeps one they did", () => {
    const reply =
      "Вакансия на экране. Могу написать сопроводительное письмо и вопросы для работодателя.";
    expect(stripOffGoalEnding(reply, "посмотри")).toBe("Вакансия на экране.");
    expect(stripOffGoalEnding(reply, "напиши cover letter")).toBe(reply);
  });

  it("does not treat a polite yes as apply", () => {
    expect(isPoliteYes("да, мне подходит")).toBe(true);
    expect(isPoliteYes("Yes, it suits me")).toBe(true);
    expect(isPoliteYes("да, откликнись")).toBe(false);
    const calls = shapeToolCalls(
      [
        {
          id: "call_apply_to_job",
          name: "apply_to_job",
          input: { jobId: "j" },
        },
        { id: "call_offer", name: "offer_step", input: { action: "pay_plus" } },
      ],
      {
        userText: "да, мне подходит",
        ready: true,
        jobThread: false,
        showedJobs: false,
        waiting: false,
      },
    );
    expect(calls.map((call) => call.name)).toEqual(["search_jobs"]);
    expect(calls[0]?.input).toEqual({});
    expect(
      shapeToolCalls([{ id: "c", name: "search_jobs", input: { q: "x" } }], {
        userText: "посмотри",
        ready: true,
        jobThread: true,
        showedJobs: false,
        waiting: false,
      }),
    ).toEqual([]);
  });

  it("drops job searches after jobs were compared in the turn (D561)", () => {
    const shape = (compared: boolean) =>
      shapeToolCalls(
        [
          { id: "s", name: "search_jobs", input: { q: "designer" } },
          { id: "o", name: "offer_step", input: { action: "register" } },
        ],
        {
          userText: "compare the Autodesk and Coinbase jobs",
          ready: true,
          jobThread: false,
          showedJobs: false,
          waiting: false,
          compared,
        },
      ).map((call) => call.name);
    expect(shape(true)).toEqual(["offer_step"]);
    expect(shape(false)).toContain("search_jobs");
  });

  it("never turns an employer's hiring question into a job search (D529)", () => {
    const turn = (
      userText: string,
      calls: Parameters<typeof shapeToolCalls>[0] = [],
    ) =>
      shapeToolCalls(calls, {
        userText,
        // The thread already holds a candidate draft that is ready to search.
        ready: true,
        jobThread: false,
        showedJobs: false,
        waiting: false,
      }).map((call) => call.name);
    for (const text of [
      "Нанимаю 4 человека в месяц. Что дешевле: Hire или Team? Посчитай.",
      "Хочу нанять дизайнера",
      "Как разместить вакансию?",
      "We are hiring two engineers, which plan?",
      "How much to hire one developer?",
      "Need to post a job",
    ]) {
      expect(speaksAsEmployer(text)).toBe(true);
      expect(turn(text)).toEqual([]);
    }
    // A block answers the turn: no search rides along.
    expect(
      turn("Сколько стоят 6 UGC-видео?", [
        { id: "b", name: "show_ui", input: { component: "calculator" } },
      ]),
    ).toEqual(["show_ui"]);
    // A candidate still gets the search, "hired" included.
    for (const text of ["покажи вакансии", "help me get hired"]) {
      expect(speaksAsEmployer(text)).toBe(false);
      expect(turn(text)).toEqual(["search_jobs"]);
    }
  });

  it("does not append the jobs search outside the routed jobs domain", () => {
    expect(
      shapeToolCalls([], {
        userText: "Покажи услуги по дизайну логотипа",
        ready: true,
        jobThread: false,
        showedJobs: false,
        waiting: false,
        allowJobSearch: false,
      }),
    ).toEqual([]);
  });
});
