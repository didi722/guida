// Testi delle email transazionali (IT/EN/ES) e invio.
// Ogni dizionario ha una voce per lingua (it, en, es) con le stesse chiavi; la lingua di un record arriva dal database
// o da un form, quindi nei punti d'ingresso si passa da normLang() (una lingua sconosciuta ripiega sull'italiano).
import { html } from './html.js';
import { calendar, eventLines } from './ics.js';
import { bookingDue, cancellationState } from './bookings.js';
import { fmtDate, fmtInstant, fmtMonth } from './time.js';
import { formatMoney } from './util.js';
import { formatGiftCode } from './pricing.js';
import { makeT } from './i18n.js';
import { LANG_META, normLang, pick } from './langs.js';
import { parseServiceRecord, serviceNote, timeRange } from './rates.js';
import { isSimplePolicy, tierSentences } from './policyText.js';
import { inviteOffer } from './invites.js';
import { INVITE_DAYS } from './partnerInvites.js';
import { vatLabel } from './vat.js';
import { TEAM_INVITE_DAYS } from './team.js';
import { brandOf } from './agencyDocs.js';
import { clientView } from './quotes.js';
import { meetingOf, themeText } from './choices.js';
import { bookingPeople, bookingPeopleShort, partyExtra, partyOfBooking, peopleShort } from './party.js';
import { ensurePayRef, groupIban, invoiceDue, invoicePayUrl, isPayable, payInstructions } from './invoicePayments.js';

/** Saluto iniziale e congedo, comuni a più email. Senza nome: «Ciao,» / «Hi,» / «Hola,». */
const greet = (lang, name) => pick({ it: name ? `Ciao ${name},` : 'Ciao,', en: name ? `Hi ${name},` : 'Hi,', es: name ? `Hola ${name},` : 'Hola,', ja: name ? `${name} 様` : 'お客様' }, lang);
const bye = (lang) => pick({ it: 'A presto,', en: 'See you soon,', es: 'Hasta pronto,', ja: 'どうぞよろしくお願いいたします。' }, lang);

/** I testi del tour nella lingua richiesta; se il tour non ha quel blocco (fixture, contenuti incompleti) ripiega sull'inglese, poi sull'italiano. */
const tourText = (app, slug, lang) => pick(app.content.tour(slug).i18n, lang);

const T = {
  it: {
    hello: (n) => `Ciao ${n},`,
    confirmedSubject: (ref, title, d) => `Prenotazione confermata ${ref} — ${title}, ${d}`,
    confirmedIntro: 'la tua prenotazione è confermata. Ecco il riepilogo.',
    cancelledSubject: (ref) => `Prenotazione annullata ${ref}`,
    cancelledIntro: 'la prenotazione è stata annullata.',
    refundLine: (m) => `Rimborso: ${m}, accreditato sul metodo di pagamento originale (di solito entro 5–10 giorni lavorativi).`,
    noRefundLine: 'Nessun rimborso previsto per questa cancellazione.',
    refundPartialLine: (m, p) => `Rimborso parziale (${p}%): ${m}, accreditato sul metodo di pagamento originale (di solito entro 5–10 giorni lavorativi).`,
    penaltyLine: (m) => `Come da condizioni, per questo annullo si applica una penale di ${m}: sarà inclusa nella fattura.`,
    retainedLine: (m) => `Importo trattenuto come penale di annullo: ${m}.`,
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
    refundPartialLine: (m, p) => `Partial refund (${p}%): ${m}, returned to the original payment method (usually within 5–10 business days).`,
    penaltyLine: (m) => `As per the terms, a cancellation fee of ${m} applies and will be included in the invoice.`,
    retainedLine: (m) => `Amount kept as cancellation fee: ${m}.`,
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
  es: {
    hello: (n) => `Hola ${n},`,
    confirmedSubject: (ref, title, d) => `Reserva confirmada ${ref} — ${title}, ${d}`,
    confirmedIntro: 'tu reserva está confirmada. Aquí tienes el resumen.',
    cancelledSubject: (ref) => `Reserva cancelada ${ref}`,
    cancelledIntro: 'la reserva ha sido cancelada.',
    refundLine: (m) => `Reembolso: ${m}, abonado en el método de pago original (normalmente entre 5 y 10 días hábiles).`,
    noRefundLine: 'Esta cancelación no da derecho a reembolso.',
    refundPartialLine: (m, p) => `Reembolso parcial (${p}%): ${m}, abonado en el método de pago original (normalmente entre 5 y 10 días hábiles).`,
    penaltyLine: (m) => `Según las condiciones, se aplica una penalización por cancelación de ${m}, que se incluirá en la factura.`,
    retainedLine: (m) => `Importe retenido como penalización por cancelación: ${m}.`,
    conflictSubject: (ref) => `Reserva ${ref}: horario ya no disponible, reembolso en curso`,
    conflictBody: 'por desgracia, el pago llegó cuando el bloqueo de la reserva ya había caducado y, entretanto, ese horario se ha asignado a otras personas. Te hemos reembolsado el importe íntegro. Disculpa las molestias: puedes elegir otro horario en la web o escribirme.',
    tour: 'Servicio',
    date: 'Fecha',
    time: 'Hora',
    people: 'Participantes',
    meeting: 'Punto de encuentro',
    total: 'Total',
    ref: 'Código',
    clientRef: 'Ref. de expediente',
    pay: { card: 'pagado online', onsite: 'a pagar el día del servicio', invoice: 'por factura / transferencia según lo acordado', giftcard: 'pagado con tarjeta regalo', free: 'nada que pagar' },
    discount: (code) => `Descuento${code ? ' ' + code : ''}`,
    giftUsed: 'Tarjeta regalo',
    due: 'A pagar',
    policyFree: (dt) => `Cancelación gratuita hasta el ${dt}.`,
    policyNone: 'Esta reserva no es reembolsable (hecha con muy poca antelación al servicio).',
    policyAfter: 'Pasado ese plazo no se prevé reembolso.',
    manage: 'Gestiona o cancela la reserva',
    addCal: 'El archivo adjunto añade el servicio a tu calendario.',
    bye: 'Hasta pronto,',
    contactLine: 'Para cualquier cosa, responde a este correo.',
  },
  ja: {
    hello: (n) => `${n} 様`,
    confirmedSubject: (ref, title, d) => `ご予約確定のお知らせ ${ref} — ${title}（${d}）`,
    confirmedIntro: 'ご予約が確定しました。内容は以下のとおりです。',
    cancelledSubject: (ref) => `ご予約をキャンセルしました ${ref}`,
    cancelledIntro: 'ご予約をキャンセルしました。',
    refundLine: (m) => `返金額：${m}（元のお支払い方法に返金されます。通常、5〜10営業日かかります）。`,
    noRefundLine: 'このキャンセルでは、返金はありません。',
    refundPartialLine: (m, p) => `一部返金（${p}%）：${m}（元のお支払い方法に返金されます。通常、5〜10営業日かかります）。`,
    penaltyLine: (m) => `規定により、このキャンセルには${m}のキャンセル料がかかります。請求書に含めてご請求します。`,
    retainedLine: (m) => `キャンセル料として差し引かれた金額：${m}。`,
    conflictSubject: (ref) => `ご予約 ${ref}：枠を確保できなかったため、返金手続き中です`,
    conflictBody: '誠に申し訳ありませんが、枠の確保期限を過ぎてからお支払いが届き、その間に同じ枠が他のお客様に割り当てられました。お支払い金額は全額返金いたしました。お手数ですが、サイトで別の枠をお選びいただくか、ご連絡ください。',
    tour: 'サービス',
    date: '日付',
    time: '時間',
    people: '参加者',
    meeting: '集合場所',
    total: '合計',
    ref: '予約番号',
    clientRef: '案件番号',
    pay: { card: 'オンライン支払い済み', onsite: 'サービス当日にお支払い', invoice: '請求書払い／銀行振込（ご契約のとおり）', giftcard: 'ギフトカードで支払い済み', free: 'お支払いは不要です' },
    discount: (code) => `割引${code ? ' ' + code : ''}`,
    giftUsed: 'ギフトカード',
    due: 'お支払い額',
    policyFree: (dt) => `${dt}まで無料でキャンセルできます。`,
    policyNone: 'このご予約は、サービス直前のお申し込みのため、返金できません。',
    policyAfter: 'それ以降は返金できません。',
    manage: 'ご予約の確認・キャンセル',
    addCal: '添付のファイルで、サービスをカレンダーに追加できます。',
    bye: 'どうぞよろしくお願いいたします。',
    contactLine: 'ご不明な点は、このメールにご返信ください。',
  },
};

/** La parola per le persone nelle email («partecipanti», «guests»…). */
const guestWord = (lang) => T[lang].people.toLowerCase();

export function bookingUrl(app, b, lang = normLang(b.lang)) {
  return `${app.cfg.baseUrl}/${lang}/booking/${b.ref}?t=${b.token}`;
}

function summaryRows(app, b, lang, { option = false } = {}) {
  const tr = T[lang];
  const ti = tourText(app, b.tour_slug, lang);
  const rows = [
    [tr.ref, b.ref],
    [tr.tour, ti.title],
    [tr.date, fmtDate(b.date, lang)],
    [tr.time, timeRange(b, lang)],
    [tr.people, `${b.participants}${partyExtra(partyOfBooking(b), lang)}`],
    [tr.meeting, meetingOf(app.content.tour(b.tour_slug), b, lang).text],
  ];
  if (b.tour_lang && LANG_META[b.tour_lang]) rows.splice(5, 0, [makeT(lang)('s.tourLang'), LANG_META[b.tour_lang].name]);
  if (themeText(b, lang)) rows.splice(5, 0, [makeT(lang)('f.theme'), themeText(b, lang)]);
  if (b.discount_cents) rows.push([tr.discount(b.promo_code), `−${formatMoney(b.discount_cents, lang, b.currency)}`]);
  if (b.gift_cents) rows.push([tr.giftUsed, `−${formatMoney(b.gift_cents, lang, b.currency)}`]);
  rows.push([b.discount_cents || b.gift_cents ? tr.due : tr.total, option ? formatMoney(bookingDue(b), lang, b.currency) : `${formatMoney(bookingDue(b), lang, b.currency)} (${tr.pay[b.payment_method]})`]);
  if (b.client_ref) rows.push([tr.clientRef, b.client_ref]);
  return rows;
}

function policyLine(b, lang, nowMs) {
  const tr = T[lang];
  const st = cancellationState(b, nowMs);
  if (!st.everRefundable) return tr.policyNone;
  if (isSimplePolicy(st.tiers)) return `${tr.policyFree(fmtInstant(st.until, lang))} ${tr.policyAfter}`;
  return tierSentences(makeT(lang), lang, st.tiers, st.startsAt).join(' '); // politica a scaglioni: una frase per scaglione
}

export function icsFor(app, b, lang = normLang(b.lang)) {
  const ti = tourText(app, b.tour_slug, lang);
  return calendar(`${app.cfg.site.name} — ${ti.title}`, [
    eventLines({
      uid: `${b.ref}@${new URL(app.cfg.baseUrl).hostname}`,
      date: b.date,
      start: b.start_time,
      end: b.end_time,
      summary: `${ti.title} (${app.cfg.site.name})`,
      description: `${b.ref} — ${bookingPeople(b, lang, { noun: guestWord(lang) })}`,
      location: meetingOf(app.content.tour(b.tour_slug), b, lang).text,
      url: bookingUrl(app, b, lang),
    }),
  ]);
}

function layout(app, lang, inner) {
  return html`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;line-height:1.55">
    <div style="background:#d6bb51;padding:18px 24px;border-radius:12px 12px 0 0"><strong style="font-size:20px">${app.cfg.site.name}</strong><br><span style="font-size:13px">${pick(app.cfg.site.tagline, lang)}</span></div>
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

/** Allega un PDF generato al volo; se la generazione fallisce la mail parte comunque, senza allegato. */
async function pdfAttachment(filename, render, what, file = './pdf.js') {
  try {
    const pdf = await import(file);
    return [{ filename, content: await render(pdf), contentType: 'application/pdf' }];
  } catch (err) {
    console.error(`[pdf] ${what} non generato:`, err.message);
    return [];
  }
}

export async function sendBookingConfirmed(app, b, nowMs = Date.now()) {
  const lang = normLang(b.lang);
  const tr = T[lang];
  const ti = tourText(app, b.tour_slug, lang);
  const pol = policyLine(b, lang, nowMs);
  const payNote = invoiceNote(app, b, lang); // prenotazione a fattura: quando e come si paga
  // tour condiviso con posti liberi: un invito per un amico, dalla pagina della prenotazione
  const inviteLine = inviteOffer(app, b, nowMs).ok ? `${makeT(lang)('invite.mailHint')} ${bookingUrl(app, b, lang)}#invita` : '';
  await app.mail.send({
    to: b.email,
    subject: tr.confirmedSubject(b.ref, ti.title, fmtDate(b.date, lang, 'short')),
    text: textBody(app, b, lang, tr.confirmedIntro, [pol, ...(payNote ? [payNote] : []), tr.addCal, ...(inviteLine ? ['', inviteLine] : []), '']),
    html: String(bodyHtml(app, b, lang, tr.confirmedIntro, html`<p style="font-size:14px;color:#444">${pol}</p>${payNote ? html`<p style="font-size:14px;color:#444">${payNote}</p>` : ''}<p style="font-size:13px;color:#666">${tr.addCal}</p>${inviteLine ? html`<p style="font-size:13px;color:#666">${makeT(lang)('invite.mailHint')} <a href="${bookingUrl(app, b, lang)}#invita">${makeT(lang)('invite.title')}</a></p>` : ''}`)),
    attachments: [
      { filename: `${b.ref}.ics`, content: icsFor(app, b, lang), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' },
      ...(await pdfAttachment(`voucher-${b.ref}.pdf`, (pdf) => pdf.renderVoucherPdf(app, b, { lang, nowMs }), 'voucher')),
    ],
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
  await notifyGuide(app, b, 'new');
}

export async function sendBookingCancelled(app, b, refundCents) {
  const lang = normLang(b.lang);
  const tr = T[lang];
  const money = (c) => formatMoney(c, lang, b.currency);
  const parts = [];
  if (refundCents) parts.push(b.cancel_percent != null && b.cancel_percent < 100 ? tr.refundPartialLine(money(refundCents), b.cancel_percent) : tr.refundLine(money(refundCents)));
  else if (b.payment_status === 'paid' || b.payment_method === 'card') parts.push(tr.noRefundLine);
  if (b.retained_cents > 0) parts.push(b.payment_status === 'unpaid' ? tr.penaltyLine(money(b.retained_cents)) : tr.retainedLine(money(b.retained_cents)));
  const line = parts.join(' ');
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
  const lang = normLang(b.lang);
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
    `${fmtDate(b.date, 'it')} · ${b.start_time}–${b.end_time} · ${bookingPeopleShort(b)}`,
    themeText(b, 'it') ? `Scelta del cliente: ${themeText(b, 'it')}` : null,
    tour.meetingChoice ? `Punto d’incontro: ${meetingOf(tour, b, 'it').text}${b.pickup ? '' : ' (standard: il cliente non ha indicato nulla)'}` : null,
    b.tour_lang && LANG_META[b.tour_lang] ? `Lingua del tour: ${LANG_META[b.tour_lang].name}` : null,
    parseServiceRecord(b.service_json) ? `Servizio a ore: ${serviceNote(parseServiceRecord(b.service_json))}` : null,
    `${b.name} <${b.email}>${b.phone ? ' · ' + b.phone : ''}`,
    b.client_ref ? `Rif. pratica: ${b.client_ref}` : null,
    b.booked_by_name ? `Prenotata da: ${b.booked_by_name}` : null,
    b.notes ? `Note: ${b.notes}` : null,
    `Totale: ${formatMoney(b.total_cents, 'it', b.currency)}${b.discount_cents ? ` (sconto ${b.promo_code}: −${formatMoney(b.discount_cents, 'it', b.currency)})` : ''}${b.gift_cents ? ` · buono regalo: −${formatMoney(b.gift_cents, 'it', b.currency)}` : ''} · pagamento: ${b.payment_method} (${b.payment_status})`,
    kind === 'cancelled' ? `Rimborso: ${refundCents ? formatMoney(refundCents, 'it', b.currency) : 'nessuno'}${b.cancel_percent != null ? ` (${b.cancel_percent}%)` : ''}${b.retained_cents > 0 ? ` · penale: ${formatMoney(b.retained_cents, 'it', b.currency)}${b.payment_status === 'unpaid' ? ' (da fatturare)' : ' (trattenuta)'}` : ''}${b.cancelled_by ? ` · annullata da: ${b.cancelled_by}` : ''}` : null,
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


// ───────────── Opzioni delle agenzie ─────────────
const O = {
  it: {
    createdSubject: (ref, title, d) => `Opzione registrata ${ref} — ${title}, ${d}`,
    createdIntro: (until) => `la data è trattenuta per te fino a ${until}. Non hai pagato nulla e non hai alcun impegno: entro quel termine conferma la prenotazione (dal tuo account o dal pulsante qui sotto), oppure rilasciala se il tuo cliente non conferma. Se non fai nulla, la data si libera da sola.`,
    until: 'Opzione valida fino a',
    cta: 'Conferma o rilascia l’opzione',
    reminderSubject: (ref, until) => `Promemoria: l’opzione ${ref} scade il ${until}`,
    reminderIntro: (until) => `la tua opzione scade il ${until}. Se il tuo cliente ha confermato, conferma ora la prenotazione; altrimenti rilasciala, così la data torna libera.`,
    expiredSubject: (ref) => `Opzione scaduta ${ref}`,
    expiredIntro: (until) => `l’opzione non è stata confermata entro ${until}, quindi la data è stata liberata. Nessun costo e nessun impegno. Se ti serve ancora, puoi prenotare di nuovo dal sito, se la data è ancora disponibile.`,
    releasedSubject: (ref) => `Opzione rilasciata ${ref}`,
    releasedIntro: 'l’opzione è stata rilasciata e la data è tornata libera. Nessun costo e nessun impegno.',
    extendedSubject: (ref) => `Opzione prorogata ${ref}`,
    extendedIntro: (until) => `ti ho prorogato l’opzione: la data resta trattenuta fino a ${until}.`,
  },
  en: {
    createdSubject: (ref, title, d) => `Option placed ${ref} — ${title}, ${d}`,
    createdIntro: (until) => `the date is held for you until ${until}. You have paid nothing and there is no commitment: before then, confirm the booking (from your account or the button below), or release it if your client does not confirm. If you do nothing, the date is released automatically.`,
    until: 'Option valid until',
    cta: 'Confirm or release the option',
    reminderSubject: (ref, until) => `Reminder: option ${ref} expires on ${until}`,
    reminderIntro: (until) => `your option expires on ${until}. If your client has confirmed, confirm the booking now; otherwise release it so the date becomes available again.`,
    expiredSubject: (ref) => `Option expired ${ref}`,
    expiredIntro: (until) => `the option was not confirmed by ${until}, so the date has been released. No cost and no commitment. If you still need it, you can book again on the website, if the date is still available.`,
    releasedSubject: (ref) => `Option released ${ref}`,
    releasedIntro: 'the option has been released and the date is available again. No cost and no commitment.',
    extendedSubject: (ref) => `Option extended ${ref}`,
    extendedIntro: (until) => `I have extended your option: the date stays held until ${until}.`,
  },
  es: {
    createdSubject: (ref, title, d) => `Opción registrada ${ref} — ${title}, ${d}`,
    createdIntro: (until) => `la fecha queda reservada para ti hasta el ${until}. No has pagado nada y no hay ningún compromiso: antes de esa fecha confirma la reserva (desde tu cuenta o con el botón de abajo) o libérala si tu cliente no confirma. Si no haces nada, la fecha se libera sola.`,
    until: 'Opción válida hasta',
    cta: 'Confirmar o liberar la opción',
    reminderSubject: (ref, until) => `Recordatorio: la opción ${ref} caduca el ${until}`,
    reminderIntro: (until) => `tu opción caduca el ${until}. Si tu cliente ha confirmado, confirma ahora la reserva; si no, libérala para que la fecha vuelva a estar disponible.`,
    expiredSubject: (ref) => `Opción caducada ${ref}`,
    expiredIntro: (until) => `la opción no se confirmó antes del ${until}, así que la fecha se ha liberado. Sin coste ni compromiso. Si todavía la necesitas, puedes reservar de nuevo en la web, si la fecha sigue disponible.`,
    releasedSubject: (ref) => `Opción liberada ${ref}`,
    releasedIntro: 'la opción se ha liberado y la fecha vuelve a estar disponible. Sin coste ni compromiso.',
    extendedSubject: (ref) => `Opción prorrogada ${ref}`,
    extendedIntro: (until) => `he prorrogado tu opción: la fecha queda reservada hasta el ${until}.`,
  },
  ja: {
    createdSubject: (ref, title, d) => `仮押さえ（オプション）を受け付けました ${ref} — ${title}（${d}）`,
    createdIntro: (until) => `この日程を${until}まで仮押さえしました。お支払いは発生せず、義務もありません。期限までに、アカウントまたは下のボタンから予約を確定するか、お客様が確定されない場合は解除してください。何もされない場合、日程は自動的に解放されます。`,
    until: '仮押さえの期限',
    cta: '仮押さえを確定または解除する',
    reminderSubject: (ref, until) => `リマインダー：仮押さえ ${ref} の期限は${until}です`,
    reminderIntro: (until) => `仮押さえの期限は${until}です。お客様が確定された場合は、今すぐ予約を確定してください。確定されない場合は解除して、日程を解放してください。`,
    expiredSubject: (ref) => `仮押さえの期限が切れました ${ref}`,
    expiredIntro: (until) => `${until}までに確定されなかったため、日程を解放しました。費用は発生せず、義務もありません。引き続き必要な場合は、日程が空いていれば、サイトから改めてご予約いただけます。`,
    releasedSubject: (ref) => `仮押さえを解除しました ${ref}`,
    releasedIntro: '仮押さえを解除し、日程を解放しました。費用は発生せず、義務もありません。',
    extendedSubject: (ref) => `仮押さえを延長しました ${ref}`,
    extendedIntro: (until) => `仮押さえを延長しました。日程は${until}まで確保されています。`,
  },
};

async function sendOptionMail(app, b, { subject, intro, withCta = true }) {
  const lang = normLang(b.lang);
  const tr = T[lang];
  const o = O[lang];
  const rows = [...(b.status === 'option' && b.option_expires_at ? [[o.until, fmtInstant(Date.parse(b.option_expires_at), lang)]] : []), ...summaryRows(app, b, lang, { option: true })];
  const link = withCta ? bookingUrl(app, b, lang) : '';
  await app.mail.send({
    to: b.email,
    subject,
    text: [tr.hello(b.name), '', intro, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', ...(withCta ? [`${o.cta}: ${link}`, ''] : []), tr.contactLine, `${tr.bye} ${app.cfg.site.name}`].join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${tr.hello(b.name)}</p><p>${intro}</p>
        <table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map(([k, v]) => html`<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0"><strong>${v}</strong></td></tr>`)}</table>
        ${withCta ? html`<p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${o.cta}</a></p>` : ''}
        <p style="color:#666;font-size:13px">${tr.contactLine}<br>${tr.bye} ${app.cfg.site.name}</p>`,
      ),
    ),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

const untilOf = (b, lang) => fmtInstant(Date.parse(b.option_expires_at), lang);

/** All'agenzia: l'opzione è registrata e fino a quando la data è trattenuta. */
export async function sendOptionCreated(app, b) {
  const lang = normLang(b.lang);
  const o = O[lang];
  await sendOptionMail(app, b, { subject: o.createdSubject(b.ref, tourText(app, b.tour_slug, lang).title, fmtDate(b.date, lang, 'short')), intro: o.createdIntro(untilOf(b, lang)) });
}

/** All'agenzia: l'opzione sta per scadere. */
export async function sendOptionReminder(app, b) {
  const lang = normLang(b.lang);
  const o = O[lang];
  await sendOptionMail(app, b, { subject: o.reminderSubject(b.ref, untilOf(b, lang)), intro: o.reminderIntro(untilOf(b, lang)) });
}

/** All'agenzia: l'opzione è scaduta e la data è libera. */
export async function sendOptionExpired(app, b) {
  const lang = normLang(b.lang);
  const o = O[lang];
  await sendOptionMail(app, b, { subject: o.expiredSubject(b.ref), intro: o.expiredIntro(untilOf(b, lang)), withCta: false });
}

/** All'agenzia: la guida ha rilasciato l'opzione. */
export async function sendOptionReleased(app, b) {
  const o = O[normLang(b.lang)];
  await sendOptionMail(app, b, { subject: o.releasedSubject(b.ref), intro: o.releasedIntro, withCta: false });
}

/** All'agenzia: la guida ha prorogato l'opzione. */
export async function sendOptionExtended(app, b) {
  const lang = normLang(b.lang);
  const o = O[lang];
  await sendOptionMail(app, b, { subject: o.extendedSubject(b.ref), intro: o.extendedIntro(untilOf(b, lang)) });
}

/** Avviso alla guida (in italiano) sulle opzioni: nuova, scaduta, rilasciata dall'agenzia. */
export async function notifyGuideOption(app, b, kind) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const tour = app.content.tour(b.tour_slug);
  const label = { created: 'Nuova opzione', expired: 'Opzione scaduta: data liberata', released: 'Opzione rilasciata dall’agenzia: data liberata' }[kind];
  const account = b.account_id ? app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(b.account_id) : null;
  const lines = [
    `${label} ${b.ref}${account ? ` — ${account.company}` : ''}`,
    tour?.i18n.it.title ?? b.tour_slug,
    `${fmtDate(b.date, 'it')} · ${b.start_time}–${b.end_time} · ${bookingPeopleShort(b)}`,
    b.client_ref ? `Rif. pratica: ${b.client_ref}` : null,
    b.booked_by_name ? `Prenotata da: ${b.booked_by_name}` : null,
    kind === 'created' ? `Trattenuta fino al ${fmtInstant(Date.parse(b.option_expires_at), 'it')}; se l’agenzia non conferma, si libera da sola.` : null,
    `Totale: ${formatMoney(b.total_cents, 'it', b.currency)}`,
    '',
    `${app.cfg.baseUrl}/admin/bookings/${b.id}`,
  ].filter((x) => x !== null);
  await app.mail.send({ to, subject: `${label}: ${tour?.i18n.it.title ?? b.tour_slug} — ${b.date} ${b.start_time}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

/** Avviso alla guida (in italiano): l'agenzia ha cambiato nominativo, telefono o note di una prenotazione confermata. */
export async function notifyGuideBookingEdited(app, before, after) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const tour = app.content.tour(before.tour_slug);
  const account = before.account_id ? app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(before.account_id) : null;
  const changes = [
    ['Nominativo', before.name, after.name],
    ['Telefono', before.phone, after.phone],
    ['Note', before.notes, after.notes],
    ['Punto d’incontro', before.pickup, after.pickup],
  ].filter(([, a, b]) => (a ?? '') !== (b ?? ''));
  const lines = [
    `Prenotazione modificata dall’agenzia: ${before.ref}${account ? ` — ${account.company}` : ''}`,
    `${tour?.i18n.it.title ?? before.tour_slug} · ${fmtDate(before.date, 'it')} · ${before.start_time}–${before.end_time} · ${bookingPeopleShort(before)}`,
    ...changes.map(([label, a, b]) => `${label}: ${a || '—'} → ${b || '—'}`),
    '',
    `${app.cfg.baseUrl}/admin/bookings/${before.id}`,
  ];
  await app.mail.send({ to, subject: `Prenotazione modificata: ${tour?.i18n.it.title ?? before.tour_slug} — ${before.date} ${before.start_time}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

// ───────────── Partner B2B ─────────────
const P = {
  it: {
    receivedSubject: 'Richiesta di accesso partner ricevuta',
    receivedBody: (n) => `Ciao ${n},\nho ricevuto la tua richiesta di accesso all'area partner. La esamino e ti rispondo di norma entro uno o due giorni lavorativi.\n`,
    approvedSubject: 'Il tuo account partner è attivo',
    approvedBody: (n, url) => `Ciao ${n},\nil tuo account partner è stato approvato: da ora puoi accedere, vedere le tariffe riservate e prenotare i servizi per i tuoi clienti.\n\nAccedi qui: ${url}\n`,
    resetSubject: 'Nuova password per l’area partner',
    resetBody: (n, url) => `Ciao ${n},\nhai chiesto di scegliere una nuova password per l'area partner. Usa questo collegamento (vale un'ora e una sola volta):\n\n${url}\n\nSe non sei stato tu, ignora questa email: la tua password non cambia.\n`,
    sign: 'A presto,',
  },
  en: {
    receivedSubject: 'Partner access request received',
    receivedBody: (n) => `Hi ${n},\nI have received your request for partner access. I will review it and reply, usually within one or two business days.\n`,
    approvedSubject: 'Your partner account is active',
    approvedBody: (n, url) => `Hi ${n},\nyour partner account has been approved: you can now sign in, see your reserved rates and book services for your clients.\n\nSign in here: ${url}\n`,
    resetSubject: 'New password for the partner area',
    resetBody: (n, url) => `Hi ${n},\nyou asked to choose a new password for the partner area. Use this link (valid for one hour, one time only):\n\n${url}\n\nIf it was not you, ignore this email: your password stays the same.\n`,
    sign: 'See you soon,',
  },
  es: {
    receivedSubject: 'Solicitud de acceso de partner recibida',
    receivedBody: (n) => `Hola ${n},\nhe recibido tu solicitud de acceso al área de partners. La reviso y te respondo, normalmente, en uno o dos días hábiles.\n`,
    approvedSubject: 'Tu cuenta de partner está activa',
    approvedBody: (n, url) => `Hola ${n},\ntu cuenta de partner ha sido aprobada: a partir de ahora puedes acceder, consultar las tarifas reservadas y reservar servicios para tus clientes.\n\nAccede aquí: ${url}\n`,
    resetSubject: 'Nueva contraseña para el área de partners',
    resetBody: (n, url) => `Hola ${n},\nhas pedido elegir una nueva contraseña para el área de partners. Usa este enlace (válido una hora y una sola vez):\n\n${url}\n\nSi no has sido tú, ignora este correo: tu contraseña no cambia.\n`,
    sign: 'Hasta pronto,',
  },
  ja: {
    receivedSubject: 'パートナーアクセスの申請を受け付けました',
    receivedBody: (n) => `${n} 様\nパートナーエリアへのアクセス申請を受け付けました。内容を確認のうえ、通常1〜2営業日以内にご連絡いたします。\n`,
    approvedSubject: 'パートナーアカウントが有効になりました',
    approvedBody: (n, url) => `${n} 様\nパートナーアカウントが承認されました。今後は、ログインして専用料金をご確認いただき、お客様のためのサービスをご予約いただけます。\n\nログインはこちら：${url}\n`,
    resetSubject: 'パートナーエリアの新しいパスワード',
    resetBody: (n, url) => `${n} 様\nパートナーエリアの新しいパスワードの設定が依頼されました。次のリンクをご利用ください（1時間有効・1回のみ）:\n\n${url}\n\nお心当たりがない場合は、このメールを無視してください。パスワードは変更されません。\n`,
    sign: 'どうぞよろしくお願いいたします。',
  },
};

/** La riga sulla partita IVA per la guida: esito della verifica, cosa dice il registro e se il nome coincide (vedi vat.js). */
const vatLine = (v) => {
  if (!v) return '';
  const detail = [v.name ? `registro: ${v.name}${v.address ? `, ${v.address}` : ''}` : '', v.sameName === false ? 'il nome sembra diverso da quello scritto' : '', ['unavailable', 'format'].includes(v.status) && v.message ? v.message : ''].filter(Boolean);
  return `P.IVA: ${v.label}${detail.length ? ` (${detail.join(' · ')})` : ''}`;
};

/**
 * Una nuova agenzia si è registrata: conferma di ricezione all'agenzia e avviso alla guida, con l'esito della verifica della partita IVA.
 * `invited`: arriva da un invito (l'account è già approvato): all'agenzia non si scrive «aspetta l'approvazione».
 */
export async function sendPartnerRegistered(app, a, { vat = null, invited = false } = {}) {
  const tr = P[normLang(a.lang)];
  if (!invited) await app.mail.send({ to: a.email, subject: tr.receivedSubject, text: `${tr.receivedBody(a.contact_name)}\n${tr.sign} ${app.cfg.site.name}`, replyTo: app.cfg.mail.notifyTo || undefined });
  const to = app.cfg.mail.notifyTo;
  if (to)
    await app.mail.send({
      to,
      subject: invited ? `Agenzia invitata registrata: ${a.company}` : `Nuova richiesta partner: ${a.company}`,
      text: [`${a.company} (${vatLabel(a)})`, vatLine(vat), `${a.contact_name} <${a.email}>${a.phone ? ' · ' + a.phone : ''}`, a.website ?? '', a.message ? `Messaggio: ${a.message}` : '', '', invited ? `Si è registrata dal tuo invito: l'account è già approvato. ${app.cfg.baseUrl}/admin/partners/${a.id}` : `Approva o rifiuta: ${app.cfg.baseUrl}/admin/partners/${a.id}`].filter(Boolean).join('\n'),
    });
}

/** All'agenzia invitata: il collegamento personale per registrarsi (con l'account già approvato). @returns {Promise<boolean>} false se l'email non è partita */
export async function sendPartnerInvite(app, invite, url) {
  const lang = normLang(invite.lang);
  const t = makeT(lang);
  const tr = T[lang];
  const site = app.cfg.site.name;
  const hello = greet(lang, invite.contact_name);
  const sign = `${bye(lang)} ${site}`;
  const intro = t('pinv.mail.intro', { site });
  const valid = t('pinv.mail.valid', { days: INVITE_DAYS });
  return app.mail.send({
    to: invite.email,
    subject: t('pinv.mail.subject', { site }),
    text: [hello, '', intro, ...(invite.note ? ['', invite.note] : []), '', `${t('pinv.mail.cta')}: ${url}`, '', valid, '', tr.contactLine, sign].join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${hello}</p><p>${intro}</p>${invite.note ? html`<p style="border-left:3px solid #d6bb51;padding-left:12px;white-space:pre-line">${invite.note}</p>` : ''}<p><a href="${url}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('pinv.mail.cta')}</a></p><p style="color:#666;font-size:13px">${valid}</p><p style="color:#666;font-size:13px">${tr.contactLine}<br>${sign}</p>`,
      ),
    ),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/**
 * A un collaboratore appena invitato dal titolare dell'agenzia: il collegamento personale per scegliere la password.
 * @returns {Promise<boolean>} false se l'email non è partita
 */
export async function sendTeamInvite(app, { account, inviter, user }, url) {
  const lang = normLang(user.lang);
  const t = makeT(lang);
  const tr = T[lang];
  const site = app.cfg.site.name;
  const hello = greet(lang, user.name);
  const sign = `${bye(lang)} ${site}`;
  const intro = t('team.mail.intro', { inviter, company: account.company, site });
  const valid = t('pinv.mail.valid', { days: TEAM_INVITE_DAYS });
  return app.mail.send({
    to: user.email,
    subject: t('team.mail.subject', { company: account.company, site }),
    text: [hello, '', intro, '', `${t('team.mail.cta')}: ${url}`, '', valid, '', tr.contactLine, sign].join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${hello}</p><p>${intro}</p><p><a href="${url}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('team.mail.cta')}</a></p><p style="color:#666;font-size:13px">${valid}</p><p style="color:#666;font-size:13px">${tr.contactLine}<br>${sign}</p>`,
      ),
    ),
    replyTo: account.email,
  });
}

// ───────────── Preventivi online delle agenzie ─────────────
/** Come `layout`, ma con il nome e i recapiti dell'agenzia in testa: è il suo preventivo, mandato per suo conto. */
function agencyLayout(brand, inner) {
  return html`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1c;line-height:1.55">
    <div style="background:#d6bb51;padding:18px 24px;border-radius:12px 12px 0 0"><strong style="font-size:20px">${brand.name}</strong>${brand.contact ? html`<br><span style="font-size:13px">${brand.contact}</span>` : ''}</div>
    <div style="border:1px solid #eee;border-top:0;padding:24px;border-radius:0 0 12px 12px">${inner}</div>
  </div>`;
}

/**
 * Il preventivo al cliente finale dell'agenzia: i servizi con il prezzo per lui (mai la tariffa dell'agenzia), la validità, il collegamento per
 * accettare e il PDF in allegato. Parte dal sito, ma le risposte arrivano all'agenzia (`replyTo`).
 * @returns {Promise<boolean>} false se l'email non è partita
 */
export async function sendQuoteToClient(app, q, { to, replyTo, pdf }) {
  const lang = normLang(q.lang);
  const t = makeT(lang);
  const site = app.cfg.site.name;
  const brand = brandOf(app, q.account_id);
  const view = clientView(app, q, lang);
  const money = (c) => formatMoney(c, lang, q.currency);
  const url = `${app.cfg.baseUrl}/${lang}/quotes/${q.ref}?t=${q.token}`;
  const hello = greet(lang, q.client_name);
  const intro = t('qm.intro', { agency: brand.name, site });
  const valid = t('qm.valid', { date: fmtDate(q.valid_until, lang) });
  const reply = t('qm.reply', { agency: brand.name });
  const sentBy = t('qm.sentBy', { site, agency: brand.name });
  const rows = view.lines.map((l) => ({ title: l.title, when: `${fmtDate(l.date, lang)} · ${l.when} · ${t('quote.pax', { n: l.pax })}${partyExtra(l.party, lang)}`, price: money(l.cents) }));
  return app.mail.send({
    to,
    subject: t('qm.subject', { agency: brand.name, ref: q.ref }),
    text: [hello, '', intro, '', ...rows.flatMap((r) => [`• ${r.title} — ${r.price}`, `  ${r.when}`]), `${t('quote.total')}: ${money(view.totalCents)}`, ...(q.note ? ['', q.note] : []), '', valid, '', `${t('qm.cta')}: ${url}`, '', reply, sentBy].join('\n'),
    html: String(
      agencyLayout(
        brand,
        html`<p>${hello}</p><p>${intro}</p>
      <table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map((r) => html`<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #eee"><strong>${r.title}</strong><br><span style="color:#666;font-size:13px">${r.when}</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap"><strong>${r.price}</strong></td></tr>`)}
        <tr><td style="padding:10px 12px 10px 0">${t('quote.total')}</td><td style="padding:10px 0;text-align:right;font-size:18px"><strong>${money(view.totalCents)}</strong></td></tr></table>
      ${q.note ? html`<p style="border-left:3px solid #d6bb51;padding-left:12px;white-space:pre-line">${q.note}</p>` : ''}
      <p style="color:#666;font-size:13px">${valid}</p>
      <p><a href="${url}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('qm.cta')}</a></p>
      <p style="color:#666;font-size:13px">${reply}<br>${sentBy}</p>`,
      ),
    ),
    replyTo,
    attachments: [{ filename: `preventivo-${q.ref}.pdf`, content: pdf, contentType: 'application/pdf' }],
  });
}

/** All'agenzia (a chi ha preparato il preventivo e al titolare): il cliente ha accettato o rifiutato. Nella lingua di ciascuno. */
export async function notifyAgencyQuote(app, q, decision) {
  const { db } = app;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(q.account_id);
  if (!account) return;
  const creator = q.user_id ? db.prepare('SELECT * FROM account_users WHERE id = ? AND account_id = ?').get(q.user_id, account.id) : null;
  const people = [creator ? { email: creator.email, name: creator.name, lang: creator.lang } : null, { email: account.email, name: account.contact_name, lang: account.lang }].filter(Boolean);
  for (const person of people) {
    const lang = normLang(person.lang);
    const t = makeT(lang);
    const body = t(`qa.body.${decision}`, { client: q.client_name, ref: q.ref, total: formatMoney(q.total_cents, lang, q.currency) });
    const note = q.decided_note ? t('qa.message', { note: q.decided_note }) : '';
    const url = `${app.cfg.baseUrl}/${lang}/b2b/quotes/${q.ref}`;
    const hello = greet(lang, person.name);
    const sign = `${bye(lang)} ${app.cfg.site.name}`;
    await app.mail.send({
      to: person.email,
      subject: t(`qa.subject.${decision}`, { ref: q.ref }),
      text: [hello, '', body, ...(note ? ['', note] : []), '', `${t('qa.cta')}: ${url}`, '', sign].join('\n'),
      html: String(layout(app, lang, html`<p>${hello}</p><p>${body}</p>${note ? html`<p style="border-left:3px solid #d6bb51;padding-left:12px;white-space:pre-line">${note}</p>` : ''}<p><a href="${url}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('qa.cta')}</a></p><p style="color:#666;font-size:13px">${sign}</p>`)),
      replyTo: app.cfg.mail.notifyTo || undefined,
    });
  }
}

/** Alla guida (in italiano): il cliente di un'agenzia ha accettato un preventivo. Nessuna data è trattenuta; non si vede il ricarico dell'agenzia. */
export async function notifyGuideQuote(app, q) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const account = app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(q.account_id);
  const view = clientView(app, q, 'it');
  const lines = [
    `Preventivo accettato ${q.ref} — ${account?.company ?? ''}`,
    `Il cliente (${q.client_name}) ha accettato il preventivo dell'agenzia. Nessuna data è trattenuta: se l'agenzia prenota, lo vedrai qui.`,
    '',
    ...view.lines.map((l) => `${fmtDate(l.date, 'it', 'short')} · ${l.when} · ${l.title} · ${peopleShort(l.party)}`),
    `Tariffa dell'agenzia: ${formatMoney(q.net_cents, 'it', q.currency)}`,
    '',
    `${app.cfg.baseUrl}/admin/partners/${q.account_id}`,
  ];
  await app.mail.send({ to, subject: `Preventivo accettato: ${account?.company ?? ''} — ${q.ref}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

/** Il collegamento per scegliere una nuova password (vale un'ora, una volta sola: dopo il cambio non funziona più). */
export async function sendPartnerPasswordReset(app, a, url) {
  const tr = P[normLang(a.lang)];
  await app.mail.send({ to: a.email, subject: tr.resetSubject, text: `${tr.resetBody(a.contact_name, url)}\n${tr.sign} ${app.cfg.site.name}`, replyTo: app.cfg.mail.notifyTo || undefined });
}

export async function sendPartnerApproved(app, a) {
  const lang = normLang(a.lang);
  const tr = P[lang];
  const url = `${app.cfg.baseUrl}/${lang}/b2b/login`;
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
  es: {
    buyerSubject: (amount) => `Tu tarjeta regalo de ${amount}`,
    buyerIntro: '¡gracias! Tu tarjeta regalo está lista.',
    buyerScheduled: (name, email, date) => `La enviaremos a ${name ? name + ' ' : ''}(${email}) el ${date} a las 9:00. Aun así, aquí abajo tienes el código.`,
    buyerSent: (email) => `La hemos enviado a ${email}.`,
    buyerSelf: 'Puedes imprimirla o reenviarla a la persona a quien se la quieras regalar.',
    recipientSubject: (from) => (from ? `${from} te ha regalado una experiencia en Venecia` : 'Una tarjeta regalo para Venecia, para ti'),
    recipientIntro: (name) => `${name ? `Hola ${name}, ` : 'Hola, '}has recibido una tarjeta regalo para descubrir Venecia con un guía turístico habilitado.`,
    from: (name) => `De parte de ${name}`,
    amount: 'Importe',
    code: 'Código',
    valid: 'Válida hasta',
    how: 'Cómo se usa: elige un tour en la web, ve al paso de confirmación e introduce el código en el campo «Tarjeta regalo». La tarjeta se puede usar en varias reservas hasta agotar el saldo.',
    cta: 'Elige tu tour',
    sign: 'Hasta pronto,',
  },
  ja: {
    buyerSubject: (amount) => `ギフトカード（${amount}）のご案内`,
    buyerIntro: 'ご購入ありがとうございます。ギフトカードのご用意ができました。',
    buyerScheduled: (name, email, date) => `${name ? name + ' 様' : ''}（${email}）へ、${date}の9:00に送信いたします。コードは、以下にも記載しています。`,
    buyerSent: (email) => `${email}宛てに送信しました。`,
    buyerSelf: '印刷して、またはそのまま転送して、贈りたい方にお渡しいただけます。',
    recipientSubject: (from) => (from ? `${from}様から、ヴェネツィアでの体験のプレゼントが届きました` : 'ヴェネツィアのギフトカードが届きました'),
    recipientIntro: (name) => `${name ? `${name} 様、` : ''}公認ガイドと一緒にヴェネツィアを巡る、ギフトカードが届きました。`,
    from: (name) => `贈り主：${name}`,
    amount: '金額',
    code: 'コード',
    valid: '有効期限',
    how: 'ご利用方法：サイトでツアーを選び、確認画面で「ギフトカード」欄にコードを入力してください。残高がなくなるまで、複数回に分けてご利用いただけます。',
    cta: 'ツアーを選ぶ',
    sign: 'どうぞよろしくお願いいたします。',
  },
};

function giftBlock(app, card, lang) {
  const tr = G[lang];
  const rows = [
    [tr.amount, formatMoney(card.initial_cents, lang, card.currency)],
    [tr.code, formatGiftCode(card.code)],
    [tr.valid, fmtDate(card.expires_at, lang, 'date')],
  ];
  return rows;
}

const giftAttachments = (app, card, lang) => pdfAttachment(`buono-regalo-${card.ref}.pdf`, (pdf) => pdf.renderGiftCardPdf(app, card, lang), 'buono regalo');

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
  const lang = normLang(card.lang);
  const tr = G[lang];
  const money = formatMoney(card.initial_cents, lang, card.currency);
  const note = card.recipient_email ? (card.delivered_at ? tr.buyerSent(card.recipient_email) : tr.buyerScheduled(card.recipient_name, card.recipient_email, fmtDate(card.deliver_on, lang, 'short'))) : tr.buyerSelf;
  const hello = greet(lang, card.buyer_name);
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
  const lang = normLang(card.lang);
  const tr = G[lang];
  const intro = tr.recipientIntro(card.recipient_name);
  const from = card.buyer_name ? tr.from(card.buyer_name) : '';
  const lines = [intro, from, card.message ? (lang === 'ja' ? `「${card.message}」` : `«${card.message}»`) : '', '', ...giftBlock(app, card, lang).map(([k, v]) => `${k}: ${v}`), '', tr.how, `${app.cfg.baseUrl}/${lang}/tours`, '', `${tr.sign} ${app.cfg.site.name}`].filter((l, i) => l !== '' || i > 2);
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

// ───────────── Richiesta di recensione ─────────────
const R = {
  it: {
    subject: (site) => `Com’è andata? Il tuo tour a Venezia con ${site}`,
    hello: (n) => `Ciao ${n},`,
    intro: (title, date) => `grazie per aver scelto «${title}» (${date}). Spero ti sia piaciuto!`,
    ask: 'Se ti va, una recensione aiuta moltissimo chi sta scegliendo una guida e un piccolo lavoro come il mio: bastano un minuto e due righe.',
    google: 'Scrivi una recensione su Google',
    tripadvisor: 'Scrivi una recensione su Tripadvisor',
    privateAsk: 'Preferisci dirmelo in privato (cosa è andato bene, cosa migliorare)?',
    privateCta: 'Lascia un feedback privato',
    thanks: 'Grazie ancora e a presto a Venezia,',
    once: 'Questa è l’unica email che ti invio dopo il tour.',
  },
  en: {
    subject: (site) => `How was it? Your Venice tour with ${site}`,
    hello: (n) => `Hi ${n},`,
    intro: (title, date) => `thank you for choosing “${title}” (${date}). I hope you enjoyed it!`,
    ask: 'If you feel like it, a review helps people choosing a guide and a small business like mine enormously: it takes a minute and two lines.',
    google: 'Write a Google review',
    tripadvisor: 'Write a Tripadvisor review',
    privateAsk: 'Would you rather tell me privately (what went well, what could be better)?',
    privateCta: 'Leave private feedback',
    thanks: 'Thanks again, and see you in Venice,',
    once: 'This is the only email I will send you after the tour.',
  },
  es: {
    subject: (site) => `¿Qué tal ha ido? Tu tour por Venecia con ${site}`,
    hello: (n) => `Hola ${n},`,
    intro: (title, date) => `gracias por haber elegido «${title}» (${date}). ¡Espero que lo hayas disfrutado!`,
    ask: 'Si te apetece, una reseña ayuda muchísimo a quienes están eligiendo guía y a un pequeño negocio como el mío: solo lleva un minuto y un par de líneas.',
    google: 'Escribe una reseña en Google',
    tripadvisor: 'Escribe una reseña en Tripadvisor',
    privateAsk: '¿Prefieres contármelo en privado (qué ha ido bien, qué se podría mejorar)?',
    privateCta: 'Deja un comentario privado',
    thanks: 'Gracias de nuevo y hasta pronto en Venecia,',
    once: 'Este es el único correo que te envío después del tour.',
  },
  ja: {
    subject: (site) => `ツアーはいかがでしたか？ ${site}とめぐるヴェネツィア`,
    hello: (n) => `${n} 様`,
    intro: (title, date) => `「${title}」（${date}）にご参加いただき、ありがとうございました。お楽しみいただけたでしょうか。`,
    ask: 'よろしければ、レビューを書いていただけませんか。ガイドを探している方にとっても、私のような小さな事業にとっても、大きな助けになります。1分ほど、2〜3行で十分です。',
    google: 'Googleでレビューを書く',
    tripadvisor: 'Tripadvisorでレビューを書く',
    privateAsk: '直接お伝えいただく方がよろしければ（良かった点、改善できる点など）、こちらから。',
    privateCta: 'フィードバックを送る',
    thanks: 'あらためて、ありがとうございました。またヴェネツィアでお会いできますように。',
    once: 'ツアー後にお送りするメールは、これ1通だけです。',
  },
};

export function reviewLinks(app, lang) {
  const tr = R[normLang(lang)];
  return [[app.cfg.reviews.googleUrl, tr.google], [app.cfg.reviews.tripadvisorUrl, tr.tripadvisor]].filter(([url]) => url);
}

export async function sendReviewRequest(app, b) {
  const lang = normLang(b.lang);
  const tr = R[lang];
  const ti = tourText(app, b.tour_slug, lang);
  const links = reviewLinks(app, lang);
  const feedbackUrl = `${app.cfg.baseUrl}/${lang}/feedback/${b.ref}?t=${b.token}`;
  const intro = tr.intro(ti.title, fmtDate(b.date, lang, 'short'));
  const text = [tr.hello(b.name), '', intro, '', tr.ask, '', ...links.map(([url, label]) => `${label}: ${url}`), '', tr.privateAsk, `${tr.privateCta}: ${feedbackUrl}`, '', tr.thanks, app.cfg.site.name, '', tr.once].join('\n');
  const button = (href, label, primary) => html`<p><a href="${href}" style="display:inline-block;${primary ? 'background:#af9168;color:#fff' : 'border:2px solid #af9168;color:#7d6238'};text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${label}</a></p>`;
  return app.mail.send({
    to: b.email,
    subject: tr.subject(app.cfg.site.name),
    text,
    html: String(
      layout(
        app,
        lang,
        html`<p>${tr.hello(b.name)}</p><p>${intro}</p><p>${tr.ask}</p>
        ${links.map(([url, label]) => button(url, label, true))}
        <p style="color:#444">${tr.privateAsk}</p>${button(feedbackUrl, tr.privateCta, links.length === 0)}
        <p style="color:#666;font-size:13px">${tr.thanks} ${app.cfg.site.name}<br>${tr.once}</p>`,
      ),
    ),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

// ───────────── Promemoria la sera prima del tour ─────────────
const RM = {
  it: {
    subject: (title) => `Domani: ${title} a Venezia`,
    intro: 'ti ricordo che domani ci vediamo per il tuo tour. Ecco i dettagli.',
    ref: 'Codice',
    file: 'Pratica',
    tour: 'Servizio',
    date: 'Data',
    time: 'Orario',
    people: 'Partecipanti',
    meeting: 'Punto d’incontro',
    map: 'Apri la mappa',
    know: 'Da sapere',
    contact: 'Se hai un imprevisto o non riesci a trovarmi, scrivimi o chiamami:',
    contactMail: 'Se hai un imprevisto o non riesci a trovarmi, rispondi a questa email.',
    manage: 'Vedi la prenotazione e scarica il voucher',
    bye: 'A domani!',
  },
  en: {
    subject: (title) => `Tomorrow: ${title} in Venice`,
    intro: 'just a reminder that we are meeting tomorrow for your tour. Here are the details.',
    ref: 'Code',
    file: 'File',
    tour: 'Service',
    date: 'Date',
    time: 'Time',
    people: 'Guests',
    meeting: 'Meeting point',
    map: 'Open the map',
    know: 'Good to know',
    contact: 'If anything comes up or you cannot find me, message or call me:',
    contactMail: 'If anything comes up or you cannot find me, just reply to this email.',
    manage: 'See your booking and download the voucher',
    bye: 'See you tomorrow!',
  },
  es: {
    subject: (title) => `Mañana: ${title} en Venecia`,
    intro: 'te recuerdo que mañana nos vemos para tu tour. Aquí tienes los detalles.',
    ref: 'Código',
    file: 'Expediente',
    tour: 'Servicio',
    date: 'Fecha',
    time: 'Hora',
    people: 'Participantes',
    meeting: 'Punto de encuentro',
    map: 'Abrir el mapa',
    know: 'Conviene saber',
    contact: 'Si surge algún imprevisto o no me encuentras, escríbeme o llámame:',
    contactMail: 'Si surge algún imprevisto o no me encuentras, responde a este correo.',
    manage: 'Ver la reserva y descargar el voucher',
    bye: '¡Hasta mañana!',
  },
  ja: {
    subject: (title) => `明日：ヴェネツィアで「${title}」`,
    intro: '明日のツアーのご案内です。詳細は以下のとおりです。',
    ref: '予約番号',
    file: '案件',
    tour: 'サービス',
    date: '日付',
    time: '時間',
    people: '参加者',
    meeting: '集合場所',
    map: '地図を開く',
    know: 'ご参考までに',
    contact: '急なご都合や、集合場所で合流できない場合は、メールまたはお電話でご連絡ください：',
    contactMail: '急なご都合や、集合場所で合流できない場合は、このメールにご返信ください。',
    manage: 'ご予約内容の確認とバウチャーのダウンロード',
    bye: '明日、お会いできるのを楽しみにしております。',
  },
};

/** Come raggiungerti: telefono, WhatsApp ed email del sito (solo quelli impostati). */
const contactParts = (cfg) => [cfg.site.phone, cfg.site.whatsapp ? `WhatsApp https://wa.me/${cfg.site.whatsapp}` : '', cfg.site.email].filter(Boolean);

export async function sendReminder(app, b) {
  const lang = normLang(b.lang);
  const tr = RM[lang];
  const ti = tourText(app, b.tour_slug, lang);
  const manageUrl = b.channel === 'b2b' ? `${app.cfg.baseUrl}/${lang}/b2b/bookings/${b.ref}` : `${app.cfg.baseUrl}/${lang}/booking/${b.ref}?t=${b.token}`; // le agenzie hanno la loro area
  const meet = meetingOf(app.content.tour(b.tour_slug), b, lang);
  const hasDirect = !!(app.cfg.site.phone || app.cfg.site.whatsapp);
  const contacts = contactParts(app.cfg);
  const rows = [
    [tr.tour, ti.title],
    [tr.date, fmtDate(b.date, lang)],
    [tr.time, timeRange(b, lang)],
    [tr.people, `${b.participants}${partyExtra(partyOfBooking(b), lang)}`],
    [tr.meeting, meet.text],
    [tr.ref, b.ref],
    ...(b.client_ref ? [[tr.file, b.client_ref]] : []),
  ];
  const text = [
    greet(lang, b.name),
    '',
    tr.intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    meet.url ? `${tr.map}: ${meet.url}` : null,
    ti.notes ? `${tr.know}: ${ti.notes}` : null,
    '',
    hasDirect ? `${tr.contact} ${contacts.join(' · ')}` : tr.contactMail,
    '',
    `${tr.manage}: ${manageUrl}`,
    '',
    tr.bye,
    app.cfg.site.name,
  ].filter((x) => x !== null).join('\n');
  const button = (href, label) => html`<p><a href="${href}" style="display:inline-block;border:2px solid #af9168;color:#7d6238;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${label}</a></p>`;
  return app.mail.send({
    to: b.email,
    subject: tr.subject(ti.title),
    text,
    html: String(
      layout(
        app,
        lang,
        html`<p>${greet(lang, b.name)}</p><p>${tr.intro}</p>
        <table style="border-collapse:collapse;width:100%;font-size:15px">
          ${rows.map(([k, v]) => html`<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0"><strong>${v}</strong></td></tr>`)}
        </table>
        ${meet.url ? button(meet.url, tr.map) : ''}
        ${ti.notes ? html`<p><strong>${tr.know}.</strong> ${ti.notes}</p>` : ''}
        <p>${hasDirect ? tr.contact : tr.contactMail}${hasDirect ? html`<br><strong>${contacts.join(' · ')}</strong>` : ''}</p>
        ${button(manageUrl, tr.manage)}
        <p style="color:#666;font-size:13px">${tr.bye}<br>${app.cfg.site.name}</p>`,
      ),
    ),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

const PN = {
  it: {
    subject: (ref, when) => `Promemoria: dal ${when} la prenotazione ${ref} non è più cancellabile gratuitamente`,
    intro: (when) => `ti ricordo che la cancellazione gratuita di questa prenotazione termina il ${when}. Da quel momento, se annulli, si applicano le condizioni di rimborso concordate (penale): se qualcosa deve cambiare, fallo entro quel termine.`,
    until: 'Cancellazione gratuita fino a',
    cta: 'Vedi o annulla la prenotazione',
  },
  en: {
    subject: (ref, when) => `Reminder: from ${when} booking ${ref} can no longer be cancelled for free`,
    intro: (when) => `a reminder that free cancellation for this booking ends on ${when}. After that, if you cancel, the agreed refund conditions (cancellation fee) apply: if anything needs to change, do it before then.`,
    until: 'Free cancellation until',
    cta: 'View or cancel the booking',
  },
  es: {
    subject: (ref, when) => `Recordatorio: desde el ${when} la reserva ${ref} ya no se puede cancelar gratis`,
    intro: (when) => `te recuerdo que la cancelación gratuita de esta reserva termina el ${when}. Después, si cancelas, se aplican las condiciones de reembolso acordadas (penalización): si algo tiene que cambiar, hazlo antes.`,
    until: 'Cancelación gratuita hasta',
    cta: 'Ver o cancelar la reserva',
  },
  ja: {
    subject: (ref, when) => `リマインダー：${when}以降、予約 ${ref} は無料でキャンセルできません`,
    intro: (when) => `この予約の無料キャンセルは${when}までです。それ以降にキャンセルされる場合は、合意済みの返金条件（キャンセル料）が適用されます。変更が必要な場合は、それまでにお手続きください。`,
    until: '無料キャンセル期限',
    cta: '予約を確認・キャンセルする',
  },
};

/** All'agenzia: tra poco la cancellazione gratuita finisce e si entra nella penale. */
export async function sendPenaltyReminder(app, b) {
  const lang = normLang(b.lang);
  const tr = T[lang];
  const p = PN[lang];
  const when = fmtInstant(Date.parse(b.free_cancel_until), lang);
  const rows = [[p.until, when], ...summaryRows(app, b, lang)];
  const link = b.channel === 'b2b' ? `${app.cfg.baseUrl}/${lang}/b2b/bookings/${b.ref}` : bookingUrl(app, b, lang);
  return app.mail.send({
    to: b.email,
    subject: p.subject(b.ref, when),
    text: [tr.hello(b.name), '', p.intro(when), '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `${p.cta}: ${link}`, '', tr.contactLine, `${tr.bye} ${app.cfg.site.name}`].join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${tr.hello(b.name)}</p><p>${p.intro(when)}</p>
        <table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map(([k, v]) => html`<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0"><strong>${v}</strong></td></tr>`)}</table>
        <p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${p.cta}</a></p>
        <p style="color:#666;font-size:13px">${tr.contactLine}<br>${tr.bye} ${app.cfg.site.name}</p>`,
      ),
    ),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

export async function notifyGuideFeedback(app, b, fb) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  await app.mail.send({
    to,
    subject: `Feedback ${'★'.repeat(fb.rating)}${'☆'.repeat(5 - fb.rating)} da ${b.name} (${b.ref})`,
    text: [`${app.content.tour(b.tour_slug).i18n.it.title} · ${fmtDate(b.date, 'it')}`, `${b.name} <${b.email}>`, `Valutazione: ${fb.rating}/5`, fb.comment ? `Commento: ${fb.comment}` : null, fb.may_publish ? 'Può essere citato sul sito.' : null, '', `${app.cfg.baseUrl}/admin/feedback`].filter((x) => x !== null).join('\n'),
  });
}

// ───────────── Programmi di più giorni ─────────────
const PG = {
  it: {
    receivedSubject: (ref) => `Richiesta ricevuta ${ref}: programma a Venezia`,
    receivedIntro: 'ho ricevuto la tua richiesta per un programma di più giorni. Ti rispondo con una proposta, di norma entro due giorni lavorativi.',
    proposalSubject: (ref) => `La tua proposta di programma a Venezia (${ref})`,
    proposalIntro: 'ecco la proposta di programma che ho preparato per te.',
    acceptedSubject: (ref) => `Proposta accettata ${ref}: manca solo l’acconto`,
    acceptedIntro: (amount) => `grazie per aver accettato la proposta! Per confermare il programma serve l’acconto di ${amount}.`,
    acceptedNoOnline: 'Ti scrivo a breve con le indicazioni per versarlo.',
    confirmedSubject: (ref) => `Programma confermato ${ref}`,
    confirmedIntro: 'il tuo programma è confermato: le date sono riservate per voi. In allegato trovi il calendario delle giornate.',
    cta: 'Vedi e accetta la proposta',
    pay: 'Paga l’acconto',
    view: 'Apri la pagina del programma',
    total: 'Totale',
    deposit: (p) => `Acconto (${p}%)`,
    valid: 'Valida fino al',
    participants: 'Persone',
    dates: 'Date',
    flexible: 'flessibili',
    tbd: 'da definire',
    sign: 'A presto,',
    reply: 'Per qualsiasi cosa rispondi a questa email.',
  },
  en: {
    receivedSubject: (ref) => `Request received ${ref}: Venice programme`,
    receivedIntro: 'I have received your request for a multi-day programme. I will reply with a proposal, usually within two business days.',
    proposalSubject: (ref) => `Your Venice programme proposal (${ref})`,
    proposalIntro: 'here is the programme proposal I have prepared for you.',
    acceptedSubject: (ref) => `Proposal accepted ${ref}: only the deposit is missing`,
    acceptedIntro: (amount) => `thank you for accepting the proposal! To confirm the programme a deposit of ${amount} is needed.`,
    acceptedNoOnline: 'I will write shortly with the instructions to pay it.',
    confirmedSubject: (ref) => `Programme confirmed ${ref}`,
    confirmedIntro: 'your programme is confirmed: the dates are reserved for you. The attached file adds the days to your calendar.',
    cta: 'View and accept the proposal',
    pay: 'Pay the deposit',
    view: 'Open the programme page',
    total: 'Total',
    deposit: (p) => `Deposit (${p}%)`,
    valid: 'Valid until',
    participants: 'Guests',
    dates: 'Dates',
    flexible: 'flexible',
    tbd: 'to be defined',
    sign: 'See you soon,',
    reply: 'Just reply to this email for anything.',
  },
  es: {
    receivedSubject: (ref) => `Solicitud recibida ${ref}: programa en Venecia`,
    receivedIntro: 'he recibido tu solicitud de un programa de varios días. Te responderé con una propuesta, normalmente en un plazo de dos días hábiles.',
    proposalSubject: (ref) => `Tu propuesta de programa en Venecia (${ref})`,
    proposalIntro: 'aquí tienes la propuesta de programa que he preparado para ti.',
    acceptedSubject: (ref) => `Propuesta aceptada ${ref}: solo falta el anticipo`,
    acceptedIntro: (amount) => `¡gracias por aceptar la propuesta! Para confirmar el programa hace falta un anticipo de ${amount}.`,
    acceptedNoOnline: 'Te escribiré en breve con las indicaciones para abonarlo.',
    confirmedSubject: (ref) => `Programa confirmado ${ref}`,
    confirmedIntro: 'tu programa está confirmado: las fechas quedan reservadas para ti y tu grupo. El archivo adjunto añade los días a tu calendario.',
    cta: 'Consulta y acepta la propuesta',
    pay: 'Paga el anticipo',
    view: 'Abre la página del programa',
    total: 'Total',
    deposit: (p) => `Anticipo (${p}%)`,
    valid: 'Válida hasta el',
    participants: 'Personas',
    dates: 'Fechas',
    flexible: 'flexibles',
    tbd: 'por definir',
    sign: 'Hasta pronto,',
    reply: 'Para cualquier cosa, responde a este correo.',
  },
  ja: {
    receivedSubject: (ref) => `リクエストを受け付けました ${ref}：ヴェネツィアのプログラム`,
    receivedIntro: '複数日プログラムのご依頼を受け付けました。通常2営業日以内に、ご提案をお送りします。',
    proposalSubject: (ref) => `ヴェネツィアのプログラムのご提案（${ref}）`,
    proposalIntro: 'ご依頼をもとに作成した、プログラムのご提案をお送りします。',
    acceptedSubject: (ref) => `ご提案を承諾いただきました ${ref}：あとは手付金のみです`,
    acceptedIntro: (amount) => `ご提案を承諾いただき、ありがとうございます。プログラムを確定するには、${amount}の手付金が必要です。`,
    acceptedNoOnline: 'お支払い方法について、まもなくご連絡します。',
    confirmedSubject: (ref) => `プログラム確定 ${ref}`,
    confirmedIntro: 'プログラムが確定しました。日程はお客様のために確保されています。各日のカレンダーを添付しました。',
    cta: 'ご提案を見て承諾する',
    pay: '手付金を支払う',
    view: 'プログラムのページを開く',
    total: '合計',
    deposit: (p) => `手付金（${p}%）`,
    valid: '有効期限',
    participants: '人数',
    dates: '日程',
    flexible: '調整可能',
    tbd: '未定',
    sign: 'どうぞよろしくお願いいたします。',
    reply: 'ご不明な点は、このメールにご返信ください。',
  },
};

export const programUrl = (app, p, lang = normLang(p.lang)) => `${app.cfg.baseUrl}/${lang}/programs/${p.ref}?t=${p.token}`;

function datesLabel(p, lang) {
  const tr = PG[lang];
  if (p.date_from) return `${fmtDate(p.date_from, lang, 'short')}${p.date_to ? ' → ' + fmtDate(p.date_to, lang, 'short') : ''}${p.flexible_dates ? ` (${tr.flexible})` : ''}`;
  return p.flexible_dates ? tr.flexible : tr.tbd;
}

function programDaysRows(app, p, lang) {
  return app.db.prepare('SELECT * FROM program_days WHERE program_id = ? ORDER BY date, start_time, position').all(p.id).map((d) => ({ ...d, label: `${fmtDate(d.date, lang, 'weekday')} · ${d.start_time}–${d.end_time}` }));
}

export function programIcs(app, p, lang = normLang(p.lang)) {
  const days = programDaysRows(app, p, lang);
  const host = new URL(app.cfg.baseUrl).hostname;
  return calendar(`${app.cfg.site.name} — ${p.proposal_title ?? p.ref}`, days.map((d) => eventLines({ uid: `${p.ref}-${d.id}@${host}`, date: d.date, start: d.start_time, end: d.end_time, summary: `${p.proposal_title ?? pick({ it: 'Venezia', en: 'Venice', es: 'Venecia', ja: 'ヴェネツィア' }, lang)}: ${d.title}`, description: d.description ?? '', url: programUrl(app, p, lang) })));
}

const proposalAttachments = (app, p, lang) => pdfAttachment(`proposta-${p.ref}.pdf`, (pdf) => pdf.renderProposalPdf(app, p, lang), 'proposta');

function programBody(app, p, lang, intro, { days = false, buttons = [] } = {}) {
  const tr = PG[lang];
  const t = makeT(lang);
  const interests = p.interests ? JSON.parse(p.interests).map((k) => t(`pg.int.${k}`)).join(', ') : '';
  const rows = [[tr.dates, datesLabel(p, lang)], [tr.participants, String(p.participants)], interests ? [t('pg.f.interests'), interests] : null].filter(Boolean);
  const dayRows = days ? programDaysRows(app, p, lang) : [];
  return html`<p>${greet(lang, p.name)}</p><p>${intro}</p>
    <table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map(([k, v]) => html`<tr><td style="padding:5px 12px 5px 0;color:#666;vertical-align:top">${k}</td><td style="padding:5px 0"><strong>${v}</strong></td></tr>`)}</table>
    ${dayRows.length
      ? html`<table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:14px">${dayRows.map((d) => html`<tr style="border-top:1px solid #eee"><td style="padding:8px 10px 8px 0;vertical-align:top;white-space:nowrap;color:#666">${d.label}</td><td style="padding:8px 0"><strong>${d.title}</strong>${d.description ? html`<br><span style="color:#555">${d.description}</span>` : ''}</td><td style="padding:8px 0 8px 10px;text-align:right;white-space:nowrap">${d.price_cents ? formatMoney(d.price_cents, lang, p.currency) : ''}</td></tr>`)}</table>
      <p style="font-size:16px"><strong>${tr.total}: ${formatMoney(p.total_cents, lang, p.currency)}</strong>${p.deposit_cents ? html`<br>${tr.deposit(p.deposit_percent)}: ${formatMoney(p.deposit_cents, lang, p.currency)}` : ''}${p.valid_until ? html`<br><span style="color:#666">${tr.valid} ${fmtDate(p.valid_until, lang, 'date')}</span>` : ''}</p>`
      : ''}
    ${buttons.map(([href, label]) => html`<p><a href="${href}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${label}</a></p>`)}
    <p style="color:#666;font-size:13px">${tr.reply}<br>${tr.sign} ${app.cfg.site.name}</p>`;
}

function programText(app, p, lang, intro, { days = false, links = [] } = {}) {
  const tr = PG[lang];
  const lines = [greet(lang, p.name), '', intro, '', `${tr.dates}: ${datesLabel(p, lang)}`, `${tr.participants}: ${p.participants}`];
  if (days) {
    lines.push('');
    for (const d of programDaysRows(app, p, lang)) lines.push(`${d.label} — ${d.title}${d.price_cents ? ` (${formatMoney(d.price_cents, lang, p.currency)})` : ''}`);
    lines.push('', `${tr.total}: ${formatMoney(p.total_cents, lang, p.currency)}`);
    if (p.deposit_cents) lines.push(`${tr.deposit(p.deposit_percent)}: ${formatMoney(p.deposit_cents, lang, p.currency)}`);
    if (p.valid_until) lines.push(`${tr.valid} ${fmtDate(p.valid_until, lang, 'date')}`);
  }
  lines.push('', ...links.map(([url, label]) => `${label}: ${url}`), '', tr.reply, `${tr.sign} ${app.cfg.site.name}`);
  return lines.join('\n');
}

export async function sendProgramReceived(app, p) {
  const lang = normLang(p.lang);
  const tr = PG[lang];
  await app.mail.send({
    to: p.email,
    subject: tr.receivedSubject(p.ref),
    text: programText(app, p, lang, tr.receivedIntro, { links: [[programUrl(app, p), tr.view]] }),
    html: String(layout(app, lang, programBody(app, p, lang, tr.receivedIntro, { buttons: [[programUrl(app, p), tr.view]] }))),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

export async function sendProposalEmail(app, p) {
  const lang = normLang(p.lang);
  const tr = PG[lang];
  return app.mail.send({
    to: p.email,
    subject: tr.proposalSubject(p.ref),
    text: programText(app, p, lang, tr.proposalIntro, { days: true, links: [[programUrl(app, p), tr.cta]] }),
    html: String(layout(app, lang, programBody(app, p, lang, tr.proposalIntro, { days: true, buttons: [[programUrl(app, p), tr.cta]] }))),
    attachments: await proposalAttachments(app, p, lang),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

export async function sendProgramAccepted(app, p) {
  const lang = normLang(p.lang);
  const tr = PG[lang];
  const online = app.payments.live || app.payments.demo;
  const intro = `${tr.acceptedIntro(formatMoney(p.deposit_cents, lang, p.currency))}${online ? '' : ' ' + tr.acceptedNoOnline}`;
  const link = online ? `${app.cfg.baseUrl}/pay/resume/${p.ref}?t=${p.token}&lang=${lang}` : programUrl(app, p);
  await app.mail.send({
    to: p.email,
    subject: tr.acceptedSubject(p.ref),
    text: programText(app, p, lang, intro, { links: [[link, online ? tr.pay : tr.view]] }),
    html: String(layout(app, lang, programBody(app, p, lang, intro, { buttons: [[link, online ? tr.pay : tr.view]] }))),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

export async function sendProgramConfirmed(app, p) {
  const lang = normLang(p.lang);
  const tr = PG[lang];
  await app.mail.send({
    to: p.email,
    subject: tr.confirmedSubject(p.ref),
    text: programText(app, p, lang, tr.confirmedIntro, { days: true, links: [[programUrl(app, p), tr.view]] }),
    html: String(layout(app, lang, programBody(app, p, lang, tr.confirmedIntro, { days: true, buttons: [[programUrl(app, p), tr.view]] }))),
    attachments: [{ filename: `${p.ref}.ics`, content: programIcs(app, p, lang), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** Avvisi alla guida (in italiano). kind: new | accepted | confirmed | deposit | message | declined */
export async function notifyGuideProgram(app, p, kind, text = '') {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const label = { new: 'Nuova richiesta di programma', accepted: 'Proposta accettata (manca l’acconto)', confirmed: 'Programma confermato', deposit: 'Acconto incassato: programma confermato', message: 'Messaggio del cliente sul programma', declined: 'Proposta rifiutata' }[kind];
  const t = makeT('it');
  const interests = p.interests ? JSON.parse(p.interests).map((k) => t(`pg.int.${k}`)).join(', ') : '';
  const lines = [
    `${label} ${p.ref}${p.channel === 'b2b' ? ' (B2B)' : ''}`,
    `${p.name} <${p.email}>${p.phone ? ' · ' + p.phone : ''}${p.company ? ' · ' + p.company : ''}`,
    `Date: ${datesLabel(p, 'it')} · ${p.participants} persone${p.group_type ? ' · ' + t(`pg.group.${p.group_type}`) : ''}`,
    interests ? `Interessi: ${interests}` : null,
    p.budget ? `Budget: ${t(`pg.budget.${p.budget}`)}` : null,
    p.total_cents ? `Totale proposta: ${formatMoney(p.total_cents, 'it', p.currency)}${p.deposit_cents ? ` · acconto ${formatMoney(p.deposit_cents, 'it', p.currency)}` : ''}` : null,
    kind === 'new' && p.message ? `Messaggio: ${p.message}` : null,
    text ? `Messaggio: ${text}` : null,
    '',
    `${app.cfg.baseUrl}/admin/programs/${p.id}`,
  ].filter((x) => x !== null);
  await app.mail.send({ to, subject: `${label}: ${p.name} (${p.ref})`, text: lines.join('\n'), replyTo: kind === 'message' || kind === 'new' ? p.email : undefined });
}

// ───────────── Fatture ─────────────
/** Manda all'intestatario la copia di cortesia (PDF) di una fattura emessa, con l'XML se richiesto. @returns {Promise<boolean>} */
export async function sendInvoiceCopy(app, inv, to, { includeXml = false } = {}) {
  const buyer = JSON.parse(inv.buyer_json);
  const lang = normLang(buyer.lang);
  const t = makeT(lang);
  const kind = t(inv.doc_type === 'TD04' ? 'inv.mail.kindCredit' : 'inv.mail.kindInvoice');
  const Kind = kind.charAt(0).toUpperCase() + kind.slice(1);
  const name = buyer.kind === 'person' ? buyer.firstName : buyer.name;
  const intro = t('inv.mail.intro', { kind, number: inv.number, date: fmtDate(inv.issue_date, lang, 'date'), total: formatMoney(inv.total_cents, lang, inv.currency) });
  const attachments = await pdfAttachment(`${inv.doc_type === 'TD04' ? 'nota-di-credito' : 'fattura'}-${String(inv.number).replace('/', '-')}.pdf`, (pdf) => pdf.renderInvoicePdf(app, inv), 'fattura', './pdf-invoice.js');
  if (includeXml && inv.xml) attachments.push({ filename: inv.file_name, content: inv.xml, contentType: 'application/xml' });
  const hello = greet(lang, name);
  const sign = `${bye(lang)} ${app.cfg.site.name}`;
  // da pagare: come (IBAN, causale, scadenza) e il link alla pagina di pagamento (anche con carta)
  const payable = inv.doc_type === 'TD01' && isPayable(inv) && invoiceDue(inv) > 0;
  const pay = payable ? ensurePayRef(app.db, inv) : null;
  const rows = pay ? payRows(app, pay, lang) : [];
  const link = pay ? invoicePayUrl(app, pay, lang) : '';
  return app.mail.send({
    to,
    subject: t('inv.mail.subject', { kind: Kind, number: inv.number, name: app.cfg.site.name }),
    text: [hello, '', intro, includeXml ? t('inv.mail.xml') : '', ...(rows.length ? ['', t('invpay.how'), ...rows.map(([k, v]) => `${k}: ${v}`), `${t('invpay.payOrCard')}: ${link}`] : []), '', sign].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${hello}</p><p>${intro}${includeXml ? html` ${t('inv.mail.xml')}` : ''}</p>
        ${rows.length ? html`<p><strong>${t('invpay.how')}</strong></p>${payTable(rows)}<p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('invpay.payOrCard')}</a></p>` : ''}
        <p style="color:#666;font-size:13px">${sign}</p>`,
      ),
    ),
    attachments,
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

// ───────────── Pagamento delle fatture: come pagare, solleciti, incasso ─────────────
/** «Come pagare» in righe: importo, scadenza, intestatario, IBAN, banca e causale (solo ciò che c'è). */
function payRows(app, inv, lang) {
  const t = makeT(lang);
  const p = payInstructions(app, inv);
  return [
    [t('invpay.amount'), formatMoney(p.amountCents, lang, inv.currency)],
    p.dueDate ? [t('invpay.dueBy'), fmtDate(p.dueDate, lang, 'date')] : null,
    p.iban ? [t('invpay.beneficiary'), p.beneficiary] : null,
    p.iban ? [t('invpay.iban'), p.iban] : null,
    p.iban && p.bank ? [t('invpay.bank'), p.bank] : null,
    p.iban ? [t('invpay.reference'), p.reference] : null,
  ].filter(Boolean);
}
const payTable = (rows) => html`<table style="border-collapse:collapse;font-size:15px">${rows.map(([k, v]) => html`<tr><td style="padding:5px 14px 5px 0;color:#666;vertical-align:top">${k}</td><td style="padding:5px 0"><strong>${v}</strong></td></tr>`)}</table>`;

/** La riga sul pagamento nella conferma di una prenotazione a fattura: quando e come si paga. Vuota se non c'è nulla da dire. */
export function invoiceNote(app, b, lang) {
  if (b.channel !== 'b2b' || b.payment_method !== 'invoice' || b.payment_status === 'paid' || b.status !== 'confirmed') return '';
  const t = makeT(lang);
  const days = Number(app.cfg.invoice.b2bDueDays) || 0;
  const iban = app.cfg.invoice.iban ? t('invpay.ibanPart', { iban: groupIban(app.cfg.invoice.iban) }) : '';
  return t('invpay.bookingNote', { when: days > 0 ? t('invpay.within', { days }) : t('invpay.onInvoiceDate'), iban });
}

/** All'agenzia: la fattura è scaduta e non risulta incassata (il sollecito). Con la fattura in allegato, IBAN, causale e il link per pagare. */
export async function sendInvoiceOverdue(app, inv, { to, lang: l }) {
  const lang = normLang(l);
  const t = makeT(lang);
  const tr = T[lang];
  const pay = ensurePayRef(app.db, inv);
  const p = payInstructions(app, pay);
  const link = invoicePayUrl(app, pay, lang);
  const rows = payRows(app, pay, lang);
  const intro = t('invpay.mail.overdueIntro', { number: inv.number, amount: formatMoney(p.amountCents, lang, inv.currency), date: p.dueDate ? fmtDate(p.dueDate, lang, 'date') : '' });
  const attachments = await pdfAttachment(`fattura-${String(inv.number).replace('/', '-')}.pdf`, (pdf) => pdf.renderInvoicePdf(app, pay), 'fattura', './pdf-invoice.js');
  const name = JSON.parse(inv.buyer_json);
  const hello = greet(lang, name.kind === 'person' ? name.firstName : name.name);
  const sign = `${bye(lang)} ${app.cfg.site.name}`;
  return app.mail.send({
    to,
    subject: t('invpay.mail.overdueSubject', { number: inv.number, date: p.dueDate ? fmtDate(p.dueDate, lang, 'date') : '' }),
    text: [hello, '', intro, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `${t('invpay.payOrCard')}: ${link}`, '', tr.contactLine, sign].join('\n'),
    html: String(layout(app, lang, html`<p>${hello}</p><p>${intro}</p>${payTable(rows)}<p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('invpay.payOrCard')}</a></p><p style="color:#666;font-size:13px">${tr.contactLine}<br>${sign}</p>`)),
    attachments,
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** All'agenzia: pagamento ricevuto (con la carta, o segnato dalla guida quando arriva il bonifico). */
export async function sendInvoicePaid(app, inv, { to, lang: l, amountCents }) {
  const lang = normLang(l);
  const t = makeT(lang);
  const tr = T[lang];
  const intro = t('invpay.mail.paidIntro', { number: inv.number, amount: formatMoney(amountCents, lang, inv.currency) });
  const link = invoicePayUrl(app, ensurePayRef(app.db, inv), lang);
  const buyer = JSON.parse(inv.buyer_json);
  const hello = greet(lang, buyer.kind === 'person' ? buyer.firstName : buyer.name);
  const sign = `${bye(lang)} ${app.cfg.site.name}`;
  return app.mail.send({
    to,
    subject: t('invpay.mail.paidSubject', { number: inv.number }),
    text: [hello, '', intro, '', `${t('invpay.openInvoice')}: ${link}`, '', sign].join('\n'),
    html: String(layout(app, lang, html`<p>${hello}</p><p>${intro}</p><p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('invpay.openInvoice')}</a></p><p style="color:#666;font-size:13px">${tr.contactLine}<br>${sign}</p>`)),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** Avviso alla guida (in italiano) sulle fatture: sollecito mandato, pagamento con carta ricevuto. */
export async function notifyGuideInvoice(app, inv, kind, extra = '') {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const buyer = JSON.parse(inv.buyer_json);
  const who = buyer.name || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'cliente';
  const label = { overdue: 'Fattura scaduta: sollecito inviato', paid: 'Fattura pagata con carta' }[kind];
  const lines = [`${label} ${inv.number} — ${who}`, extra || null, '', `${app.cfg.baseUrl}/admin/invoices/${inv.id}`].filter((x) => x !== null);
  await app.mail.send({ to, subject: `${label}: ${inv.number} — ${who}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}


// ───────────── Modifiche dell'agenzia e richieste di proroga ─────────────
const changeLine = (app, b, lang) => `${bookingPeople(b, lang, { noun: guestWord(lang) })} · ${fmtDate(b.date, lang, 'short')} · ${timeRange(b, lang)} · ${formatMoney(bookingDue(b), lang, b.currency)}`;

/** All'agenzia: la prenotazione (o l'opzione) è stata modificata. Per una prenotazione confermata ci sono il nuovo voucher e il calendario aggiornato. */
export async function sendBookingChanged(app, before, after, nowMs = Date.now(), { note = '', refundCents = 0 } = {}) {
  const lang = normLang(after.lang);
  const t = makeT(lang);
  const tr = T[lang];
  const isOption = after.status === 'option';
  const title = tourText(app, after.tour_slug, lang).title;
  const until = isOption && after.option_expires_at ? fmtInstant(Date.parse(after.option_expires_at), lang) : '';
  const subject = t(isOption ? 'chg.mail.optionSubject' : 'chg.mail.subject', { ref: after.ref, title, date: fmtDate(after.date, lang, 'short') });
  const intro = isOption ? t('chg.mail.optionIntro', { until }) : t('chg.mail.intro');
  const was = t('chg.mail.was', { what: changeLine(app, before, lang) });
  const now = t('chg.mail.now', { what: changeLine(app, after, lang) });
  const extra = [note ? `«${note}»` : '', refundCents > 0 ? t('chg.mail.refund', { amount: formatMoney(refundCents, lang, after.currency) }) : ''].filter(Boolean); // il messaggio della guida e, se serve, il rimborso
  const link = bookingUrl(app, after, lang);
  const rows = summaryRows(app, after, lang, { option: isOption });
  const attachments =
    after.status === 'confirmed'
      ? [{ filename: `${after.ref}.ics`, content: icsFor(app, after, lang), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }, ...(await pdfAttachment(`voucher-${after.ref}.pdf`, (pdf) => pdf.renderVoucherPdf(app, after, { lang, nowMs }), 'voucher'))]
      : [];
  return app.mail.send({
    to: after.email,
    subject,
    text: [tr.hello(after.name), '', intro, '', was, now, '', ...extra.flatMap((x) => [x, '']), ...rows.map(([k, v]) => `${k}: ${v}`), '', `${tr.manage}: ${link}`, '', tr.contactLine, `${tr.bye} ${app.cfg.site.name}`].join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${tr.hello(after.name)}</p><p>${intro}</p>
        <p style="font-size:14px;color:#666">${was}<br><strong style="color:#1c1c1c">${now}</strong></p>
        ${extra.map((x) => html`<p>${x}</p>`)}
        <table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map(([k, v]) => html`<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0"><strong>${v}</strong></td></tr>`)}</table>
        <p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${tr.manage}</a></p>
        <p style="color:#666;font-size:13px">${tr.contactLine}<br>${tr.bye} ${app.cfg.site.name}</p>`,
      ),
    ),
    attachments,
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** Avviso alla guida (in italiano): l'agenzia ha cambiato persone, data od ore di una prenotazione o di un'opzione. */
export async function notifyGuideBookingChanged(app, before, after) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const tour = app.content.tour(after.tour_slug);
  const account = after.account_id ? app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(after.account_id) : null;
  const money = (c) => formatMoney(c, 'it', after.currency);
  const lines = [
    `${after.status === 'option' ? 'Opzione modificata' : 'Prenotazione modificata'} dall’agenzia ${after.ref}${account ? ` — ${account.company}` : ''}`,
    tour?.i18n.it.title ?? after.tour_slug,
    `Prima: ${bookingPeopleShort(before)} · ${fmtDate(before.date, 'it')} ${before.start_time}–${before.end_time} · ${money(bookingDue(before))}`,
    `Ora:   ${bookingPeopleShort(after)} · ${fmtDate(after.date, 'it')} ${after.start_time}–${after.end_time} · ${money(bookingDue(after))}`,
    after.client_ref ? `Rif. pratica: ${after.client_ref}` : null,
    after.status === 'option' ? `Trattenuta fino al ${fmtInstant(Date.parse(after.option_expires_at), 'it')}.` : null,
    '',
    `${app.cfg.baseUrl}/admin/bookings/${after.id}`,
  ].filter((x) => x !== null);
  await app.mail.send({ to, subject: `${after.status === 'option' ? 'Opzione modificata' : 'Prenotazione modificata'}: ${tour?.i18n.it.title ?? after.tour_slug} — ${after.date} ${after.start_time}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

/** Avviso alla guida (in italiano): l'agenzia chiede più tempo per un'opzione. */
export async function notifyGuideExtensionRequest(app, b, request) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const tour = app.content.tour(b.tour_slug);
  const account = b.account_id ? app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(b.account_id) : null;
  const lines = [
    `Richiesta di proroga${request.group_id ? ' (pacchetto)' : ''} ${b.ref}${account ? ` — ${account.company}` : ''}`,
    `${tour?.i18n.it.title ?? b.tour_slug} · ${fmtDate(b.date, 'it')} ${b.start_time}`,
    `Chiede ${request.days} ${request.days === 1 ? 'giorno' : 'giorni'} in più; l’opzione scade il ${fmtInstant(Date.parse(b.option_expires_at), 'it')}.`,
    request.note ? `Motivo: ${request.note}` : null,
    b.client_ref ? `Rif. pratica: ${b.client_ref}` : null,
    '',
    `Approva o rifiuta dalla scheda: ${app.cfg.baseUrl}/admin/bookings/${b.id}`,
  ].filter((x) => x !== null);
  await app.mail.send({ to, subject: `Richiesta di proroga: ${tour?.i18n.it.title ?? b.tour_slug} — ${b.date} ${b.start_time}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

/** All'agenzia: la proroga dell'opzione non è stata concessa (quella concessa è l'email «Opzione prorogata»). */
export async function sendExtensionDenied(app, b) {
  const lang = normLang(b.lang);
  const t = makeT(lang);
  const tr = T[lang];
  const until = fmtInstant(Date.parse(b.option_expires_at), lang);
  const intro = t('chg.mail.deniedIntro', { until });
  const link = b.group_id ? packageUrl(app, app.db.prepare('SELECT * FROM booking_groups WHERE id = ?').get(b.group_id), lang) : bookingUrl(app, b, lang);
  const cta = t('chg.mail.deniedCta');
  await app.mail.send({
    to: b.email,
    subject: t('chg.mail.deniedSubject', { ref: b.group_id ? app.db.prepare('SELECT ref FROM booking_groups WHERE id = ?').get(b.group_id).ref : b.ref }),
    text: [tr.hello(b.name), '', intro, '', `${cta}: ${link}`, '', tr.contactLine, `${tr.bye} ${app.cfg.site.name}`].join('\n'),
    html: String(layout(app, lang, html`<p>${tr.hello(b.name)}</p><p>${intro}</p><p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${cta}</a></p><p style="color:#666;font-size:13px">${tr.contactLine}<br>${tr.bye} ${app.cfg.site.name}</p>`)),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

// ───────────── Pacchetti (più servizi prenotati insieme da un'agenzia) ─────────────
export const packageUrl = (app, group, lang = normLang(group.lang)) => `${app.cfg.baseUrl}/${lang}/packages/${group.ref}?t=${group.token}`;

/** Un solo file di calendario con tutti i servizi confermati del pacchetto. */
export function icsForPackage(app, group, bookings, lang = normLang(group.lang)) {
  const host = new URL(app.cfg.baseUrl).hostname;
  return calendar(
    `${app.cfg.site.name} — ${group.ref}`,
    bookings
      .filter((b) => b.status === 'confirmed')
      .map((b) =>
        eventLines({
          uid: `${b.ref}@${host}`,
          date: b.date,
          start: b.start_time,
          end: b.end_time,
          summary: `${tourText(app, b.tour_slug, lang).title} (${app.cfg.site.name})`,
          description: `${group.ref} · ${b.ref} — ${bookingPeople(b, lang, { noun: guestWord(lang) })}`,
          location: meetingOf(app.content.tour(b.tour_slug), b, lang).text,
          url: packageUrl(app, group, lang),
        }),
      ),
  );
}

/** Il corpo comune delle email sul pacchetto: saluto, testo, elenco dei servizi (con il prezzo di ciascuno e il totale) e un pulsante. */
async function sendPackageMail(app, group, bookings, { subject, intro, until = null, cta = 'pkg.mail.cta', policy = false, note = '', attachments = [], nowMs = Date.now() }) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const shown = bookings.filter((b) => ['confirmed', 'held', 'option'].includes(b.status));
  const money = (c) => formatMoney(c, lang, group.currency);
  const rows = shown.map((b) => ({
    when: `${fmtDate(b.date, lang, 'short')} · ${timeRange(b, lang)}`,
    what: `${tourText(app, b.tour_slug, lang).title} · ${bookingPeople(b, lang, { noun: guestWord(lang) })}`,
    price: money(bookingDue(b)),
    note: policy ? policyLine(b, lang, nowMs) : '',
  }));
  const total = money(shown.reduce((s, b) => s + bookingDue(b), 0));
  const link = packageUrl(app, group, lang);
  const text = [
    greet(lang, group.name),
    '',
    intro,
    '',
    ...(until ? [`${t('pkg.mail.until')}: ${until}`, ''] : []),
    ...rows.flatMap((r) => [`${r.when} — ${r.what} — ${r.price}`, ...(r.note ? [`   ${r.note}`] : [])]),
    `${t('pkg.mail.total')}: ${total}`,
    ...(group.client_ref ? [`${T[lang].clientRef}: ${group.client_ref}`] : []),
    ...(note ? ['', note] : []),
    '',
    `${t(cta)}: ${link}`,
    '',
    T[lang].contactLine,
    `${bye(lang)} ${app.cfg.site.name}`,
  ].join('\n');
  await app.mail.send({
    to: group.email,
    subject,
    text,
    html: String(
      layout(
        app,
        lang,
        html`<p>${greet(lang, group.name)}</p><p>${intro}</p>
        ${until ? html`<p><strong>${t('pkg.mail.until')}: ${until}</strong></p>` : ''}
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          ${rows.map((r) => html`<tr><td style="padding:6px 10px 6px 0;vertical-align:top;border-bottom:1px solid #eee"><strong>${r.when}</strong></td><td style="padding:6px 10px 6px 0;vertical-align:top;border-bottom:1px solid #eee">${r.what}${r.note ? html`<br><small style="color:#666">${r.note}</small>` : ''}</td><td style="padding:6px 0;vertical-align:top;text-align:right;border-bottom:1px solid #eee">${r.price}</td></tr>`)}
          <tr><td colspan="2" style="padding:8px 10px 0 0;text-align:right"><strong>${t('pkg.mail.total')}</strong></td><td style="padding:8px 0 0;text-align:right"><strong>${total}</strong></td></tr>
        </table>
        ${group.client_ref ? html`<p style="font-size:13px;color:#666">${T[lang].clientRef}: ${group.client_ref}</p>` : ''}
        ${note ? html`<p style="font-size:14px;color:#444">${note}</p>` : ''}
        <p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t(cta)}</a></p>
        <p style="color:#666;font-size:13px">${T[lang].contactLine}<br>${bye(lang)} ${app.cfg.site.name}</p>`,
      ),
    ),
    attachments,
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

const untilGroup = (bookings, lang) => {
  const ends = bookings.filter((b) => b.option_expires_at).map((b) => Date.parse(b.option_expires_at));
  return ends.length ? fmtInstant(Math.min(...ends), lang) : '';
};

/** All'agenzia: il pacchetto è confermato; un voucher per ogni servizio e un solo file per il calendario. */
export async function sendPackageConfirmed(app, group, bookings, nowMs = Date.now()) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const vouchers = [];
  for (const b of confirmed) vouchers.push(...(await pdfAttachment(`voucher-${b.ref}.pdf`, (pdf) => pdf.renderVoucherPdf(app, b, { lang, nowMs }), 'voucher')));
  await sendPackageMail(app, group, confirmed, {
    subject: t('pkg.mail.confirmedSubject', { ref: group.ref, n: confirmed.length }),
    intro: t('pkg.mail.confirmedIntro'),
    policy: true,
    note: confirmed[0] ? invoiceNote(app, confirmed[0], lang) : '',
    nowMs,
    attachments: [{ filename: `${group.ref}.ics`, content: icsForPackage(app, group, confirmed, lang), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }, ...vouchers],
  });
}

/** All'agenzia: il pacchetto è in opzione, con la scadenza comune a tutti i servizi. */
export async function sendPackageOptionCreated(app, group, bookings) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const until = untilGroup(bookings, lang);
  await sendPackageMail(app, group, bookings, { subject: t('pkg.mail.optionSubject', { ref: group.ref, n: bookings.length }), intro: t('pkg.mail.optionIntro', { until }), until, cta: 'pkg.mail.ctaOption' });
}

/** All'agenzia: l'opzione del pacchetto sta per scadere. */
export async function sendPackageOptionReminder(app, group, bookings) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const until = untilGroup(bookings, lang);
  await sendPackageMail(app, group, bookings, { subject: t('pkg.mail.reminderSubject', { ref: group.ref, until }), intro: t('pkg.mail.reminderIntro', { until }), until, cta: 'pkg.mail.ctaOption' });
}

/** All'agenzia: l'opzione del pacchetto è scaduta e le date sono libere. */
export async function sendPackageOptionExpired(app, group, bookings) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const until = untilGroup(bookings, lang);
  await sendPackageMail(app, group, bookings.map((b) => ({ ...b, status: 'option' })), { subject: t('pkg.mail.expiredSubject', { ref: group.ref }), intro: t('pkg.mail.expiredIntro', { until }) });
}

/** All'agenzia: la guida ha prolungato l'opzione di tutto il pacchetto. */
export async function sendPackageOptionExtended(app, group, bookings) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const until = untilGroup(bookings, lang);
  await sendPackageMail(app, group, bookings, { subject: t('pkg.mail.extendedSubject', { ref: group.ref }), intro: t('pkg.mail.extendedIntro', { until }), until, cta: 'pkg.mail.ctaOption' });
}

/** All'agenzia: i servizi annullati del pacchetto, con rimborso o penale di ciascuno. */
export async function sendPackageCancelled(app, group, results) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const money = (c) => formatMoney(c, lang, group.currency);
  const lines = results.map((r) => {
    const b = r.booking;
    const outcome = r.refundCents ? t('pkg.mail.lineRefund', { amount: money(r.refundCents) }) : b.retained_cents > 0 ? (b.payment_status === 'unpaid' ? t('pkg.mail.linePenalty', { amount: money(b.retained_cents) }) : t('pkg.mail.lineKept', { amount: money(b.retained_cents) })) : t('pkg.mail.lineNone');
    return `${fmtDate(b.date, lang, 'short')} · ${b.start_time} — ${tourText(app, b.tour_slug, lang).title}: ${outcome}`;
  });
  const link = packageUrl(app, group, lang);
  const intro = t('pkg.mail.cancelledIntro', { n: results.length });
  await app.mail.send({
    to: group.email,
    subject: t('pkg.mail.cancelledSubject', { ref: group.ref }),
    text: [greet(lang, group.name), '', intro, '', ...lines, '', `${t('pkg.mail.cta')}: ${link}`, '', T[lang].contactLine, `${bye(lang)} ${app.cfg.site.name}`].join('\n'),
    html: String(layout(app, lang, html`<p>${greet(lang, group.name)}</p><p>${intro}</p><ul>${lines.map((l) => html`<li>${l}</li>`)}</ul><p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('pkg.mail.cta')}</a></p><p style="color:#666;font-size:13px">${T[lang].contactLine}<br>${bye(lang)} ${app.cfg.site.name}</p>`)),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** All'agenzia: ha pagato dopo la scadenza e un servizio non era più libero; il pacchetto non si conferma a metà e si rimborsa tutto. */
export async function sendPackageSlotLost(app, group, bookings) {
  const lang = normLang(group.lang);
  const t = makeT(lang);
  const body = t('pkg.mail.lostBody');
  await app.mail.send({
    to: group.email,
    subject: t('pkg.mail.lostSubject', { ref: group.ref }),
    text: [greet(lang, group.name), '', body, '', `${bye(lang)} ${app.cfg.site.name}`].join('\n'),
    html: String(layout(app, lang, html`<p>${greet(lang, group.name)}</p><p>${body}</p><p>${bye(lang)} ${app.cfg.site.name}</p>`)),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** Avviso alla guida (in italiano) sul pacchetto: nuovo, in opzione, scaduto, rilasciato, annullato. */
export async function notifyGuidePackage(app, group, bookings, kind, extra = '') {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const label = { new: 'Nuovo pacchetto', option: 'Nuovo pacchetto in opzione', expired: 'Pacchetto in opzione scaduto: date liberate', released: 'Pacchetto in opzione rilasciato dall’agenzia: date liberate', cancelled: 'Pacchetto annullato' }[kind];
  const account = group.account_id ? app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(group.account_id) : null;
  const lines = [
    `${label} ${group.ref}${account ? ` — ${account.company}` : ''}`,
    `${group.name} <${group.email}>${group.phone ? ' · ' + group.phone : ''}`,
    group.client_ref ? `Rif. pratica: ${group.client_ref}` : null,
    group.booked_by_name ? `Prenotato da: ${group.booked_by_name}` : null,
    group.notes ? `Note: ${group.notes}` : null,
    '',
    ...bookings.map((b) => `${fmtDate(b.date, 'it', 'short')} · ${b.start_time}–${b.end_time} · ${app.content.tour(b.tour_slug)?.i18n.it.title ?? b.tour_slug} · ${bookingPeopleShort(b)} · ${formatMoney(bookingDue(b), 'it', b.currency)} (${b.ref})`),
    `Totale: ${formatMoney(bookings.reduce((s, b) => s + bookingDue(b), 0), 'it', group.currency)}`,
    kind === 'option' ? `Trattenuti fino al ${untilGroup(bookings, 'it')}; se l’agenzia non conferma, si liberano da soli.` : null,
    extra || null,
    '',
    `${app.cfg.baseUrl}/admin/bookings/${bookings[0]?.id ?? ''}`,
  ].filter((x) => x !== null);
  await app.mail.send({ to, subject: `${label}: ${group.ref} — ${bookings.length} servizi`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

/** I dizionari per lingua, esposti ai test: ogni lingua deve avere le stesse chiavi e gli stessi segnaposto. */
export const EMAIL_TEXTS = { T, P, G, R, PG };

/** «Invita un amico»: l'email all'amico, con il suo codice sconto e il collegamento alla partenza. Nella lingua del tour (è quella in cui si svolgerà). */
export async function sendInviteEmail(app, b, invite, link, nowMs = Date.now()) {
  if (!invite.friend_email) return false;
  const lang = normLang(b.tour_lang ?? b.lang);
  const ti = tourText(app, b.tour_slug, lang);
  const percent = app.db.prepare('SELECT value FROM promo_codes WHERE id = ?').get(invite.promo_code_id)?.value ?? app.cfg.invite.percent;
  const when = `${fmtDate(b.date, lang)} · ${b.start_time}`;
  const who = b.name;
  const subject = pick({
    it: `${who} ti invita: ${ti.title}, ${fmtDate(b.date, lang, 'short')}`,
    en: `${who} invites you: ${ti.title}, ${fmtDate(b.date, lang, 'short')}`,
    es: `${who} te invita: ${ti.title}, ${fmtDate(b.date, lang, 'short')}`,
    ja: `${who}さんからのご招待：${ti.title}（${fmtDate(b.date, lang, 'short')}）`,
  }, lang);
  const intro = pick({
    it: `${who} ha prenotato «${ti.title}» (${when}) e ti invita a unirti. Con il codice qui sotto hai il ${percent}% di sconto: vale una sola volta e solo per questa partenza.`,
    en: `${who} has booked “${ti.title}” (${when}) and invites you to join. With the code below you get ${percent}% off: it can be used once and only for this departure.`,
    es: `${who} ha reservado «${ti.title}» (${when}) y te invita a unirte. Con el código de abajo tienes un ${percent}% de descuento: vale una sola vez y solo para esta salida.`,
    ja: `${who}さんが「${ti.title}」（${when}）を予約し、あなたをご招待しています。下のコードで${percent}%割引になります（この出発のみ、1回限り有効）。`,
  }, lang);
  const cta = pick({ it: 'Prenota il tuo posto', en: 'Book your place', es: 'Reserva tu plaza', ja: 'お席を予約する' }, lang);
  const codeLabel = pick({ it: 'Il tuo codice', en: 'Your code', es: 'Tu código', ja: 'あなたのコード' }, lang);
  await app.mail.send({
    to: invite.friend_email,
    subject,
    text: [greet(lang), '', intro, '', `${codeLabel}: ${invite.code}`, `${cta}: ${link}`, '', `${bye(lang)} ${app.cfg.site.name}`].join('\n'),
    html: String(layout(app, lang, html`<p>${greet(lang)}</p><p>${intro}</p><p style="font-size:20px;letter-spacing:2px"><strong>${codeLabel}: ${invite.code}</strong></p><p><a href="${link}" style="display:inline-block;background:#d6bb51;color:#1c1c1c;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">${cta}</a></p><p>${bye(lang)} ${app.cfg.site.name}</p>`)),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
  app.db.prepare('UPDATE invites SET sent_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), invite.id);
  return true;
}

// ───────────── Lista d'attesa delle agenzie («avvisami se si libera») ─────────────
const waitTourTitle = (app, slug, lang) => app.content.tour(slug)?.i18n[lang]?.title ?? slug;

/** All'agenzia: la data che aspettava è di nuovo prenotabile (`slots`: gli orari liberi adesso). Nessuno la tiene da parte: chi prenota per primo la ottiene. @returns {Promise<boolean>} false se l'email non è partita */
export async function sendWaitlistFree(app, e, slots, { advantageUntilMs = null } = {}) {
  const lang = normLang(e.acct_lang);
  const t = makeT(lang);
  const tr = T[lang];
  const title = waitTourTitle(app, e.tour_slug, lang);
  const times = slots.slice(0, 8).map((s) => s.time).join(', ');
  const intro = t('wl.mail.intro', { tour: title, date: fmtDate(e.date, lang), times });
  // chi è avvisata per prima ha un vantaggio: poi la data viene segnalata anche alle altre agenzie in lista (ma non è bloccata per nessuno)
  const note = advantageUntilMs ? `${t('wl.mail.advantage', { when: fmtInstant(advantageUntilMs, lang) })} ${t('wl.mail.note')}` : t('wl.mail.note');
  const cta = t('wl.mail.cta');
  const link = `${app.cfg.baseUrl}/${lang}/book?date=${e.date}&pax=${e.pax}&tour=${encodeURIComponent(e.tour_slug)}`;
  const manage = `${app.cfg.baseUrl}/${lang}/b2b/availability#lista`;
  return app.mail.send({
    to: e.acct_email,
    subject: t('wl.mail.subject', { tour: title, date: fmtDate(e.date, lang, 'short') }),
    text: [tr.hello(e.acct_name), '', intro, '', `${cta}: ${link}`, '', note, `${t('wl.title')}: ${manage}`, '', tr.contactLine, `${tr.bye} ${app.cfg.site.name}`].join('\n'),
    html: String(layout(app, lang, html`<p>${tr.hello(e.acct_name)}</p><p>${intro}</p><p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${cta}</a></p><p style="color:#555">${note} <a href="${manage}">${t('wl.title')}</a></p><p style="color:#555">${tr.contactLine}</p><p>${tr.bye}<br>${app.cfg.site.name}</p>`)),
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** Avviso alla guida (in italiano): un'agenzia aspetta una data; `blockers` sono le prenotazioni di altri che la occupano adesso. */
export async function notifyGuideWaitlist(app, e, account, blockers = []) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return;
  const title = waitTourTitle(app, e.tour_slug, 'it');
  const who = (b) => (b.company ? ` di ${b.company}` : '');
  const blocker = (b) =>
    b.status === 'option'
      ? `opzione ${b.ref}${who(b)} (${b.start_time}), scade il ${fmtInstant(Date.parse(b.option_expires_at), 'it')}`
      : b.status === 'held'
        ? `pagamento in corso ${b.ref}${who(b)} (${b.start_time})`
        : `prenotazione confermata ${b.ref}${who(b)} (${b.start_time})`;
  const lines = [
    `Lista d’attesa: ${account.company} aspetta una data`,
    `${title} · ${fmtDate(e.date, 'it')}${e.time ? ` ore ${e.time}` : ' (qualsiasi orario)'} · ${e.pax} ${e.pax === 1 ? 'persona' : 'persone'}`,
    blockers.length ? 'Adesso la occupano:' : null,
    ...blockers.slice(0, 6).map((b) => `- ${blocker(b)}`),
    '',
    'Se si libera l’agenzia riceve l’avviso da sola. Tutta la lista: ' + `${app.cfg.baseUrl}/admin/waitlist`,
  ].filter((x) => x !== null);
  await app.mail.send({ to, subject: `Lista d’attesa: ${account.company} — ${title}, ${e.date}`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}

// ───────────── Scheda del giorno dopo, per la guida ─────────────
/** Alla guida (in italiano): i servizi del giorno `sheet.date`, con il PDF della scheda in allegato. @returns {Promise<boolean>} */
export async function sendDayBriefing(app, sheet, { attachments = [] } = {}) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return false;
  const t = sheet.totals;
  const eur = (c) => `${(c / 100).toLocaleString('it-IT', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const head = `${fmtDate(sheet.date, 'it')}: ${n(t.services, 'servizio', 'servizi')}, ${n(t.people, 'persona', 'persone')}${t.options ? `, ${n(t.options, 'opzione aperta', 'opzioni aperte')}` : ''}${t.collectCents ? ` · da incassare sul posto ${eur(t.collectCents)}` : ''}`;
  const blocks = sheet.services.map((s) => {
    const who = s.b2b ? [s.agency, s.clientRef, s.name, s.phone].filter(Boolean).join(' · ') : [s.name, s.phone].filter(Boolean).join(' · ');
    return [
      `${s.start}–${s.end}  ${s.title}${s.confirmed ? '' : ' (OPZIONE)'}`,
      `   ${s.peopleLine}${s.tourLang ? ` · ${s.tourLang}` : ''}${s.service ? ` · ${s.service}` : ''}`,
      s.meeting ? `   Incontro: ${s.meeting}` : null,
      who ? `   ${s.b2b ? 'Agenzia' : 'Cliente'}: ${who}` : null,
      s.notes ? `   Note: ${s.notes}` : null,
      s.adminNotes ? `   Tue note: ${s.adminNotes}` : null,
      s.collectCents ? `   DA INCASSARE SUL POSTO: ${eur(s.collectCents)}` : null,
    ].filter(Boolean);
  });
  const lines = [head, '', ...blocks.flatMap((b) => [...b, '']), `Scheda completa: ${app.cfg.baseUrl}/admin/day?date=${sheet.date}`];
  return app.mail.send({
    to,
    subject: `Domani: ${n(t.services, 'servizio', 'servizi')}, ${n(t.people, 'persona', 'persone')}${t.collectCents ? ` · da incassare ${eur(t.collectCents)}` : ''} — ${fmtDate(sheet.date, 'it', 'short')}`,
    text: lines.join('\n'),
    html: String(html`<div style="font-family:Arial,sans-serif"><p><strong>${head}</strong></p>${blocks.map((b) => html`<p style="margin:0 0 14px">${b.map((l) => html`${l}<br>`)}</p>`)}<p><a href="${app.cfg.baseUrl}/admin/day?date=${sheet.date}">Apri la scheda completa</a></p></div>`),
    attachments,
  });
}

/** All'agenzia: l'estratto conto del mese, con il PDF in allegato. @returns {Promise<boolean>} false se l'email non è partita */
export async function sendStatementEmail(app, account, st, { attachments = [] } = {}) {
  const lang = normLang(account.lang);
  const t = makeT(lang);
  const tr = T[lang];
  const month = fmtMonth(st.month, lang);
  const money = (c) => formatMoney(c, lang);
  const link = `${app.cfg.baseUrl}/${lang}/b2b/statement?month=${st.month}`;
  const hello = greet(lang, account.contact_name);
  const sign = `${bye(lang)} ${app.cfg.site.name}`;
  const intro = t('stmt.mail.intro', { month });
  const lines = [
    { text: t('stmt.mail.balance', { date: fmtDate(st.asOf, lang, 'short'), amount: money(st.closing) }), big: true },
    st.overdueCents ? { text: t('stmt.mail.overdue', { amount: money(st.overdueCents) }), err: true } : null,
    st.closing < 0 ? { text: t('stmt.mail.credit', { amount: money(-st.closing) }) } : null,
    st.closing === 0 ? { text: t('stmt.mail.settled') } : null,
  ].filter(Boolean);
  return app.mail.send({
    to: account.email,
    subject: t('stmt.mail.subject', { month, site: app.cfg.site.name }),
    text: [hello, '', intro, '', ...lines.map((l) => l.text), '', `${t('stmt.mail.open')}: ${link}`, '', t('stmt.mail.stop'), '', tr.contactLine, sign].join('\n'),
    html: String(
      layout(
        app,
        lang,
        html`<p>${hello}</p><p>${intro}</p>${lines.map((l) => html`<p style="margin:0 0 10px;${l.big ? 'font-size:17px;' : ''}${l.err ? 'color:#b3362b;' : ''}"><strong>${l.text}</strong></p>`)}<p><a href="${link}" style="display:inline-block;background:#af9168;color:#fff;text-decoration:none;padding:10px 22px;border-radius:50px;font-weight:bold">${t('stmt.mail.open')}</a></p><p style="color:#666;font-size:13px">${t('stmt.mail.stop')}</p><p style="color:#666;font-size:13px">${tr.contactLine}<br>${sign}</p>`,
      ),
    ),
    attachments,
    replyTo: app.cfg.mail.notifyTo || undefined,
  });
}

/** Alla guida (in italiano): è successo qualcosa alla sicurezza del pannello (secondo passaggio acceso o spento, codice di emergenza usato, blocco dopo troppi errori). */
export async function notifySecurity(app, { subject, lines, ip = '' }) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return false;
  const body = [...lines, '', ip ? `Da: ${ip}` : null, `Quando: ${fmtInstant(Date.now(), 'it')}`, '', 'Se non sei stato tu, cambia subito la password del pannello (ADMIN_PASSWORD sul server): così tutti i dispositivi vengono scollegati.'].filter((l) => l !== null);
  return app.mail.send({ to, subject: `${app.cfg.site.name} · ${subject}`, text: body.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${body.map((l) => html`${l}<br>`)}</div>`) });
}

/** Alla guida (in italiano): la copia automatica di sicurezza non è riuscita. */
export async function notifyBackupFailed(app, { message }) {
  const to = app.cfg.mail.notifyTo;
  if (!to) return false;
  const lines = ['La copia automatica di sicurezza non è riuscita.', '', message, '', 'Il sito riprova da solo. Intanto puoi scaricare una copia a mano da Aiuto › Backup, e da lì controllare la destinazione («Prova la connessione»).', `${app.cfg.baseUrl}/admin/backup`];
  return app.mail.send({ to, subject: `${app.cfg.site.name} · Copia automatica non riuscita`, text: lines.join('\n'), html: String(html`<div style="font-family:Arial,sans-serif">${lines.map((l) => html`${l}<br>`)}</div>`) });
}
