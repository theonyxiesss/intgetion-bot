import { randomUUID } from "node:crypto";
import { createTranslator } from "use-intl";
import { PRICING } from "../../../config/pricing";
import { UGC_LIMITS } from "../../../config/ugc";
import { messagesFor } from "../../../i18n/messages";
import {
  clampStep,
  freelanceOrder,
  hiringCost,
  ugcBudget,
  usdText,
  type HiringPrices,
} from "../../../lib/calc";
import { billingMe } from "../../../platform";
import {
  freelancePriceRange,
  SERVICE_DRAFT_REQUIRED,
} from "../../../platform";
import { intlLocale } from "@intgetion/kit";
import { formatMoneyDto } from "@intgetion/kit";
import {
  JOB_DRAFT_REQUIRED,
  listPublicJobsByIds,
} from "../../../platform";
import { UGC_BRIEF_REQUIRED, ugcPriceGuide } from "../../../platform";
import { offerPath } from "../service/offers";
import { checkBlock, type ShowUiInput } from "./schemas";
import {
  UI_TTL_SEC,
  UI_VERSION,
  type CalcInput,
  type CalculatorProps,
  type ComparePlansProps,
  type UiAction,
  type UiBlock,
  type UiComponent,
  type UiPropsMap,
} from "./types";

/**
 * Builds Spoki blocks on the server (D523): from what a data tool already
 * returned to the chat, or from a `show_ui` request with prices and ranges
 * read here. Every block is checked by `checkBlock` before anyone sees it.
 */

type Ctx = { userId: string | null; locale: string };

const MAX_ITEMS = 10;

function blocksText(locale: string) {
  return createTranslator({
    locale,
    messages: messagesFor(locale),
    namespace: "chat.blocks",
  });
}

function block<C extends UiComponent>(
  component: C,
  props: UiPropsMap[C],
  actions: UiAction[],
  source: { tool: string; refresh?: UiBlock["source"]["refresh"] },
  fallback: UiBlock["fallback"],
  now: Date,
): UiBlock | null {
  return checkBlock({
    v: UI_VERSION,
    id: randomUUID(),
    component,
    props,
    source: {
      tool: source.tool,
      at: now.toISOString(),
      ttlSec: UI_TTL_SEC[component],
      ...(source.refresh ? { refresh: source.refresh } : {}),
    },
    fallback,
    actions,
  });
}

const UUID = /^[0-9a-f-]{36}$/i;

type JobCard = {
  id: string;
  title: string;
  companyName: string;
  workFormat?: string;
  score?: number;
  explain?: {
    detail: { key: string; params: Record<string, string | number> };
  }[];
};

type ServiceCard = {
  id: string;
  slug: string;
  title: string;
  fromMinor: string;
  fromDays: number;
};

const DRAFT_KINDS = {
  ugc_brief_draft: {
    draft: "ugc_brief",
    required: UGC_BRIEF_REQUIRED,
    path: (id: string) => `/campaigns/new?draft=${id}`,
  },
  freelance_service_draft: {
    draft: "freelance_service",
    required: SERVICE_DRAFT_REQUIRED,
    path: (id: string) => `/profile/freelance/new?draft=${id}`,
  },
  job_draft: {
    draft: "job",
    required: JOB_DRAFT_REQUIRED,
    path: (id: string) => `/post-job?draft=${id}`,
  },
} as const;

/**
 * The block for a data tool's chat payload, or null when the payload has no
 * block (then the chat keeps its old card). Telegram keeps the old cards.
 */
export function blockFromTool(
  tool: string,
  client: { kind: string; data: unknown } | undefined,
  input: unknown,
  ctx: Ctx,
  now = new Date(),
): UiBlock | null {
  if (!client) return null;
  const t = blocksText(ctx.locale);
  const refresh =
    input && typeof input === "object"
      ? { tool, args: input as Record<string, unknown> }
      : undefined;
  if (
    (client.kind === "jobs" || client.kind === "matches") &&
    Array.isArray(client.data)
  ) {
    const jobs = (client.data as JobCard[])
      .filter((job) => typeof job?.id === "string" && UUID.test(job.id))
      .slice(0, MAX_ITEMS);
    if (jobs.length === 0) return null;
    const actions: UiAction[] = [];
    const items = jobs.map((job) => {
      const ids = [`open:${job.id}`];
      actions.push({
        id: `open:${job.id}`,
        type: "link",
        label: t("open"),
        path: `/jobs/${job.id}`,
      });
      if (ctx.userId) {
        // Saving is a reversible write: done at once, kept in the journal.
        ids.push(`save:${job.id}`);
        actions.push({
          id: `save:${job.id}`,
          type: "action",
          label: t("save"),
          doneLabel: t("saved"),
          tool: "save_job",
          args: { jobId: job.id },
          write: true,
        });
      }
      // Applying needs a letter and the D520 card: Spoki takes it from here.
      ids.push(`apply:${job.id}`);
      actions.push({
        id: `apply:${job.id}`,
        type: "reply",
        label: t("apply"),
        text: t("applyReply", { title: job.title }),
      });
      return {
        id: job.id,
        title: job.title,
        company: job.companyName ?? "",
        ...(job.workFormat ? { workFormat: job.workFormat } : {}),
        ...(typeof job.score === "number" ? { score: job.score } : {}),
        ...(job.explain?.length ? { explain: job.explain.slice(0, 3) } : {}),
        actions: ids,
      };
    });
    actions.push({ id: "refresh", type: "refresh", label: t("refresh") });
    return block(
      "job_cards",
      { items },
      actions,
      { tool, refresh },
      {
        text: `${t("fallback.jobs")}\n${jobs.map((job) => `• ${job.title} — ${job.companyName}`).join("\n")}`,
        path: "/jobs",
      },
      now,
    );
  }
  if (client.kind === "freelance_services" && Array.isArray(client.data)) {
    const services = (client.data as ServiceCard[])
      .filter(
        (service) => typeof service?.id === "string" && UUID.test(service.id),
      )
      .slice(0, MAX_ITEMS);
    if (services.length === 0) return null;
    const actions: UiAction[] = [];
    const items = services.map((service) => {
      const fromCents = Number(service.fromMinor);
      actions.push(
        {
          id: `open:${service.id}`,
          type: "link",
          label: t("open"),
          path: `/freelance/${encodeURIComponent(service.slug)}`,
        },
        // Ordering needs a brief and the card: Spoki asks for it.
        {
          id: `order:${service.id}`,
          type: "reply",
          label: t("order"),
          text: t("orderReply", { title: service.title }),
        },
      );
      return {
        id: service.id,
        title: service.title,
        fromCents: Number.isSafeInteger(fromCents) ? fromCents : 0,
        fromDays: service.fromDays ?? 0,
        actions: [`open:${service.id}`, `order:${service.id}`],
      };
    });
    actions.push({ id: "refresh", type: "refresh", label: t("refresh") });
    return block(
      "service_cards",
      { items },
      actions,
      { tool, refresh },
      {
        text: `${t("fallback.services")}\n${items.map((item) => `• ${item.title} — ${t("from", { price: usdText(item.fromCents, ctx.locale) })}`).join("\n")}`,
        path: "/freelance",
      },
      now,
    );
  }
  const draftKind = DRAFT_KINDS[client.kind as keyof typeof DRAFT_KINDS];
  if (draftKind) {
    const data = client.data as {
      id?: unknown;
      missingRequired?: unknown;
    } | null;
    const missing = Array.isArray(data?.missingRequired)
      ? data.missingRequired.filter(
          (key): key is string => typeof key === "string",
        )
      : [];
    if (
      typeof data?.id !== "string" ||
      !UUID.test(data.id) ||
      missing.length === 0
    )
      return null;
    const total = Math.max(
      draftKind.required.length +
        missing.filter((key) => !draftKind.required.includes(key)).length,
      missing.length,
    );
    const path = draftKind.path(data.id);
    return block(
      "progress",
      { draft: draftKind.draft, total, missing, action: "open" },
      [{ id: "open", type: "link", label: t("progress.open"), path }],
      { tool },
      {
        text: t("fallback.progress", { filled: total - missing.length, total }),
        path,
      },
      now,
    );
  }
  return null;
}

/** Hire and Team prices from the price list, in cents. */
export function hiringPrices(): HiringPrices {
  const tiers = PRICING.companies;
  const hire = tiers.find((tier) => tier.code === "hire")!;
  const team = tiers.find((tier) => tier.code === "team")!;
  return {
    hireCents: (hire.price ?? 0) * 100,
    teamMonthCents: (team.price ?? 0) * 100,
    teamYearCents: (team.yearly ?? (team.price ?? 0) * 12) * 100,
  };
}

/**
 * Plan points Spoki does not repeat: the first free Hire job is on /pricing
 * but billing does not apply it (D523, 10.5.1).
 */
const UNBACKED_POINTS = new Set(["hire.firstFree"]);

const PLAN_OFFER: Record<string, string> = {
  hire: "pay_hire",
  team: "pay_team",
  plus: "pay_plus",
  pro: "pay_pro",
  start: "post_job",
};

async function comparePlans(
  input: Extract<ShowUiInput, { component: "compare_plans" }>,
  ctx: Ctx,
  now: Date,
): Promise<UiBlock | null> {
  const t = blocksText(ctx.locale);
  const pricing = createTranslator({
    locale: ctx.locale,
    messages: messagesFor(ctx.locale),
    namespace: "pricing.tiers",
  });
  let current: string | undefined;
  if (ctx.userId) {
    const me = await billingMe(ctx.userId).catch(() => null);
    current = me
      ? input.audience === "companies"
        ? me.plan
        : me.candidatePlan
      : undefined;
  }
  const signedIn = ctx.userId !== null;
  const actions: UiAction[] = [];
  const plans: ComparePlansProps["plans"] = PRICING[input.audience].map(
    (tier) => {
      const offer = PLAN_OFFER[tier.code];
      const path =
        (offer ? offerPath(offer as never, signedIn) : null) ?? "/pricing";
      const name = pricing(`${tier.code}.name` as never);
      const actionId = `plan:${tier.code}`;
      actions.push({
        id: actionId,
        type: "link",
        label: t("plans.choose", { name }),
        path,
      });
      return {
        code: tier.code,
        name,
        priceCents: tier.price === null ? null : tier.price * 100,
        per: tier.per,
        ...(tier.yearly ? { yearlyCents: tier.yearly * 100 } : {}),
        ...(tier.recommended ? { recommended: true } : {}),
        points: tier.points
          .filter((point) => !UNBACKED_POINTS.has(`${tier.code}.${point}`))
          .map((point) => pricing(`${tier.code}.points.${point}` as never)),
        ...(tier.code === current ? {} : { action: actionId }),
      };
    },
  );
  const lines = plans.map((plan) => {
    const price =
      plan.priceCents === null
        ? t("plans.free")
        : `${usdText(plan.priceCents, ctx.locale)} ${plan.per === "job" ? t("plans.perJob") : t("plans.perMonth")}`;
    return `• ${plan.name}: ${price}${plan.code === current ? ` (${t("plans.current")})` : ""}`;
  });
  return block(
    "compare_plans",
    { audience: input.audience, ...(current ? { current } : {}), plans },
    actions,
    { tool: "show_ui" },
    { text: `${t("fallback.plans")}\n${lines.join("\n")}`, path: "/pricing" },
    now,
  );
}

/**
 * D560: two to four published jobs on the same fields, read here from the
 * catalog. A field the job leaves empty stays `null`; ids that are not
 * published are dropped, and fewer than two left means no block.
 */
async function compareJobs(
  input: Extract<ShowUiInput, { component: "compare_jobs" }>,
  ctx: Ctx,
  now: Date,
): Promise<UiBlock | null> {
  const ids = [...new Set(input.jobIds)];
  const found = await listPublicJobsByIds(ids, ctx.locale);
  const byId = new Map(found.map((job) => [job.id, job]));
  const jobs = ids.flatMap((id) => {
    const job = byId.get(id);
    return job ? [job] : [];
  });
  if (jobs.length < 2) return null;
  const t = blocksText(ctx.locale);
  const messages = messagesFor(ctx.locale);
  const jobText = createTranslator({
    locale: ctx.locale,
    messages,
    namespace: "jobs",
  });
  const markers = createTranslator({
    locale: ctx.locale,
    messages,
    namespace: "markers",
  });
  const money = intlLocale(ctx.locale);
  const day = new Intl.DateTimeFormat(money, {
    day: "numeric",
    month: "short",
  });
  const criteria = [
    t("compareJobs.salary"),
    t("compareJobs.format"),
    t("compareJobs.employment"),
    t("compareJobs.seniority"),
    t("compareJobs.place"),
    t("compareJobs.posted"),
  ];
  const actions: UiAction[] = [];
  const items = jobs.map((job) => {
    const salary = job.salaryMin
      ? `${formatMoneyDto(job.salaryMin, money)}${job.salaryMax ? ` – ${formatMoneyDto(job.salaryMax, money)}` : ""} / ${jobText(job.salaryMin.period as never)}`
      : null;
    const values = [
      salary,
      jobText(job.workFormat as never),
      jobText(job.employmentType as never),
      job.seniority ? markers(`seniority.${job.seniority}` as never) : null,
      job.location?.trim() || job.locationCountry || null,
      job.publishedAt ? day.format(new Date(job.publishedAt)) : null,
    ];
    actions.push({
      id: `open:${job.id}`,
      type: "link",
      label: t("open"),
      path: `/jobs/${job.id}`,
    });
    return {
      id: job.id,
      title: job.title,
      company: job.company.name,
      values,
      action: `open:${job.id}`,
    };
  });
  // Stale data reads the catalog again with the same ids (TZ 35, stage 4).
  actions.push({ id: "refresh", type: "refresh", label: t("refresh") });
  const unknown = t("compareJobs.unknown");
  const lines = items.map(
    (item) =>
      `• ${item.title} — ${item.company}: ${criteria.map((name, index) => `${name}: ${item.values[index] ?? unknown}`).join("; ")}`,
  );
  return block(
    "compare_jobs",
    { criteria, items },
    actions,
    {
      tool: "show_ui",
      refresh: {
        tool: "show_ui",
        args: { component: "compare_jobs", jobIds: ids },
      },
    },
    {
      text: `${t("fallback.compareJobs")}\n${lines.join("\n")}`,
      path: "/jobs",
    },
    now,
  );
}

function slider(
  name: string,
  min: number,
  max: number,
  step: number,
  wanted: number | undefined,
  fallback: number,
): CalcInput {
  return {
    name,
    min,
    max,
    step,
    value: clampStep(wanted ?? fallback, min, max, step),
  };
}

async function calculator(
  input: Extract<ShowUiInput, { component: "calculator" }>,
  ctx: Ctx,
  now: Date,
): Promise<UiBlock | null> {
  const t = blocksText(ctx.locale);
  const signedIn = ctx.userId !== null;
  const start = input;
  const actions: UiAction[] = [];
  let props: CalculatorProps;
  let summary: string;
  let path: string | undefined;
  if (input.formula === "ugc_budget") {
    const guide = await ugcPriceGuide({
      niche: input.niche,
      platform: input.platform,
    });
    const videos = slider(
      "videos",
      UGC_LIMITS.videosMin,
      UGC_LIMITS.videosMax,
      1,
      start.videos,
      5,
    );
    const reward = slider(
      "rewardCents",
      UGC_LIMITS.bountyMinMinor,
      UGC_LIMITS.bountyMaxMinor,
      500,
      start.rewardUsd === undefined
        ? undefined
        : Math.round(start.rewardUsd * 100),
      guide.medianMinor,
    );
    path = offerPath("fill_brief", signedIn) ?? "/campaigns";
    actions.push({
      id: "create",
      type: "link",
      label: t("calc.ugc_budget.create"),
      path,
    });
    props = {
      formula: "ugc_budget",
      inputs: [videos, reward],
      range: {
        minCents: guide.minMinor,
        medianCents: guide.medianMinor,
        maxCents: guide.maxMinor,
        count: guide.count,
        source: guide.source === "briefs" ? "data" : "presets",
      },
      actions: ["create"],
    };
    const { totalCents } = ugcBudget({
      videos: videos.value,
      rewardCents: reward.value,
    });
    summary = t("fallback.ugc_budget", {
      videos: videos.value,
      reward: usdText(reward.value, ctx.locale),
      total: usdText(totalCents, ctx.locale),
    });
  } else if (input.formula === "freelance_order") {
    const range = input.category
      ? await freelancePriceRange(input.category).catch(() => null)
      : null;
    const median = range ? Number(range.medianMinor) : 10_000;
    const price = slider(
      "priceCents",
      500,
      1_000_000,
      500,
      start.priceUsd === undefined
        ? undefined
        : Math.round(start.priceUsd * 100),
      median,
    );
    const quantity = slider("quantity", 1, 10, 1, start.quantity, 1);
    path = input.category
      ? `/freelance?category=${input.category}`
      : "/freelance";
    actions.push({
      id: "find",
      type: "link",
      label: t("calc.freelance_order.find"),
      path,
    });
    props = {
      formula: "freelance_order",
      inputs: [price, quantity],
      ...(range && range.count > 0
        ? {
            range: {
              minCents: Number(range.minMinor),
              medianCents: Number(range.medianMinor),
              maxCents: Number(range.maxMinor),
              count: range.count,
              source: "data" as const,
            },
          }
        : {}),
      actions: ["find"],
    };
    const { totalCents } = freelanceOrder({
      priceCents: price.value,
      quantity: quantity.value,
    });
    summary = t("fallback.freelance_order", {
      quantity: quantity.value,
      price: usdText(price.value, ctx.locale),
      total: usdText(totalCents, ctx.locale),
    });
  } else {
    const prices = hiringPrices();
    const jobs = slider("jobsPerMonth", 1, 20, 1, start.jobsPerMonth, 2);
    const billing = input.billing ?? "month";
    path = offerPath("post_job", signedIn) ?? "/post-job";
    actions.push(
      { id: "post", type: "link", label: t("calc.hiring_cost.post"), path },
      {
        id: "team",
        type: "link",
        label: t("calc.hiring_cost.teamCta"),
        path: offerPath("pay_team", signedIn) ?? "/pricing",
      },
    );
    props = {
      formula: "hiring_cost",
      inputs: [jobs],
      billing,
      prices,
      actions: ["post", "team"],
    };
    const result = hiringCost({ jobsPerMonth: jobs.value, billing }, prices);
    summary = t("fallback.hiring_cost", {
      jobs: jobs.value,
      hire: usdText(result.hireCents, ctx.locale),
      team: usdText(result.teamCents, ctx.locale),
      plan:
        result.cheaper === "hire"
          ? t("calc.hiring_cost.hire")
          : t("calc.hiring_cost.team"),
    });
  }
  return block(
    "calculator",
    props,
    actions,
    { tool: "show_ui" },
    { text: summary, ...(path ? { path } : {}) },
    now,
  );
}

/** The block for a `show_ui` request, with the platform's own numbers. */
export async function blockFromShowUi(
  input: ShowUiInput,
  ctx: Ctx,
  now = new Date(),
): Promise<UiBlock | null> {
  switch (input.component) {
    case "compare_plans":
      return comparePlans(input, ctx, now);
    case "compare_jobs":
      return compareJobs(input, ctx, now);
    case "calculator":
      return calculator(input, ctx, now);
    case "choice": {
      const actions: UiAction[] = input.options.map((option, index) => ({
        id: `option:${index}`,
        type: "reply" as const,
        label: option.label,
        text: option.reply,
      }));
      return block(
        "choice",
        {
          ...(input.question ? { question: input.question } : {}),
          options: actions.map((action) => action.id),
        },
        actions,
        { tool: "show_ui" },
        {
          text: `${input.question ? `${input.question}\n` : ""}${input.options.map((option) => `• ${option.label}`).join("\n")}`,
        },
        now,
      );
    }
    case "details":
      return block(
        "details",
        {
          ...(input.title ? { title: input.title } : {}),
          sections: input.sections,
        },
        [],
        { tool: "show_ui" },
        {
          text: [
            input.title,
            ...input.sections.map(
              (section) => `${section.title}: ${section.text}`,
            ),
          ]
            .filter(Boolean)
            .join("\n"),
        },
        now,
      );
  }
}
