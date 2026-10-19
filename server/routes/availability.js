// Area agenzie: calendario delle date libere di un servizio e lista d'attesa («avvisami se si libera»).
import express from 'express';
import { dayOverviewFor, monthOverview } from '../availability.js';
import { send, tooMany } from '../http.js';
import { hourOptions, minHours, openTo } from '../rates.js';
import { addDays, addMonths, isDate, isMonth, nowRome } from '../time.js';
import { WaitlistError, entriesOf } from '../waitlist.js';
import { availabilityPage } from '../views/availability.js';
import { needPartner, safeNext } from './guards.js';

const clampInt = (v, min, max, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function availabilityRouter(app) {
  const r = express.Router();
  const { db, cfg, content } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ip = (req) => req.ip ?? 'ip';

  r.use(['/b2b/availability', '/b2b/waitlist'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** I servizi che l'agenzia può prenotare, come nella ricerca per data. */
  const services = () => {
    const rates = app.rates.get();
    return content.tours.filter((x) => x.active && openTo(rates, x, 'b2b'));
  };

  /** Tutto ciò che serve alla pagina, letto dall'indirizzo (valori non validi → quelli di partenza). */
  function readView(req, nowMs) {
    const tours = services();
    const tour = tours.find((x) => x.slug === String(req.query.tour ?? '')) ?? tours[0] ?? null;
    const today = nowRome(nowMs).date;
    const entries = entriesOf(db, req.acct.id, today);
    if (!tour) return { tours, tour: null, entries };
    const pax = clampInt(req.query.pax, 1, tour.maxParticipants, Math.min(2, tour.maxParticipants));
    const hours = tour.pricing === 'hourly' ? (tour.chooseHours ? (hourOptions(tour.service).includes(Number(req.query.hours)) ? Number(req.query.hours) : minHours(tour.service)) : tour.durationMin / 60) : null;
    const tourLang = tour.model === 'person' && tour.languages.includes(String(req.query.tl ?? '')) ? String(req.query.tl) : null;
    const firstMonth = today.slice(0, 7);
    const lastMonth = addDays(today, cfg.policy.maxAdvanceDays).slice(0, 7);
    let month = isMonth(String(req.query.m ?? '')) ? String(req.query.m) : firstMonth;
    month = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
    const durationMin = hours != null ? Math.round(hours * 60) : null;
    const opts = { pax, channel: 'b2b', nowMs, durationMin, tourLang, accountId: req.acct.id };
    const overview = monthOverview(db, cfg, tour, month, opts);
    const days = Object.keys(overview).sort();
    const asked = String(req.query.d ?? '');
    const selected = isDate(asked) && asked.slice(0, 7) === month ? asked : (days.find((d) => overview[d].state === 'free') ?? days[0] ?? null);
    const day = selected ? dayOverviewFor(db, cfg, tour, selected, opts) : null;
    const step = (n) => addMonths(`${month}-01`, n).slice(0, 7);
    return { tours, tour, pax, hours, tourLang, month, prev: month > firstMonth ? step(-1) : '', next: month < lastMonth ? step(1) : '', overview, selected, day, entries };
  }

  /** L'indirizzo di questa pagina senza l'esito dell'ultima azione: i moduli lo rimandano per tornarci. */
  const hereOf = (req) => {
    const url = new URL(req.originalUrl, 'http://x');
    url.searchParams.delete('flash');
    return url.pathname + url.search;
  };

  r.get('/b2b/availability', needPartner, (req, res) => {
    send(res, availabilityPage(res.locals.ctx, { ...readView(req, Date.now()), flash: String(req.query.flash ?? ''), here: hereOf(req) }));
  });

  /** Torna alla pagina da cui si è partiti (indirizzo interno e sicuro), con l'esito. */
  const back = (req, res, flash) => {
    const url = new URL(safeNext(req.body?.next) || `/${req.lang}/b2b/availability`, 'http://x');
    url.searchParams.set('flash', flash);
    url.hash = flash.startsWith('err-') || flash === 'joined' ? '#giorno' : '#lista';
    res.redirect(303, url.pathname + url.search + url.hash);
  };

  r.post('/b2b/waitlist', needPartner, form, async (req, res) => {
    if (!app.limits.booking(ip(req))) return tooMany(res);
    try {
      await app.waitlist.join(req.acct, req.body, Date.now());
    } catch (e) {
      if (!(e instanceof WaitlistError)) throw e;
      return back(req, res, `err-${e.code}`);
    }
    back(req, res, 'joined');
  });

  const entryId = (req) => clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
  r.post('/b2b/waitlist/:id/remove', needPartner, form, (req, res) => {
    app.waitlist.remove(req.acct, entryId(req));
    back(req, res, 'removed');
  });
  r.post('/b2b/waitlist/:id/rearm', needPartner, form, (req, res) => {
    app.waitlist.rearm(req.acct, entryId(req));
    back(req, res, 'rearmed');
  });

  return r;
}
