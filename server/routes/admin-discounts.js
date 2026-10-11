import express from 'express';
import { adjustGift, getGift, giftLedger, setGiftExpiry, voidGift, GiftError } from '../gifts.js';
import { normalizePromo, promoUses } from '../pricing.js';
import { sendGiftToBuyer, sendGiftToRecipient } from '../emails.js';
import { isDate, nowRome } from '../time.js';
import { cleanText, parseEuros } from '../util.js';
import { invoiceForSource } from '../invoices.js';
import { send, sendPdf } from '../http.js';
import { renderGiftCardPdf } from '../pdf.js';
import { discountsPage, giftDetailPage } from '../views/admin-discounts.js';

const FLASH = {
  promo: 'Codice sconto creato.',
  toggled: 'Codice aggiornato.',
  deleted: 'Codice eliminato.',
  gift: 'Buono creato.',
  adjusted: 'Saldo aggiornato.',
  expiry: 'Scadenza aggiornata.',
  voided: 'Buono annullato.',
  resent: 'Email inviata.',
};
const ERR = {
  code: 'Il codice deve avere almeno 3 caratteri (lettere, numeri, - o _).',
  dup: 'Esiste già un codice con questo nome.',
  value: 'Valore non valido: la percentuale va da 1 a 100, l’importo fisso deve essere positivo.',
  dates: 'Date non valide.',
  amount: 'Importo non valido.',
  giftfail: 'Impossibile creare il buono: controlla importo ed email.',
  adjust: 'Rettifica non valida (il saldo non può diventare negativo).',
};

export function adminDiscountsRouter(app) {
  const r = express.Router();
  const { db, content } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ctxOf = (req) => ({ app, req });
  const back = (tab, k, v) => `/admin/discounts?tab=${tab}&${k}=${v}`;
  const optDate = (v) => (v ? (isDate(String(v)) ? String(v) : false) : null);

  r.get('/discounts', (req, res) => {
    const tab = req.query.tab === 'gifts' ? 'gifts' : 'promos';
    const now = Date.now();
    const promos = db.prepare('SELECT * FROM promo_codes ORDER BY active DESC, id DESC').all().map((p) => ({ ...p, uses: promoUses(db, p.id, now) }));
    const gifts = tab === 'gifts' ? db.prepare(`SELECT * FROM gift_cards WHERE status != 'pending' OR created_at > ? ORDER BY id DESC LIMIT 300`).all(new Date(now - 7 * 86400_000).toISOString()) : [];
    send(res, discountsPage(ctxOf(req), { tab, promos, gifts, tours: content.tours, today: nowRome(now).date, flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '' }));
  });

  r.post('/discounts/promos', form, (req, res) => {
    const b = req.body;
    const code = normalizePromo(b.code);
    if (code.length < 3) return res.redirect(303, back('promos', 'err', 'code'));
    const kind = b.kind === 'fixed' ? 'fixed' : 'percent';
    const raw = String(b.value ?? '').replace(',', '.');
    const value = kind === 'percent' ? Number(raw) : parseEuros(raw);
    if (!Number.isFinite(value) || value <= 0 || (kind === 'percent' && (value > 100 || !Number.isInteger(value))) || (kind === 'fixed' && value > 10_000_00)) return res.redirect(303, back('promos', 'err', 'value'));
    const dates = ['valid_from', 'valid_to', 'service_from', 'service_to'].map((k) => optDate(b[k]));
    if (dates.includes(false) || (dates[0] && dates[1] && dates[0] > dates[1]) || (dates[2] && dates[3] && dates[2] > dates[3])) return res.redirect(303, back('promos', 'err', 'dates'));
    const minTotal = b.min_total ? parseEuros(b.min_total) : null;
    if (b.min_total && (minTotal === null || minTotal < 0)) return res.redirect(303, back('promos', 'err', 'amount'));
    const tours = [].concat(b.tours ?? []).filter((s) => content.tour(s));
    const maxUses = b.max_uses ? Math.max(1, Number.parseInt(b.max_uses, 10) || 1) : null;
    if (db.prepare('SELECT 1 FROM promo_codes WHERE code = ?').get(code)) return res.redirect(303, back('promos', 'err', 'dup'));
    db.prepare(
      `INSERT INTO promo_codes(code, kind, value, valid_from, valid_to, service_from, service_to, max_uses, one_per_email, tours, min_total_cents, note, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(code, kind, value, ...dates, maxUses, b.one_per_email ? 1 : 0, tours.length ? JSON.stringify(tours) : null, minTotal, cleanText(b.note, 200) || null, new Date().toISOString());
    res.redirect(303, back('promos', 'ok', 'promo'));
  });

  r.post('/discounts/promos/:id/toggle', form, (req, res) => {
    db.prepare('UPDATE promo_codes SET active = 1 - active WHERE id = ?').run(Number(req.params.id));
    res.redirect(303, back('promos', 'ok', 'toggled'));
  });
  r.post('/discounts/promos/:id/delete', form, (req, res) => {
    const id = Number(req.params.id);
    // un codice già usato non si elimina (resta lo storico delle prenotazioni): si disattiva
    if (!db.prepare('SELECT 1 FROM bookings WHERE promo_code_id = ?').get(id)) db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
    res.redirect(303, back('promos', 'ok', 'deleted'));
  });

  r.post('/discounts/gifts', form, async (req, res) => {
    const b = req.body;
    const cents = parseEuros(b.amount);
    const exp = optDate(b.expires_at);
    if (cents === null) return res.redirect(303, back('gifts', 'err', 'amount'));
    if (exp === false) return res.redirect(303, back('gifts', 'err', 'dates'));
    try {
      const notify = ['buyer', 'recipient'].includes(b.notify) ? b.notify : 'none';
      const card = await app.gifts.createByAdmin(
        { amountCents: cents, buyerName: b.buyer_name, buyerEmail: b.buyer_email, recipientName: b.recipient_name, recipientEmail: b.recipient_email, message: b.message, lang: b.lang, expiresAt: exp, sendToRecipient: notify === 'recipient' },
        { notify },
      );
      res.redirect(303, `/admin/discounts/gifts/${card.id}?ok=gift`);
    } catch (e) {
      if (!(e instanceof GiftError)) throw e;
      res.redirect(303, back('gifts', 'err', 'giftfail'));
    }
  });

  r.get('/discounts/gifts/:id', (req, res, next) => {
    const card = getGift(db, Number(req.params.id));
    if (!card) return next();
    send(res, giftDetailPage(ctxOf(req), card, giftLedger(db, card.id), nowRome().date, FLASH[String(req.query.ok ?? '')] ?? '', ERR[String(req.query.err ?? '')] ?? '', invoiceForSource(db, 'gift', card.id)));
  });
  const here = (id, k, v) => `/admin/discounts/gifts/${id}?${k}=${v}`;
  r.get('/discounts/gifts/:id/card.pdf', async (req, res, next) => {
    const card = getGift(db, Number(req.params.id));
    if (!card) return next();
    sendPdf(res, await renderGiftCardPdf(app, card, card.lang === 'en' ? 'en' : 'it'), `buono-regalo-${card.ref}.pdf`);
  });
  r.post('/discounts/gifts/:id/adjust', form, (req, res, next) => {
    const card = getGift(db, Number(req.params.id));
    if (!card) return next();
    const cents = parseEuros(req.body.amount);
    try {
      adjustGift(db, card.id, cents, req.body.note);
      res.redirect(303, here(card.id, 'ok', 'adjusted'));
    } catch (e) {
      if (!(e instanceof GiftError)) throw e;
      res.redirect(303, here(card.id, 'err', 'adjust'));
    }
  });
  r.post('/discounts/gifts/:id/expiry', form, (req, res, next) => {
    const card = getGift(db, Number(req.params.id));
    if (!card) return next();
    if (!isDate(String(req.body.expires_at))) return res.redirect(303, here(card.id, 'err', 'dates'));
    setGiftExpiry(db, card.id, req.body.expires_at);
    res.redirect(303, here(card.id, 'ok', 'expiry'));
  });
  r.post('/discounts/gifts/:id/void', form, (req, res, next) => {
    const card = getGift(db, Number(req.params.id));
    if (!card) return next();
    voidGift(db, card.id, cleanText(req.body.note, 200) || null);
    res.redirect(303, here(card.id, 'ok', 'voided'));
  });
  r.post('/discounts/gifts/:id/resend', form, async (req, res, next) => {
    const card = getGift(db, Number(req.params.id));
    if (!card || card.status !== 'active') return next();
    if (req.body.to === 'recipient') await sendGiftToRecipient(app, card);
    else await sendGiftToBuyer(app, card);
    res.redirect(303, here(card.id, 'ok', 'resent'));
  });

  return r;
}
