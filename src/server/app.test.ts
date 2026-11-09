import { describe, expect, it, vi } from "vitest";
import { createApp, SESSION_HEADER } from "./app";
import { httpBotPorts } from "./remote-ports";

const token = "test-token";
const app = createApp({ serviceToken: token });
const user = "11111111-1111-4111-8111-111111111111";
const auth = { authorization: `Bearer ${token}` };
const call = (path: string, init: RequestInit = {}) => app(new Request(`http://bot${path}`, init));

describe("bot http", () => {
  it("serves health without a token and refuses a missing one", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/v1/memory")).status).toBe(401);
  });
  it("needs a signed-in person for memory, cards and fill", async () => {
    expect((await call("/v1/memory", { headers: auth })).status).toBe(401);
    const confirm = await call("/v1/confirm", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ confirmationId: user, accept: true }),
    });
    expect(confirm.status).toBe(401);
  });
  it("rejects bad bodies and a bad person id", async () => {
    const headers = { ...auth, "x-user-id": user };
    expect((await call("/v1/messages", { method: "POST", headers, body: JSON.stringify({ text: "" }) })).status).toBe(400);
    expect((await call("/v1/memory", { method: "POST", headers, body: "{bad" })).status).toBe(400);
    expect((await call("/v1/memory", { headers: { ...auth, "x-user-id": "nope" } })).status).toBe(400);
  });
  it("answers 404 for a bad fact id, 503 without Telegram, 404 for unknown routes", async () => {
    const headers = { ...auth, "x-user-id": user };
    expect((await call("/v1/memory/nope", { method: "DELETE", headers })).status).toBe(404);
    expect((await call("/v1/telegram/update", { method: "POST", headers: auth, body: "{}" })).status).toBe(503);
    expect((await call("/v1/nothing", { headers: auth })).status).toBe(404);
    expect(SESSION_HEADER).toBe("x-bot-session");
  });
});

describe("remote ports", () => {
  it("sends args, revives hidden sets, keeps an owner's 4xx", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const op = String(url).split("/").pop();
      const { args } = JSON.parse(String(init?.body)) as { args: unknown[] };
      if (op === "feedback.hidden-sets") return Response.json({ result: { hiddenJobIds: ["j1"], hiddenCompanyIds: [] } });
      if (op === "taxonomy.match-skill") return Response.json({ result: args[0] === "React" ? "react" : null });
      if (op === "rate-limit") return Response.json({ error: { code: "RATE_LIMITED", message: "slow" } }, { status: 429 });
      return new Response("down", { status: 503 });
    });
    const ports = httpBotPorts({ platform: { url: "http://p/", token: "t" }, fetchImpl: fetchImpl as typeof fetch });
    const hidden = await ports.feedback.getHiddenSetsForViewer(user);
    expect(hidden.hiddenJobIds.has("j1")).toBe(true);
    expect(await ports.taxonomy.matchSkillSlug("React")).toBe("react");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("http://p/api/internal/bot/taxonomy.match-skill");
    await expect(ports.rateLimit("botUser", user)).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    await expect(ports.users.readSharedProfile(user)).rejects.toThrow("503");
  });
});
