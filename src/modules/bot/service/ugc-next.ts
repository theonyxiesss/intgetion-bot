import type { UgcNextStep } from "../../../platform";
import * as repo from "../repo/bot-repo";
import { CONFIRMATION_TTL_MS } from "./conversation";
import { hashArgs, type BotState } from "./tools";

/**
 * Spoki offers the next UGC step when a brief or an invite thread opens
 * (D467). The line is a template, not the model, and is written once per
 * step. A write still goes through its confirmation card; a payment or a
 * decision opens the page, never a card with a choice made for them.
 */

type Kind = UgcNextStep["kind"];

const LINES: Record<string, Record<Kind, string>> = {
  en: {
    deposit:
      "Next step: pay in the brief budget. Offers to creators open once it is in.",
    hire: "Next step: a creator applied. The offer is on the card below; or ask me about the other applicants.",
    decide:
      "Next step: a video is waiting for your decision. Watch it on the brief page, then tell me: accept, one round of changes, or reject.",
    remind:
      "Next step: a creator has not answered or sent a video yet. The card below sends one reminder.",
    accept:
      "Next step: the company offers you this brief. Accept on the card below, or tell me to decline.",
    submit:
      "Next step: send your video as an https link on TikTok, Instagram or YouTube, with a one-line hook. I will put it on a card.",
    changes:
      "Next step: the company asked for one change. The note is on the brief page. Send the new link when it is ready.",
    payout:
      "Your video was accepted. Confirm your payout address so the reward can be sent.",
  },
  ru: {
    deposit:
      "Следующий шаг: внести бюджет брифа. Предложения авторам откроются после взноса.",
    hire: "Следующий шаг: автор откликнулся. Предложение — на карточке ниже; или спросите меня о других откликах.",
    decide:
      "Следующий шаг: видео ждёт вашего решения. Посмотрите его на странице брифа и скажите: принять, одна правка или отклонить.",
    remind:
      "Следующий шаг: автор ещё не ответил или не прислал видео. Карточка ниже отправит одно напоминание.",
    accept:
      "Следующий шаг: компания предлагает вам этот бриф. Примите на карточке ниже или скажите, что отказываетесь.",
    submit:
      "Следующий шаг: пришлите видео ссылкой https на TikTok, Instagram или YouTube и одну строку хука. Я соберу карточку.",
    changes:
      "Следующий шаг: компания попросила одну правку. Заметка — на странице брифа. Пришлите новую ссылку, когда будет готово.",
    payout:
      "Ваше видео принято. Подтвердите адрес для выплат, чтобы награду можно было отправить.",
  },
  es: {
    deposit:
      "Siguiente paso: deposita el presupuesto del brief. Las ofertas a creadores se abren cuando llega.",
    hire: "Siguiente paso: un creador se postuló. La oferta está en la tarjeta de abajo; o pregúntame por las demás postulaciones.",
    decide:
      "Siguiente paso: un vídeo espera tu decisión. Míralo en la página del brief y dime: aceptar, una ronda de cambios o rechazar.",
    remind:
      "Siguiente paso: un creador aún no respondió ni envió vídeo. La tarjeta de abajo envía un recordatorio.",
    accept:
      "Siguiente paso: la empresa te ofrece este brief. Acepta en la tarjeta de abajo o dime que lo rechazas.",
    submit:
      "Siguiente paso: envía tu vídeo como enlace https de TikTok, Instagram o YouTube, con un gancho de una línea. Lo pondré en una tarjeta.",
    changes:
      "Siguiente paso: la empresa pidió un cambio. La nota está en la página del brief. Envía el nuevo enlace cuando esté listo.",
    payout:
      "Tu vídeo fue aceptado. Confirma tu dirección de pago para que se pueda enviar la recompensa.",
  },
  "pt-BR": {
    deposit:
      "Próximo passo: deposite o orçamento do brief. As ofertas aos criadores abrem quando ele chega.",
    hire: "Próximo passo: um criador se candidatou. A oferta está no cartão abaixo; ou me pergunte sobre as outras candidaturas.",
    decide:
      "Próximo passo: um vídeo espera sua decisão. Assista na página do brief e me diga: aceitar, uma rodada de ajustes ou recusar.",
    remind:
      "Próximo passo: um criador ainda não respondeu nem enviou vídeo. O cartão abaixo envia um lembrete.",
    accept:
      "Próximo passo: a empresa oferece este brief a você. Aceite no cartão abaixo ou me diga que recusa.",
    submit:
      "Próximo passo: envie seu vídeo como link https do TikTok, Instagram ou YouTube, com um gancho de uma linha. Eu monto o cartão.",
    changes:
      "Próximo passo: a empresa pediu um ajuste. A nota está na página do brief. Envie o novo link quando estiver pronto.",
    payout:
      "Seu vídeo foi aceito. Confirme seu endereço de pagamento para que a recompensa possa ser enviada.",
  },
  de: {
    deposit:
      "Nächster Schritt: das Budget des Briefings einzahlen. Angebote an Creator öffnen sich danach.",
    hire: "Nächster Schritt: Ein Creator hat sich beworben. Das Angebot steht auf der Karte unten; oder fragen Sie mich nach den anderen Bewerbungen.",
    decide:
      "Nächster Schritt: Ein Video wartet auf Ihre Entscheidung. Sehen Sie es auf der Seite des Briefings an und sagen Sie mir: annehmen, eine Änderungsrunde oder ablehnen.",
    remind:
      "Nächster Schritt: Ein Creator hat noch nicht geantwortet oder kein Video geschickt. Die Karte unten sendet eine Erinnerung.",
    accept:
      "Nächster Schritt: Die Firma bietet Ihnen dieses Briefing an. Nehmen Sie auf der Karte unten an oder sagen Sie mir, dass Sie ablehnen.",
    submit:
      "Nächster Schritt: Schicken Sie Ihr Video als https-Link auf TikTok, Instagram oder YouTube, mit einem Hook in einer Zeile. Ich lege eine Karte an.",
    changes:
      "Nächster Schritt: Die Firma bat um eine Änderung. Die Notiz steht auf der Seite des Briefings. Schicken Sie den neuen Link, wenn er fertig ist.",
    payout:
      "Ihr Video wurde angenommen. Bestätigen Sie Ihre Auszahlungsadresse, damit die Belohnung gesendet werden kann.",
  },
  fr: {
    deposit:
      "Étape suivante : verser le budget du brief. Les offres aux créateurs s’ouvrent une fois versé.",
    hire: "Étape suivante : un créateur a postulé. L’offre est sur la carte ci-dessous ; ou demandez-moi les autres candidatures.",
    decide:
      "Étape suivante : une vidéo attend votre décision. Regardez-la sur la page du brief, puis dites-moi : accepter, une série de retouches ou refuser.",
    remind:
      "Étape suivante : un créateur n’a pas encore répondu ni envoyé de vidéo. La carte ci-dessous envoie un rappel.",
    accept:
      "Étape suivante : l’entreprise vous propose ce brief. Acceptez sur la carte ci-dessous ou dites-moi que vous refusez.",
    submit:
      "Étape suivante : envoyez votre vidéo en lien https TikTok, Instagram ou YouTube, avec une accroche d’une ligne. Je la mets sur une carte.",
    changes:
      "Étape suivante : l’entreprise a demandé une retouche. La note est sur la page du brief. Envoyez le nouveau lien quand il est prêt.",
    payout:
      "Votre vidéo a été acceptée. Confirmez votre adresse de paiement pour que la récompense puisse être envoyée.",
  },
  it: {
    deposit:
      "Prossimo passo: versa il budget del brief. Le offerte ai creator si aprono dopo il versamento.",
    hire: "Prossimo passo: un creator si è candidato. L’offerta è nella scheda qui sotto; oppure chiedimi delle altre candidature.",
    decide:
      "Prossimo passo: un video aspetta la tua decisione. Guardalo nella pagina del brief, poi dimmi: accettare, un giro di modifiche o rifiutare.",
    remind:
      "Prossimo passo: un creator non ha ancora risposto né inviato il video. La scheda qui sotto invia un promemoria.",
    accept:
      "Prossimo passo: l’azienda ti offre questo brief. Accetta nella scheda qui sotto o dimmi che rifiuti.",
    submit:
      "Prossimo passo: invia il video come link https di TikTok, Instagram o YouTube, con un gancio di una riga. Lo metto in una scheda.",
    changes:
      "Prossimo passo: l’azienda ha chiesto una modifica. La nota è nella pagina del brief. Invia il nuovo link quando è pronto.",
    payout:
      "Il tuo video è stato accettato. Conferma l’indirizzo di pagamento perché la ricompensa possa essere inviata.",
  },
};

export function ugcNextLine(locale: string, kind: Kind): string {
  return (LINES[locale] ?? LINES.en!)[kind];
}

export type UgcNextLink = {
  href: string;
  link: "ugcDeposit" | "ugcCampaign" | "ugcPayout";
};

/** The page a step opens, when it is not a card. */
export function ugcNextLink(step: UgcNextStep): UgcNextLink | null {
  if (step.kind === "deposit") {
    return {
      href: `/billing/crypto?ugc=${step.campaignId}`,
      link: "ugcDeposit",
    };
  }
  if (step.kind === "payout") {
    return { href: "/account#security", link: "ugcPayout" };
  }
  if (
    step.kind === "decide" ||
    step.kind === "submit" ||
    step.kind === "changes"
  ) {
    return { href: `/campaigns/${step.campaignId}`, link: "ugcCampaign" };
  }
  return null;
}

/** The confirmation card a step offers, when it is a write. */
export function ugcNextCard(
  step: UgcNextStep,
): { tool: string; args: Record<string, string> } | null {
  if (step.kind === "hire") {
    return {
      tool: "offer_ugc_hire",
      args: { campaignId: step.campaignId, creatorId: step.creatorId },
    };
  }
  if (step.kind === "remind") {
    return { tool: "remind_ugc_invites", args: { inviteId: step.inviteId } };
  }
  if (step.kind === "accept") {
    return { tool: "accept_ugc_invite", args: { inviteId: step.inviteId } };
  }
  return null;
}

/**
 * Writes the step line once per step and keeps one card for it. A card is
 * made again only when the last one expired unanswered; an answered card
 * (yes or no) is not pushed again.
 */
export async function offerUgcNextStep(input: {
  conversation: repo.ConversationRow;
  userId: string;
  locale: string;
  step: UgcNextStep | null;
  now?: Date;
}): Promise<UgcNextLink | null> {
  const { conversation, step } = input;
  if (!step) return null;
  const now = input.now ?? new Date();
  const state = (conversation.state ?? {}) as BotState;
  if (state.ugcNextKey !== step.key) {
    await repo.insertMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: ugcNextLine(input.locale, step.kind),
    });
    await repo.updateConversation(
      conversation.id,
      { state: { ...state, ugcNextKey: step.key } },
      now,
    );
  }
  const card = ugcNextCard(step);
  if (card) {
    const argsHash = hashArgs(card.tool, card.args);
    const last = await repo.latestConfirmationByHash({
      conversationId: conversation.id,
      userId: input.userId,
      argsHash,
    });
    const expired =
      last &&
      last.decidedAt === null &&
      last.expiresAt.getTime() <= now.getTime();
    if (!last || expired) {
      await repo.createConfirmation({
        conversationId: conversation.id,
        userId: input.userId,
        tool: card.tool,
        args: card.args,
        argsHash,
        expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
      });
    }
  }
  return ugcNextLink(step);
}
