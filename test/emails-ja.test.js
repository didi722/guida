// Giapponese come quarta lingua: email transazionali, PDF con il font giapponese incorporato (Noto Sans JP) e nomi in giapponese nei PDF delle altre lingue.
// I testi che vengono da server/strings.json (voucher, buono, fattura nei PDF) si confrontano con makeT('ja'), non con frasi scritte qui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../server/bookings.js';
import { EMAIL_TEXTS, programIcs, sendBookingCancelled, sendGiftToBuyer, sendGiftToRecipient, sendPartnerApproved, sendPartnerRegistered, sendProgramAccepted, sendProgramConfirmed, sendProgramReceived, sendProposalEmail, sendReviewRequest, sendSlotLostRefund } from '../server/emails.js';
import { makeT } from '../server/i18n.js';
import { fold, renderGiftCardPdf, renderProposalPdf, renderVoucherPdf } from '../server/pdf.js';
import { formatGiftCode } from '../server/pricing.js';
import { createProgramRequest, markQuoted, saveProposal } from '../server/programs.js';
import { HAS_PDFTOTEXT, NOW, addGift, base, isPdf, makeApp, pdfText } from './helpers.js';

const t_ja = makeT('ja');
const needText = { skip: HAS_PDFTOTEXT ? false : 'pdftotext (poppler) non installato: i controlli sul testo dei PDF vengono saltati' };
const JA = /[぀-ヿ一-鿿]/;

// pdftotext può separare le lettere dei titoletti spaziati: si confronta senza spazi e senza maiuscole
const squash = (x) => x.replace(/\s+/g, '').toLowerCase();
const has = (text, ...needles) => needles.forEach((n) => assert.ok(squash(text).includes(squash(n)), `nel PDF manca «${n}»\n${text}`));
const flat = (s) => String(s).replace(/ /g, ' ');
const unfold = (ics) => ics.replace(/\r\n /g, '');
const pdfsOf = (m) => m.attachments.filter((a) => a.contentType === 'application/pdf');
const lang = (pdf) => /\/Lang \(([\w-]+)\)/.exec(Buffer.from(pdf).toString('latin1'))?.[1];
const embedsJapaneseFont = (pdf) => /NotoSansJP/.test(Buffer.from(pdf).toString('latin1'));
const bookingRow = (app, id) => app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
const programRow = (app, id) => app.db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
const mailsTo = (app, to) => app.mail.sent.filter((m) => m.to === to);
const includesAll = (text, lines) => lines.forEach((l) => assert.ok(text.includes(l), `manca «${l}» in\n${text}`));

/** Nessun segnaposto rimasto a metà nel messaggio. */
function assertClean(m) {
  for (const f of ['subject', 'text', 'html']) if (m[f]) assert.ok(!/\b(undefined|null|NaN)\b|\[object|\$\{/.test(m[f]), `${f} di «${m.subject}» contiene un valore non risolto:\n${m[f]}`);
}

function appJa(t, over = {}) {
  const app = makeApp({
    site: { vatNumber: 'IT01234567890', guideLicense: 'Guida turistica abilitata n. 1234', address: 'Calle del Test 1, Venezia', phone: '+39 333 1234567' },
    mail: { notifyTo: 'guida@example.com' },
    reviews: { googleUrl: 'https://reviews.example/google', tripadvisorUrl: 'https://reviews.example/tripadvisor' },
    ...over,
  });
  t.after(() => app.cleanup());
  const tour = app.content.tour('shared');
  tour.i18n.it = { ...tour.i18n.it, title: 'Cannaregio e il Ghetto', meetingPoint: 'Ponte delle Guglie, Cannaregio' };
  tour.i18n.ja = { title: 'カンナレージョとゲットー', subtitle: 'ヴェネツィアの共同体と少数者の歴史をたどる', meetingPoint: 'グリエ橋（カンナレージョ地区）', meetingUrl: 'https://maps.example/guglie', includes: ['公認ガイド'], excludes: ['美術館・博物館の入場料'], notes: '宗教施設を訪れますので、肩や膝が隠れる服装でお越しください。' };
  return app;
}

const flatten = (name, v) => (typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => flatten(`${name}.${k}`, x)) : [[name, typeof v === 'function' ? v(...Array.from({ length: v.length }, (_, i) => `§${i}§`)) : v]]);

// ───────────── dizionari ─────────────
test('testi giapponesi delle email: ogni voce contiene giapponese, saluto con «様», niente punteggiatura occidentale», «Venezia» scritta in giapponese', () => {
  for (const [dict, entries] of Object.entries(EMAIL_TEXTS)) {
    for (const [path, text] of flatten(dict, entries.ja)) {
      assert.ok(JA.test(text), `${path}: nessun carattere giapponese in «${text}»`);
      assert.ok(!/[«»¿¡]/.test(text), `${path}: punteggiatura non giapponese in «${text}»`);
      assert.ok(!/ヴェネチア|ベネチア|Venezia|Venice/.test(text), `${path}: «ヴェネツィア» va scritta così`);
    }
  }
  assert.equal(EMAIL_TEXTS.T.ja.hello('田中 太郎'), '田中 太郎 様');
  assert.equal(EMAIL_TEXTS.PG.ja.deposit(30), '手付金（30%）');
});

// ───────────── prenotazione ─────────────
test('prenotazione con lang ja: conferma in giapponese (oggetto, saluto, riepilogo, link /ja/), .ics e voucher PDF con font giapponese; la guida riceve l’avviso in italiano', async (t) => {
  const app = appJa(t);
  const { booking } = await app.services.book(base({ lang: 'ja', date: '2027-01-12', name: '田中 太郎', phone: '+81 90 0000 0000', notes: 'お子様（8歳）が一緒です。ベジタリアン対応は不要です。' }), 'ja', NOW);
  assert.equal(booking.lang, 'ja', 'la prenotazione conserva la lingua');
  const [m] = mailsTo(app, 'mario@example.com');
  assertClean(m);
  assert.match(flat(m.subject), /^ご予約確定のお知らせ VE-[A-Z0-9]+ — カンナレージョとゲットー（2027年1月12日）$/);
  const text = flat(m.text);
  assert.ok(text.startsWith('田中 太郎 様\n\nご予約が確定しました。内容は以下のとおりです。\n'), text);
  includesAll(text, [`予約番号: ${booking.ref}`, 'サービス: カンナレージョとゲットー', '日付: 2027年1月12日火曜日', '時間: 09:30–12:00', '参加者: 2', '集合場所: グリエ橋（カンナレージョ地区）', '合計: €70 (サービス当日にお支払い)', '2027年1月10日, 09:30まで無料でキャンセルできます。', 'それ以降は返金できません。', '添付のファイルで、サービスをカレンダーに追加できます。', `ご予約の確認・キャンセル: http://localhost:3000/ja/booking/${booking.ref}?t=${booking.token}`, 'ご不明な点は、このメールにご返信ください。']);
  assert.ok(text.trimEnd().endsWith('どうぞよろしくお願いいたします。 Davide Tomio'), 'congedo');
  assert.equal(app.cfg.site.tagline.ja, 'ガイド · ヴェネツィア', 'la configurazione ha lo slogan giapponese');
  assert.ok(m.html.includes('田中 太郎 様') && m.html.includes(app.cfg.site.tagline.ja) && m.html.includes('/ja/booking/') && m.html.includes('ご予約の確認・キャンセル'), 'anche l’HTML è in giapponese');

  // allegati: calendario e voucher
  const ics = unfold(m.attachments.find((a) => a.filename === `${booking.ref}.ics`).content);
  includesAll(ics, ['SUMMARY:カンナレージョとゲットー (Davide Tomio)', `DESCRIPTION:${booking.ref} — 2 参加者`, 'LOCATION:グリエ橋（カンナレージョ地区）', `/ja/booking/${booking.ref}`]);
  const [pdf] = pdfsOf(m);
  assert.equal(pdf.filename, `voucher-${booking.ref}.pdf`);
  assert.ok(isPdf(pdf.content));
  assert.equal(lang(pdf.content), 'ja-JP', 'il PDF dichiara la lingua');
  assert.ok(embedsJapaneseFont(pdf.content), 'il font giapponese è incorporato nel PDF');
  if (HAS_PDFTOTEXT) {
    const pt = pdfText(pdf.content);
    has(pt, '田中 太郎', 'お子様（8歳）が一緒です。', '2027年1月12日火曜日', '09:30 – 12:00', 'カンナレージョとゲットー', 'ヴェネツィアの共同体と少数者の歴史をたどる', 'グリエ橋', '美術館・博物館の入場料', '肩や膝が隠れる服装', 'ガイド · ヴェネツィア', 'Guida turistica abilitata n. 1234', 'VAT番号 IT01234567890', '€70', `/ja/booking/${booking.ref}?t=${booking.token}`, t_ja('voucher.title'), t_ja('pdf.bookingRef'), t_ja('voucher.note'));
  }

  // la guida riceve l'avviso in italiano (con il titolo italiano del tour)
  const [notice] = mailsTo(app, 'guida@example.com');
  assert.equal(notice.subject, 'Nuova prenotazione: Cannaregio e il Ghetto — 2027-01-12 09:30');
});

test('annullo, slot perso e richiesta di recensione in giapponese', async (t) => {
  const app = appJa(t);
  const { booking } = await app.services.book(base({ lang: 'ja', date: '2027-01-12', name: '田中 太郎' }), 'ja', NOW);
  const b = bookingRow(app, booking.id);
  app.mail.sent.length = 0;
  const lastToClient = () => mailsTo(app, 'mario@example.com').at(-1);

  await sendBookingCancelled(app, b, 3500);
  let m = lastToClient();
  assertClean(m);
  assert.equal(m.subject, `ご予約をキャンセルしました ${b.ref}`);
  includesAll(flat(m.text), ['ご予約をキャンセルしました。', '返金額：€35（元のお支払い方法に返金されます。通常、5〜10営業日かかります）。']);
  assert.match(mailsTo(app, 'guida@example.com')[0].subject, /^Prenotazione annullata:/, 'avviso alla guida in italiano');

  await sendBookingCancelled(app, { ...b, payment_method: 'card' }, 0);
  assert.ok(lastToClient().text.includes('このキャンセルでは、返金はありません。'), lastToClient().text);

  await sendSlotLostRefund(app, b);
  m = lastToClient();
  assertClean(m);
  assert.equal(m.subject, `ご予約 ${b.ref}：枠を確保できなかったため、返金手続き中です`);
  assert.ok(m.text.startsWith('田中 太郎 様\n\n誠に申し訳ありませんが'), m.text);
  assert.ok(m.text.includes('お手数ですが、サイトで別の枠をお選びいただくか、ご連絡ください。') && m.text.trimEnd().endsWith('どうぞよろしくお願いいたします。 Davide Tomio'));

  await sendReviewRequest(app, b);
  m = lastToClient();
  assertClean(m);
  assert.equal(m.subject, 'ツアーはいかがでしたか？ Davide Tomioとめぐるヴェネツィア');
  includesAll(flat(m.text), ['田中 太郎 様', '「カンナレージョとゲットー」（2027年1月12日）にご参加いただき、ありがとうございました。', 'Googleでレビューを書く: https://reviews.example/google', 'Tripadvisorでレビューを書く: https://reviews.example/tripadvisor', 'フィードバックを送る', `http://localhost:3000/ja/feedback/${b.ref}?t=${b.token}`, 'ツアー後にお送りするメールは、これ1通だけです。']);
  assert.ok(m.html.includes('Googleでレビューを書く') && m.html.includes('フィードバックを送る'));
});

// ───────────── buoni regalo ─────────────
test('buono regalo in giapponese: nome del prodotto nel pagamento, email all’acquirente e al destinatario, PDF allegato con il font giapponese', async (t) => {
  const app = appJa(t);
  const checkouts = [];
  const realCheckout = app.payments.createCheckout.bind(app.payments);
  t.mock.method(app.payments, 'createCheckout', async (args) => {
    checkouts.push(args);
    return realCheckout(args);
  });
  const message = 'お誕生日おめでとう！ 一緒にヴェネツィアを歩きましょう。';
  const { card } = await app.gifts.buy({ amountCents: 5000, buyerName: '田中 太郎', buyerEmail: 'tanaka@example.com', delivery: 'recipient', recipientName: '山田 花子', recipientEmail: 'yamada@example.com', deliverOn: '2027-01-04', message, lang: 'ja' }, 'ja', NOW);
  assert.equal(card.lang, 'ja');
  assert.deepEqual([checkouts[0].title, checkouts[0].description, checkouts[0].lang], ['ギフトカード — Davide Tomio', 'ギフトカード · 山田 花子', 'ja']);
  const { handler, row: pending } = app.payables.lookup(card.ref);
  assert.deepEqual(['it', 'en', 'es', 'ja', 'xx'].map((l) => handler.title(pending, l)), ['Buono regalo', 'Gift card', 'Tarjeta regalo', 'ギフトカード', 'Buono regalo']);

  await app.gifts.handlePaid(card.id, null, NOW);
  const code = formatGiftCode(app.db.prepare('SELECT code FROM gift_cards WHERE id = ?').get(card.id).code);

  const [buyer] = mailsTo(app, 'tanaka@example.com');
  assertClean(buyer);
  assert.equal(flat(buyer.subject), 'ギフトカード（€50）のご案内');
  const bt = flat(buyer.text);
  assert.ok(bt.startsWith('田中 太郎 様\n\nご購入ありがとうございます。ギフトカードのご用意ができました。\nyamada@example.com宛てに送信しました。\n'), bt);
  includesAll(bt, ['金額: €50', `コード: ${code}`, '有効期限: 2029年1月4日', 'ご利用方法：サイトでツアーを選び', '「ギフトカード」欄', 'http://localhost:3000/ja/tours']);
  assert.ok(bt.trimEnd().endsWith('どうぞよろしくお願いいたします。 Davide Tomio'));
  assert.ok(!buyer.html.includes(message), 'l’acquirente non vede il messaggio per il destinatario');

  const [recipient] = mailsTo(app, 'yamada@example.com');
  assertClean(recipient);
  assert.equal(recipient.subject, '田中 太郎様から、ヴェネツィアでの体験のプレゼントが届きました');
  const rt = flat(recipient.text);
  assert.ok(rt.startsWith('山田 花子 様、公認ガイドと一緒にヴェネツィアを巡る、ギフトカードが届きました。\n贈り主：田中 太郎\n'), rt);
  includesAll(rt, [`「${message}」`, `コード: ${code}`, '有効期限: 2029年1月4日']);
  assert.ok(recipient.html.includes(message) && recipient.html.includes('ツアーを選ぶ'));

  for (const m of [buyer, recipient]) {
    const [pdf] = pdfsOf(m);
    assert.ok(isPdf(pdf.content));
    assert.equal(lang(pdf.content), 'ja-JP');
    assert.ok(embedsJapaneseFont(pdf.content));
    if (HAS_PDFTOTEXT) has(pdfText(pdf.content), '€50', '山田 花子', '田中 太郎', message, '2029年1月4日', code, t_ja('pdf.giftTitle'), t_ja('gift.code'), 'VAT番号 IT01234567890');
  }
});

// ───────────── partner e programmi ─────────────
test('partner e programmi di più giorni in giapponese: email pulite, in giapponese, con i link /ja/ e il PDF della proposta', async (t) => {
  const app = appJa(t);
  const a = { id: 7, lang: 'ja', contact_name: '佐藤 健', email: 'dmc@example.com', company: 'Tokyo DMC', country: 'JP', vat: 'T1234567890123' };
  await sendPartnerRegistered(app, a);
  await sendPartnerApproved(app, a);
  const [received, notice, approved] = app.mail.sent;
  [received, notice, approved].forEach(assertClean);
  assert.equal(received.subject, 'パートナーアクセスの申請を受け付けました');
  assert.ok(received.text.startsWith('佐藤 健 様\nパートナーエリアへのアクセス申請を受け付けました。'), received.text);
  assert.equal(notice.to, 'guida@example.com');
  assert.equal(notice.subject, 'Nuova richiesta partner: Tokyo DMC');
  assert.equal(approved.subject, 'パートナーアカウントが有効になりました');
  assert.ok(approved.text.includes('ログインはこちら：http://localhost:3000/ja/b2b/login'), approved.text);

  app.mail.sent.length = 0;
  const p = createProgramRequest(app, { name: '田中 太郎', email: 'tanaka@example.com', company: '', participants: 6, dateFrom: '2027-02-10', dateTo: '2027-02-12', lang: 'ja' }, NOW);
  await sendProgramReceived(app, programRow(app, p.id));
  assertClean(mailsTo(app, 'tanaka@example.com')[0]);
  assert.equal(mailsTo(app, 'tanaka@example.com')[0].subject, `リクエストを受け付けました ${p.ref}：ヴェネツィアのプログラム`);
  saveProposal(app, p.id, { title: 'ヴェネツィア3日間の旅', intro: 'ご希望をもとに、宗教と歴史をテーマにした3日間のプログラムをご提案します。', notes: 'キャンセルは前日の正午まで無料です。', depositPercent: 30, validUntil: '2027-01-20', holdDates: true, days: [{ date: '2027-02-10', start: '09:30', end: '12:30', title: 'サン・マルコ広場とリアルト', description: '大聖堂と鐘楼、リアルト市場を歩きます。', priceCents: 40000 }, { date: '2027-02-11', start: '10:00', end: '13:00', title: 'カンナレージョとゲットー', priceCents: 40000 }] }, { nowMs: NOW });
  markQuoted(app, p.id, NOW);
  const row = programRow(app, p.id);
  await sendProposalEmail(app, row);
  const proposal = mailsTo(app, 'tanaka@example.com').at(-1);
  assertClean(proposal);
  assert.equal(proposal.subject, `ヴェネツィアのプログラムのご提案（${p.ref}）`);
  includesAll(flat(proposal.text), ['ご依頼をもとに作成した、プログラムのご提案をお送りします。', `/ja/programs/${p.ref}`]);
  const [pdf] = pdfsOf(proposal);
  assert.ok(isPdf(pdf.content) && embedsJapaneseFont(pdf.content));
  if (HAS_PDFTOTEXT) has(pdfText(pdf.content), 'ヴェネツィア3日間の旅', 'サン・マルコ広場とリアルト', '大聖堂と鐘楼、リアルト市場を歩きます。', '€800', '€240', '€560', t_ja('pdf.proposal'), t_ja('pg.notes'), 'キャンセルは前日の正午まで無料です。');

  // accettazione e conferma, con il calendario delle giornate
  await sendProgramAccepted(app, programRow(app, p.id));
  await sendProgramConfirmed(app, programRow(app, p.id));
  for (const m of mailsTo(app, 'tanaka@example.com')) assertClean(m);
  assert.match(mailsTo(app, 'tanaka@example.com').at(-1).subject, /^プログラム確定 /);
  assert.ok(unfold(programIcs(app, programRow(app, p.id))).includes('サン・マルコ広場とリアルト'));
});

// ───────────── PDF e font ─────────────
test('fold: kana e ideogrammi restano; gli altri alfabeti non latini restano «?»', () => {
  assert.equal(fold('田中 太郎'), '田中 太郎');
  assert.equal(fold('ヴェネツィア・サン・マルコ広場「引用」。'), 'ヴェネツィア・サン・マルコ広場「引用」。');
  assert.equal(fold('髙橋 𠮷田 﨑'), '髙橋 𠮷田 﨑', 'varianti dei cognomi e caratteri fuori dal piano base');
  assert.equal(fold('ＡＢＣ　１２３'), 'ＡＢＣ　１２３', 'forme a larghezza intera');
  assert.equal(fold('한국어'), '???', 'il coreano non è coperto');
  assert.equal(fold('Иван'), '????');
});

test('PDF: il font giapponese si incorpora solo quando serve; un nome giapponese in un voucher inglese o italiano si legge', needText, async (t) => {
  const app = appJa(t);
  const b = createBooking(app, base({ date: '2027-01-12', pax: 2, name: '田中 太郎', email: 'tanaka@example.com', lang: 'en', notes: 'Vegetariana: 髙橋さんの分も' }), NOW);
  const en = await renderVoucherPdf(app, b, { lang: 'en', nowMs: NOW });
  assert.ok(isPdf(en) && embedsJapaneseFont(en), 'il nome in kanji ha richiesto il font');
  has(pdfText(en), '田中 太郎', '髙橋さんの分も', 'Booking voucher', 'Tuesday, 12 January 2027', 'Licensed guide'.slice(0, 0) || 'Booked by');
  const it = await renderVoucherPdf(app, b, { lang: 'it', nowMs: NOW });
  has(pdfText(it), '田中 太郎', 'Voucher di prenotazione');

  // senza ideogrammi il PDF resta com'era: nessun font giapponese incorporato (e quindi leggero)
  const plain = createBooking(app, base({ date: '2027-01-13', pax: 2, name: 'Mario Rossi', email: 'mario2@example.com', lang: 'it' }), NOW);
  const pdf = await renderVoucherPdf(app, plain, { lang: 'it', nowMs: NOW });
  assert.ok(isPdf(pdf) && !embedsJapaneseFont(pdf), 'nessun font giapponese in un voucher italiano senza ideogrammi');
  assert.ok(pdf.length < 60_000, `PDF leggero: ${pdf.length} byte`);
  // e anche quello giapponese resta leggero: nel file ci sono solo i glifi usati
  const ja = await renderVoucherPdf(app, b, { lang: 'ja', nowMs: NOW });
  assert.ok(ja.length < 150_000, `voucher giapponese: ${ja.length} byte`);
});

test('buono regalo e proposta in giapponese: importo, nomi, messaggio, date e testi fissi nel PDF', needText, async (t) => {
  const app = appJa(t);
  const gift = addGift(app.db, { initial_cents: 15000, recipient_name: '山田 花子', buyer_name: '田中 太郎', message: 'お誕生日おめでとう！ 一緒にヴェネツィアを歩きましょう。', lang: 'ja' });
  const pdf = await renderGiftCardPdf(app, gift, 'ja');
  assert.equal(lang(pdf), 'ja-JP');
  has(pdfText(pdf), '€150', `${t_ja('pdf.giftFor')} 山田 花子`, `${t_ja('pdf.giftFrom')} 田中 太郎`, '「お誕生日おめでとう！ 一緒にヴェネツィアを歩きましょう。」', t_ja('gift.useIt'), t_ja('gift.validUntil'), '2028年12月31日', formatGiftCode(gift.code));

  const p = createProgramRequest(app, { name: '田中 太郎', email: 'tanaka@example.com', company: 'Tokyo DMC', participants: 6, dateFrom: '2027-02-10', dateTo: '2027-02-12', lang: 'ja' }, NOW);
  saveProposal(app, p.id, { title: 'ヴェネツィア3日間の旅', depositPercent: 30, validUntil: '2027-01-20', days: [{ date: '2027-02-10', start: '09:30', end: '12:30', title: 'サン・マルコ広場とリアルト', priceCents: 40000 }] }, { nowMs: NOW });
  const doc = await renderProposalPdf(app, programRow(app, p.id), 'ja');
  const text = pdfText(doc);
  has(text, `${t_ja('pdf.proposalFor')} 田中 太郎, Tokyo DMC`, 'ヴェネツィア3日間の旅', '2月10日(水)', '09:30 – 12:30', '€400', t_ja('pg.deposit', { percent: 30 }), '€120', '€280', t_ja('pg.validUntil', { date: '2027年1月20日' }));
});
