import { describe, expect, it } from "vitest";
import { systemPrompt } from "../prompts/system";
import {
  isServiceFrom,
  serviceFocusBlock,
  serviceFocusOpener,
  serviceTopicState,
} from "../service/service-focus";

describe("service visit from /services", () => {
  it("accepts only the services marker", () => {
    expect(isServiceFrom("services")).toBe(true);
    expect(isServiceFrom("jobs")).toBe(false);
    expect(isServiceFrom(null)).toBe(false);
  });

  it("opens in the site language and names the company", () => {
    expect(serviceFocusOpener("ru")).toContain("Услуги");
    expect(serviceFocusOpener("ru")).toContain("INTGETION");
    expect(serviceFocusOpener("en")).toContain("Services");
    expect(serviceFocusOpener("de")).toContain("INTGETION");
    expect(serviceFocusOpener("xx")).toBe(serviceFocusOpener("en"));
  });

  it("tells the agent to represent the company and answer how the work is done", () => {
    const block = serviceFocusBlock();
    expect(block).toContain("You represent the company");
    expect(block).toContain("how the work is carried out");
    expect(block).toContain("Do not invent a dollar amount");
    expect(block).toContain("order_service");
    expect(block).not.toContain("http");
  });

  it("clears the open vacancy once, then keeps a later one", () => {
    const marked = serviceTopicState({
      presentedJobId: "job-1",
      verdict: "suits",
    });
    expect(marked.topic).toBe("services");
    expect(marked.presentedJobId).toBeUndefined();
    expect(marked.verdict).toBeUndefined();
    const later = serviceTopicState({
      ...marked,
      presentedJobId: "job-2",
      verdict: "suits",
    });
    expect(later.presentedJobId).toBe("job-2");
  });

  it("adds the block only for this visit", () => {
    const plain = systemPrompt({ locale: "en", signedIn: false });
    expect(plain).not.toContain("SERVICE TALK");
    const visit = systemPrompt({
      locale: "ru",
      signedIn: false,
      serviceFocus: serviceFocusBlock(),
    });
    expect(visit).toContain("SERVICE TALK");
    expect(visit).toContain("You represent the company");
  });
});
