import { beforeEach, describe, expect, it, vi } from "vitest";

const billingMeMock = vi.hoisted(() => vi.fn());
const priceGuideMock = vi.hoisted(() => vi.fn());
const priceRangeMock = vi.hoisted(() => vi.fn());

vi.mock("../../../platform", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const parts = await Promise.all([
    ((() => ({
  billingMe: (...args: unknown[]) => billingMeMock(...args),
})) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform")
  >("../../../platform");
  return {
    UGC_BRIEF_REQUIRED: actual.UGC_BRIEF_REQUIRED,
    ugcPriceGuide: (...args: unknown[]) => priceGuideMock(...args),
  };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async () => {
  const actual = await vi.importActual<
    typeof import("../../../platform")
  >("../../../platform");
  return {
    SERVICE_DRAFT_REQUIRED: actual.SERVICE_DRAFT_REQUIRED,
    freelancePriceRange: (...args: unknown[]) => priceRangeMock(...args),
  };
}) as (...args: unknown[]) => unknown)(importOriginal),
    ((async (importOriginal: <T>() => Promise<T>) => ({
  ...(await importOriginal<typeof import("../../../platform")>()),
  listPublicJobsByIds: (...args: unknown[]) => listJobsMock(...args),
})) as (...args: unknown[]) => unknown)(importOriginal),
  ]);
  // A part that spreads the original must not undo the mocks before it.
  const changed = (parts as Record<string, unknown>[]).map((part) =>
    Object.fromEntries(Object.entries(part).filter(([key, value]) => value !== actual[key])),
  );
  return Object.assign({}, actual, ...changed);
});

const listJobsMock = vi.hoisted(() => vi.fn());

const { blockFromShowUi, blockFromTool, hiringPrices } =
  await import("./build");
const { checkBlock, showUiInput } = await import("./schemas");

const JOB = "11111111-1111-4111-8111-111111111111";
const SERVICE = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-24T10:00:00Z");
const guest = { userId: null, locale: "en" };
const user = { userId: "44444444-4444-4444-8444-444444444444", locale: "en" };

const jobs = {
  kind: "jobs",
  data: [
    { id: JOB, title: "Solidity Engineer", companyName: "Acme", score: 0.8 },
    // Not a job of this site: no card.
    { id: "rss-1", title: "Feed", companyName: "Feed" },
  ],
};

describe("blocks from a data tool (D523)", () => {
  it("turns jobs into cards with the person's own buttons", () => {
    const signedIn = blockFromTool(
      "search_jobs",
      jobs,
      { q: "solidity" },
      user,
      NOW,
    );
    expect(signedIn?.component).toBe("job_cards");
    const items = (signedIn?.props as { items: { id: string }[] }).items;
    expect(items.map((item) => item.id)).toEqual([JOB]);
    expect(signedIn?.actions.map((action) => action.id)).toEqual([
      `open:${JOB}`,
      `save:${JOB}`,
      `apply:${JOB}`,
      "refresh",
    ]);
    expect(signedIn?.source).toMatchObject({
      tool: "search_jobs",
      at: NOW.toISOString(),
      ttlSec: 3600,
      refresh: { tool: "search_jobs", args: { q: "solidity" } },
    });
    expect(signedIn?.fallback.text).toContain("Solidity Engineer — Acme");

    // A guest cannot save; applying goes back to Spoki as a message.
    const asGuest = blockFromTool("search_jobs", jobs, {}, guest, NOW);
    expect(asGuest?.actions.some((action) => action.type === "action")).toBe(
      false,
    );
    expect(
      asGuest?.actions.find((action) => action.id === `apply:${JOB}`),
    ).toMatchObject({
      type: "reply",
      text: "I want to apply to “Solidity Engineer”",
    });
  });

  it("turns services into cards with the price from the catalog", () => {
    const block = blockFromTool(
      "find_services",
      {
        kind: "freelance_services",
        data: [
          {
            id: SERVICE,
            slug: "logo",
            title: "Logo",
            fromMinor: "4500",
            fromDays: 3,
          },
        ],
      },
      {},
      guest,
      NOW,
    );
    expect(block?.component).toBe("service_cards");
    expect(block?.props).toEqual({
      items: [
        {
          id: SERVICE,
          title: "Logo",
          fromCents: 4500,
          fromDays: 3,
          actions: [`open:${SERVICE}`, `order:${SERVICE}`],
        },
      ],
    });
    expect(block?.fallback.text).toContain("Logo — from $45");
  });

  it("shows progress only while a draft still misses fields", () => {
    const missing = blockFromTool(
      "update_ugc_brief_draft",
      {
        kind: "ugc_brief_draft",
        data: { id: DRAFT, missingRequired: ["goal", "videoCount"] },
      },
      {},
      user,
      NOW,
    );
    expect(missing?.component).toBe("progress");
    expect(missing?.props).toMatchObject({
      draft: "ugc_brief",
      missing: ["goal", "videoCount"],
    });
    expect(missing?.fallback.path).toBe(`/campaigns/new?draft=${DRAFT}`);
    expect(
      blockFromTool(
        "update_ugc_brief_draft",
        { kind: "ugc_brief_draft", data: { id: DRAFT, missingRequired: [] } },
        {},
        user,
        NOW,
      ),
    ).toBeNull();
  });

  it("has no block for other payloads", () => {
    expect(
      blockFromTool("offer_step", { kind: "offer", data: {} }, {}, guest, NOW),
    ).toBeNull();
    expect(blockFromTool("search_jobs", undefined, {}, guest, NOW)).toBeNull();
    expect(
      blockFromTool("search_jobs", { kind: "jobs", data: [] }, {}, guest, NOW),
    ).toBeNull();
  });
});

describe("blocks Spoki asks for (D523)", () => {
  beforeEach(() => {
    billingMeMock.mockReset();
    priceGuideMock.mockReset();
    priceRangeMock.mockReset();
  });

  it("compares plans from the price list and marks the person's own", async () => {
    billingMeMock.mockResolvedValue({ plan: "hire", candidatePlan: "free" });
    const block = await blockFromShowUi(
      { component: "compare_plans", audience: "companies" },
      user,
      NOW,
    );
    const props = block?.props as {
      current?: string;
      plans: {
        code: string;
        priceCents: number | null;
        points: string[];
        action?: string;
      }[];
    };
    expect(props.current).toBe("hire");
    const hire = props.plans.find((plan) => plan.code === "hire");
    expect(hire?.priceCents).toBe(7900);
    // The own plan has no buttons; the unbacked promise is not shown.
    expect(hire?.action).toBeUndefined();
    expect(JSON.stringify(props)).not.toMatch(/first .*free/i);
    expect(props.plans.find((plan) => plan.code === "team")?.priceCents).toBe(
      8000,
    );
  });

  it("builds a hiring calculator on the platform's prices", async () => {
    const block = await blockFromShowUi(
      {
        component: "calculator",
        formula: "hiring_cost",
        jobsPerMonth: 99,
      },
      guest,
      NOW,
    );
    expect(block?.props).toMatchObject({
      formula: "hiring_cost",
      prices: hiringPrices(),
      // Asked 99: kept in bounds.
      inputs: [{ name: "jobsPerMonth", min: 1, max: 20, value: 20 }],
    });
    expect(hiringPrices()).toEqual({
      hireCents: 7900,
      teamMonthCents: 8000,
      teamYearCents: 80000,
    });
  });

  it("builds a UGC budget from the reviewed briefs", async () => {
    priceGuideMock.mockResolvedValue({
      source: "briefs",
      count: 12,
      minMinor: 2000,
      medianMinor: 5000,
      maxMinor: 15000,
      presets: [],
    });
    const block = await blockFromShowUi(
      { component: "calculator", formula: "ugc_budget", videos: 4 },
      guest,
      NOW,
    );
    expect(block?.props).toMatchObject({
      inputs: [
        { name: "videos", value: 4 },
        { name: "rewardCents", value: 5000 },
      ],
      range: {
        minCents: 2000,
        medianCents: 5000,
        maxCents: 15000,
        source: "data",
      },
    });
    expect(block?.fallback.text).toBe("4 videos × $50 = $200.");
  });

  it("makes each choice a reply and keeps details as text", async () => {
    const choice = await blockFromShowUi(
      {
        component: "choice",
        question: "Which side?",
        options: [
          { label: "Find work", reply: "I want to find work" },
          { label: "Hire", reply: "I want to hire" },
        ],
      },
      guest,
      NOW,
    );
    expect(choice?.actions).toEqual([
      {
        id: "option:0",
        type: "reply",
        label: "Find work",
        text: "I want to find work",
      },
      { id: "option:1", type: "reply", label: "Hire", text: "I want to hire" },
    ]);
    const details = await blockFromShowUi(
      { component: "details", sections: [{ title: "Fees", text: "None." }] },
      guest,
      NOW,
    );
    expect(details?.fallback.text).toBe("Fees: None.");
  });
});

describe("what the model may send (D523)", () => {
  it("takes flat start numbers, even written as text", () => {
    expect(
      showUiInput.parse({
        component: "calculator",
        formula: "hiring_cost",
        jobsPerMonth: "4",
      }),
    ).toMatchObject({ jobsPerMonth: 4 });
  });

  it("refuses prices, HTML and unknown components", () => {
    expect(
      showUiInput.safeParse({
        component: "compare_plans",
        audience: "companies",
        priceCents: 1,
      }).success,
    ).toBe(false);
    expect(
      showUiInput.safeParse({ component: "html", html: "<script>" }).success,
    ).toBe(false);
  });
});

describe("the block check (D523)", () => {
  const valid = () => ({
    v: 1,
    id: "55555555-5555-4555-8555-555555555555",
    component: "choice",
    props: { options: ["a", "b"] },
    source: { tool: "show_ui", at: NOW.toISOString(), ttlSec: 60 },
    fallback: { text: "Pick one" },
    actions: [
      { id: "a", type: "reply", label: "A", text: "a" },
      { id: "b", type: "reply", label: "B", text: "b" },
    ],
  });

  it("passes a block the server built", () => {
    expect(checkBlock(valid())).not.toBeNull();
  });

  it("refuses a button the block does not have", () => {
    expect(
      checkBlock({ ...valid(), props: { options: ["a", "c"] } }),
    ).toBeNull();
  });

  it("refuses links off this site and unknown fields", () => {
    for (const path of [
      "https://evil.test",
      "//evil.test",
      "javascript:alert(1)",
      "/a b",
    ]) {
      expect(
        checkBlock({
          ...valid(),
          actions: [
            ...valid().actions,
            { id: "x", type: "link", label: "X", path },
          ],
        }),
      ).toBeNull();
    }
    expect(checkBlock({ ...valid(), html: "<b>x</b>" })).toBeNull();
    expect(checkBlock({ ...valid(), component: "iframe" })).toBeNull();
  });
});

describe("jobs side by side (D560)", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const job = (id: string, extra: Record<string, unknown>) => ({
    id,
    title: `Job ${id.slice(0, 1)}`,
    company: { name: `Company ${id.slice(0, 1)}` },
    workFormat: "remote",
    employmentType: "full_time",
    seniority: null,
    location: null,
    locationCountry: null,
    salaryMin: null,
    salaryMax: null,
    publishedAt: null,
    ...extra,
  });

  beforeEach(() => listJobsMock.mockReset());

  it("takes only ids from the model", () => {
    expect(
      showUiInput.safeParse({ component: "compare_jobs", jobIds: [A, B] })
        .success,
    ).toBe(true);
    expect(
      showUiInput.safeParse({ component: "compare_jobs", jobIds: [A] }).success,
    ).toBe(false);
    expect(
      showUiInput.safeParse({
        component: "compare_jobs",
        jobIds: [A, B],
        salary: "$1",
      }).success,
    ).toBe(false);
  });

  it("puts the same fields in the same order and marks what a job does not say", async () => {
    listJobsMock.mockResolvedValue([
      job(B, {
        seniority: "senior",
        locationCountry: "PL",
        salaryMin: {
          amountMinor: "8000000",
          currency: "USD",
          period: "year",
          basis: "gross",
        },
        publishedAt: "2026-10-20T00:00:00.000Z",
      }),
      job(A, {}),
    ]);
    const block = await blockFromShowUi(
      { component: "compare_jobs", jobIds: [A, B] },
      guest,
      NOW,
    );
    expect(block?.component).toBe("compare_jobs");
    const props = block?.props as {
      criteria: string[];
      items: { id: string; values: (string | null)[]; action: string }[];
    };
    expect(props.criteria).toEqual([
      "Salary",
      "Work format",
      "Employment",
      "Level",
      "Location",
      "Posted",
    ]);
    // The order the model asked for, not the order the catalog returned.
    expect(props.items.map((item) => item.id)).toEqual([A, B]);
    expect(props.items[0]!.values).toEqual([
      null,
      "Remote",
      "Full time",
      null,
      null,
      null,
    ]);
    expect(props.items[1]!.values[0]).toContain("80,000");
    expect(props.items[1]!.values[4]).toBe("PL");
    expect(block?.actions).toContainEqual(
      expect.objectContaining({ type: "link", path: `/jobs/${A}` }),
    );
    expect(block?.fallback.text).toContain("Not stated");
    expect(block?.source.ttlSec).toBe(3600);
    expect(block?.actions).toContainEqual(
      expect.objectContaining({ id: "refresh", type: "refresh" }),
    );
    expect(block?.source.refresh).toEqual({
      tool: "show_ui",
      args: { component: "compare_jobs", jobIds: [A, B] },
    });
  });

  it("shows nothing when fewer than two of the jobs are published", async () => {
    listJobsMock.mockResolvedValue([job(A, {})]);
    expect(
      await blockFromShowUi(
        { component: "compare_jobs", jobIds: [A, C] },
        guest,
        NOW,
      ),
    ).toBeNull();
  });

  it("refuses a block whose job lacks a value for a field", () => {
    expect(
      checkBlock({
        v: 1,
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        component: "compare_jobs",
        props: {
          criteria: ["Salary", "Level"],
          items: [
            { id: A, title: "A", company: "", values: [null], action: "a" },
            {
              id: B,
              title: "B",
              company: "",
              values: [null, null],
              action: "b",
            },
          ],
        },
        source: { tool: "show_ui", at: NOW.toISOString(), ttlSec: 3600 },
        fallback: { text: "x" },
        actions: [
          { id: "a", type: "link", label: "Open", path: `/jobs/${A}` },
          { id: "b", type: "link", label: "Open", path: `/jobs/${B}` },
        ],
      }),
    ).toBeNull();
  });
});
