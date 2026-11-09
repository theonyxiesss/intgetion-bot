import type { FillKind } from "./offers";
import { isJobDraftRequest } from "./job-draft-focus";

/**
 * D516: before Spoki starts filling something in, the person chooses —
 * together here in the chat, or alone in the form. These wordings get the
 * choice without a model call; other wordings reach it through
 * `offer_step fill_*`.
 */
const REQUESTS: [FillKind, RegExp][] = [
  [
    "brief",
    /(?:созда|оформ|запуст|сдела|состав|напи[сш]|заполн)\p{L}*\s+(?:новый\s+|свой\s+|наш\s+)?бриф|\b(?:create|write|start|make|fill\s+in|fill\s+out)\s+(?:a\s+|the\s+|my\s+|our\s+|new\s+)?(?:ugc\s+)?brief\b/iu,
  ],
  [
    "service",
    /(?:созда|разме[сщ]|добав|выстав|опублик|оформ)\p{L}*\s+(?:свою\s+|новую\s+|мою\s+)?услугу|\b(?:create|list|add|publish)\s+(?:a\s+|my\s+|new\s+)?(?:freelance\s+)?service\b/iu,
  ],
  [
    "creator",
    /(?:заполн|созда|оформ|сдела)\p{L}*\s+(?:мою\s+|свою\s+|мой\s+|свой\s+)?(?:анкет|профил)\p{L}*\s+креатора|стать\s+креатором|\b(?:fill\s+in|fill\s+out|create|set\s+up|make)\s+(?:my\s+|a\s+)?creator\s+profile\b|\bbecome\s+a\s+creator\b/iu,
  ],
  [
    "company",
    /(?:заполн|созда|оформ|сдела)\p{L}*\s+(?:карточк|профил|страниц)\p{L}*\s+(?:нашей\s+|моей\s+)?компании|\b(?:fill\s+in|fill\s+out|create|set\s+up)\s+(?:my\s+|our\s+|the\s+|a\s+)?company\s+(?:card|profile|page)\b/iu,
  ],
  [
    "profile",
    /(?:заполн|созда|оформ|сдела|допол)\p{L}*\s+(?:мой\s+|свой\s+|мне\s+)?профиль(?!\s+(?:креатора|компании))|\b(?:fill\s+in|fill\s+out|complete|create|set\s+up)\s+my\s+profile\b/iu,
  ],
];

/** What the message asks Spoki to fill in, or null. */
export function fillRequestOf(text: string): FillKind | null {
  if (isJobDraftRequest(text)) return "job";
  for (const [kind, pattern] of REQUESTS) if (pattern.test(text)) return kind;
  return null;
}

const QUESTION: Record<string, (what: string) => string> = {
  ru: (what) =>
    `Да, могу. Как удобнее: заполним ${what} вместе здесь в чате — я буду спрашивать по шагам, — или откроете форму и заполните сами?`,
  en: (what) =>
    `Yes, I can. Which suits you: we fill in ${what} together here in the chat, with me asking step by step, or you open the form and fill it in yourself?`,
  de: (what) =>
    `Ja, gern. Was passt dir: Wir füllen ${what} gemeinsam hier im Chat aus, ich frage Schritt für Schritt, oder du öffnest das Formular und füllst es selbst aus?`,
  es: (what) =>
    `Sí, puedo. ¿Qué prefieres: rellenamos ${what} juntos aquí en el chat, te pregunto paso a paso, o abres el formulario y lo rellenas tú?`,
  fr: (what) =>
    `Oui, je peux. Que préfères-tu : on remplit ${what} ensemble ici dans le chat, je pose les questions une par une, ou tu ouvres le formulaire et tu le remplis toi-même ?`,
  it: (what) =>
    `Sì, posso. Cosa preferisci: compiliamo ${what} insieme qui in chat, ti chiedo passo per passo, oppure apri il modulo e lo compili tu?`,
  "pt-BR": (what) =>
    `Sim, posso. O que prefere: preenchemos ${what} juntos aqui no chat, eu pergunto passo a passo, ou você abre o formulário e preenche sozinho?`,
};

const WHAT: Record<string, Record<FillKind, string>> = {
  ru: {
    job: "вакансию",
    brief: "бриф на видео",
    service: "услугу",
    profile: "профиль",
    creator: "анкету креатора",
    company: "карточку компании",
  },
  en: {
    job: "the job",
    brief: "the video brief",
    service: "your service",
    profile: "your profile",
    creator: "your creator profile",
    company: "the company card",
  },
  de: {
    job: "die Stelle",
    brief: "das Video-Briefing",
    service: "deine Leistung",
    profile: "dein Profil",
    creator: "dein Creator-Profil",
    company: "die Firmenkarte",
  },
  es: {
    job: "la oferta",
    brief: "el brief de vídeo",
    service: "tu servicio",
    profile: "tu perfil",
    creator: "tu perfil de creador",
    company: "la ficha de la empresa",
  },
  fr: {
    job: "l’offre",
    brief: "le brief vidéo",
    service: "ton service",
    profile: "ton profil",
    creator: "ton profil de créateur",
    company: "la fiche de l’entreprise",
  },
  it: {
    job: "l’offerta",
    brief: "il brief video",
    service: "il tuo servizio",
    profile: "il tuo profilo",
    creator: "il tuo profilo da creator",
    company: "la scheda dell’azienda",
  },
  "pt-BR": {
    job: "a vaga",
    brief: "o briefing de vídeo",
    service: "seu serviço",
    profile: "seu perfil",
    creator: "seu perfil de criador",
    company: "o cartão da empresa",
  },
};

/** The question before filling something in, in the reply language. */
export function fillQuestion(kind: FillKind, locale: string): string {
  const ask = QUESTION[locale] ?? QUESTION.en!;
  const what = (WHAT[locale] ?? WHAT.en!)[kind];
  return ask(what);
}
