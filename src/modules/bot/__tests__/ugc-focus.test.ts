import { describe, expect, it } from "vitest";
import { ugcDraftContextBlock, ugcFocusBlock } from "../service/ugc-focus";

describe("UGC brief focus", () => {
  it("uses the live draft as the authority for whether product name is missing", () => {
    const focus = ugcFocusBlock("", true, true);

    expect(focus).toContain("CURRENT UGC BRIEF STATE block is authoritative");
    expect(focus).toContain("only when missingRequired includes productName");
    expect(focus).not.toContain("No product has been named yet");
  });

  it("provides the saved product name and remaining required fields in draft context", () => {
    const context = ugcDraftContextBlock({
      thread: "ugc",
      locale: "ru",
      draft: { productName: "LUMINA Glow Serum" },
      missingRequired: ["goal", "platform"],
      assumptions: [],
    });

    expect(context).toContain('"productName":"LUMINA Glow Serum"');
    expect(context).toContain('"missingRequired":["goal","platform"]');
    expect(context).toContain("do not re-ask filled fields");
  });

  it("retains the product-name prompt for non-draft UGC entry", () => {
    expect(ugcFocusBlock("", false)).toContain("No product has been named yet");
  });
});
