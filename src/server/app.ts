import { z, ZodError } from "zod";
import {
  HttpError,
  httpErrorResponse,
  notFound,
  reportError,
  telegramSender,
  validationError,
} from "@intgetion/kit";
import * as bot from "../modules/bot/service";
import {
  botConfirmInput,
  botContinueInput,
  botFeedbackInput,
  botFillModeInput,
  botMemoryFactInput,
  botUiActionInput,
} from "../modules/bot/schemas";
import { botPorts } from "../ports";
import { isUuid, requireServiceToken } from "./auth";

export type AppConfig = {
  serviceToken: string;
  /** Telegram bot token for the agent and reminders; absent turns them off. */
  telegramToken?: string;
};

/** The person's bot session (the platform keeps it in its HttpOnly cookie). */
export const SESSION_HEADER = "x-bot-session";

const MAX_JSON = 64 * 1024;

/**
 * `POST /v1/messages`. The platform opens UGC threads itself (it reads the
 * campaign) and passes the product name; other entry points are by `from`.
 */
const messageBody = z
  .object({
    text: z.string().trim().min(1).max(2000),
    locale: z.string().max(10).optional(),
    from: z.enum(["services", "campaigns", "freelance_sell", "post_job"]).optional(),
    section: z.string().max(40).optional(),
    ugc: z
      .object({
        campaignId: z.uuid().optional(),
        inviteId: z.uuid().optional(),
        productName: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict();

const conversationQuery = z.object({
  locale: z.string().max(10).optional(),
  jobId: z.uuid().optional(),
  from: z.string().max(40).optional(),
});

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_JSON) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Body too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw validationError([{ path: [], message: "invalid_json" }]);
  }
}
const parsed = async <T>(request: Request, schema: z.ZodType<T>) => schema.parse(await readBody(request));

/** The signed-in person (active, checked by the platform), or a guest. */
function viewer(request: Request): string | null {
  const id = request.headers.get("x-user-id");
  if (!id) return null;
  if (!isUuid(id)) throw validationError({ header: "x-user-id" });
  return id;
}
function signedIn(request: Request): string {
  const id = viewer(request);
  if (!id) throw new HttpError(401, "UNAUTHENTICATED", "Sign in first");
  return id;
}
const session = (request: Request) => request.headers.get(SESSION_HEADER) ?? undefined;
const ip = (request: Request) => request.headers.get("x-client-ip") ?? "";

const json = (body: unknown, init: { status?: number; token?: string } = {}) =>
  Response.json(body, {
    status: init.status ?? 200,
    headers: {
      "cache-control": "no-store",
      ...(init.token ? { [SESSION_HEADER]: init.token } : {}),
    },
  });

/** Bot events as server-sent events, as the platform streams them. */
function stream(
  run: (emit: (event: bot.BotEvent) => void) => Promise<void>,
  onError: (emit: (event: bot.BotEvent) => void, error: unknown) => void,
  token?: string,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: bot.BotEvent) =>
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      try {
        await run(emit);
      } catch (error) {
        if (!(error instanceof HttpError)) reportError(error, "bot-service");
        onError(emit, error);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      ...(token ? { [SESSION_HEADER]: token } : {}),
    },
  });
}

const errorCode = (error: unknown) => (error instanceof HttpError ? error.code : "INTERNAL");

async function openForMessage(userId: string | null, token: string | undefined, locale: string, body: z.infer<typeof messageBody>) {
  if (userId && body.ugc) {
    return bot.openUgcThread({ userId, token, locale, ...body.ugc });
  }
  const input = { userId, token, locale };
  if (body.from === "campaigns") return bot.openUgcHomeConversation(input);
  if (body.from === "freelance_sell") return bot.openFreelanceDraftConversation(input);
  if (body.from === "post_job" && userId) return bot.openJobDraftConversation(input);
  if (body.from === "services") return bot.openServiceConversation(input);
  return bot.resolveConversation(input);
}

type Route = {
  method: string;
  pattern: RegExp;
  run: (request: Request, params: string[], url: URL, config: AppConfig) => Promise<Response>;
};

const routes: Route[] = [
  {
    method: "POST",
    pattern: /^\/v1\/messages$/,
    run: async (request) => {
      const userId = viewer(request);
      const body = await parsed(request, messageBody);
      const locale = body.locale ?? "en";
      const { conversation, token } = await openForMessage(userId, session(request), locale, body);
      return stream(
        (emit) =>
          bot.handleMessage(
            {
              userId,
              conversation,
              text: body.text,
              ip: ip(request),
              locale,
              page: body.section as never,
              goalSession: bot.goalSessionFromRequest(request),
            },
            emit,
          ),
        (emit, error) => {
          emit({ type: "error", code: errorCode(error) } as bot.BotEvent);
          emit({ type: "done", conversationId: conversation.id } as bot.BotEvent);
        },
        token,
      );
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/continue$/,
    run: async (request) => {
      const userId = signedIn(request);
      const body = await parsed(request, botContinueInput);
      return stream(
        (emit) =>
          bot.continueAfterCard(
            { userId, confirmationId: body.confirmationId, ip: ip(request), goalSession: bot.goalSessionFromRequest(request) },
            emit,
          ),
        (emit, error) => emit({ type: "error", code: errorCode(error) } as bot.BotEvent),
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/conversation$/,
    run: async (request, _p, url) => {
      const userId = viewer(request);
      const query = conversationQuery.parse(Object.fromEntries(url.searchParams));
      const resumed = await bot.resumeConversation({ userId, token: session(request), ...query });
      return json(resumed, { token: (resumed as { token?: string }).token });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/confirm$/,
    run: async (request) => {
      const userId = signedIn(request);
      const body = await parsed(request, botConfirmInput);
      // A card shown in Telegram is answered here; it stays bound to its thread.
      const conversation =
        (await bot.findConfirmationConversation(userId, body.confirmationId)) ??
        (await bot.findOwnConversation(userId, session(request)));
      if (!conversation) throw notFound();
      return json(
        await bot.confirmAction({
          userId,
          conversation,
          confirmationId: body.confirmationId,
          accept: body.accept,
          fields: body.fields,
        }),
      );
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/fill$/,
    run: async (request) => {
      const userId = signedIn(request);
      const body = await parsed(request, botFillModeInput);
      const conversation = await bot.findOwnConversation(userId, session(request));
      if (!conversation) throw notFound();
      return json(await bot.setFillMode(conversation, userId, body.mode));
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/goal$/,
    run: async (request) => {
      const userId = viewer(request);
      const action = await parsed(request, bot.jobGoalActionInput);
      const result = await bot.manageConversationJobGoal({
        userId,
        token: session(request),
        session: bot.goalSessionFromRequest(request),
        locale: "en",
        action,
      });
      return json({ goal: result.goal }, { token: result.token });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/feedback$/,
    run: async (request) => {
      const userId = viewer(request);
      const body = await parsed(request, botFeedbackInput);
      await botPorts().rateLimit("botFeedback", userId ?? ip(request));
      await bot.rateAnswer({ userId, token: session(request), messageId: body.messageId, rating: body.rating });
      return new Response(null, { status: 204 });
    },
  },
  {
    method: "POST",
    pattern: /^\/v1\/ui\/action$/,
    run: async (request) => {
      const userId = viewer(request);
      const body = await parsed(request, botUiActionInput);
      return json(
        await bot.runUiAction({
          userId,
          token: session(request),
          ip: ip(request),
          blockId: body.blockId,
          actionId: body.actionId,
        }),
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/v1\/conversations$/,
    run: async (request, _p, url) =>
      json({
        conversations: await bot.listOwnConversations(
          signedIn(request),
          Number(url.searchParams.get("limit") ?? 30),
        ),
      }),
  },
  {
    method: "GET",
    pattern: /^\/v1\/memory$/,
    run: async (request) => json({ facts: await bot.listMemory(signedIn(request)) }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/memory$/,
    run: async (request) => {
      const userId = signedIn(request);
      const body = await parsed(request, botMemoryFactInput);
      const result = await bot.rememberFact(userId, body.fact, "site");
      if (!result.ok) throw bot.memoryError(result.reason);
      return json({ fact: result.fact }, { status: 201 });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/v1\/memory$/,
    run: async (request) => json({ deleted: await bot.clearMemory(signedIn(request)) }),
  },
  {
    method: "PATCH",
    pattern: /^\/v1\/memory\/([^/]+)$/,
    run: async (request, [factId]) => {
      const userId = signedIn(request);
      if (!factId || !isUuid(factId)) throw notFound();
      const body = await parsed(request, botMemoryFactInput);
      return json({ fact: await bot.editFact(userId, factId, body.fact) });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/v1\/memory\/([^/]+)$/,
    run: async (request, [factId]) => {
      const userId = signedIn(request);
      if (!factId || !isUuid(factId)) throw notFound();
      await bot.forgetFact(userId, factId);
      return new Response(null, { status: 204 });
    },
  },
  {
    // The platform's Telegram webhook hands over messages that are for Spoki.
    method: "POST",
    pattern: /^\/v1\/telegram\/update$/,
    run: async (request, _p, _u, config) => {
      if (!config.telegramToken) throw new HttpError(503, "TELEGRAM_OFF", "Telegram is not configured");
      await bot.handleTelegramAgentUpdate(config.telegramToken, await readBody(request));
      return json({ ok: true });
    },
  },
  {
    // Cron: due reminders, then the journal and idle goals.
    method: "POST",
    pattern: /^\/v1\/tasks\/run$/,
    run: async (_request, _p, _u, config) => {
      const reminders = config.telegramToken
        ? await bot.runReminderDispatch({ sender: telegramSender(config.telegramToken) })
        : null;
      return json({
        reminders,
        journal: await bot.sweepBotActions(),
        goals: await bot.sweepIdleJobGoals(),
      });
    },
  },
];

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return httpErrorResponse(error);
  if (error instanceof ZodError) return httpErrorResponse(validationError(error.issues));
  reportError(error, "bot-service");
  return Response.json({ error: { code: "INTERNAL", message: "Internal error" } }, { status: 500 });
}

export function createApp(config: AppConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true });
      requireServiceToken(request, config.serviceToken);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        return await route.run(request, match.slice(1), url, config);
      }
      throw notFound();
    } catch (error) {
      return toResponse(error);
    }
  };
}
