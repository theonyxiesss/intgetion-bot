import { z } from "zod";
import { CALC_FORMULAS } from "../../../lib/calc";
import { FREELANCE_CATEGORIES } from "@intgetion/freelance/config";
import { UGC_NICHES, UGC_PLATFORMS } from "../../../config/ugc";
import { UI_COMPONENTS, UI_VERSION, type UiBlock } from "./types";

/**
 * Checks for Spoki blocks (D523). `showUiInput` is what the model may ask
 * for: a component and its choices, never prices, HTML or addresses.
 * `uiBlock` checks every block the server built before it is sent or kept.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

/** A page of this site: no scheme, no other host, no spaces. */
export const sitePath = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[A-Za-z0-9/_\-?=&.%#:+,~]*$/);

export const showUiInput = z.discriminatedUnion("component", [
  z
    .object({
      component: z.literal("compare_plans"),
      audience: z.enum(["companies", "candidates"]),
    })
    .strict(),
  z
    .object({
      component: z.literal("compare_jobs"),
      // Only ids: titles, pay and facts are read from the catalog (D560).
      jobIds: z.array(z.uuid()).min(2).max(4),
    })
    .strict(),
  z
    .object({
      component: z.literal("calculator"),
      formula: z.enum(CALC_FORMULAS),
      // Start values in dollars and counts, flat: free models send a nested
      // object as a string. The server keeps them in bounds.
      videos: z.coerce.number().int().optional(),
      rewardUsd: z.coerce.number().optional(),
      priceUsd: z.coerce.number().optional(),
      quantity: z.coerce.number().int().optional(),
      jobsPerMonth: z.coerce.number().int().optional(),
      billing: z.enum(["month", "year"]).optional(),
      niche: z.enum(UGC_NICHES).optional(),
      platform: z.enum(UGC_PLATFORMS).optional(),
      category: z.enum(FREELANCE_CATEGORIES).optional(),
    })
    .strict(),
  z
    .object({
      component: z.literal("choice"),
      question: text(200).optional(),
      options: z
        .array(z.object({ label: text(60), reply: text(200) }).strict())
        .min(2)
        .max(5),
    })
    .strict(),
  z
    .object({
      component: z.literal("details"),
      title: text(120).optional(),
      sections: z
        .array(z.object({ title: text(120), text: text(1200) }).strict())
        .min(1)
        .max(6),
    })
    .strict(),
]);
export type ShowUiInput = z.infer<typeof showUiInput>;

const id = z.string().min(1).max(80);
const actionIds = z.array(id).max(6);

const action = z.discriminatedUnion("type", [
  z
    .object({ id, type: z.literal("reply"), label: text(80), text: text(300) })
    .strict(),
  z
    .object({ id, type: z.literal("link"), label: text(80), path: sitePath })
    .strict(),
  z
    .object({
      id,
      type: z.literal("action"),
      label: text(80),
      doneLabel: text(80),
      tool: z.string().regex(/^[a-z_]{2,64}$/),
      args: z.record(z.string(), z.unknown()),
      write: z.boolean(),
    })
    .strict(),
  z.object({ id, type: z.literal("refresh"), label: text(80) }).strict(),
]);

const cents = z.number().int().min(0).max(100_000_000);

const explain = z
  .object({
    detail: z
      .object({
        key: z.string().max(120),
        params: z.record(z.string(), z.union([z.string(), z.number()])),
      })
      .strict(),
  })
  .strict();

const props = {
  job_cards: z
    .object({
      items: z
        .array(
          z
            .object({
              id: z.uuid(),
              title: text(300),
              company: z.string().max(200),
              workFormat: z.string().max(40).optional(),
              score: z.number().min(0).max(1).optional(),
              explain: z.array(explain).max(3).optional(),
              actions: actionIds,
            })
            .strict(),
        )
        .min(1)
        .max(10),
    })
    .strict(),
  service_cards: z
    .object({
      items: z
        .array(
          z
            .object({
              id: z.uuid(),
              title: text(300),
              fromCents: cents,
              fromDays: z.number().int().min(0).max(365),
              actions: actionIds,
            })
            .strict(),
        )
        .min(1)
        .max(10),
    })
    .strict(),
  compare_plans: z
    .object({
      audience: z.enum(["companies", "candidates"]),
      current: z.string().max(20).optional(),
      plans: z
        .array(
          z
            .object({
              code: z.string().max(20),
              name: text(60),
              priceCents: cents.nullable(),
              per: z.enum(["job", "month"]).nullable(),
              yearlyCents: cents.optional(),
              recommended: z.boolean().optional(),
              points: z.array(text(200)).max(8),
              action: id.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
  compare_jobs: z
    .object({
      criteria: z.array(text(60)).min(1).max(8),
      items: z
        .array(
          z
            .object({
              id: z.uuid(),
              title: text(300),
              company: z.string().max(200),
              values: z.array(z.string().max(200).nullable()).max(8),
              action: id,
            })
            .strict(),
        )
        .min(2)
        .max(4),
    })
    .strict()
    .refine((value) =>
      value.items.every((item) => item.values.length === value.criteria.length),
    ),
  calculator: z
    .object({
      formula: z.enum(CALC_FORMULAS),
      inputs: z
        .array(
          z
            .object({
              name: z.string().max(40),
              min: z.number(),
              max: z.number(),
              step: z.number().positive(),
              value: z.number(),
            })
            .strict()
            .refine(
              (input) => input.min <= input.value && input.value <= input.max,
            ),
        )
        .min(1)
        .max(3),
      billing: z.enum(["month", "year"]).optional(),
      prices: z
        .object({
          hireCents: cents.positive(),
          teamMonthCents: cents.positive(),
          teamYearCents: cents.positive(),
        })
        .strict()
        .optional(),
      range: z
        .object({
          minCents: cents,
          medianCents: cents,
          maxCents: cents,
          count: z.number().int().min(0),
          source: z.enum(["data", "presets"]),
        })
        .strict()
        .optional(),
      actions: actionIds,
    })
    .strict(),
  choice: z
    .object({ question: text(200).optional(), options: actionIds.min(2) })
    .strict(),
  progress: z
    .object({
      draft: z.enum(["ugc_brief", "freelance_service", "job"]),
      total: z.number().int().min(1).max(30),
      missing: z.array(z.string().max(40)).max(30),
      action: id.optional(),
    })
    .strict(),
  details: z
    .object({
      title: text(120).optional(),
      sections: z
        .array(z.object({ title: text(120), text: text(1200) }).strict())
        .min(1)
        .max(6),
    })
    .strict(),
} as const;

export const uiBlock = z
  .object({
    v: z.literal(UI_VERSION),
    id: z.uuid(),
    component: z.enum(UI_COMPONENTS),
    props: z.unknown(),
    source: z
      .object({
        tool: z.string().regex(/^[a-z_]{2,64}$/),
        at: z.iso.datetime(),
        ttlSec: z.number().int().positive(),
        refresh: z
          .object({
            tool: z.string().regex(/^[a-z_]{2,64}$/),
            args: z.record(z.string(), z.unknown()),
          })
          .strict()
          .optional(),
      })
      .strict(),
    fallback: z
      .object({ text: text(2000), path: sitePath.optional() })
      .strict(),
    actions: z.array(action).max(30),
  })
  .strict()
  .superRefine((block, context) => {
    const checked = props[block.component].safeParse(block.props);
    if (!checked.success) {
      context.addIssue({ code: "custom", message: "props", path: ["props"] });
      return;
    }
    // Every button a part names exists in the block.
    const known = new Set(block.actions.map((item) => item.id));
    for (const name of namedActions(block.component, checked.data)) {
      if (!known.has(name))
        context.addIssue({ code: "custom", message: `action ${name}` });
    }
  });

/** The button ids the parts of a block refer to. */
function namedActions(component: string, value: unknown): string[] {
  const data = value as Record<string, unknown>;
  const items = (data.items ?? []) as { actions: string[] }[];
  switch (component) {
    case "job_cards":
    case "service_cards":
      return items.flatMap((item) => item.actions);
    case "compare_plans":
      return ((data.plans ?? []) as { action?: string }[]).flatMap((plan) =>
        plan.action ? [plan.action] : [],
      );
    case "compare_jobs":
      return (data.items as { action: string }[]).map((item) => item.action);
    case "calculator":
      return data.actions as string[];
    case "choice":
      return data.options as string[];
    case "progress":
      return typeof data.action === "string" ? [data.action] : [];
    default:
      return [];
  }
}

/** The block if it passes, else null: an unchecked block is never sent. */
export function checkBlock(block: unknown): UiBlock | null {
  const parsed = uiBlock.safeParse(block);
  return parsed.success ? (parsed.data as UiBlock) : null;
}
