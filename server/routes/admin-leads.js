// Pannello › Commerciale: Oggi, elenco e scheda dei contatti, referenti, registro, appuntamenti, invito e profilo B2B, importazione ed esportazione.
// (Scrivere le email, la coda e i modelli sono in admin-leads-mail.js.)
import express from 'express';
import { optionalPhone } from '../countries.js';
import { send } from '../http.js';
import {
  APPT_LABEL, KIND_LABEL, LeadError, MANUAL_ACTIVITIES, PRIORITY_LABEL, STATUSES, accountOf, accountStats, addAppointment, addContact, addRegistered, allowEmail, cancelAppointment, cleanContact, cleanLead, completeAppointment, countriesUsed,
  deleteLead, dueLeads, duplicateIndex, getAppointment, getContact, getLead, importLeads, insertLead, leadAppointments, leadCounts, leadsCsv, listContacts, logActivity, optOut, overlapCount, parseImport, plannedAppointments, recipients,
  removeContact, searchLeads, setMainContact, setNextAction, setStatus, snooze, sourcesUsed, syncAccounts, timeline, toContact, unlinkedAccounts, updateAppointment, updateContact, updateLead,
} from '../leads.js';
import { composeEmail, leadEmails, queueEmail, queuedCount, sendSettings } from '../leadMail.js';
import { addDays, isDate, localToInstant, nowRome } from '../time.js';
import { cleanText } from '../util.js';
import { appointmentPage, leadPage, leadsPage, newLeadPage, todayPage } from '../views/admin-leads.js';
import { bulkReviewPage, importPage } from '../views/admin-leads-mail.js';

const FLASH = {
  created: 'Contatto aggiunto.',
  saved: 'Dati salvati.',
  logged: 'Salvato nel registro.',
  next: 'Prossima azione salvata.',
  status: 'Stato cambiato.',
  contact: 'Referente salvato.',
  contactRemoved: 'Referente tolto.',
  main: 'Referente principale cambiato.',
  optout: 'Segnato: da ora nessuna email parte per questo contatto.',
  allowed: 'Email di nuovo consentite.',
  appt: 'Appuntamento fissato: lo trovi anche nell’agenda.',
  apptOver: 'Appuntamento fissato, ma attenzione: si sovrappone a un altro impegno già in agenda (prenotazione, programma o altro appuntamento).',
  apptSaved: 'Appuntamento aggiornato.',
  apptDone: 'Appuntamento segnato come fatto: è nel registro.',
  apptCancelled: 'Appuntamento annullato.',
  emailSent: 'Email inviata: la trovi nel registro.',
  emailQueued: 'Email in coda: parte da sola nel primo momento utile.',
  cancelled: 'Email annullata.',
  deleted: 'Contatto cancellato.',
  bulkStatus: (q) => `Stato cambiato per ${q.n} ${Number(q.n) === 1 ? 'contatto' : 'contatti'}.`,
  bulkDeleted: (q) => `${q.n} ${Number(q.n) === 1 ? 'contatto cancellato' : 'contatti cancellati'}.`,
  registered: (q) => `${q.n} ${Number(q.n) === 1 ? 'agenzia portata' : 'agenzie portate'} tra i contatti.`,
};
const ERR = {
  company: 'Scrivi il nome dell’agenzia.',
  email: 'L’indirizzo email non è valido.',
  website: 'L’indirizzo del sito non è valido (per esempio www.agenzia.it).',
  phone: 'Il telefono va scritto con il prefisso del paese (per esempio +39 041 1234567), oppure lasciato vuoto.',
  contactPhone: 'Il telefono del referente va scritto con il prefisso del paese, oppure lasciato vuoto.',
  contactEmail: 'L’email del referente non è valida.',
  country: 'Non riconosco il paese.',
  date: 'La data non è valida.',
  time: 'Controlla gli orari: la fine deve essere dopo l’inizio.',
  name: 'Scrivi il nome del referente (o almeno la sua email).',
  kind: 'Scegli che cosa è successo.',
  none: 'Non hai selezionato nessun contatto.',
  nomail: 'Non c’è un indirizzo a cui scrivere (o il contatto non vuole email): aggiungi un indirizzo, oppure riabilitalo.',
  'invite-email': 'Per invitare serve un indirizzo email: aggiungilo all’agenzia o a un referente.',
  'invite-exists': 'Questa agenzia ha già un profilo sul sito: l’ho agganciato qui sopra.',
  'invite-blocked': 'Non invito chi ha chiesto di non ricevere email.',
  'profile-email': 'Per creare il profilo serve un indirizzo email: aggiungilo all’agenzia o a un referente.',
  'profile-exists': 'Questa agenzia ha già un profilo sul sito (o l’email è già registrata).',
};

const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
};

export function adminLeadsRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '60kb' });
  const big = express.urlencoded({ extended: false, limit: '700kb' });
  const ctxOf = (req) => ({ app, req });
  const flash = (req) => {
    const f = FLASH[String(req.query.ok ?? '')];
    return typeof f === 'function' ? f(req.query) : f ?? '';
  };
  const errorOf = (req) => ERR[String(req.query.err ?? '')] ?? '';
  const dest = (back, id) => (back === 'today' ? '/admin/leads/today' : `/admin/leads/${id}`);
  const withOk = (url, ok) => `${url}${url.includes('?') ? '&' : '?'}ok=${ok}`;
  const retQs = (v) => (/^\?[\w=&%.+-]*$/.test(String(v ?? '')) ? String(v) : '');

  // ───── lettura dei moduli ─────
  /** I campi del modulo di un contatto (con il primo referente, se richiesto) → valori puliti, oppure il codice dell'errore. */
  function readForm(b, { withContact = false } = {}) {
    const phone = optionalPhone(b, 'phone');
    if (phone.error) return { error: 'phone' };
    const cphone = withContact ? optionalPhone(b, 'contact_phone') : { value: '' };
    if (cphone.error) return { error: 'contactPhone' };
    let value;
    try {
      ({ value } = cleanLead({ company: b.company, kind: b.kind, country: b.country, city: b.city, website: b.website, email: b.email, phone: phone.value, lang: b.lang, source: b.source, priority: b.priority, notes: b.notes, nextActionOn: b.nextActionOn, hintEmail: b.contact_email }));
    } catch (err) {
      if (err instanceof LeadError) return { error: err.code };
      throw err;
    }
    let contact = null;
    if (withContact && (cleanText(b.contact_name, 120) || cleanText(b.contact_email, 254) || cphone.value)) {
      try {
        ({ value: contact } = cleanContact({ name: b.contact_name, role: b.contact_role, email: b.contact_email, phone: cphone.value }, { country: value.country }));
      } catch (err) {
        if (err instanceof LeadError) return { error: err.code === 'email' ? 'contactEmail' : err.code === 'phone' ? 'contactPhone' : 'name' };
        throw err;
      }
    }
    return { value, contact };
  }

  // ───── Oggi ─────
  r.get('/leads/today', (req, res) => {
    syncAccounts(db);
    const t = nowRome().date;
    send(res, todayPage(ctxOf(req), {
      today: t, counts: leadCounts(db, t), due: dueLeads(db, t, 7), appointments: plannedAppointments(db, { from: t, to: addDays(t, 14) }), toClose: plannedAppointments(db, { before: t }),
      queue: { count: queuedCount(db), paused: sendSettings(db).paused }, toContact: toContact(db, 8), registered: unlinkedAccounts(db), flash: flash(req),
    }));
  });
  r.get('/leads', (req, res) => {
    syncAccounts(db);
    const t = nowRome().date;
    const q = req.query;
    const filters = {
      status: STATUSES.includes(q.status) ? q.status : '', q: cleanText(q.q, 80), kind: KIND_LABEL[q.kind] ? q.kind : '', country: /^[A-Za-z]{2}$/.test(q.country ?? '') ? String(q.country).toUpperCase() : '',
      priority: PRIORITY_LABEL[q.priority] ? q.priority : '', due: ['overdue', 'today', 'week', 'none'].includes(q.due) ? q.due : '', source: cleanText(q.source, 120), email: ['none', 'blocked'].includes(q.email) ? q.email : '',
      sort: ['company', 'priority', 'recent', 'created', 'last'].includes(q.sort) ? q.sort : '',
    };
    const pageSize = 100;
    const page = Math.max(1, int(q.page) ?? 1);
    const { rows, total } = searchLeads(db, filters, { today: t, limit: pageSize, offset: (page - 1) * pageSize });
    send(res, leadsPage(ctxOf(req), { rows, total, filters, counts: leadCounts(db, t), countries: countriesUsed(db), sources: sourcesUsed(db), page, pageSize, today: t, flash: flash(req), error: errorOf(req) }));
  });

  // ───── un contatto nuovo ─────
  r.get('/leads/new', (req, res) => send(res, newLeadPage(ctxOf(req), { values: { company: cleanText(req.query.company, 160) }, sources: sourcesUsed(db) })));
  r.post('/leads/new', form, (req, res) => {
    const out = readForm(req.body, { withContact: true });
    const again = (error, duplicates = [], status = 400) => send(res, newLeadPage(ctxOf(req), { values: req.body, sources: sourcesUsed(db), duplicates, error }), status);
    if (out.error) return again(ERR[out.error] ?? ERR.company);
    if (req.body.force !== '1') {
      const dups = duplicateIndex(db).find({ company: out.value.company, email: out.value.email, contactEmail: out.contact?.email, website: out.value.website });
      if (dups.length) return again('', dups, 409);
    }
    const lead = insertLead(db, out.value, { contact: out.contact });
    res.redirect(303, `/admin/leads/${lead.id}?ok=created`);
  });

  // ───── importare ed esportare ─────
  r.get('/leads/import', (req, res) => send(res, importPage(ctxOf(req), {})));
  r.post('/leads/import', big, (req, res) => {
    const text = String(req.body.text ?? '');
    const source = cleanText(req.body.source, 120);
    const parsed = parseImport(text);
    if (req.body.action === 'import') {
      const result = importLeads(db, parsed.rows, { source });
      return send(res, importPage(ctxOf(req), { result }));
    }
    const index = duplicateIndex(db);
    const seen = new Set();
    const checks = parsed.rows.map((row) => {
      if (!row.lead) return null;
      const dup = index.find({ company: row.lead.company, email: row.lead.email, contactEmail: row.contact?.email, website: row.lead.website })[0] ?? null;
      const key = `${row.lead.company.toLowerCase()}|${row.lead.email || row.contact?.email || ''}`;
      if (!dup && seen.has(key)) return { company: row.lead.company, why: 'ripetuta nell’elenco' };
      seen.add(key);
      return dup;
    });
    send(res, importPage(ctxOf(req), { text, source, parsed, checks }));
  });
  r.get('/leads/export.csv', (req, res) => {
    res.type('text/csv; charset=utf-8').set({ 'Content-Disposition': 'attachment; filename="contatti-commerciali.csv"', 'Cache-Control': 'private, no-store' }).send(leadsCsv(db));
  });
  r.post('/leads/registered', form, (req, res) => {
    const n = addRegistered(db);
    res.redirect(303, `/admin/leads/today?ok=registered&n=${n}`);
  });

  // ───── azioni su più contatti ─────
  r.post('/leads/bulk', form, (req, res) => {
    const ids = [...new Set([].concat(req.body.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const ret = retQs(req.body.return);
    if (!ids.length) return res.redirect(303, `/admin/leads${ret}${ret ? '&' : '?'}err=none`);
    const action = String(req.body.action ?? '');
    if (action === 'presentation') {
      const items = ids.map((id) => getLead(db, id)).filter(Boolean).map((lead) => {
        const rec = recipients(db, lead)[0];
        const problem = !lead.email_ok ? 'Non vuole email' : ['lost', 'client'].includes(lead.status) ? `È «${lead.status === 'lost' ? 'non interessata' : 'cliente'}»` : !rec ? 'Nessun indirizzo' : db.prepare("SELECT 1 FROM lead_emails WHERE lead_id = ? AND template = 'presentation' AND status = 'queued'").get(lead.id) ? 'Presentazione già in coda' : '';
        return { lead, to: rec?.email, name: rec?.name, lang: rec?.lang ?? lead.lang, contactId: rec?.contactId ?? null, problem };
      });
      return send(res, bulkReviewPage(ctxOf(req), { items, settings: sendSettings(db), ret }));
    }
    let n = 0;
    if (action === 'set-status' && STATUSES.includes(req.body.status)) {
      for (const id of ids) if (setStatus(db, id, req.body.status)) n++;
      return res.redirect(303, `/admin/leads${ret}${ret ? '&' : '?'}ok=bulkStatus&n=${n}`);
    }
    if (action === 'set-priority' && PRIORITY_LABEL[req.body.priority]) {
      for (const id of ids) n += db.prepare('UPDATE leads SET priority = ? WHERE id = ?').run(Number(req.body.priority), id).changes;
      return res.redirect(303, `/admin/leads${ret}${ret ? '&' : '?'}ok=bulkStatus&n=${n}`);
    }
    if (action === 'delete') {
      for (const id of ids) if (deleteLead(db, id)) n++;
      return res.redirect(303, `/admin/leads${ret}${ret ? '&' : '?'}ok=bulkDeleted&n=${n}`);
    }
    res.redirect(303, `/admin/leads${ret}`);
  });
  r.post('/leads/bulk/queue', form, (req, res) => {
    const ids = [...new Set([].concat(req.body.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const days = req.body.followup === '1' ? int(req.body.followupDays) : null;
    let queued = 0;
    let skipped = 0;
    for (const id of ids) {
      const lead = getLead(db, id);
      const rec = lead ? recipients(db, lead)[0] : null;
      if (!lead || !rec) {
        skipped++;
        continue;
      }
      const lang = String(req.body[`lang_${id}`] ?? rec.lang);
      try {
        const c = composeEmail(app, { lead, contact: rec.contactId ? getContact(db, id, rec.contactId) : null, template: 'presentation', lang });
        queueEmail(db, { leadId: id, contactId: rec.contactId, to: rec.email, template: 'presentation', lang: c.lang, subject: c.subject, body: c.body, followupDays: days });
        queued++;
      } catch (err) {
        if (!(err instanceof LeadError)) throw err;
        skipped++; // non vuole email, è già in coda, indirizzo non valido…
      }
    }
    res.redirect(303, `/admin/leads/mail?ok=queuedMany&n=${queued}&skip=${skipped}`);
  });

  // ───── appuntamenti ─────
  const apptValues = (b) => ({ lead: b.lead, kind: b.kind, contactId: b.contactId, date: b.date, start: b.start, end: b.end, allDay: b.allDay === '1', place: b.place, notes: b.notes, blocks: b.blocks === '1' });
  const apptView = (req, res, { values, editing = null, error = '', status = 200 }) => {
    const t = nowRome().date;
    const lead = getLead(db, values.lead);
    send(res, appointmentPage(ctxOf(req), { leads: db.prepare('SELECT id, company, city FROM leads ORDER BY company COLLATE NOCASE LIMIT 3000').all(), contacts: lead ? listContacts(db, lead.id) : [], values, editing, today: t, error }), status);
  };
  r.get('/leads/appointment', (req, res) => {
    const edit = req.query.edit ? getAppointment(db, req.query.edit) : null;
    if (edit && edit.status === 'planned') {
      return apptView(req, res, { editing: edit.id, values: { lead: edit.lead_id, kind: edit.kind, contactId: edit.contact_id, date: edit.date, start: edit.start_time, end: edit.end_time, allDay: edit.start_time === '00:00' && edit.end_time === '23:59', place: edit.place, notes: edit.notes, blocks: !!edit.blocks } });
    }
    const date = isDate(String(req.query.date ?? '')) ? String(req.query.date) : undefined;
    apptView(req, res, { values: { lead: getLead(db, req.query.lead)?.id ?? '', date, kind: APPT_LABEL[req.query.kind] ? req.query.kind : 'visit' } });
  });
  const apptErr = { date: ERR.date, time: ERR.time, notfound: 'Scegli un’agenzia.' };
  r.post('/leads/appointment', form, (req, res) => {
    const v = apptValues(req.body);
    const lead = getLead(db, req.body.lead);
    if (!lead) return apptView(req, res, { values: v, error: apptErr.notfound, status: 400 });
    try {
      const a = addAppointment(db, lead.id, { ...v, contactId: int(v.contactId) });
      const over = overlapCount(db, a.date, a.start_time, a.end_time, Date.now(), { ignoreAppointment: a.id });
      res.redirect(303, `/admin/leads/${lead.id}?ok=${over ? 'apptOver' : 'appt'}`);
    } catch (err) {
      if (!(err instanceof LeadError)) throw err;
      apptView(req, res, { values: v, error: apptErr[err.code] ?? ERR.date, status: 400 });
    }
  });
  r.post('/leads/appointments/:id', form, (req, res, next) => {
    const cur = getAppointment(db, req.params.id);
    if (!cur) return next();
    const v = apptValues({ ...req.body, lead: cur.lead_id });
    try {
      const a = updateAppointment(db, cur.id, { ...v, contactId: int(v.contactId) });
      if (!a) return res.redirect(303, `/admin/leads/${cur.lead_id}`);
      const over = overlapCount(db, a.date, a.start_time, a.end_time, Date.now(), { ignoreAppointment: a.id });
      res.redirect(303, `/admin/leads/${cur.lead_id}?ok=${over ? 'apptOver' : 'apptSaved'}`);
    } catch (err) {
      if (!(err instanceof LeadError)) throw err;
      apptView(req, res, { values: v, editing: cur.id, error: apptErr[err.code] ?? ERR.date, status: 400 });
    }
  });
  r.post('/leads/appointments/:id/done', form, (req, res, next) => {
    const a = getAppointment(db, req.params.id);
    if (!a) return next();
    completeAppointment(db, a.id, { outcome: req.body.outcome, nextOn: req.body.nextOn, nextAction: req.body.nextAction });
    res.redirect(303, withOk(dest(req.body.back, a.lead_id), 'apptDone'));
  });
  r.post('/leads/appointments/:id/cancel', form, (req, res, next) => {
    const a = getAppointment(db, req.params.id);
    if (!a) return next();
    cancelAppointment(db, a.id);
    res.redirect(303, withOk(dest(req.body.back, a.lead_id), 'apptCancelled'));
  });

  // ───── la scheda di un contatto ─────
  const lead404 = (req) => getLead(db, req.params.id); // (senza contatto: `next()` e si passa al 404)
  /** Disegna la scheda; `extra` porta ciò che si vede una volta sola (il collegamento appena creato) o i valori di un modulo rifiutato. */
  const detail = (req, res, lead, extra = {}, status = 200) => {
    const t = nowRome().date;
    const current = getLead(db, lead.id);
    const account = accountOf(db, current);
    send(res, leadPage(ctxOf(req), {
      lead: current, contacts: listContacts(db, lead.id), timeline: timeline(db, lead.id), appointments: leadAppointments(db, lead.id), emails: leadEmails(db, lead.id), account,
      stats: account ? accountStats(db, account.id) : { bookings: 0, lastDate: null }, today: t, sources: sourcesUsed(db), flash: flash(req), error: errorOf(req), ...extra,
    }), status);
  };
  r.get('/leads/:id', (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    syncAccounts(db);
    detail(req, res, lead);
  });
  r.post('/leads/:id', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    const out = readForm(req.body);
    if (out.error) return detail(req, res, lead, { values: { ...lead, ...req.body }, error: ERR[out.error] ?? ERR.company }, 400);
    updateLead(db, lead.id, out.value);
    res.redirect(303, `/admin/leads/${lead.id}?ok=saved`);
  });
  r.post('/leads/:id/status', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    if (STATUSES.includes(req.body.status)) setStatus(db, lead.id, req.body.status);
    res.redirect(303, withOk(dest(req.body.back, lead.id), 'status'));
  });
  r.post('/leads/:id/next', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    const on = String(req.body.on ?? '').trim();
    if (on && !isDate(on)) return res.redirect(303, `${dest(req.body.back, lead.id)}?err=date`);
    setNextAction(db, lead.id, { on, text: req.body.text ?? lead.next_action ?? '' });
    res.redirect(303, withOk(dest(req.body.back, lead.id), 'next'));
  });
  r.post('/leads/:id/snooze', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    snooze(db, lead.id, int(req.body.days) ?? 0);
    res.redirect(303, withOk(dest(req.body.back, lead.id), 'next'));
  });
  r.post('/leads/:id/log', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    const b = req.body;
    if (!MANUAL_ACTIVITIES.includes(b.kind)) return res.redirect(303, `/admin/leads/${lead.id}?err=kind#registra`);
    const t = nowRome().date;
    const days = int(b.again);
    const nextOn = isDate(String(b.againDate ?? '')) ? String(b.againDate) : days > 0 ? addDays(t, days) : '';
    const day = isDate(String(b.when ?? '')) && b.when <= t ? String(b.when) : '';
    logActivity(db, lead.id, { kind: b.kind, contactId: int(b.contactId), body: b.body, at: day && day !== t ? new Date(localToInstant(day, '12:00')).toISOString() : null, nextOn, nextAction: b.againText });
    res.redirect(303, withOk(dest('', lead.id), 'logged'));
  });

  // ───── referenti ─────
  const readContact = (b, lead) => {
    const phone = optionalPhone(b, 'phone');
    if (phone.error) return { error: 'contactPhone' };
    try {
      return { value: { ...cleanContact({ name: b.name, role: b.role, email: b.email, phone: phone.value, lang: b.lang, notes: b.notes }, { country: lead.country ?? '' }).value } };
    } catch (err) {
      if (err instanceof LeadError) return { error: err.code === 'email' ? 'contactEmail' : err.code === 'phone' ? 'contactPhone' : 'name' };
      throw err;
    }
  };
  r.post('/leads/:id/contacts', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    const out = readContact(req.body, lead);
    if (out.error) return res.redirect(303, `/admin/leads/${lead.id}?err=${out.error}#referenti`);
    addContact(db, lead.id, { ...out.value, main: req.body.main === '1' });
    res.redirect(303, `/admin/leads/${lead.id}?ok=contact#referenti`);
  });
  r.post('/leads/:id/contacts/:cid', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead || !getContact(db, lead.id, req.params.cid)) return next();
    const out = readContact(req.body, lead);
    if (out.error) return res.redirect(303, `/admin/leads/${lead.id}?err=${out.error}#referenti`);
    updateContact(db, lead.id, Number(req.params.cid), out.value);
    res.redirect(303, `/admin/leads/${lead.id}?ok=contact#referenti`);
  });
  r.post('/leads/:id/contacts/:cid/main', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead || !setMainContact(db, lead.id, Number(req.params.cid))) return next();
    res.redirect(303, `/admin/leads/${lead.id}?ok=main#referenti`);
  });
  r.post('/leads/:id/contacts/:cid/delete', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead || !removeContact(db, lead.id, Number(req.params.cid))) return next();
    res.redirect(303, `/admin/leads/${lead.id}?ok=contactRemoved#referenti`);
  });

  // ───── divieto di email, cancellazione ─────
  r.post('/leads/:id/optout', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    optOut(db, lead.id, { source: 'admin' });
    res.redirect(303, `/admin/leads/${lead.id}?ok=optout`);
  });
  r.post('/leads/:id/allow-email', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    allowEmail(db, lead.id);
    res.redirect(303, `/admin/leads/${lead.id}?ok=allowed`);
  });
  r.post('/leads/:id/delete', form, (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    deleteLead(db, lead.id);
    res.redirect(303, '/admin/leads?ok=deleted');
  });

  // ───── area B2B: invito e profilo ─────
  r.post('/leads/:id/invite', form, async (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    const out = await app.leads.invite(lead.id, { contactId: int(req.body.contactId), note: cleanText(req.body.note, 600) });
    if (out.error) return res.redirect(303, `/admin/leads/${lead.id}?err=invite-${out.error}#b2b`);
    detail(req, res, lead, { fresh: { kind: 'invite', url: out.url, sent: out.sent } });
  });
  r.post('/leads/:id/profile', form, async (req, res, next) => {
    const lead = lead404(req);
    if (!lead) return next();
    const out = await app.leads.createProfile(lead.id, { contactId: int(req.body.contactId), sendMail: req.body.sendMail === '1' });
    if (out.error) return res.redirect(303, `/admin/leads/${lead.id}?err=profile-${out.error}#b2b`);
    detail(req, res, lead, { fresh: { kind: 'profile', url: out.url, sent: out.sent } });
  });

  return r;
}
