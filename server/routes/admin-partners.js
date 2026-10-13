// Partner B2B nel pannello: elenco, approvazione, condizioni, listino dedicato e politica di annullo.
import express from 'express';
import { sendPartnerApproved } from '../emails.js';
import { send } from '../http.js';
import { MAX_HOURS, MAX_TIERS, validateTiers } from '../policy.js';
import { accountPrices } from '../pricing.js';
import { cleanText, parseEuros } from '../util.js';
import { partnerDetailPage, partnersPage } from '../views/admin-partners.js';

const FLASH = {
  partner: 'Condizioni aggiornate.',
  approved: 'Partner approvato: gli ho inviato un’email.',
  prices: 'Listino aggiornato.',
  policy: 'Politica di annullo aggiornata.',
  copied: 'Copiato.',
};
const ERR = {
  price: 'Un prezzo non è valido: scrivi un importo in euro, per esempio 24,50 (lascia vuoto per usare la tariffa standard).',
  hours: `Controlla le ore: numeri interi da 0 a ${MAX_HOURS} (con «giorni» ×24), e il rimborso va indicato per ogni riga.`,
  refund: 'Il rimborso è una percentuale intera da 0 a 100.',
  duplicate: 'Due scaglioni hanno lo stesso preavviso.',
  order: 'Il rimborso non può aumentare avvicinandosi al servizio: più si è vicini, meno si rimborsa.',
  count: `Al massimo ${MAX_TIERS} scaglioni.`,
  copy: 'Scegli il partner da cui copiare.',
};

export function adminPartnersRouter(app) {
  const r = express.Router();
  const { db, content } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ctxOf = (req) => ({ app, req });
  const get = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(id));
  const here = (id, k, v) => `/admin/partners/${id}?${k}=${v}`;

  r.get('/partners', (req, res) => {
    const f = ['all', 'pending', 'approved'].includes(req.query.f) ? req.query.f : 'all';
    const items = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM bookings b WHERE b.account_id = a.id AND b.status = 'confirmed') AS bookings FROM accounts a ${f === 'all' ? '' : 'WHERE a.status = ?'} ORDER BY a.status = 'pending' DESC, a.created_at DESC`).all(...(f === 'all' ? [] : [f]));
    send(res, partnersPage(ctxOf(req), { items, filter: f }));
  });

  r.get('/partners/:id', (req, res, next) => {
    const a = get(req.params.id);
    if (!a) return next();
    const bookings = db.prepare('SELECT * FROM bookings WHERE account_id = ? ORDER BY date DESC LIMIT 100').all(a.id);
    const others = db.prepare('SELECT id, company FROM accounts WHERE id != ? ORDER BY company').all(a.id);
    send(res, partnerDetailPage(ctxOf(req), a, { bookings, others, flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '' }));
  });

  // stato, sconto, pagamento a fattura, note
  r.post('/partners/:id', form, async (req, res, next) => {
    const a = get(req.params.id);
    if (!a) return next();
    const status = ['pending', 'approved', 'rejected', 'suspended'].includes(req.body.status) ? req.body.status : a.status;
    const discount = Math.min(60, Math.max(0, Number(String(req.body.discount_percent ?? '').replace(',', '.')) || 0));
    const justApproved = status === 'approved' && a.status !== 'approved';
    db.prepare(`UPDATE accounts SET status = ?, discount_percent = ?, allow_invoice = ?, admin_notes = ?, approved_at = CASE WHEN ? THEN ? ELSE approved_at END WHERE id = ?`).run(
      status, discount, req.body.allow_invoice ? 1 : 0, cleanText(req.body.admin_notes, 2000) || null, justApproved ? 1 : 0, new Date().toISOString(), a.id,
    );
    if (justApproved) await sendPartnerApproved(app, get(a.id));
    res.redirect(303, here(a.id, 'ok', justApproved ? 'approved' : 'partner'));
  });

  // listino dedicato
  r.post('/partners/:id/prices', form, (req, res, next) => {
    const a = get(req.params.id);
    if (!a) return next();
    if (req.body.action === 'copy') {
      const from = get(req.body.copy_from);
      if (!from) return res.redirect(303, here(a.id, 'err', 'copy'));
      db.prepare('UPDATE accounts SET prices_json = ? WHERE id = ?').run(from.prices_json, a.id);
      return res.redirect(303, here(a.id, 'ok', 'copied'));
    }
    const list = {};
    for (const t of content.tours) {
      const raw = String(req.body[`price_${t.slug}`] ?? '').trim();
      if (!raw) continue;
      const cents = parseEuros(raw);
      if (cents == null || cents < 0 || cents > 10_000_000) return res.redirect(303, here(a.id, 'err', 'price'));
      list[t.slug] = cents;
    }
    // i prezzi di tour nascosti non compaiono nella tabella: restano com'erano
    for (const [slug, cents] of Object.entries(accountPrices(a))) if (!content.tours.some((t) => t.slug === slug) && content.tour(slug)) list[slug] = cents;
    db.prepare('UPDATE accounts SET prices_json = ? WHERE id = ?').run(Object.keys(list).length ? JSON.stringify(list) : null, a.id);
    res.redirect(303, here(a.id, 'ok', 'prices'));
  });

  // politica di annullo a scaglioni
  r.post('/partners/:id/policy', form, (req, res, next) => {
    const a = get(req.params.id);
    if (!a) return next();
    if (req.body.action === 'copy') {
      const from = get(req.body.copy_from);
      if (!from) return res.redirect(303, here(a.id, 'err', 'copy'));
      db.prepare('UPDATE accounts SET cancel_policy_json = ?, cancel_hours = ? WHERE id = ?').run(from.cancel_policy_json, from.cancel_hours, a.id);
      return res.redirect(303, here(a.id, 'ok', 'copied'));
    }
    const rows = Array.from({ length: MAX_TIERS }, (_, i) => {
      const n = i + 1;
      const h = String(req.body[`h${n}`] ?? '').trim();
      return { hours: h === '' ? '' : Number(h.replace(',', '.')) * (req.body[`u${n}`] === 'd' ? 24 : 1), refund: String(req.body[`r${n}`] ?? '').trim() };
    });
    const { tiers, error } = validateTiers(rows);
    if (error) return res.redirect(303, here(a.id, 'err', error));
    db.prepare('UPDATE accounts SET cancel_policy_json = ?, cancel_hours = NULL WHERE id = ?').run(tiers ? JSON.stringify(tiers) : null, a.id);
    res.redirect(303, here(a.id, 'ok', 'policy'));
  });

  return r;
}
