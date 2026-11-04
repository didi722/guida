// Commerciale › Email: scrivere a un contatto, la coda con lo storico, i modelli. (Il resto del Commerciale è in admin-leads.js.)
import express from 'express';
import { send } from '../http.js';
import { normLang, LANGS } from '../langs.js';
import { LeadError, getContact, getLead, recipients } from '../leads.js';
import { TEMPLATE_KEYS, cancelEmail, composeEmail, estimateSendTimes, fillTemplate, queuedEmails, recentEmails, saveSendSettings, saveSender, saveTemplate, sendSettings, senderOf, sentOn, setPaused, templates, unknownVariables, variablesFor } from '../leadMail.js';
import { isEmail } from '../util.js';
import { localToInstant, nowRome, isDate } from '../time.js';
import { cleanText } from '../util.js';
import { composePage, mailPage, templatesPage } from '../views/admin-leads-mail.js';

const FLASH = {
  sent: 'Email inviata. La trovi nel registro del contatto.',
  queued: 'Email in coda: parte da sola nel primo momento utile.',
  queuedMany: (q) => `${Number(q.n) === 1 ? '1 presentazione messa in coda' : `${q.n} presentazioni messe in coda`}${Number(q.skip) ? ` (${q.skip} ${Number(q.skip) === 1 ? 'saltata' : 'saltate'})` : ''}: ${Number(q.n) === 1 ? 'parte da sola' : 'partono da sole'}, poche al giorno.`,
  preview: 'Anteprima inviata al tuo indirizzo.',
  cancelled: 'Email annullata.',
  paused: 'Invio automatico in pausa: le email restano in coda.',
  resumed: 'Invio automatico ripreso.',
  settings: 'Impostazioni salvate.',
  sender: 'Mittente salvato: da adesso le email commerciali partono da lì. Fai una prova di invio per esserne sicuro.',
  senderTest: 'Prova inviata: controlla che sia arrivata e da quale indirizzo.',
  saved: 'Modello salvato.',
  reset: 'Tornato al testo di partenza.',
  test: 'Prova inviata al tuo indirizzo.',
};
const ERR = {
  email: 'L’indirizzo del destinatario non è valido.',
  blocked: 'A questo contatto non si può scrivere: ha chiesto di non ricevere email.',
  empty: 'Servono sia l’oggetto sia il testo.',
  placeholder: 'Nel testo c’è un segnaposto sbagliato (parentesi graffe doppie): controlla e riprova.',
  duplicate: 'C’è già una email così in coda per questo contatto: annullala prima, oppure scrivine una a mano.',
  notfound: 'Contatto non trovato.',
  date: 'Scegli un giorno nel futuro.',
  failed: 'L’email non è partita: controlla la posta in Aiuto › Email.',
  nomail: 'Non ho un indirizzo a cui scrivere (o il contatto non vuole email).',
  nonotify: 'Manca l’indirizzo che riceve le notifiche (Sito › Impostazioni › Attività e contatti): non so a chi mandare la prova.',
  previewFailed: 'La prova non è partita: controlla la posta in Aiuto › Email.',
  limit: 'Valori non validi.',
  template: 'Modello sconosciuto.',
};

/** Il testo di un errore di salvataggio (i segnaposto sbagliati si elencano). */
const errorText = (err) => (err.code === 'placeholder' && err.names?.length ? `Segnaposto sconosciuto: ${err.names.map((n) => `{{${n}}}`).join(', ')}. Puoi usare solo quelli dell’elenco.` : ERR[err.code] ?? `Errore (${err.code}).`);

export function adminLeadsMailRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '60kb' });
  const ctxOf = (req) => ({ app, req });
  const flash = (req) => {
    const f = FLASH[String(req.query.ok ?? '')];
    return typeof f === 'function' ? f(req.query) : f ?? '';
  };

  // ───── coda e storico ─────
  /** La coda con l'orario stimato di partenza di ciascuna email (`eta`, in ISO; vuoto se l'invio è in pausa). */
  const queueWithTimes = () => {
    const queue = queuedEmails(db);
    const times = estimateSendTimes(db, queue);
    return queue.map((e, i) => ({ ...e, eta: times[i] == null ? null : new Date(times[i]).toISOString() }));
  };
  /** La pagina Email: coda, storico, mittente e impostazioni. `over` porta ciò che si stava scrivendo in un modulo rifiutato. */
  const mailView = (req, res, { error = '', settings = {}, status = 200 } = {}) =>
    send(res, mailPage(ctxOf(req), {
      queue: queueWithTimes(), history: recentEmails(db, 100), settings: { ...sendSettings(db), ...settings }, sender: senderOf(app), notifyTo: app.cfg.mail.notifyTo, sentToday: sentOn(db, nowRome().date),
      flash: error ? '' : flash(req), error,
    }), status);
  r.get('/leads/mail', (req, res) => mailView(req, res, { error: ERR[String(req.query.err ?? '')] ?? '' }));
  r.post('/leads/mail/pause', form, (req, res) => {
    setPaused(db, true);
    res.redirect(303, '/admin/leads/mail?ok=paused');
  });
  r.post('/leads/mail/resume', form, (req, res) => {
    setPaused(db, false);
    res.redirect(303, '/admin/leads/mail?ok=resumed');
  });
  r.post('/leads/mail/settings', form, (req, res) => {
    const out = saveSendSettings(db, req.body);
    if (out.error) return mailView(req, res, { error: out.error, settings: { ...req.body, signature: String(req.body.signature ?? '') }, status: 400 });
    res.redirect(303, '/admin/leads/mail?ok=settings');
  });
  // da quale indirizzo partono le email commerciali, e una prova per vedere che il server di posta lo accetti
  r.post('/leads/mail/sender', form, (req, res) => {
    const out = saveSender(db, req.body);
    if (out.error) return mailView(req, res, { error: out.error, settings: { fromEmail: req.body.fromEmail, fromName: req.body.fromName, replyTo: req.body.replyTo, bcc: req.body.bcc }, status: 400 });
    res.redirect(303, '/admin/leads/mail?ok=sender#mittente');
  });
  r.post('/leads/mail/sender-test', form, async (req, res) => {
    const to = cleanText(req.body.to, 254).toLowerCase();
    if (!isEmail(to)) return mailView(req, res, { error: 'Scrivi un indirizzo email valido a cui mandare la prova.', status: 400 });
    const out = await app.leads.testSender(to);
    if (!out.ok) return mailView(req, res, { error: `La prova non è partita da ${out.from}. Il server di posta dice: ${out.error}`, status: 502 });
    res.redirect(303, '/admin/leads/mail?ok=senderTest#mittente');
  });
  r.post('/leads/mail/:id/cancel', form, (req, res) => {
    cancelEmail(db, Number(req.params.id));
    const back = Number(req.body.back);
    res.redirect(303, Number.isInteger(back) && back > 0 ? `/admin/leads/${back}?ok=cancelled` : '/admin/leads/mail?ok=cancelled');
  });

  // ───── i modelli ─────
  const sample = (key, lang) => {
    const t = templates(db)[key][lang];
    const vars = variablesFor(app, { id: 0, company: 'Agenzia di prova', lang }, { name: 'Anna Rossi' }, lang);
    return { subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars) };
  };
  const templatesView = (req, res, { key, lang, error = '', status = 200, shown = null }) => {
    const all = templates(db);
    if (shown) all[key][lang] = { ...all[key][lang], ...shown }; // il testo che si stava scrivendo, se il salvataggio è stato rifiutato
    send(res, templatesPage(ctxOf(req), { templates: all, key, lang, sample: sample(key, lang), flash: error ? '' : flash(req), error }), status);
  };
  r.get('/leads/templates', (req, res) => {
    const key = TEMPLATE_KEYS.includes(req.query.key) ? req.query.key : 'presentation';
    const lang = LANGS.includes(req.query.lang) ? req.query.lang : 'it';
    templatesView(req, res, { key, lang });
  });
  r.post('/leads/templates', form, async (req, res) => {
    const key = TEMPLATE_KEYS.includes(req.body.key) ? req.body.key : 'presentation';
    const lang = LANGS.includes(req.body.lang) ? req.body.lang : 'it';
    const back = (ok) => res.redirect(303, `/admin/leads/templates?key=${key}&lang=${lang}&ok=${ok}`);
    const subject = cleanText(req.body.subject, 200);
    const body = String(req.body.body ?? '');
    try {
      if (req.body.action === 'reset') {
        saveTemplate(db, key, lang, { subject: '', body: '' });
        return back('reset');
      }
      if (req.body.action === 'test') {
        const bad = unknownVariables(`${subject} ${body}`);
        if (bad.length) throw Object.assign(new LeadError('placeholder'), { names: bad });
        const vars = variablesFor(app, { id: 0, company: 'Agenzia di prova', lang }, { name: 'Anna Rossi' }, lang);
        const ok = await app.leads.preview({ lead: { id: 0, company: 'Agenzia di prova', lang }, lang, subject: fillTemplate(subject, vars), body: fillTemplate(body, vars) });
        if (!ok) return templatesView(req, res, { key, lang, error: app.cfg.mail.notifyTo ? ERR.previewFailed : ERR.nonotify, shown: { subject, body }, status: 400 });
        return back('test');
      }
      saveTemplate(db, key, lang, { subject, body });
      return back('saved');
    } catch (err) {
      if (!(err instanceof LeadError)) throw err;
      return templatesView(req, res, { key, lang, error: errorText(err), shown: { subject, body }, status: 400 });
    }
  });

  // ───── scrivere a un contatto ─────
  /** Gli indirizzi a cui si può scrivere, con una chiave stabile («c12» = il referente 12, «lead» = l'indirizzo dell'agenzia). */
  const options = (lead) => recipients(db, lead).map((x) => ({ ...x, key: x.contactId ? `c${x.contactId}` : 'lead' }));

  const composeView = (req, res, lead, { key, template, lang, subject, body, error = '', ok = '', status = 200 }) => {
    const recs = options(lead);
    const chosen = recs.find((x) => x.key === key) ?? recs[0];
    const contact = chosen.contactId ? getContact(db, lead.id, chosen.contactId) : null;
    const l = LANGS.includes(lang) ? lang : normLang(chosen.lang);
    const t = TEMPLATE_KEYS.includes(template) ? template : 'presentation';
    const fresh = composeEmail(app, { lead, contact, template: t, lang: l });
    send(res, composePage(ctxOf(req), { lead, recipients: recs, pick: chosen.key, template: t, lang: l, compose: { to: chosen.email, subject: subject ?? fresh.subject, body: body ?? fresh.body }, settings: sendSettings(db), flash: ok, error }), status);
  };

  r.get('/leads/:id/mail', (req, res, next) => {
    const lead = getLead(db, req.params.id);
    if (!lead) return next();
    if (!lead.email_ok || !options(lead).length) return res.redirect(303, `/admin/leads/${lead.id}?err=nomail`);
    composeView(req, res, lead, { key: String(req.query.to ?? (req.query.contact ? `c${Number(req.query.contact)}` : '')), template: req.query.t, lang: req.query.l });
  });

  r.post('/leads/:id/mail', form, async (req, res, next) => {
    const lead = getLead(db, req.params.id);
    if (!lead) return next();
    const b = req.body;
    const recs = options(lead);
    const chosen = recs.find((x) => x.email === String(b.to ?? '').toLowerCase()); // solo gli indirizzi che il contatto ha: da qui non si scrive a nessun altro
    const template = TEMPLATE_KEYS.includes(b.template) ? b.template : 'custom';
    const lang = normLang(b.lang);
    const subject = cleanText(b.subject, 200);
    const text = String(b.body ?? '');
    const redraw = (error, ok = '', status = 400) => composeView(req, res, lead, { key: chosen?.key, template: TEMPLATE_KEYS.includes(b.template) ? b.template : 'presentation', lang, subject, body: text, error, ok, status });
    if (!chosen || !lead.email_ok) return redraw(ERR.nomail);
    if (!subject || !text.trim()) return redraw(ERR.empty);
    if (unknownVariables(`${subject} ${text}`).length) return redraw(ERR.placeholder);

    if (b.action === 'preview') {
      const ok = app.cfg.mail.notifyTo ? await app.leads.preview({ lead, lang, subject, body: text }) : false;
      return redraw(ok ? '' : app.cfg.mail.notifyTo ? ERR.previewFailed : ERR.nonotify, ok ? FLASH.preview : '', ok ? 200 : 400);
    }

    const when = ['now', 'queue', 'date'].includes(b.when) ? b.when : 'now';
    let sendAfter;
    if (when === 'date') {
      const day = String(b.sendDate ?? '');
      if (!isDate(day) || day <= nowRome().date) return redraw(ERR.date);
      sendAfter = localToInstant(day, `${String(sendSettings(db).fromHour).padStart(2, '0')}:00`);
    }
    const days = b.followup === '1' ? Number.parseInt(b.followupDays, 10) : null;
    try {
      const out = await app.leads.write({ leadId: lead.id, contactId: chosen.contactId, to: chosen.email, template, lang, subject, body: text.replace(/\r\n/g, '\n'), mode: when === 'now' ? 'now' : 'queue', sendAfter, followupDays: days }, Date.now());
      if (when === 'now' && !out.sent) return redraw(out.skipped ? `Non è partita: ${out.skipped}.` : ERR.failed, '', 502);
      return res.redirect(303, `/admin/leads/${lead.id}?ok=${when === 'now' ? 'emailSent' : 'emailQueued'}`);
    } catch (err) {
      if (!(err instanceof LeadError)) throw err;
      return redraw(errorText(err));
    }
  });

  return r;
}
