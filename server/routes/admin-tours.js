// Tour e listino prezzi modificabili dal pannello (si salvano nel database; vedi contentStore.js).
import express from 'express';
import { ContentError, SLUG, audienceOf, md } from '../content.js';
import { LANGS } from '../langs.js';
import { nowRome } from '../time.js';
import { parseEuros } from '../util.js';
import { send } from '../http.js';
import { LIST_FIELDS, TEXT_FIELDS, defToValues, pricesPage, sectionOf, toursPage, tourFormPage } from '../views/admin-tours.js';

const FLASH = { saved: 'Tour salvato.', created: 'Tour creato.', toggled: 'Visibilità aggiornata.', deleted: 'Tour eliminato.', prices: 'Prezzi aggiornati.' };

export const slugify = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const lines = (s) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const text = (s, max) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

/**
 * Dal modulo alla definizione che si salva. `existing` conserva ciò che il modulo non mostra (come l'ordine, che si cambia trascinando
 * i tour nell'elenco); un tour nuovo va in fondo (`nextOrder`).
 */
export function bodyToDef(body, existing = {}, { nextOrder = 100 } = {}) {
  const errors = [];
  const euros = (name, label, { required = false } = {}) => {
    const raw = String(body[name] ?? '').trim();
    if (!raw) {
      if (required) errors.push(`${label}: scrivi un importo`);
      return null;
    }
    const c = parseEuros(raw);
    if (c == null || c < 0) errors.push(`${label}: «${raw}» non è un importo valido (es. 35 oppure 35,50)`);
    return c == null ? null : c / 100;
  };
  const int = (name) => {
    const raw = String(body[name] ?? '').trim();
    return raw === '' ? null : Number(raw);
  };
  const hourly = body.pricing === 'hourly'; // il prezzo viene dalle tariffe a ore (Sito › Tariffe a ore)
  const model = hourly || body.model === 'group' ? 'group' : 'person';
  const wd = [].concat(body.wd ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (!wd.length) errors.push('Scegli almeno un giorno della settimana');
  const def = {
    order: Number.isFinite(Number(existing.order)) && existing.order != null ? Number(existing.order) : nextOrder,
    active: !!body.active,
    featured: !!body.featured,
    model,
    flexible: !!body.flexible,
    times: String(body.times ?? '').split(/[\s,;]+/).filter(Boolean),
    weekdays: wd,
    duration: (int('durH') ?? 0) * 60 + (int('durM') ?? 0),
    maxParticipants: int('maxParticipants'),
    price: euros('price', body.audience === 'b2b' ? 'Tariffa agenzie' : 'Prezzo al pubblico', { required: !hourly }),
    audience: body.audience === 'b2b' ? 'b2b' : 'b2c', // un tour è dei privati o delle agenzie, con un solo prezzo
    cancelHours: int('cancelHours'),
    payOnSite: !!body.payOnSite,
    themeOther: !!body.themeOther,
    meetingChoice: !!body.meetingChoice,
    ...(model === 'person' ? { inviteEnabled: !!body.inviteEnabled, invitePercent: int('invitePercent') } : {}),
    art: String(body.art ?? 'dome'),
    image: String(body.image ?? '').trim() || null,
    languages: [].concat(body.langs ?? []).filter((l) => LANGS.includes(l)),
  };
  if (hourly) {
    def.pricing = 'hourly';
    def.service = String(body.service ?? 'guide');
    def.chooseHours = !!body.chooseHours;
    def.roundHours = !!body.chooseHours && !!body.roundHours;
    delete def.price;
  }
  if (existing.category) def.category = existing.category;
  for (const l of LANGS) {
    const block = {};
    for (const f of TEXT_FIELDS) {
      const raw = body[`${f}_${l}`];
      block[f] = LIST_FIELDS.includes(f) ? lines(raw).map((x) => x.slice(0, 300)) : text(raw, f === 'description' ? 20000 : f === 'faq' ? 20000 : 600);
    }
    const filled = TEXT_FIELDS.some((f) => (LIST_FIELDS.includes(f) ? block[f].length : block[f]));
    if (!filled && l !== 'it') continue; // lingua non compilata: il sito ripiega su un'altra
    if (existing[l]?.languagesLabel) block.languagesLabel = existing[l].languagesLabel;
    def[l] = block;
  }
  return { def, errors };
}

export function adminToursRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '300kb' });
  const ctxOf = (req) => ({ app, req });
  const upcomingFor = () => {
    const today = nowRome().date;
    return Object.fromEntries(db.prepare(`SELECT tour_slug, COUNT(*) n FROM bookings WHERE status = 'confirmed' AND date >= ? GROUP BY tour_slug`).all(today).map((x) => [x.tour_slug, x.n]));
  };
  const store = () => app.content;

  // due sezioni: i tour dei privati (B2C) e quelli delle agenzie (B2B)
  for (const audience of ['b2c', 'b2b']) {
    r.get(sectionOf(audience).path.replace('/admin', ''), (req, res) => send(res, toursPage(ctxOf(req), { tours: store().allTours, audience, upcoming: upcomingFor(), flash: FLASH[String(req.query.ok ?? '')] ?? '', error: req.query.err ? String(req.query.err).slice(0, 300) : '' })));
  }

  // ordine dei tour (prima di /tours/:slug, che altrimenti prenderebbe «order» per un indirizzo): l'elenco si trascina (public/js/admin-tours-order.js) e qui si salva la sequenza
  r.post('/tours/order', express.json({ limit: '20kb' }), (req, res) => {
    const slugs = req.body?.slugs;
    if (!Array.isArray(slugs) || slugs.length > 200 || slugs.some((x) => typeof x !== 'string')) return res.status(400).json({ ok: false });
    store().setTourOrder(slugs);
    res.json({ ok: true, order: store().allTours.map((t) => t.slug) });
  });

  r.get('/tours/new', (req, res) => {
    const from = req.query.from ? store().rawTour(String(req.query.from)) : null;
    const audience = req.query.audience === 'b2b' ? 'b2b' : req.query.audience === 'b2c' ? 'b2c' : null;
    const v = defToValues(from ?? { duration: 120, maxParticipants: 10, order: 100, times: ['10:00'] }, '');
    if (audience) v.audience = audience; // «Nuovo tour B2B», «Duplica come tour B2B»
    if (from) for (const l of LANGS) if (v[`title_${l}`]) v[`title_${l}`] += l === 'it' ? ' (copia)' : ' (copy)';
    send(res, tourFormPage(ctxOf(req), { v, isNew: true, media: app.media.list() }));
  });

  const render = (req, res, { v, isNew, error = '', status = 200, tour = null }) =>
    send(res, tourFormPage(ctxOf(req), { v, isNew, media: app.media.list(), error: '', problems: error ? [].concat(error) : [], tour, flash: FLASH[String(req.query.ok ?? '')] ?? '' }), status);

  /** Il corpo del modulo, riportato nel formato dei valori (per riproporlo dopo un errore). */
  const bodyValues = (body, slug) => {
    const v = defToValues({}, slug);
    for (const k of Object.keys(v)) if (body[k] !== undefined) v[k] = Array.isArray(v[k]) ? [].concat(body[k]) : String(body[k]);
    v.active = body.active ? '1' : '';
    v.featured = body.featured ? '1' : '';
    v.flexible = body.flexible ? '1' : '';
    v.chooseHours = body.chooseHours ? '1' : '';
    v.roundHours = body.roundHours ? '1' : '';
    v.themeOther = body.themeOther ? '1' : '';
    v.meetingChoice = body.meetingChoice ? '1' : '';
    v.inviteEnabled = body.inviteEnabled ? '1' : '';
    v.payOnSite = body.payOnSite ? '1' : '';
    v.wd = [].concat(body.wd ?? []).map(String);
    v.langs = [].concat(body.langs ?? []);
    return v;
  };

  r.post('/tours', form, (req, res) => {
    const slug = String(req.body.slug ?? '').trim() || slugify(req.body.title_it);
    const { def, errors } = bodyToDef(req.body, {}, { nextOrder: Math.max(0, ...store().allTours.map((t) => t.order)) + 10 }); // un tour nuovo va in fondo all'elenco
    if (!SLUG.test(slug)) errors.push('L’indirizzo web può contenere solo lettere minuscole, numeri e trattini');
    if (!errors.length) {
      try {
        store().saveTour(slug, def, { create: true });
        return res.redirect(303, `/admin/tours/${slug}?ok=created`);
      } catch (err) {
        if (!(err instanceof ContentError)) throw err;
        errors.push(err.detail);
      }
    }
    render(req, res, { v: bodyValues(req.body, slug), isNew: true, error: errors, status: 400 });
  });

  r.get('/tours/:slug', (req, res, next) => {
    const def = store().rawTour(req.params.slug);
    if (!def) return next();
    render(req, res, { v: defToValues(def, req.params.slug), isNew: false, tour: store().tour(req.params.slug) });
  });

  r.post('/tours/:slug', form, (req, res, next) => {
    const slug = req.params.slug;
    const existing = store().rawTour(slug);
    if (!existing) return next();
    const { def, errors } = bodyToDef(req.body, existing);
    if (!errors.length) {
      try {
        store().saveTour(slug, def);
        return res.redirect(303, `/admin/tours/${slug}?ok=saved`);
      } catch (err) {
        if (!(err instanceof ContentError)) throw err;
        errors.push(err.detail);
      }
    }
    render(req, res, { v: bodyValues(req.body, slug), isNew: false, error: errors, status: 400, tour: store().tour(slug) });
  });

  r.post('/tours/:slug/toggle', form, (req, res, next) => {
    const def = store().rawTour(req.params.slug);
    if (!def) return next();
    store().saveTour(req.params.slug, { ...def, active: def.active === false });
    res.redirect(303, `${sectionOf(audienceOf(def)).path}?ok=toggled`);
  });

  r.post('/tours/:slug/delete', form, (req, res, next) => {
    const def = store().rawTour(req.params.slug);
    if (!def) return next();
    const back = sectionOf(audienceOf(def)).path;
    try {
      store().deleteTour(req.params.slug);
      res.redirect(303, `${back}?ok=deleted`);
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
      res.redirect(303, `${back}?err=${encodeURIComponent(err.detail)}`);
    }
  });

  // listino prezzi: tutti i tour insieme
  r.get('/prices', (req, res) => send(res, pricesPage(ctxOf(req), { tours: store().allTours, flash: FLASH[String(req.query.ok ?? '')] ?? '' })));
  r.post('/prices', form, (req, res) => {
    const errors = [];
    const next = [];
    for (const t of store().allTours.filter((x) => x.pricing !== 'hourly')) {
      const price = parseEuros(req.body[`price_${t.slug}`]);
      if (price == null || price < 0) errors.push(`${t.i18n.it.title}: prezzo non valido`);
      else next.push([t.slug, price / 100]);
    }
    if (errors.length) return send(res, pricesPage(ctxOf(req), { tours: store().allTours, values: req.body, error: errors.join(' · ') }), 400);
    for (const [slug, price] of next) {
      const def = store().rawTour(slug);
      if (def && def.price !== price) store().saveTour(slug, { ...def, price });
    }
    res.redirect(303, '/admin/prices?ok=prices');
  });

  // anteprima del markdown (descrizioni, articoli, pagine)
  r.post('/preview', express.json({ limit: '300kb' }), (req, res) => res.json({ html: md(String(req.body?.md ?? '').slice(0, 50000)) }));

  return r;
}
