# intgetion-bot

The core of Spoki, the INTGETION assistant, as a standalone service: web and
Telegram conversations, guest sessions and their hand-over at sign-in, the
tool loop with server-side cards (P8) and access checks (P11), routing of
tools by service (D522), memory (D469), reminders (D570), the action journal
(D521), job goals, interactive blocks (D523), the after-card turn (D515) and
the answer checks. Not connected to the platform yet; it is integrated later
through a separate branch and PR. The chat UI stays in the platform.

- Package `@intgetion/bot`, HTTP service on port `4150`.
- Depends by git tag on `@intgetion/kit` v0.3.1, `@intgetion/llm` v0.1.0
  (models, budget, redaction) and, for types and pure helpers only, on
  taxonomy, candidates, jobs, freelance, feedback, applications, users and
  billing.
- Owns tables `bot_conversations`, `bot_messages`, `bot_memory_facts`,
  `bot_reminders`, `bot_confirmations`, `bot_actions` (migration `0001_bot.sql`,
  the final state of platform migrations 0018, 0047, 0052, 0058, 0059, 0070
  and 0088 for them, with the `app_rw` grants; tracker `bot_schema_migrations`).
- Reads only, outside its tables: `users` (locale, status) and
  `telegram_accounts` for reminder delivery.

## Tools: core and registry

The core owns the tool framework (`service/tools.ts`: `BotTool`, access and
card checks, routing, MCP faces) and its own tools: `use_tools`,
`offer_step`, `remember_fact`, `forget_fact`, the reminder tools and
`show_ui`. The tool sets that act on other modules (jobs search and saving,
applications, account, company, employer jobs, cards, pitch, freelance, UGC)
stay in the platform with their modules and are plugged in at start:

```ts
import { registerBotTools, setBotPorts } from "@intgetion/bot";
registerBotTools([...platformTools, ...freelanceTools, ...ugcTools]);
```

The eval harness that runs the full tool set (`eval-run`) stays in the
platform too; the eval sets in `evals/` and the routing checks are here.

## Ports (`src/ports.ts`)

What the conversation itself reads from other modules: the shared and
candidate profile, the billing plan, skill matching, public jobs and the job
draft, a freelance order, service and service draft, the UGC brief draft
and price guide, own applications, saved and hidden jobs, the rate limiter
and the Telegram bot. Port types are the owners' own signatures
(`typeof import("@intgetion/jobs").readJobDraft`). `src/platform.ts` keeps
the names the code used. Over HTTP every port goes to one platform
callback, `POST /api/internal/bot/:op` with `{args}`, answering `{result}`
or `{error}`.

## HTTP

Every route except `/health` needs `authorization: Bearer $BOT_SERVICE_TOKEN`.
The platform signs the person in and passes them in `x-user-id`, the address
in `x-client-ip`, the bot session in `x-bot-session` (returned in the same
header when it changes; the platform keeps it in its HttpOnly cookie) and
the job-goal tab in `x-spoki-goal-session`.

| Method | Path | Does |
| --- | --- | --- |
| POST | `/v1/messages` | one turn, streamed as server-sent events; `{text, locale?, from?, section?, ugc?}` |
| POST | `/v1/continue` | the turn after a card, streamed |
| GET | `/v1/conversation?locale&jobId&from` | resume the thread |
| POST | `/v1/confirm` | answer a card `{confirmationId, accept, fields?}` |
| POST | `/v1/fill` | `{mode: self\|spoki}` |
| POST | `/v1/goal` | job goal actions |
| POST | `/v1/feedback` | rate an answer |
| POST | `/v1/ui/action` | a button on a block |
| GET | `/v1/conversations?limit=` | own conversations, newest first: topic, last message time, first question (chat history) |
| GET / POST / DELETE | `/v1/memory` | list, add, clear facts |
| PATCH / DELETE | `/v1/memory/:id` | edit, forget one fact |
| POST | `/v1/telegram/update` | a Telegram update for Spoki |
| POST | `/v1/tasks/run` | cron: due reminders, journal sweep, idle goals |

UGC threads are opened by the platform: it reads the campaign and passes
`ugc: {campaignId?, inviteId?, productName}`.

## Run

```bash
cp .env.example .env
npm ci
npm run migrate
npm start
```

## Tests

Unit tests run without a database. Integration tests run when `DATABASE_URL`
is set, on a database prepared as in CI: `test/sql/pre/*.sql`, then
`npm run migrate`. Every test starts with harmless ports and stand-ins for
the platform's tool sets: `test/platform-tools.json` holds their names and
gates (access, card, journal, card fields) taken from the platform, and
`run` echoes its input unless a test records it. Checks of the tool sets
themselves (search results, saving, applying, retention and export) run in
the platform with those modules. The two live evals are skipped without a
model key.
