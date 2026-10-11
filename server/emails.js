// Testi delle email transazionali (IT/EN) e invio.
import { html } from './html.js';
import { calendar, eventLines } from './ics.js';
import { bookingDue, cancellationState } from './bookings.js';
import { fmtDate, fmtInstant } from './time.js';
import { formatMoney } from './util.js';
import { formatGiftCode } from './pricing.js';

const T = {
  it: {
    hello: (n) => `Ciao ${n},`,
    confirmedSubject: (ref, title, d) => `Prenotazione confermata ${ref} — ${title}, ${d}`,
    confirmedIntro: 'la tua prenotazione è confermata. Ecco il riepilogo.',
    cancelledSubject: (ref) => `Prenotazione annullata ${ref}`,
    cancelledIntro: 'la prenotazione è stata annullata.',
    refundLine: (m) => `Rimborso: ${m}, accreditato sul metodo di pagamento originale (di solito entro 5–10 giorni lavorativi).`,
    noRefundLine: 'Nessun rimborso previsto per questa cancellazione.',
    conflictSubject: (ref) => `Prenotazione ${ref}: slot non più disponibile, rimborso in corso`,
    conflictBody: 'purtroppo il pagamento è arrivato dopo la scadenza del blocco e nel frattempo lo slot è stato assegnato ad altri. Ti abbiamo rimborsato l’intero importo. Scusaci: puoi sceglierne un altro sul sito o scrivermi.',
    tour: 'Servizio',
    date: 'Data',
    time: 'Orario',
    people: 'Partecipanti',
    meeting: 'Punto d’incontro',
    total: 'Totale',
    ref: 'Codice',
    clientRef: 'Rif. pratica',
    pay: { card: 'pagato online', onsite: 'da pagare il giorno del servizio', invoice: 'a fattura / bonifico come da accordi', giftcard: 'pagato con buono regalo', free: 'nessun pagamento dovuto' },
    discount: (code) => `Sconto${code ? ' ' + code : ''}`,
    giftUsed: 'Buono regalo',
    due: 'Da pagare',
    policyFree: (dt) => `Cancellazione gratuita fino a ${dt}.`,
    policyNone: 'Questa prenotazione non è rimborsabile (effettuata a ridosso del servizio).',
    policyAfter: 'Dopo tale termine non è previsto rimborso.',
    manage: 'Gestisci o annulla la prenotazione',
    addCal: 'Il file allegato aggiunge il servizio al tuo calendario.',
    bye: 'A presto,',
    contactLine: 'Per qualsiasi cosa rispondi a questa email.',
  },
  en: {
    hello: (n) => `Hi ${n},`,
    confirmedSubject: (ref, title, d) => `Booking confirmed ${ref} — ${title}, ${d}`,
    confirmedIntro: 'your booking is confirmed. Here is your summary.',
    cancelledSubject: (ref) => `Booking cancelled ${ref}`,
    cancelledIntro: 'your booking has been cancelled.',
    refundLine: (m) => `Refund: ${m}, returned to the original payment method (usually within 5–10 business days).`,
    noRefundLine: 'No refund applies to this cancellation.',
    conflictSubject: (ref) => `Booking ${ref}: slot no longer available, refund issued`,
    conflictBody: 'unfortunately your payment arrived after the hold expired and the slot has meanwhile been taken. We have refunded the full amount. Sorry about that: you can pick another time on the website or write to me.',
    tour: 'Service',
    date: 'Date',
    time: 'Time',
    people: 'Guests',
    meeting: 'Meeting point',
    total: 'Total',
    ref: 'Reference',
    clientRef: 'File ref.',
    pay: { card: 'paid online', onsite: 'to be paid on the day', invoice: 'by invoice / bank transfer as agreed', giftcard: 'paid with gift card', free: 'nothing to pay' },
    discount: (code) => `Discount${code ? ' ' + code : ''}`,
    giftUsed: 'Gift card',
    due: 'To pay',
    policyFree: (dt) => `Free cancellation until ${dt}.`,
    policyNone: 'This booking is non-refundable (made close to the service date).',
    policyAfter: 'After that, no refund applies.',
    manage: 'Manage or cancel your booking',
    addCal: 'The attached file adds the service to your calendar.',
    bye: 'See you soon,',
    contactLine: 'Just reply to this email for anything.',
  },
};

export function bookingUrl(app, b, lang = b.lang) {
  return `${app.cfg.baseUrl}/${lang}/booking/${b.ref}?t=${b.token}`;
}

function summaryRows(app, b, lang) {
  const tr = T[lang];
  const tour = app.content.tour(b.tour_slug);
  const ti = tour.i18n[lang];
  const rows = [
    [tr.ref, b.ref],
    [tr.tour, ti.title],
    [tr.date, fmtDate(b.date, lang)],
    [tr.time, `${b.start_time}–${b.end_time}`],
    [tr.people, String(b.participants)],
    [tr.meeting, ti.meetingPoint],
  ];
  if (b.discount_cents) rows.push([tr.discount(b.promo_code), `−${formatMoney(b.discount_cents, lang, b.currency)}`]);
  if (b.gift_cents) rows.push([tr.giftUsed, `−${formatMoney(b.gift_cents, lang, b.currency)}`]);
  rows.push([b.discount_cents || b.gift_cents ? tr.due : tr.total, `${formatMoney(bookingDue(b), lang, b.currency)} (${tr.pay[b.payment_method]})`]);
  if (b.client_ref) rows.push([tr.clientRef, b.client_ref]);
  return rows;
}

function policyLine(b, lang, nowMs) {
  const tr = T[lang];
  const st = cancellationState(b, nowMs);
  if (!st.everRefundable) return tr.policyNone;
  return `${tr.policyFree(fmtInstant(st.until, lang))} ${tr.policyAfter}`;
}

export function icsFor(app, b, lang = b.lang) {
  const tour = app.content.tour(b.tour_slug);
  const ti = tour.i18n[lang];
  return calendar(`${app.cfg.site.name} — ${ti.title}`, [
    eventLines({
      uid: `${b.ref}@${new URL(app.cfg.baseUrl).hostname}`,
      date: b.date,
      start: b.start_time,
      end: b.end_time,
      summary: `${ti.title} (${app.cfg.site.name})`,
      description: `${b.ref} — ${b.participants} ${T[lang].people.toLowerCase()}`,
      location: ti.meetingPoint,
      url: bookingUrl(app, b, lang),
    }),
  ]);
}

function layout(app, lang, inner) {
  return html`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;line-height:1.55">
    <div style="background:#d6bb51;padding:18px 24px;border-radius:12px 12px 0 0"><strong style="font-size:20px">${app.cfg.site.name}</strong><br><span style="font-size:13px">${app.cfg.site.tagline[lang]}</span></div>
    <div style="border:1px solid #eee;border-top:0;padding:24px;border-radius:0 0 12px 12px">${inner}</div>
  </div>`;
}

function bodyHtml(app, b, lang, intro, extra = '') {
  const tr = T[lang];
  return layout(
    app,
    lang,
    html`<p>${tr.hello(b.name)}</p><p>${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-size:15px">
        ${summaryRows(app, b, lang).map(([k, v]) => html`<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0"><strong>${v}</strong></td></tr>`)}
      </table>
      ${extra}
      <p><a href="${bookingUrl(app, b, lang)}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${tr.manage}</a></p>
      <p style="color:#666;font-size:13px">${tr.contactLine}<br>${tr.bye} ${app.cfg.site.name}</p>`,
  );
}

function textBody(app, b, lang, intro, extra = []) {
  const tr = T[lang];
  return [tr.hello(b.name), '', intro, '', ...summaryRows(app, b, lang).map(([k, v]) => `${k}: ${v}`), '', ...extra, `${tr.manage}: ${bookingUrl(app, b, lang)}`, '', tr.contactLine, `${tr.bye} ${app.cfg.site.name}`].join('\n');
}

export async function sendBookingConfirmed(app, b, nowMs = Date.now()) {
  const lang = b.lang;
  const tr = T[lang];
  const ti = app.content.tour(b.tour_slug).i18n[lang];
  const pol = policyLine(b, lang, nowMs);
  await app.mail.send({
    to: b.email,
    subject: tr.confirmedSubject(b.ref, ti.title, fmtDate(b.date, lang, 'short')),
    text: textBody(app, b, lang, tr.confirmedIntro, [pol, tr.addCal, '']),
    html: String(bodyHtml(app, b, lang, tr.confirmedIntro, html`<p style="font-size:14px;color:#444">${pol}</p><p style="font-size:13px;color:#666">${tr.addCal}</p>`)),
    attachments: [{ filename: `${b.ref}.ics`, content: icsFor(app, b, lang), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
  await notifyGuide(app, b, 'new');
}

export async function sendBookingCancelled(app, b, refundCents) {
  const lang = b.lang;
  const tr = T[lang];
  const line = refundCents ? tr.refundLine(formatMoney(refundCents, lang, b.currency)) : b.payment_status === 'paid' || b.payment_method === 'card' ? tr.noRefundLine : '';
  await app.mail.send({
    to: b.email,
    subject: tr.cancelledSubject(b.ref),
    text: textBody(app, b, lang, tr.cancelledIntro, line ? [line, ''] : []),
    html: String(bodyHtml(app, b, lang, tr.cancelledIntro, line ? html`<p style="font-size:14px">${line}</p>` : '')),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
  await notifyGuide(app, b, 'cancelled', refundCents);
}

export async function sendSlotLostRefund(app, b) {
  const lang = b.lang;
  const tr = T[lang];
  await app.mail.send({
    to: b.email,
    subject: tr.conflictSubject(b.ref),
    text: [tr.hello(b.name), '', tr.conflictBody, '', `${tr.bye} ${app.cfg.site.name}`].join('\n'),
    html: String(layout(app, lang, html`<p>${tr.hello(b.name)}</p><p>${tr.conflictBody}</p><p>${tr.bye} ${app.cfg.site.name}</p>`)),
  });
  await notifyGuide(app, b, 'slot-lost');
}

/** Avviso alla guida (in italiano) per ogni evento importante. */
export async function notifyGuide(app, b, kind, refundCents = 0) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const tour = app.content.tour(b.tour_slug);
  const label = { new: 'Nuova prenotazione', cancelled: 'Prenotazione annullata', 'slot-lost': 'Pagamento tardivo: slot perso, rimborsato' }[kind];
  const lines = [
    `${label} ${b.ref} (${b.channel.toUpperCase()})`,
    `${tour.i18n.it.title}`,
    `${fmtDate(b.date, 'it')} · ${b.start_time}–${b.end_time} · ${b.participants} pers.`,
    `${b.name} <${b.email}>${b.phone ? ' · ' + b.phone : ''}`,
    b.client_ref ? `Rif. pratica: ${b.client_ref}` : null,
    b.notes ? `Note: ${b.notes}` : null,
    `Totale: ${formatMoney(b.total_cents, 'it', b.currency)}${b.discount_cents ? ` (sconto ${b.promo_code}: −${formatMoney(b.discount_cents, 'it', b.currency)})` : ''}${b.gift_cents ? ` · buono regalo: −${formatMoney(b.gift_cents, 'it', b.currency)}` : ''} · pagamento: ${b.payment_method} (${b.payment_status})`,
    kind === 'cancelled' ? `Rimborso: ${refundCents ? formatMoney(refundCents, 'it', b.currency) : 'nessuno'}${b.cancelled_by ? ` · annullata da: ${b.cancelled_by}` : ''}` : null,
    '',
    `${app.cfg.baseUrl}/admin/bookings/${b.id}`,
  ].filter((x) => x !== null);
  await app.mail.send({
    to,
    subject: `${label}: ${tour.i18n.it.title} — ${b.date} ${b.start_time}`,
    text: lines.join('\n'),
    html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`),
  });
}


// ───────────── Partner B2B ─────────────
const P = {
  it: {
    receivedSubject: 'Richiesta di accesso partner ricevuta',
    receivedBody: (n) => `Ciao ${n},\nho ricevuto la tua richiesta di accesso all'area partner. La esamino e ti rispondo di norma entro uno o due giorni lavorativi.\n`,
    approvedSubject: 'Il tuo account partner è attivo',
    approvedBody: (n, url) => `Ciao ${n},\nil tuo account partner è stato approvato: da ora puoi accedere, vedere le tariffe riservate e prenotare i servizi per i tuoi clienti.\n\nAccedi qui: ${url}\n`,
    sign: 'A presto,',
  },
  en: {
    receivedSubject: 'Partner access request received',
    receivedBody: (n) => `Hi ${n},\nI have received your request for partner access. I will review it and reply, usually within one or two business days.\n`,
    approvedSubject: 'Your partner account is active',
    approvedBody: (n, url) => `Hi ${n},\nyour partner account has been approved: you can now sign in, see your reserved rates and book services for your clients.\n\nSign in here: ${url}\n`,
    sign: 'See you soon,',
  },
};

export async function sendPartnerRegistered(app, a) {
  const tr = P[a.lang === 'en' ? 'en' : 'it'];
  await app.mail.send({ to: a.email, subject: tr.receivedSubject, text: `${tr.receivedBody(a.contact_name)}\n${tr.sign} ${app.cfg.site.name}`, replyTo: app.cfg.mail.notifyTo || undefined });
  const to = app.cfg.mail.notifyTo;
  if (to)
    await app.mail.send({
      to,
      subject: `Nuova richiesta partner: ${a.company}`,
      text: [`${a.company} (${a.country ?? ''} ${a.vat ?? ''})`, `${a.contact_name} <${a.email}>${a.phone ? ' · ' + a.phone : ''}`, a.website ?? '', a.message ? `Messaggio: ${a.message}` : '', '', `Approva o rifiuta: ${app.cfg.baseUrl}/admin/partners/${a.id}`].filter(Boolean).join('\n'),
    });
}

export async function sendPartnerApproved(app, a) {
  const tr = P[a.lang === 'en' ? 'en' : 'it'];
  const url = `${app.cfg.baseUrl}/${a.lang === 'en' ? 'en' : 'it'}/b2b/login`;
  await app.mail.send({ to: a.email, subject: tr.approvedSubject, text: `${tr.approvedBody(a.contact_name, url)}\n${tr.sign} ${app.cfg.site.name}`, replyTo: app.cfg.mail.notifyTo || undefined });
}

export async function sendContactMessage(app, { name, email, message, lang }) {
  const to = app.cfg.mail.notifyTo || app.cfg.site.email;
  await app.mail.send({ to, replyTo: email, subject: `Messaggio dal sito: ${name}`, text: `${name} <${email}> (${lang})\n\n${message}\n` });
}

// ───────────── Buoni regalo ─────────────
const G = {
  it: {
    buyerSubject: (amount) => `Il tuo buono regalo da ${amount}`,
    buyerIntro: 'grazie! Il tuo buono regalo è pronto.',
    buyerScheduled: (name, email, date) => `Lo invieremo a ${name ? name + ' ' : ''}(${email}) il ${date} alle 9:00. Qui sotto trovi comunque il codice.`,
    buyerSent: (email) => `Lo abbiamo inviato a ${email}.`,
    buyerSelf: 'Puoi stamparlo o inoltrarlo a chi vuoi regalarlo.',
    recipientSubject: (from) => (from ? `${from} ti ha regalato un'esperienza a Venezia` : 'Un buono regalo per Venezia, per te'),
    recipientIntro: (name) => `${name ? `Ciao ${name}, ` : 'Ciao, '}hai ricevuto un buono regalo per scoprire Venezia con una guida abilitata.`,
    from: (name) => `Da parte di ${name}`,
    amount: 'Importo',
    code: 'Codice',
    valid: 'Valido fino al',
    how: 'Come si usa: scegli un tour sul sito, vai alla conferma e inserisci il codice nel campo «Buono regalo». Il buono si può usare anche in più volte fino a esaurimento del saldo.',
    cta: 'Scegli il tuo tour',
    sign: 'A presto,',
  },
  en: {
    buyerSubject: (amount) => `Your ${amount} gift card`,
    buyerIntro: 'thank you! Your gift card is ready.',
    buyerScheduled: (name, email, date) => `We will send it to ${name ? name + ' ' : ''}(${email}) on ${date} at 9:00. You will find the code below as well.`,
    buyerSent: (email) => `We have sent it to ${email}.`,
    buyerSelf: 'You can print it or forward it to whoever you want to give it to.',
    recipientSubject: (from) => (from ? `${from} has given you an experience in Venice` : 'A gift card for Venice, for you'),
    recipientIntro: (name) => `${name ? `Hi ${name}, ` : 'Hi, '}you have received a gift card to discover Venice with a licensed guide.`,
    from: (name) => `From ${name}`,
    amount: 'Amount',
    code: 'Code',
    valid: 'Valid until',
    how: 'How to use it: pick a tour on the website, go to the confirmation step and enter the code in the “Gift card” field. The card can be used in several bookings until the balance runs out.',
    cta: 'Choose your tour',
    sign: 'See you soon,',
  },
};

function giftBlock(app, card, lang) {
  const tr = G[lang];
  const rows = [
    [tr.amount, formatMoney(card.initial_cents, lang, card.currency)],
    [tr.code, formatGiftCode(card.code)],
    [tr.valid, fmtDate(card.expires_at, lang)],
  ];
  return rows;
}

async function giftAttachments(app, card, lang) {
  try {
    const { renderGiftCardPdf } = await import('./pdf.js');
    return [{ filename: `buono-regalo-${card.ref}.pdf`, content: await renderGiftCardPdf(app, card, lang), contentType: 'application/pdf' }];
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND') console.error('[pdf] buono regalo non generato:', err.message);
    return [];
  }
}

function giftHtml(app, lang, intro, card, extra = '') {
  const tr = G[lang];
  return String(
    layout(
      app,
      lang,
      html`<p>${intro}</p>
      ${card.message ? html`<blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid #d6bb51;background:#fbf8f1;font-style:italic">${card.message}</blockquote>` : ''}
      <table style="border-collapse:collapse;width:100%;font-size:16px">
        ${giftBlock(app, card, lang).map(([k, v]) => html`<tr><td style="padding:6px 12px 6px 0;color:#666">${k}</td><td style="padding:6px 0"><strong style="${k === tr.code ? 'font-size:20px;letter-spacing:2px' : ''}">${v}</strong></td></tr>`)}
      </table>
      ${extra}
      <p style="font-size:14px;color:#444">${tr.how}</p>
      <p><a href="${app.cfg.baseUrl}/${lang}/tours" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${tr.cta}</a></p>
      <p style="color:#666;font-size:13px">${tr.sign} ${app.cfg.site.name}</p>`,
    ),
  );
}

export async function sendGiftToBuyer(app, card) {
  if (!card.buyer_email) return false;
  const lang = card.lang;
  const tr = G[lang];
  const money = formatMoney(card.initial_cents, lang, card.currency);
  const note = card.recipient_email ? (card.delivered_at ? tr.buyerSent(card.recipient_email) : tr.buyerScheduled(card.recipient_name, card.recipient_email, fmtDate(card.deliver_on, lang, 'short'))) : tr.buyerSelf;
  const hello = lang === 'it' ? `Ciao ${card.buyer_name},` : `Hi ${card.buyer_name},`;
  const lines = [hello, '', tr.buyerIntro, note, '', ...giftBlock(app, card, lang).map(([k, v]) => `${k}: ${v}`), '', tr.how, `${app.cfg.baseUrl}/${lang}/tours`, '', `${tr.sign} ${app.cfg.site.name}`];
  return app.mail.send({
    to: card.buyer_email,
    subject: tr.buyerSubject(money),
    text: lines.join('\n'),
    html: giftHtml(app, lang, `${hello} ${tr.buyerIntro} ${note}`, { ...card, message: null }),
    attachments: await giftAttachments(app, card, lang),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

export async function sendGiftToRecipient(app, card) {
  if (!card.recipient_email) return false;
  const lang = card.lang;
  const tr = G[lang];
  const intro = tr.recipientIntro(card.recipient_name);
  const from = card.buyer_name ? tr.from(card.buyer_name) : '';
  const lines = [intro, from, card.message ? `«${card.message}»` : '', '', ...giftBlock(app, card, lang).map(([k, v]) => `${k}: ${v}`), '', tr.how, `${app.cfg.baseUrl}/${lang}/tours`, '', `${tr.sign} ${app.cfg.site.name}`].filter((l, i) => l !== '' || i > 2);
  return app.mail.send({
    to: card.recipient_email,
    subject: tr.recipientSubject(card.buyer_name),
    text: lines.join('\n'),
    html: giftHtml(app, lang, `${intro}${from ? ' ' + from + '.' : ''}`, card),
    attachments: await giftAttachments(app, card, lang),
    replyTo: card.buyer_email || app.cfg.mail.notifyTo || undefined,
  });
}

export async function notifyGuideGift(app, card) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  await app.mail.send({
    to,
    subject: `Buono regalo venduto: ${formatMoney(card.initial_cents, 'it', card.currency)} (${card.ref})`,
    text: [`Buono regalo ${card.ref}`, `Importo: ${formatMoney(card.initial_cents, 'it', card.currency)}`, `Acquirente: ${card.buyer_name ?? '—'} <${card.buyer_email ?? '—'}>`, card.recipient_email ? `Destinatario: ${card.recipient_name ?? ''} <${card.recipient_email}> (consegna: ${card.deliver_on ?? 'subito'})` : null, '', `${app.cfg.baseUrl}/admin/discounts/gifts/${card.id}`].filter((x) => x !== null).join('\n'),
  });
}
