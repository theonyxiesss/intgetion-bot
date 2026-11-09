import { markdownToTelegramHtml, stripMarkdown } from "../../../lib/telegram-markdown";
import { createHmac } from "node:crypto";
import { logger } from "@intgetion/kit";
import { siteUrl } from "@intgetion/kit";
import {
  sendTelegramChatAction,
  sendTelegramLinks,
  sendTelegramMessage,
  userIdForTelegramId,
} from "../../../platform";
import {
  handleMessage,
  openJobDraftConversation,
  resolveConversation,
  type BotEvent,
} from "./conversation";
import { localePrefix } from "../../../i18n/paths";
import { stripLeakedToolMarkup } from "./leaked-tool";
import {
  fillKindOf,
  fillPaths,
  isFillKind,
  isOfferAction,
  offerPath,
  type OfferAction,
} from "./offers";

function fillKindFromOffer(action: unknown) {
  return isOfferAction(action) ? fillKindOf(action) : null;
}

/** One Telegram message is 4096 characters; leave room for the job list. */
const TELEGRAM_TEXT_LIMIT = 3500;
const MAX_JOBS_IN_REPLY = 5;

type TelegramChatMessage = {
  text?: string;
  from?: { id?: number; is_bot?: boolean; language_code?: string };
  chat?: { id?: number };
};

export type TelegramAgentUpdate = { message?: TelegramChatMessage };

const copy = {
  en: {
    unavailable:
      "The agent is resting right now. The catalogue still works: " +
      "{site}/en/jobs",
    tryLater: "Something went wrong on my side. Try again in a minute.",
    rateLimited: "That is a lot of questions at once. Try again in a minute.",
    budget: "The agent has reached its budget for today. Try again tomorrow.",
    empty: "Ask me what you are looking for — a role, a skill, a time zone.",
    reset: "Forgotten. What are you looking for?",
    help:
      "Ask in plain words: «remote solidity jobs», «part-time design in Europe». " +
      "Sign in on {site} to save jobs and apply. Send /post_job to prepare a listing. /reset starts a new conversation.",
    signIn: "To save a job or apply, sign in, then come back here.",
    signInButton: "Sign in",
    jobSignIn: "Sign in to prepare a job listing.",
    fillChoice: "Or reply here and we fill it in together.",
    fillChatButton: "Fill in with Spoki on the site",
    jobChoice: "Or send /post_job and we fill it in here.",
    jobFormButton: "Fill in the form",
    jobDraftButton: "Review job draft",
    startJob:
      "Let's prepare a job listing draft. Tell me who you need, and I'll save the details and ask only about the next important gap.",
    confirmOnSite: "Confirm this on the site, then come back here.",
    openChat: "Open the chat",
    openJob: "Open",
    more: "More in the catalogue: {site}/en/jobs",
  },
  ru: {
    unavailable: "Агент сейчас недоступен. Каталог работает: {site}/ru/jobs",
    tryLater: "У меня что-то сломалось. Попробуйте через минуту.",
    rateLimited: "Слишком много вопросов подряд. Попробуйте через минуту.",
    budget: "Агент исчерпал бюджет на сегодня. Попробуйте завтра.",
    empty: "Напишите, что ищете: роль, навык, часовой пояс.",
    reset: "Забыл. Что ищете?",
    help:
      "Пишите словами: «удалённая работа solidity», «дизайн на part-time в Европе». " +
      "Войдите на {site}, чтобы сохранять вакансии и откликаться. Отправьте /post_job, чтобы подготовить вакансию. /reset — начать заново.",
    signIn:
      "Чтобы сохранить вакансию или откликнуться, войдите и возвращайтесь сюда.",
    signInButton: "Войти",
    jobSignIn: "Войдите, чтобы подготовить вакансию.",
    fillChoice: "Или ответьте здесь — заполним вместе.",
    fillChatButton: "Заполнить со Spoki на сайте",
    jobChoice: "Или отправьте /post_job — заполним здесь.",
    jobFormButton: "Заполнить форму",
    jobDraftButton: "Проверить черновик вакансии",
    startJob:
      "Давайте подготовим черновик вакансии. Напишите, кого ищете, а я сохраню детали и спрошу только о следующем важном пробеле.",
    confirmOnSite: "Подтвердите это на сайте и возвращайтесь сюда.",
    openChat: "Открыть чат",
    openJob: "Открыть",
    more: "Ещё в каталоге: {site}/ru/jobs",
  },
  "pt-BR": {
    unavailable:
      "O agente está descansando agora. O catálogo continua funcionando: " +
      "{site}/pt-BR/jobs",
    tryLater: "Algo deu errado do meu lado. Tente novamente em um minuto.",
    rateLimited:
      "São muitas perguntas de uma vez. Tente novamente em um minuto.",
    budget: "O agente atingiu o orçamento de hoje. Tente novamente amanhã.",
    empty:
      "Diga o que você procura — um cargo, uma habilidade, um fuso horário.",
    reset: "Esquecido. O que você procura?",
    help:
      "Pergunte com suas palavras: «vagas remotas de solidity», «design em meio período na Europa». " +
      "Entre em {site} para salvar vagas e se candidatar. Envie /post_job para preparar uma vaga. /reset começa uma nova conversa.",
    signIn: "Para salvar uma vaga ou se candidatar, entre e depois volte aqui.",
    signInButton: "Entrar",
    jobSignIn: "Entre para preparar uma vaga.",
    fillChoice: "Ou responda aqui e preenchemos juntos.",
    fillChatButton: "Preencher com o Spoki no site",
    jobChoice: "Ou envie /post_job e preenchemos aqui.",
    jobFormButton: "Preencher o formulário",
    jobDraftButton: "Revisar rascunho da vaga",
    startJob:
      "Vamos preparar um rascunho da vaga. Diga quem você procura; vou salvar os detalhes e perguntar apenas sobre o próximo dado importante que faltar.",
    confirmOnSite: "Confirme isso no site e depois volte aqui.",
    openChat: "Abrir o chat",
    openJob: "Abrir",
    more: "Mais no catálogo: {site}/pt-BR/jobs",
  },
  de: {
    unavailable:
      "Der Agent ruht gerade. Der Katalog funktioniert weiterhin: " +
      "{site}/de/jobs",
    tryLater:
      "Bei mir ist etwas schiefgelaufen. Versuchen Sie es in einer Minute erneut.",
    rateLimited:
      "Das sind viele Fragen auf einmal. Versuchen Sie es in einer Minute erneut.",
    budget:
      "Der Agent hat sein Budget für heute erreicht. Versuchen Sie es morgen erneut.",
    empty:
      "Sagen Sie mir, was Sie suchen — eine Rolle, einen Skill, eine Zeitzone.",
    reset: "Vergessen. Was suchen Sie?",
    help:
      "Fragen Sie mit Ihren Worten: «Remote-Jobs mit Solidity», «Design in Teilzeit in Europa». " +
      "Melden Sie sich auf {site} an, um Jobs zu speichern und sich zu bewerben. /reset beginnt ein neues Gespräch.",
    signIn:
      "Um einen Job zu speichern oder sich zu bewerben, melden Sie sich an und kommen Sie dann hierher zurück.",
    signInButton: "Anmelden",
    jobSignIn: "Melden Sie sich an, um eine Stellenanzeige vorzubereiten.",
    fillChoice: "Oder antworte hier, dann füllen wir es zusammen aus.",
    fillChatButton: "Mit Spoki auf der Website ausfüllen",
    jobChoice: "Oder sende /post_job, dann füllen wir sie hier aus.",
    jobFormButton: "Formular ausfüllen",
    jobDraftButton: "Stellenentwurf ansehen",
    startJob:
      "Lass uns einen Stellenentwurf erstellen. Beschreibe, wen du suchst; ich speichere die Angaben und frage nur nach der nächsten wichtigen Lücke.",
    confirmOnSite:
      "Bestätigen Sie das auf der Website und kommen Sie dann hierher zurück.",
    openChat: "Chat öffnen",
    openJob: "Öffnen",
    more: "Mehr im Katalog: {site}/de/jobs",
  },
  fr: {
    unavailable:
      "L’agent se repose en ce moment. Le catalogue fonctionne toujours : " +
      "{site}/fr/jobs",
    tryLater:
      "Quelque chose a mal tourné de mon côté. Réessayez dans une minute.",
    rateLimited:
      "Cela fait beaucoup de questions d’un coup. Réessayez dans une minute.",
    budget: "L’agent a atteint son budget pour aujourd’hui. Réessayez demain.",
    empty:
      "Dites-moi ce que vous cherchez — un poste, une compétence, un fuseau horaire.",
    reset: "Oublié. Que cherchez-vous ?",
    help:
      "Demandez avec vos mots : «emplois Solidity à distance», «design à temps partiel en Europe». " +
      "Connectez-vous sur {site} pour enregistrer des offres et postuler. Envoyez /post_job pour préparer une offre. /reset démarre une nouvelle conversation.",
    signIn:
      "Pour enregistrer une offre ou postuler, connectez-vous, puis revenez ici.",
    signInButton: "Se connecter",
    jobSignIn: "Connectez-vous pour préparer une offre d’emploi.",
    fillChoice: "Ou réponds ici et on le remplit ensemble.",
    fillChatButton: "Remplir avec Spoki sur le site",
    jobChoice: "Ou envoie /post_job et on la remplit ici.",
    jobFormButton: "Remplir le formulaire",
    jobDraftButton: "Vérifier le brouillon d’offre",
    startJob:
      "Préparons un brouillon d’offre d’emploi. Décris le profil recherché ; j’enregistre les informations et ne demande que le prochain élément important manquant.",
    confirmOnSite: "Confirmez cela sur le site, puis revenez ici.",
    openChat: "Ouvrir le chat",
    openJob: "Ouvrir",
    more: "Plus dans le catalogue : {site}/fr/jobs",
  },
  it: {
    unavailable:
      "L’agente sta riposando. Il catalogo funziona ancora: " +
      "{site}/it/jobs",
    tryLater: "Qualcosa è andato storto da parte mia. Riprova tra un minuto.",
    rateLimited: "Sono tante domande tutte insieme. Riprova tra un minuto.",
    budget: "L’agente ha raggiunto il budget di oggi. Riprova domani.",
    empty: "Dimmi cosa cerchi — un ruolo, una competenza, un fuso orario.",
    reset: "Dimenticato. Cosa cerchi?",
    help:
      "Chiedi con parole tue: «lavori Solidity da remoto», «design part-time in Europa». " +
      "Accedi su {site} per salvare offerte e candidarti. Invia /post_job per preparare un’offerta. /reset avvia una nuova conversazione.",
    signIn: "Per salvare un’offerta o candidarti, accedi e poi torna qui.",
    signInButton: "Accedi",
    jobSignIn: "Accedi per preparare un’offerta di lavoro.",
    fillChoice: "Oppure rispondi qui e lo compiliamo insieme.",
    fillChatButton: "Compila con Spoki sul sito",
    jobChoice: "Oppure invia /post_job e la compiliamo qui.",
    jobFormButton: "Compila il modulo",
    jobDraftButton: "Rivedi la bozza dell’offerta",
    startJob:
      "Prepariamo una bozza dell’offerta. Dimmi chi cerchi; salverò i dettagli e chiederò solo il prossimo dato importante che manca.",
    confirmOnSite: "Confermalo sul sito e poi torna qui.",
    openChat: "Apri la chat",
    openJob: "Apri",
    more: "Altro nel catalogo: {site}/it/jobs",
  },
} as const;

type Lines = { readonly [K in keyof (typeof copy)["en"]]: string };

const OFFER_BUTTON: Record<string, Record<OfferAction, string>> = {
  en: {
    pay_hire: "Pay for Hire",
    pay_team: "Pay for Team",
    pay_plus: "Pay for Plus",
    pay_pro: "Pay for Pro",
    pricing: "See plans",
    register: "Create account",
    post_job: "Post a job",
    fill_job: "Fill in the form",
    fill_brief: "Fill in the form",
    fill_service: "Fill in the form",
    fill_profile: "Fill in the form",
    fill_creator: "Fill in the form",
    fill_company: "Fill in the form",
    order_service: "Describe the task",
    events: "See events",
    campaigns: "UGC videos",
    freelance: "Freelance services",
    freelance_sell: "Sell a service",
    freelance_payout: "Confirm payout address",
    memory: "Spoki memory",
    link_telegram: "Link Telegram",
    account_settings: "Account settings",
    my_account: "My account",
    company: "Company page",
  },
  ru: {
    pay_hire: "Оплатить «Найм»",
    pay_team: "Оплатить «Команду»",
    pay_plus: "Оплатить Plus",
    pay_pro: "Оплатить Pro",
    pricing: "Открыть тарифы",
    register: "Создать аккаунт",
    post_job: "Разместить вакансию",
    fill_job: "Заполнить форму",
    fill_brief: "Заполнить форму",
    fill_service: "Заполнить форму",
    fill_profile: "Заполнить форму",
    fill_creator: "Заполнить форму",
    fill_company: "Заполнить форму",
    order_service: "Описать задачу",
    events: "Смотреть события",
    campaigns: "UGC-видео",
    freelance: "Фриланс-услуги",
    freelance_sell: "Выставить услугу",
    freelance_payout: "Подтвердить адрес выплаты",
    memory: "Память Spoki",
    link_telegram: "Привязать Telegram",
    account_settings: "Настройки аккаунта",
    my_account: "Мой аккаунт",
    company: "Страница компании",
  },
  "pt-BR": {
    pay_hire: "Pagar Hire",
    pay_team: "Pagar Team",
    pay_plus: "Pagar Plus",
    pay_pro: "Pagar Pro",
    pricing: "Ver planos",
    register: "Criar conta",
    post_job: "Publicar uma vaga",
    fill_job: "Preencher o formulário",
    fill_brief: "Preencher o formulário",
    fill_service: "Preencher o formulário",
    fill_profile: "Preencher o formulário",
    fill_creator: "Preencher o formulário",
    fill_company: "Preencher o formulário",
    order_service: "Descrever a tarefa",
    events: "Ver eventos",
    campaigns: "Vídeos UGC",
    freelance: "Serviços freelance",
    freelance_sell: "Oferecer um serviço",
    freelance_payout: "Confirmar endereço de recebimento",
    memory: "Memória do Spoki",
    link_telegram: "Vincular Telegram",
    account_settings: "Configurações da conta",
    my_account: "Minha conta",
    company: "Página da empresa",
  },
  de: {
    pay_hire: "Hire bezahlen",
    pay_team: "Team bezahlen",
    pay_plus: "Plus bezahlen",
    pay_pro: "Pro bezahlen",
    pricing: "Tarife ansehen",
    register: "Konto erstellen",
    post_job: "Job ausschreiben",
    fill_job: "Formular ausfüllen",
    fill_brief: "Formular ausfüllen",
    fill_service: "Formular ausfüllen",
    fill_profile: "Formular ausfüllen",
    fill_creator: "Formular ausfüllen",
    fill_company: "Formular ausfüllen",
    order_service: "Aufgabe beschreiben",
    events: "Events ansehen",
    campaigns: "UGC-Videos",
    freelance: "Freelance-Dienste",
    freelance_sell: "Dienst anbieten",
    freelance_payout: "Auszahlungsadresse bestätigen",
    memory: "Spoki-Gedächtnis",
    link_telegram: "Telegram verknüpfen",
    account_settings: "Kontoeinstellungen",
    my_account: "Mein Konto",
    company: "Unternehmensseite",
  },
  fr: {
    pay_hire: "Payer Hire",
    pay_team: "Payer Team",
    pay_plus: "Payer Plus",
    pay_pro: "Payer Pro",
    pricing: "Voir les formules",
    register: "Créer un compte",
    post_job: "Publier une offre",
    fill_job: "Remplir le formulaire",
    fill_brief: "Remplir le formulaire",
    fill_service: "Remplir le formulaire",
    fill_profile: "Remplir le formulaire",
    fill_creator: "Remplir le formulaire",
    fill_company: "Remplir le formulaire",
    order_service: "Décrire la tâche",
    events: "Voir les événements",
    campaigns: "Vidéos UGC",
    freelance: "Services freelance",
    freelance_sell: "Proposer un service",
    freelance_payout: "Confirmer l’adresse de versement",
    memory: "Mémoire de Spoki",
    link_telegram: "Lier Telegram",
    account_settings: "Paramètres du compte",
    my_account: "Mon compte",
    company: "Page de l’entreprise",
  },
  it: {
    pay_hire: "Paga Hire",
    pay_team: "Paga Team",
    pay_plus: "Paga Plus",
    pay_pro: "Paga Pro",
    pricing: "Vedi i piani",
    register: "Crea un account",
    post_job: "Pubblica un’offerta",
    fill_job: "Compila il modulo",
    fill_brief: "Compila il modulo",
    fill_service: "Compila il modulo",
    fill_profile: "Compila il modulo",
    fill_creator: "Compila il modulo",
    fill_company: "Compila il modulo",
    order_service: "Descrivi il compito",
    events: "Vedi eventi",
    campaigns: "Video UGC",
    freelance: "Servizi freelance",
    freelance_sell: "Offri un servizio",
    freelance_payout: "Conferma l’indirizzo di pagamento",
    memory: "Memoria di Spoki",
    link_telegram: "Collega Telegram",
    account_settings: "Impostazioni account",
    my_account: "Il mio account",
    company: "Pagina dell’azienda",
  },
};

const ORDER_BUTTON: Record<string, string> = {
  en: "Open the order",
  ru: "Открыть заказ",
  "pt-BR": "Abrir o pedido",
  de: "Auftrag öffnen",
  fr: "Ouvrir la commande",
  it: "Apri l’ordine",
};

type LinkButton = { label: string; url: string };
/** `markdown`: Spoki's own words, sent as Telegram HTML (D514). */
type Part = { text: string; links: LinkButton[]; markdown?: boolean };

function buttonsFor(locale: string): Record<OfferAction, string> {
  return OFFER_BUTTON[locale] ?? OFFER_BUTTON.en;
}

function pageUrl(locale: string, path: string): string {
  return `${siteUrl()}${localePrefix(locale)}${path}`;
}

function linesFor(languageCode: string | undefined): {
  lines: Lines;
  locale: string;
} {
  const code = (languageCode ?? "").toLowerCase();
  // D350: Telegram sends "pt" or "pt-br"; both get Brazilian Portuguese.
  if (code.startsWith("pt")) return { lines: copy["pt-BR"], locale: "pt-BR" };
  // D373: "de", "de-at", "de-ch" all get German.
  if (code.startsWith("de")) return { lines: copy.de, locale: "de" };
  // D374: "fr", "fr-fr", "fr-ca", "fr-be", "fr-ch" all get French.
  if (code.startsWith("fr")) return { lines: copy.fr, locale: "fr" };
  // D379: "it", "it-it", "it-ch" all get Italian.
  if (code.startsWith("it")) return { lines: copy.it, locale: "it" };
  const ru = code.startsWith("ru");
  return { lines: ru ? copy.ru : copy.en, locale: ru ? "ru" : "en" };
}

function fill(line: string): string {
  return line.replace("{site}", siteUrl());
}

/**
 * The conversation of one Telegram chat, derived rather than stored: the same
 * chat always yields the same session token, so the agent remembers the thread
 * without a table of its own. The secret keeps a chat id from being guessable.
 */
function chatSessionToken(chatId: number): string {
  const secret = process.env.PRIVACY_HASH_SECRET ?? "";
  return createHmac("sha256", secret).update(`tg:${chatId}`).digest("hex");
}

/** A fresh thread for /reset: the salt changes the derived token. */
function resetSessionToken(chatId: number, now: Date): string {
  const secret = process.env.PRIVACY_HASH_SECRET ?? "";
  return createHmac("sha256", secret)
    .update(`tg:${chatId}:${now.toISOString().slice(0, 16)}`)
    .digest("hex");
}

const resets = new Map<number, string>();

/** Collects the turn's events into text and the buttons Telegram can show. */
function render(
  events: BotEvent[],
  lines: Lines,
  locale: string,
  signedIn: boolean,
): Part[] {
  const out: Part[] = [];
  let answer = "";
  for (const event of events) {
    if (
      event.type === "token" ||
      event.type === "resume_ack" ||
      event.type === "signup_hint" ||
      event.type === "profile_saved"
    ) {
      answer += event.text;
    }
  }
  const said = stripLeakedToolMarkup(answer)
    .trim()
    .slice(0, TELEGRAM_TEXT_LIMIT);
  if (said) out.push({ text: said, links: [], markdown: true });

  for (const event of events) {
    if (event.type !== "tool_result") continue;
    if (event.kind !== "jobs" && event.kind !== "matches") continue;
    const jobs =
      (event.data as Array<{
        id: string;
        title: string;
        companyName: string;
      }>) ?? [];
    const shown = jobs.slice(0, MAX_JOBS_IN_REPLY);
    const links = shown.map((job) => ({
      label: job.title.trim().slice(0, 64) || lines.openJob,
      url: pageUrl(locale, `/jobs/${job.id}`),
    }));
    const list = shown.map((job) => `• ${job.title} — ${job.companyName}`);
    if (list.length) out.push({ text: list.join("\n"), links });
  }

  for (const event of events) {
    if (event.type !== "tool_result") continue;
    if (event.kind === "freelance_services") {
      const services =
        (event.data as Array<{ slug: string; title: string }>) ?? [];
      const shown = services.slice(0, MAX_JOBS_IN_REPLY);
      const links = shown.map((service) => ({
        label:
          service.title.trim().slice(0, 64) || buttonsFor(locale).freelance,
        url: pageUrl(locale, `/freelance/${encodeURIComponent(service.slug)}`),
      }));
      if (links.length) {
        out.push({ text: shown.map((s) => `• ${s.title}`).join("\n"), links });
      }
    }
    if (event.kind === "ugc_campaign") {
      const campaignId = (event.data as { id?: unknown } | null)?.id;
      if (
        typeof campaignId === "string" &&
        /^[0-9a-f-]{36}$/i.test(campaignId)
      ) {
        const label = buttonsFor(locale).campaigns;
        out.push({
          text: label,
          links: [{ label, url: pageUrl(locale, `/campaigns/${campaignId}`) }],
        });
      }
    }
    if (event.kind === "freelance_order") {
      const orderId = (event.data as { id?: unknown } | null)?.id;
      if (typeof orderId === "string" && /^[0-9a-f-]{36}$/i.test(orderId)) {
        const label = ORDER_BUTTON[locale] ?? ORDER_BUTTON.en!;
        out.push({
          text: label,
          links: [
            { label, url: pageUrl(locale, `/freelance/orders/${orderId}`) },
          ],
        });
      }
    }
    // D516: "here or in the form?" A job is filled in here with /post_job,
    // a brief or a service in the site chat, the rest right in this chat.
    const fillKind =
      event.kind === "fill_choice"
        ? (event.data as { kind?: unknown } | null)?.kind
        : event.kind === "offer"
          ? fillKindFromOffer(
              (event.data as { action?: unknown } | null)?.action,
            )
          : null;
    if (isFillKind(fillKind)) {
      const paths = fillPaths(fillKind, signedIn);
      const links = [
        { label: lines.jobFormButton, url: pageUrl(locale, paths.form) },
      ];
      if (paths.chat && fillKind !== "job")
        links.unshift({
          label: lines.fillChatButton,
          url: pageUrl(locale, paths.chat),
        });
      out.push({
        text: fill(fillKind === "job" ? lines.jobChoice : lines.fillChoice),
        links,
      });
    }
    if (event.kind === "job_draft") {
      const draftId = (event.data as { id?: unknown } | null)?.id;
      if (typeof draftId === "string" && /^[0-9a-f-]{36}$/i.test(draftId)) {
        const label = lines.jobDraftButton;
        out.push({
          text: label,
          links: [
            { label, url: pageUrl(locale, `/post-job?draft=${draftId}`) },
          ],
        });
      }
    }
  }

  // A Spoki block (D523) cannot be drawn here: its text and its page.
  for (const event of events) {
    if (event.type !== "ui") continue;
    const { text, path } = event.block.fallback;
    out.push({
      text: text.slice(0, TELEGRAM_TEXT_LIMIT),
      links: path ? [{ label: lines.openJob, url: pageUrl(locale, path) }] : [],
    });
  }

  const labels = buttonsFor(locale);
  for (const event of events) {
    if (event.type !== "tool_result" || event.kind !== "offer") continue;
    const action = (event.data as { action?: unknown } | null)?.action;
    if (!isOfferAction(action) || fillKindOf(action)) continue;
    const path = offerPath(action, signedIn);
    if (!path) continue;
    const label = labels[action];
    out.push({
      text: label,
      links: [{ label, url: pageUrl(locale, path) }],
    });
  }

  for (const event of events) {
    if (event.type === "confirm_request") {
      // A write needs a confirmation this chat cannot press.
      // A linked account opens the site chat. A guest still gets sign-in;
      // the login page sends an existing browser session straight to chat.
      out.push({
        text: fill(signedIn ? lines.confirmOnSite : lines.signIn),
        links: [
          {
            label: signedIn ? lines.openChat : lines.signInButton,
            // The card itself opens on the site chat (D460).
            url: pageUrl(
              locale,
              signedIn
                ? `/chat?confirm=${encodeURIComponent(event.confirmationId)}`
                : "/login?next=chat",
            ),
          },
        ],
      });
      break;
    }
    if (event.type === "error") {
      const code = event.code;
      out.push({
        text: fill(
          code === "BOT_UNAVAILABLE"
            ? lines.unavailable
            : code === "BOT_BUDGET_EXCEEDED"
              ? lines.budget
              : code === "RATE_LIMITED"
                ? lines.rateLimited
                : lines.tryLater,
        ),
        links: [],
      });
      break;
    }
  }
  return out.length ? out : [{ text: fill(lines.empty), links: [] }];
}

/**
 * Ordinary chat with the bot, answered by the same agent as the site (D311).
 * Called only for updates the sign-in flow did not take.
 */
export async function handleTelegramAgentUpdate(
  token: string,
  raw: unknown,
  now = new Date(),
): Promise<void> {
  const update = (raw ?? {}) as TelegramAgentUpdate;
  const message = update.message;
  if (!message) return;
  const chatId = message.chat?.id;
  const text = message.text?.trim();
  const from = message.from;
  if (!text || typeof chatId !== "number") return;
  if (!from || from.is_bot || typeof from.id !== "number") return;

  const { lines, locale } = linesFor(from.language_code);
  if (text === "/help" || text === "/help@") {
    await sendTelegramMessage(token, chatId, fill(lines.help));
    return;
  }
  if (text === "/reset") {
    resets.set(chatId, resetSessionToken(chatId, now));
    await sendTelegramMessage(token, chatId, fill(lines.reset));
    return;
  }
  if (/^\/post_job(?:@intgetion_bot)?$/i.test(text)) {
    const linkedUserId = await userIdForTelegramId(from.id);
    if (!linkedUserId) {
      await sendTelegramLinks(token, chatId, fill(lines.jobSignIn), [
        {
          label: lines.signInButton,
          url: pageUrl(locale, "/login?next=post-job"),
        },
      ]);
      return;
    }
    const sessionToken = resets.get(chatId) ?? chatSessionToken(chatId);
    try {
      await openJobDraftConversation({
        userId: linkedUserId,
        token: sessionToken,
        locale,
      });
      await sendTelegramMessage(token, chatId, lines.startJob);
    } catch (error) {
      logger.warn({ err: error }, "telegram job draft could not be opened");
      await sendTelegramMessage(token, chatId, fill(lines.tryLater));
    }
    return;
  }
  // Other slash commands are not ours; stay quiet rather than guess.
  if (text.startsWith("/")) return;

  const userId = await userIdForTelegramId(from.id);
  const sessionToken = resets.get(chatId) ?? chatSessionToken(chatId);
  const { conversation } = await resolveConversation({
    userId,
    token: sessionToken,
    locale,
  });

  await sendTelegramChatAction(token, chatId, "typing").catch(() => undefined);

  const events: BotEvent[] = [];
  try {
    await handleMessage(
      {
        userId,
        conversation,
        text,
        // Rate limits key guests by address; one chat is one caller here.
        ip: `tg:${chatId}`,
        locale,
        channel: "telegram",
      },
      (event) => events.push(event),
      now,
    );
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.name : "Error" },
      "telegram agent turn failed",
    );
    await sendTelegramMessage(token, chatId, fill(lines.tryLater));
    return;
  }

  for (const part of render(events, lines, locale, userId !== null)) {
    if (part.links.length) {
      await sendTelegramLinks(token, chatId, part.text, part.links);
    } else if (part.markdown) {
      // Telegram refuses markup it cannot parse: then the plain words go.
      await sendTelegramMessage(
        token,
        chatId,
        markdownToTelegramHtml(part.text),
        undefined,
        "HTML",
      ).catch(() =>
        sendTelegramMessage(token, chatId, stripMarkdown(part.text)),
      );
    } else {
      await sendTelegramMessage(token, chatId, part.text);
    }
  }
}
