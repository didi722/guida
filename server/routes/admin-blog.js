// Articoli del blog e pagine fisse (Chi sono, privacy, condizioni, cookie) modificabili dal pannello.
import express from 'express';
import { ContentError, PAGE_NAMES, SLUG } from '../content.js';
import { send } from '../http.js';
import { LANGS } from '../langs.js';
import { slugify } from './admin-tours.js';
import { blogListPage, pageFormPage, pagesListPage, postFormPage, postToValues } from '../views/admin-blog.js';

const FLASH = { saved: 'Salvato.', created: 'Articolo creato.', deleted: 'Articolo eliminato.' };
const text = (s, max) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

function bodyToPost(body) {
  const raw = { date: String(body.date ?? '').trim(), published: !!body.published, art: String(body.art ?? 'dome'), image: String(body.image ?? '').trim() || null, tours: [].concat(body.tours ?? []).map(String) };
  for (const l of LANGS) {
    const x = { title: text(body[`title_${l}`], 160), summary: text(body[`summary_${l}`], 400), tags: String(body[`tags_${l}`] ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12), body: text(body[`body_${l}`], 100000) };
    if (x.title || x.body) raw[l] = x;
  }
  return raw;
}

function bodyToPage(body) {
  const raw = {};
  for (const l of LANGS) {
    const x = { title: text(body[`title_${l}`], 160), description: text(body[`description_${l}`], 300), body: text(body[`body_${l}`], 100000) };
    if (x.title || x.body) raw[l] = x;
  }
  return raw;
}

export function adminBlogRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '600kb' });
  const ctxOf = (req) => ({ app, req });
  const store = () => app.content;
  const flash = (req) => FLASH[String(req.query.ok ?? '')] ?? '';

  r.get('/blog', (req, res) => send(res, blogListPage(ctxOf(req), { posts: store().allPosts, flash: flash(req) })));
  r.get('/blog/new', (req, res) => send(res, postFormPage(ctxOf(req), { v: postToValues({ date: new Date().toISOString().slice(0, 10), published: true }), isNew: true, media: app.media.list(), tours: store().allTours })));

  const rerender = (req, res, { slug, isNew, raw, errors, status = 400 }) =>
    send(res, postFormPage(ctxOf(req), { v: postToValues(raw, slug), isNew, media: app.media.list(), tours: store().allTours, problems: errors, post: store().postAny(slug) }), status);

  r.post('/blog', form, (req, res) => {
    const raw = bodyToPost(req.body);
    const slug = String(req.body.slug ?? '').trim() || slugify(raw.it?.title ?? Object.values(raw).find((x) => x?.title)?.title);
    const errors = [];
    if (!SLUG.test(slug)) errors.push('L’indirizzo web può contenere solo lettere minuscole, numeri e trattini');
    if (!errors.length) {
      try {
        store().savePost(slug, raw, { create: true });
        return res.redirect(303, `/admin/blog/${slug}?ok=created`);
      } catch (err) {
        if (!(err instanceof ContentError)) throw err;
        errors.push(err.detail);
      }
    }
    rerender(req, res, { slug, isNew: true, raw, errors });
  });

  r.get('/blog/:slug', (req, res, next) => {
    const raw = store().rawPost(req.params.slug);
    if (!raw) return next();
    send(res, postFormPage(ctxOf(req), { v: postToValues(raw, req.params.slug), isNew: false, media: app.media.list(), tours: store().allTours, post: store().postAny(req.params.slug), flash: flash(req) }));
  });

  r.post('/blog/:slug', form, (req, res, next) => {
    const slug = req.params.slug;
    if (!store().rawPost(slug)) return next();
    const raw = bodyToPost(req.body);
    try {
      store().savePost(slug, raw);
      return res.redirect(303, `/admin/blog/${slug}?ok=saved`);
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
      rerender(req, res, { slug, isNew: false, raw, errors: [err.detail] });
    }
  });

  r.post('/blog/:slug/delete', form, (req, res, next) => {
    if (!store().rawPost(req.params.slug)) return next();
    store().deletePost(req.params.slug);
    res.redirect(303, '/admin/blog?ok=deleted');
  });

  // pagine fisse
  r.get('/pages', (req, res) => send(res, pagesListPage(ctxOf(req), { flash: flash(req) })));
  r.get('/pages/:name', (req, res, next) => {
    if (!PAGE_NAMES.includes(req.params.name) || !store().rawPage(req.params.name)) return next();
    send(res, pageFormPage(ctxOf(req), { name: req.params.name, raw: store().rawPage(req.params.name), flash: flash(req) }));
  });
  r.post('/pages/:name', form, (req, res, next) => {
    const name = req.params.name;
    if (!PAGE_NAMES.includes(name)) return next();
    const raw = bodyToPage(req.body);
    try {
      store().savePage(name, raw);
      res.redirect(303, `/admin/pages/${name}?ok=saved`);
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
      send(res, pageFormPage(ctxOf(req), { name, raw, problems: [err.detail] }), 400);
    }
  });

  return r;
}
