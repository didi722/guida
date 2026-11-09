// Area agenzie › Nuova prenotazione (/book): servizio, persone e giorno su una sola pagina — gli orari del primo giorno libero compaiono subito —
// e la lista d'attesa («avvisami se si libera»). I vecchi indirizzi (/b2b/availability, /book?date=…) portano qui.
import express from 'express';
import { dayOverviewFor, loadAvailabilityContext, monthOverview, slotsForDay } from '../availability.js';
import { send, tooMany } from '../http.js';
import { hourlyQuote, unitPriceFor } from '../pricing.js';
import { hourOptions, minHours, openTo } from '../rates.js';
import { addDays, addMonths, isDate, isMonth, nowRome } from '../time.js';
import { cleanText } from '../util.js';
import { WaitlistError, entriesOf, queueInfo } from '../waitlist.js';
import { availabilityPage } from '../views/availability.js';
import { minBookableDate } from '../views/site.js';
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

  r.use(['/book', '/b2b/availability', '/b2b/waitlist'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** I servizi che l'agenzia può prenotare. */
  const services = () => {
    const rates = app.rates.get();
    return content.tours.filter((x) => x.active && openTo(rates, x, 'b2b'));
  };

  /** La durata con cui si cerca: quella fissa del servizio, oppure quella scelta (se è valida) o la più breve. */
  const hoursOf = (tour, asked) => (tour.pricing !== 'hourly' ? null : tour.chooseHours ? (hourOptions(tour.service).includes(asked) ? asked : minHours(tour.service)) : tour.durationMin / 60);

  /** Tutto ciò che serve alla pagina, letto dall'indirizzo (valori non validi → quelli di partenza). */
  function readView(req, nowMs) {
    const tours = services();
    const today = nowRome(nowMs).date;
    const entries = entriesOf(db, req.acct.id, today).map((e) => ({ ...e, queue: queueInfo(db, cfg, e, nowMs) }));
    if (!tours.length) return { tours, tour: null, entries };

    // di partenza: il servizio dell'ultima prenotazione dell'agenzia, così chi ripete lo stesso lavoro non deve sceglierlo
    const last = db.prepare("SELECT tour_slug FROM bookings WHERE account_id = ? AND status NOT IN ('cancelled', 'expired') ORDER BY id DESC LIMIT 1").get(req.acct.id);
    const tour = tours.find((x) => x.slug === String(req.query.tour ?? '')) ?? tours.find((x) => x.slug === last?.tour_slug) ?? tours[0];
    const pax = clampInt(req.query.pax, 1, tour.maxParticipants, Math.min(2, tour.maxParticipants));
    const hours = hoursOf(tour, Number(req.query.hours));
    const tourLang = tour.model === 'person' && tour.languages.includes(String(req.query.tl ?? '')) ? String(req.query.tl) : null;
    const durationMin = hours != null ? Math.round(hours * 60) : null;
    const opts = { pax, channel: 'b2b', nowMs, durationMin, tourLang, accountId: req.acct.id };

    const firstMonth = today.slice(0, 7);
    const lastDay = addDays(today, cfg.policy.maxAdvanceDays);
    const lastMonth = lastDay.slice(0, 7);
    const step = (m, n) => addMonths(`${m}-01`, n).slice(0, 7);
    // il giorno chiesto: dal calendario (d) o da un vecchio collegamento (date); un giorno passato o troppo lontano non conta
    const wanted = String(req.query.d ?? req.query.date ?? '');
    const askedDay = isDate(wanted) && wanted >= today && wanted <= lastDay ? wanted : '';
    const askedMonth = isMonth(String(req.query.m ?? '')) ? String(req.query.m) : '';
    let month = askedDay.slice(0, 7) || askedMonth || firstMonth; // il giorno chiesto decide il mese
    month = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
    let overview = monthOverview(db, cfg, tour, month, opts);
    // senza una scelta e con il mese in corso tutto occupato, si apre il primo mese che ha un giorno libero
    if (!askedMonth && !askedDay && !Object.values(overview).some((x) => x.state === 'free')) {
      for (let i = 1; i <= 3 && step(firstMonth, i) <= lastMonth; i++) {
        const next = monthOverview(db, cfg, tour, step(firstMonth, i), opts);
        if (Object.values(next).some((x) => x.state === 'free')) {
          month = step(firstMonth, i);
          overview = next;
          break;
        }
      }
    }
    const days = Object.keys(overview).sort();
    const chosen = askedDay || null;
    const selected = chosen ?? days.find((d) => overview[d].state === 'free') ?? days[0] ?? null;
    const day = selected ? dayOverviewFor(db, cfg, tour, selected, opts) : null;

    // gli altri servizi liberi nello stesso giorno (per lo stesso numero di persone): se questo è occupato, l'agenzia vede subito dove andare
    let also = [];
    if (selected) {
      const actx = loadAvailabilityContext(db, cfg, selected, selected, nowMs);
      also = tours
        .filter((x) => x.slug !== tour.slug && x.maxParticipants >= pax)
        .map((x) => {
          const h = hoursOf(x, null);
          return { tour: x, n: slotsForDay(actx, cfg, x, selected, { pax, channel: 'b2b', nowMs, durationMin: h != null ? Math.round(h * 60) : null }).length };
        })
        .filter((x) => x.n > 0);
    }

    // quanto costa (tariffa dell'agenzia), per non dover aprire il pagamento solo per scoprirlo
    let price = null;
    if (tour.pricing === 'hourly') {
      const quote = hourlyQuote(app, tour, { pax, channel: 'b2b', account: req.acct, date: selected, time: null, hours });
      price = quote.ok ? quote.totalCents : null;
    } else {
      const unit = unitPriceFor(tour, 'b2b', req.acct);
      price = tour.model === 'person' ? unit * pax : unit;
    }
    return {
      tours, tour, pax, hours, tourLang, clientRef: cleanText(req.query.cr, 120), month, prev: month > firstMonth ? step(month, -1) : '', next: month < lastMonth ? step(month, 1) : '',
      overview, selected, auto: !chosen, asked: askedDay, day, also, price, entries, minDate: minBookableDate(app, 'b2b', nowMs), maxDate: lastDay,
    };
  }

  /** L'indirizzo di questa pagina senza l'esito dell'ultima azione: i moduli lo rimandano per tornarci. */
  const hereOf = (req) => {
    const url = new URL(req.originalUrl, 'http://x');
    url.searchParams.delete('flash');
    return url.pathname + url.search;
  };

  // le agenzie prenotano da qui; chi non è un'agenzia approvata resta sulla pagina pubblica (stesso indirizzo)
  r.get('/book', (req, res, next) => {
    if (req.acct?.status !== 'approved') return next();
    send(res, availabilityPage(res.locals.ctx, { ...readView(req, Date.now()), flash: String(req.query.flash ?? ''), here: hereOf(req) }));
  });

  // il vecchio «Date libere»: stessa pagina, stessi parametri
  r.get('/b2b/availability', needPartner, (req, res) => {
    const q = new URLSearchParams(req.query);
    res.redirect(302, `/${req.lang}/book${q.size ? `?${q}` : ''}`);
  });

  /** Torna alla pagina da cui si è partiti (indirizzo interno e sicuro), con l'esito. */
  const back = (req, res, flash) => {
    const url = new URL(safeNext(req.body?.next) || `/${req.lang}/book`, 'http://x');
    url.searchParams.set('flash', flash);
    url.hash = flash.startsWith('err-') || flash === 'joined' ? '#giorno' : '#lista';
    res.redirect(303, url.pathname + url.search + url.hash);
  };

  r.post('/b2b/waitlist', needPartner, form, async (req, res) => {
    if (!app.limits.booking(ip(req))) return tooMany(res);
    try {
      await app.waitlist.join(req.acct, req.body, Date.now(), req.actor?.userId ?? null); // l'avviso arriva a chi l'ha chiesto
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
