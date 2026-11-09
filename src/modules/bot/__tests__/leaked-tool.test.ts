import { describe, expect, it } from "vitest";
import {
  containsLeakedToolMarkup,
  shouldSearchDespiteLeak,
  stripLeakedToolMarkup,
} from "../service/leaked-tool";

const LEAKED_OFFER = `<tool_call>
<function=offer_step>
<parameter=step>
pay_plus
</parameter>
</function>
</tool_call>`;

describe("leaked tool markup", () => {
  it("removes the fake offer_step the model wrote as text", () => {
    expect(containsLeakedToolMarkup(LEAKED_OFFER)).toBe(true);
    expect(stripLeakedToolMarkup(LEAKED_OFFER)).toBe("");
    expect(stripLeakedToolMarkup(`Here you go.\n${LEAKED_OFFER}`)).toBe(
      "Here you go.",
    );
  });

  it("leaves an ordinary reply unchanged", () => {
    const text = "Community manager, remote.";
    expect(stripLeakedToolMarkup(text)).toBe(text);
  });

  it("searches when a role and remote format are already known", () => {
    expect(
      shouldSearchDespiteLeak({
        text: LEAKED_OFFER,
        toolNames: [],
        draft: {
          desiredTitles: ["community manager"],
          workFormats: ["remote"],
        },
      }),
    ).toBe(true);
    expect(
      shouldSearchDespiteLeak({
        text: LEAKED_OFFER,
        toolNames: ["search_jobs"],
        draft: {
          country: "IT",
          desiredTitles: ["community manager"],
          workFormats: ["remote"],
        },
      }),
    ).toBe(false);
    expect(
      shouldSearchDespiteLeak({
        text: LEAKED_OFFER,
        toolNames: [],
        draft: { country: "IT" },
      }),
    ).toBe(false);
  });
});
