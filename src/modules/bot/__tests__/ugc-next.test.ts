import { describe, expect, it } from "vitest";
import { ugcNextCard, ugcNextLine, ugcNextLink } from "../service/ugc-next";

/** The line, card and page Spoki shows for a UGC next step (D467). */

const CAMPAIGN = "00000000-0000-4000-8000-0000000000c1";
const ADA = "00000000-0000-4000-8000-0000000000a1";

describe("what Spoki shows for a step (D467)", () => {
  const kinds = [
    "deposit",
    "hire",
    "decide",
    "remind",
    "accept",
    "submit",
    "changes",
    "payout",
  ] as const;

  it("has a line for every step in every language", () => {
    for (const locale of ["en", "ru", "es", "pt-BR", "de", "fr", "it"]) {
      for (const kind of kinds) {
        expect(ugcNextLine(locale, kind).length).toBeGreaterThan(10);
      }
    }
    expect(ugcNextLine("xx", "hire")).toBe(ugcNextLine("en", "hire"));
  });

  it("puts writes on a card and payments or decisions on a page", () => {
    const base = { campaignId: CAMPAIGN, inviteId: "i1" };
    expect(
      ugcNextCard({
        kind: "hire",
        key: "k",
        campaignId: CAMPAIGN,
        creatorId: ADA,
      }),
    ).toEqual({
      tool: "offer_ugc_hire",
      args: { campaignId: CAMPAIGN, creatorId: ADA },
    });
    expect(ugcNextCard({ kind: "remind", key: "k", ...base })?.tool).toBe(
      "remind_ugc_invites",
    );
    expect(ugcNextCard({ kind: "accept", key: "k", ...base })?.tool).toBe(
      "accept_ugc_invite",
    );
    expect(ugcNextCard({ kind: "decide", key: "k", ...base })).toBeNull();
    expect(
      ugcNextLink({ kind: "deposit", key: "k", campaignId: CAMPAIGN }),
    ).toEqual({ href: `/billing/crypto?ugc=${CAMPAIGN}`, link: "ugcDeposit" });
    expect(ugcNextLink({ kind: "decide", key: "k", ...base })?.href).toBe(
      `/campaigns/${CAMPAIGN}`,
    );
    expect(ugcNextLink({ kind: "payout", key: "k", ...base })?.link).toBe(
      "ugcPayout",
    );
    expect(
      ugcNextLink({
        kind: "hire",
        key: "k",
        campaignId: CAMPAIGN,
        creatorId: ADA,
      }),
    ).toBeNull();
  });
});
