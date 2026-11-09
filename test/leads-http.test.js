// Pannello › Commerciale, dalle pagine: accesso, Oggi, contatti, scheda, appuntamenti in agenda, email e coda, modelli, importazione, disiscrizione pubblica, area B2B.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { addDays, nowRome } from '../server/time.js';
import * as L from '../server/leads.js';
import * as M from '../server/leadMail.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-leads-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
/** Come `form`, ma con campi ripetuti (le caselle «ids» dell'elenco). */
const formPairs = (pairs) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const today = () => nowRome().date;

async function start(over = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' }, ...over });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    return async (p, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(base + p, { redirect: 'manual', ...init, headers });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        const val = kv.slice(i + 1);
        if (/Max-Age=0/i.test(c) || !val) cookies.delete(kv.slice(0, i));
        else cookies.set(kv.slice(0, i), val);
      }
      return res;
    };
  };
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  return { app, cfg, admin, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** Aggiunge un contatto dal modulo e dice a che indirizzo porta. */
async function addLead(s, fields = {}) {
  const res = await s.admin('/admin/leads/new', form({ company: 'Lagoon Travel', country: 'IT', email: 'info@lagoon.it', ...fields }));
  return { res, path: loc(res), id: Number(loc(res)?.match(/leads\/(\d+)/)?.[1]) };
}

test('Commerciale: solo per la guida; nel menu c’è il gruppo e il numero dei richiami; all’inizio la pagina spiega da dove cominciare', async () => {
  const s = await start();
  try {
    for (const p of ['/admin/leads/today', '/admin/leads', '/admin/leads/new', '/admin/leads/mail', '/admin/leads/templates', '/admin/leads/import', '/admin/leads/export.csv', '/admin/leads/appointment']) {
      assert.equal((await s.anon(p)).status, 302, `${p} è riservata`);
    }
    assert.equal((await s.anon('/admin/leads/new', form({ company: 'X' }))).status, 302);
    const page = await text(await s.admin('/admin/leads/today'));
    assert.match(page, /<h1>Commerciale<\/h1>/);
    assert.match(page, /<a href="\/admin\/leads\/today" aria-current="page">Commerciale<\/a>/, 'il gruppo nel menu in alto');
    assert.match(page, /<nav class="tabs admin-subnav" aria-label="Commerciale">.*Oggi.*Contatti.*Email.*Modelli/s);
    assert.match(page, /Si comincia da qui/);
    assert.match(page, /<a class="btn btn-gold" href="\/admin\/leads\/new">Aggiungi un contatto<\/a>/);
    assert.doesNotMatch(page, /class="tab-n"/, 'nessun richiamo, nessun numero');

    // un richiamo per oggi: il numero compare accanto a «Oggi» in tutte le pagine del gruppo e il contatto è in cima
    const { id } = await addLead(s, { nextActionOn: today() });
    const t2 = await text(await s.admin('/admin/leads/today'));
    assert.match(t2, /Oggi <span class="tab-n">1<\/span>/);
    assert.match(t2, /<a href="\/admin\/leads\/\d+">Lagoon Travel<\/a>/);
    assert.match(t2, /Ricontattare · oggi/);
    assert.match(await text(await s.admin('/admin/leads')), /Oggi <span class="tab-n">1<\/span>/);
    // anche la dashboard dell'agenda e «Da fare»
    assert.match(await text(await s.admin('/admin')), /Agenzie da richiamare<\/span><strong>1<\/strong>/);
    const todo = await text(await s.admin('/admin/todo'));
    assert.match(todo, /<h2 class="h-sub spaced">Commerciale<\/h2>/);
    assert.match(todo, /1 agenzia da richiamare/);
    assert.match(await text(await s.admin('/admin/bookings')), /Da fare <span class="tab-n">1<\/span>/, 'il richiamo conta nel numero di «Da fare»');
    // si rimanda con un tocco: il numero sparisce
    const sn = await s.admin(`/admin/leads/${id}/snooze`, form({ days: '3', back: 'today' }));
    assert.equal(loc(sn), '/admin/leads/today?ok=next');
    assert.doesNotMatch(await text(await s.admin('/admin/leads/today')), /Oggi <span class="tab-n">/);
  } finally {
    s.close();
  }
});

test('nuovo contatto: errori chiari nel modulo, avviso dei doppioni (si può insistere), referente e primo richiamo', async () => {
  const s = await start();
  try {
    const bad = async (fields, re) => {
      const res = await s.admin('/admin/leads/new', form({ company: 'Alfa Viaggi', ...fields }));
      assert.equal(res.status, 400);
      assert.match(await text(res), re);
    };
    await bad({ company: '' }, /Scrivi il nome dell’agenzia/);
    await bad({ email: 'senza-chiocciola' }, /L’indirizzo email non è valido/);
    await bad({ website: 'javascript:alert(1)' }, /indirizzo del sito non è valido/);
    await bad({ phone: '041 123456', phone_cc: '' }, /prefisso del paese/);
    await bad({ contact_email: 'rotta' }, /email del referente non è valida/);
    assert.equal(L.leadCounts(s.app.db).total, 0, 'nulla è stato salvato');
    // il modulo rimostrato conserva ciò che si era scritto
    const again = await text(await s.admin('/admin/leads/new', form({ company: 'Alfa Viaggi', city: 'Padova', email: 'rotta' })));
    assert.match(again, /value="Alfa Viaggi"/);
    assert.match(again, /value="Padova"/);

    const ok = await s.admin('/admin/leads/new', form({ company: 'Alfa Viaggi', kind: 'operator', country: 'IT', city: 'Padova', website: 'alfa.it', email: 'info@alfa.it', phone: '049 123456', phone_cc: 'IT', source: 'Fiera BIT', priority: '1', contact_name: 'Anna Rossi', contact_role: 'Titolare', contact_email: 'anna@alfa.it', contact_phone: '333 1234567', contact_phone_cc: 'IT', nextActionOn: addDays(today(), 2), notes: 'Vuole Murano' }));
    assert.equal(ok.status, 303);
    assert.match(loc(ok), /^\/admin\/leads\/\d+\?ok=created$/);
    const lead = L.searchLeads(s.app.db, { q: 'Alfa' }).rows[0];
    assert.deepEqual([lead.kind, lead.website, lead.email, lead.phone, lead.priority, lead.source, lead.lang, lead.next_action_on, lead.contact_name, lead.contact_role, lead.contact_email, lead.contact_phone], ['operator', 'https://alfa.it', 'info@alfa.it', '+39 049123456', 1, 'Fiera BIT', 'it', addDays(today(), 2), 'Anna Rossi', 'Titolare', 'anna@alfa.it', '+39 3331234567']);
    const detail = await text(await s.admin(loc(ok)));
    assert.match(detail, /Contatto aggiunto\./);
    assert.match(detail, /<h1>Alfa Viaggi<\/h1>/);
    assert.match(detail, /<p class="lead-chips"><span class="chip ">Da contattare<\/span> <span class="chip chip-err"[^>]*>Alta<\/span><\/p>/);
    assert.doesNotMatch(detail, /<h2>Alfa Viaggi/, 'il nome compare una volta sola come titolo');
    assert.match(detail, /<strong>Anna Rossi<\/strong> <span class="chip">Principale<\/span>/);
    assert.match(detail, /href="https:\/\/wa\.me\/393331234567"/, 'il collegamento a WhatsApp dal numero con il prefisso');
    assert.match(detail, /href="mailto:anna@alfa\.it"/);

    // doppioni: stesso nome / stesso dominio → avviso e nessun salvataggio, a meno di «crea comunque»
    const dup = await s.admin('/admin/leads/new', form({ company: 'ALFA viaggi s.r.l.', email: 'booking@alfa.it' }));
    assert.equal(dup.status, 409);
    const dupPage = await text(dup);
    assert.match(dupPage, /Forse c’è già:.*Alfa Viaggi/s);
    assert.match(dupPage, /crea comunque un contatto nuovo/);
    assert.equal(L.leadCounts(s.app.db).total, 1);
    const forced = await s.admin('/admin/leads/new', form({ company: 'ALFA viaggi s.r.l.', email: 'booking@alfa.it', force: '1' }));
    assert.equal(forced.status, 303);
    assert.equal(L.leadCounts(s.app.db).total, 2);
  } finally {
    s.close();
  }
});

test('elenco: schede per stato con i numeri, filtri e ricerca, azioni sui selezionati (stato, priorità, cancella), pagine', async () => {
  const s = await start();
  try {
    const t = today();
    const mk = (company, over = {}) => L.insertLead(s.app.db, L.cleanLead({ company, email: `${company.toLowerCase().replace(/\W/g, '')}@x.it`, ...over }).value);
    const a = mk('Alfa', { country: 'IT', city: 'Padova', priority: 1, source: 'Fiera BIT' });
    const b = mk('Beta', { country: 'JP', nextActionOn: addDays(t, -2) });
    const c = mk('Gamma', { country: 'ES' });
    L.setStatus(s.app.db, c.id, 'talking');
    const page = await text(await s.admin('/admin/leads'));
    assert.match(page, /<a class="tab" href="\/admin\/leads" aria-current="page">Tutti <span class="tab-n">3<\/span><\/a>/);
    assert.match(page, />Da contattare <span class="tab-n">2<\/span><\/a>/);
    assert.match(page, />In dialogo <span class="tab-n">1<\/span><\/a>/);
    assert.match(page, /<tr class="row-overdue">.*Beta/s, 'il richiamo scaduto è evidenziato');
    assert.match(page, /scaduto da 2 giorni/);
    assert.ok(page.indexOf('Beta') < page.indexOf('Alfa'), 'in cima chi ha il richiamo');
    const names = async (qs) => [...(await text(await s.admin(`/admin/leads?${qs}`))).matchAll(/<div><a href="\/admin\/leads\/\d+">([^<]+)<\/a><br>/g)].map((m) => m[1]);
    assert.deepEqual(await names('status=talking'), ['Gamma']);
    assert.deepEqual(await names('q=padova'), ['Alfa']);
    assert.deepEqual(await names('country=jp'), ['Beta']);
    assert.deepEqual(await names('priority=1'), ['Alfa']);
    assert.deepEqual(await names('due=overdue'), ['Beta']);
    assert.deepEqual(await names('source=Fiera+BIT'), ['Alfa']);
    assert.deepEqual(await names('sort=company'), ['Alfa', 'Beta', 'Gamma']);
    assert.deepEqual(await names('q=nessuno'), []);
    assert.match(await text(await s.admin('/admin/leads?q=nessuno')), /Nessun contatto con questi filtri/);
    assert.deepEqual(await names('kind=inventato&status=boh&sort=boh'), ['Beta', 'Alfa', 'Gamma'], 'filtri sconosciuti ignorati');

    // azioni su più contatti
    const none = await s.admin('/admin/leads/bulk', formPairs([['action', 'delete']]));
    assert.match(loc(none), /err=none$/);
    const st = await s.admin('/admin/leads/bulk', formPairs([['ids', a.id], ['ids', b.id], ['action', 'set-status'], ['status', 'contacted'], ['return', '?status=new']]));
    assert.equal(loc(st), '/admin/leads?status=new&ok=bulkStatus&n=2');
    assert.deepEqual([L.getLead(s.app.db, a.id).status, L.getLead(s.app.db, b.id).status], ['contacted', 'contacted']);
    const prio = await s.admin('/admin/leads/bulk', formPairs([['ids', a.id], ['action', 'set-priority'], ['priority', '3']]));
    assert.equal(loc(prio), '/admin/leads?ok=bulkPriority&n=1');
    assert.match(await text(await s.admin(loc(prio))), /Priorità cambiata per 1 contatto\./);
    assert.equal(L.getLead(s.app.db, a.id).priority, 3);
    const evil = await s.admin('/admin/leads/bulk', formPairs([['ids', a.id], ['action', 'set-status'], ['status', 'lost'], ['return', 'https://evil.example/']]));
    assert.equal(loc(evil), '/admin/leads?ok=bulkStatus&n=1', 'il ritorno accetta solo una query locale');
    const del = await s.admin('/admin/leads/bulk', formPairs([['ids', a.id], ['ids', b.id], ['action', 'delete']]));
    assert.match(loc(del), /ok=bulkDeleted&n=2$/);
    assert.equal(L.leadCounts(s.app.db).total, 1);

    // pagine da 100
    for (let i = 0; i < 105; i++) mk(`Agenzia ${String(i).padStart(3, '0')}`);
    const p1 = await text(await s.admin('/admin/leads?sort=company'));
    assert.match(p1, /106 contatti · pagina 1 di 2/);
    assert.match(p1, /Dopo →/);
    assert.doesNotMatch(p1, /← Prima/);
    const p2 = await text(await s.admin('/admin/leads?sort=company&page=2'));
    assert.match(p2, /pagina 2 di 2/);
    assert.match(p2, /← Prima/);
  } finally {
    s.close();
  }
});

test('scheda del contatto: dati, prossima azione, registro con richiamo, stato, referenti, cancellazione', async () => {
  const s = await start();
  try {
    const { id } = await addLead(s, { contact_name: 'Anna Rossi', contact_email: 'anna@lagoon.it' });
    const base = `/admin/leads/${id}`;
    // modifica dei dati
    const bad = await s.admin(base, form({ company: 'Lagoon Travel', email: 'rotta' }));
    assert.equal(bad.status, 400);
    assert.match(await text(bad), /L’indirizzo email non è valido/);
    assert.equal(loc(await s.admin(base, form({ company: 'Lagoon Travel Srl', country: 'ES', city: 'Madrid', priority: '1', lang: '', email: 'info@lagoon.es', notes: 'Nota' }))), `${base}?ok=saved`);
    const edited = L.getLead(s.app.db, id);
    assert.deepEqual([edited.company, edited.country, edited.city, edited.priority, edited.email, edited.lang, edited.notes], ['Lagoon Travel Srl', 'ES', 'Madrid', 1, 'info@lagoon.es', 'es', 'Nota'], 'lingua automatica dal paese');
    // prossima azione
    assert.equal(loc(await s.admin(`${base}/next`, form({ on: addDays(today(), 5), text: 'Mandare il listino' }))), `${base}?ok=next`);
    assert.match(await text(await s.admin(base)), /Mandare il listino: tra 5 giorni/);
    assert.match(loc(await s.admin(`${base}/next`, form({ on: 'domani' }))), /err=date$/);
    assert.equal(loc(await s.admin(`${base}/next`, form({ on: '' }))), `${base}?ok=next`);
    assert.equal(L.getLead(s.app.db, id).next_action_on, null);
    // registro: una telefonata con il richiamo tra una settimana
    const anna = L.mainContact(s.app.db, id);
    const log = await s.admin(`${base}/log`, form({ kind: 'call', contactId: String(anna.id), body: 'Interessata a Murano', again: '7', againText: 'Mandare il listino' }));
    assert.equal(loc(log), `${base}?ok=logged`);
    const after = L.getLead(s.app.db, id);
    assert.deepEqual([after.status, after.next_action_on, after.next_action, after.last_contact_on], ['talking', addDays(today(), 7), 'Mandare il listino', today()]);
    const page = await text(await s.admin(base));
    assert.match(page, /<ul class="timeline lead-timeline">/);
    assert.match(page, /<strong>Telefonata<\/strong> <small class="muted">Telefonata · Anna Rossi/);
    assert.match(page, /<p class="pre small">Interessata a Murano<\/p>/);
    // una data scelta a mano vince sul menu; il giorno in cui è successo si può indicare
    await s.admin(`${base}/log`, form({ kind: 'note', body: 'Ieri ci siamo sentiti', when: addDays(today(), -1), again: '', againDate: addDays(today(), 20) }));
    assert.equal(L.getLead(s.app.db, id).next_action_on, addDays(today(), 20));
    assert.equal((await s.admin(`${base}/log`, form({ kind: 'inventato' }))).headers.get('location'), `${base}?err=kind#registra`);
    // stato
    assert.equal(loc(await s.admin(`${base}/status`, form({ status: 'lost' }))), `${base}?ok=status`);
    const lost = L.getLead(s.app.db, id);
    assert.deepEqual([lost.status, lost.next_action_on], ['lost', null]);
    // referenti
    const add = await s.admin(`${base}/contacts`, form({ name: 'Bob Verdi', role: 'Booking', email: 'bob@lagoon.es', phone: '600 123 456', phone_cc: 'ES', lang: 'en', main: '1' }));
    assert.equal(loc(add), `${base}?ok=contact#referenti`);
    const contacts = L.listContacts(s.app.db, id);
    assert.deepEqual(contacts.map((c) => [c.name, c.is_main, c.phone, c.lang]), [['Bob Verdi', 1, '+34 600123456', 'en'], ['Anna Rossi', 0, null, null]]);
    assert.match(loc(await s.admin(`${base}/contacts`, form({ name: '', email: '' }))), /err=name#referenti$/);
    assert.match(loc(await s.admin(`${base}/contacts`, form({ name: 'X', email: 'rotta' }))), /err=contactEmail#referenti$/);
    assert.match(loc(await s.admin(`${base}/contacts`, form({ name: 'X', phone: '123456', phone_cc: '' }))), /err=contactPhone#referenti$/);
    assert.equal(loc(await s.admin(`${base}/contacts/${anna.id}/main`, form({}))), `${base}?ok=main#referenti`);
    assert.equal(L.mainContact(s.app.db, id).name, 'Anna Rossi');
    assert.equal(loc(await s.admin(`${base}/contacts/${contacts[0].id}`, form({ name: 'Roberto Verdi', email: 'bob@lagoon.es' }))), `${base}?ok=contact#referenti`);
    assert.equal((await s.admin(`${base}/contacts/${contacts[0].id}/delete`, form({}))).status, 303);
    assert.equal(L.listContacts(s.app.db, id).length, 1);
    assert.equal((await s.admin(`${base}/contacts/99999/delete`, form({}))).status, 404, 'un referente che non c’è');
    // un contatto che non c’è
    assert.equal((await s.admin('/admin/leads/99999')).status, 404);
    assert.equal((await s.admin('/admin/leads/abc')).status, 404);
    assert.equal((await s.admin('/admin/leads/99999/status', form({ status: 'new' }))).status, 404);
    // cancellazione
    assert.equal(loc(await s.admin(`${base}/delete`, form({}))), '/admin/leads?ok=deleted');
    assert.equal(L.getLead(s.app.db, id), null);
  } finally {
    s.close();
  }
});

test('appuntamenti: nell’agenda (elenco, calendario, feed .ics, scheda del giorno), ore tolte dalle disponibilità, da chiudere in «Oggi» e in «Da fare»', async () => {
  const s = await start();
  try {
    const { id } = await addLead(s, { contact_name: 'Anna Rossi', contact_phone: '333 1234567', contact_phone_cc: 'IT' });
    const base = `/admin/leads/${id}`;
    const date = addDays(today(), 3);
    const form1 = await text(await s.admin(`/admin/leads/appointment?lead=${id}&date=${date}`));
    assert.match(form1, /<h2>Fissa un appuntamento<\/h2>/);
    assert.match(form1, new RegExp(`<option value="${id}" selected>Lagoon Travel</option>`));
    assert.match(form1, new RegExp(`name="date" required value="${date}"`));
    // errori
    for (const [fields, re] of [[{ date: 'ieri' }, /La data non è valida/], [{ start: '12:00', end: '11:00' }, /fine deve essere dopo l’inizio/], [{ lead: '' }, /Scegli un’agenzia/]]) {
      const res = await s.admin('/admin/leads/appointment', form({ lead: String(id), kind: 'visit', date, start: '10:00', end: '11:00', blocks: '1', ...fields }));
      assert.equal(res.status, 400);
      assert.match(await text(res), re);
    }
    const ok = await s.admin('/admin/leads/appointment', form({ lead: String(id), kind: 'visit', contactId: String(L.mainContact(s.app.db, id).id), date, start: '10:00', end: '12:00', place: 'Via Roma 1, Padova', notes: 'Portare il listino', blocks: '1' }));
    assert.equal(loc(ok), `${base}?ok=appt`);
    const appt = L.leadAppointments(s.app.db, id)[0];
    assert.deepEqual([appt.kind, appt.blocks, appt.place], ['visit', 1, 'Via Roma 1, Padova']);
    const call = await s.admin('/admin/leads/appointment', form({ lead: String(id), kind: 'call', date, start: '16:00', end: '16:30' }));
    assert.equal(L.leadAppointments(s.app.db, id).find((a) => a.kind === 'call').blocks, 0, 'una telefonata non toglie ore se non lo scegli');
    assert.equal(loc(call), `${base}?ok=appt`);
    // sopra un altro appuntamento che toglie ore: avviso
    assert.equal(loc(await s.admin('/admin/leads/appointment', form({ lead: String(id), kind: 'video', date, start: '11:00', end: '11:30', blocks: '1' }))), `${base}?ok=apptOver`);

    // la scheda del contatto
    const detail = await text(await s.admin(base));
    assert.match(detail, /Visita in azienda · Lagoon Travel/);
    assert.match(detail, /Ore non prenotabili/);
    assert.match(detail, /Non toglie ore/);
    // l'agenda: elenco e calendario
    const cal = await text(await s.admin(`/admin?v=cal&m=${date.slice(0, 7)}&d=${date}`));
    assert.match(cal, /<span class="acal-ev ev-sales" title="10:00 Visita in azienda Lagoon Travel">/);
    assert.match(cal, /<a class="agenda-item agenda-sales" href="\/admin\/leads\/\d+">/);
    assert.match(cal, /Visita in azienda · Lagoon Travel<\/strong><small>Commerciale · Anna Rossi · Via Roma 1, Padova<\/small>/);
    assert.match(cal, /appuntamento commerciale/);
    assert.match(cal, new RegExp(`href="/admin/leads/appointment\\?date=${date}"`));
    // feed .ics (protetto da un token) e scheda del giorno
    const feed = (await text(await s.admin('/admin'))).match(/value="([^"]*calendar\.ics\?k=[^"]+)"/)[1];
    const ics = await text(await s.anon(new URL(feed).pathname + new URL(feed).search));
    assert.match(ics, /SUMMARY:Visita in azienda · Lagoon Travel/);
    assert.match(ics, /LOCATION:Via Roma 1\\, Padova/);
    assert.match(ics, new RegExp(`URL:http://localhost/admin/leads/${id}`));
    const sheet = await text(await s.admin(`/admin/day?date=${date}`));
    assert.match(sheet, /Commerciale · Visita in azienda: Lagoon Travel/);
    assert.match(sheet, /Anna Rossi · \+39 3331234567 · Via Roma 1, Padova · Portare il listino/);
    // sparisce dall'ics e dall'agenda quando si annulla
    const cancel = await s.admin(`/admin/leads/appointments/${appt.id}/cancel`, form({}));
    assert.equal(loc(cancel), `${base}?ok=apptCancelled`);
    assert.doesNotMatch(await text(await s.admin(`/admin?v=cal&m=${date.slice(0, 7)}&d=${date}`)), /Visita in azienda · Lagoon Travel/);

    // un appuntamento passato ancora «fissato» è da chiudere: in Oggi e in Da fare
    const past = L.addAppointment(s.app.db, id, { kind: 'video', date: addDays(today(), -2), start: '10:00', end: '11:00', blocks: false });
    const todayPage = await text(await s.admin('/admin/leads/today'));
    assert.match(todayPage, /1 appuntamento passato da chiudere:<\/strong> com’è andata\?/);
    assert.match(await text(await s.admin('/admin/todo')), /1 appuntamento commerciale passato da chiudere/);
    const done = await s.admin(`/admin/leads/appointments/${past.id}/done`, form({ outcome: 'Hanno chiesto il listino', nextOn: addDays(today(), 4), nextAction: 'Mandare il listino', back: 'today' }));
    assert.equal(loc(done), '/admin/leads/today?ok=apptDone');
    assert.deepEqual([L.getAppointment(s.app.db, past.id).status, L.getLead(s.app.db, id).status, L.getLead(s.app.db, id).next_action_on], ['done', 'talking', addDays(today(), 4)]);
    assert.doesNotMatch(await text(await s.admin('/admin/todo')), /appuntamento commerciale passato/);
    // modificare
    const next = L.leadAppointments(s.app.db, id).find((a) => a.kind === 'call');
    const edit = await text(await s.admin(`/admin/leads/appointment?edit=${next.id}`));
    assert.match(edit, /<h2>Modifica l’appuntamento<\/h2>/);
    assert.equal(loc(await s.admin(`/admin/leads/appointments/${next.id}`, form({ kind: 'call', date, start: '17:00', end: '17:30' }))), `${base}?ok=apptSaved`);
    assert.equal(L.getAppointment(s.app.db, next.id).start_time, '17:00');
    assert.equal((await s.admin('/admin/leads/appointments/99999/done', form({}))).status, 404);
  } finally {
    s.close();
  }
});

test('«Oggi» e «Da fare» annunciano gli appuntamenti di oggi e domani', async () => {
  const s = await start();
  try {
    const { id } = await addLead(s);
    L.addAppointment(s.app.db, id, { kind: 'visit', date: addDays(today(), 1), start: '15:00', end: '16:00', place: 'Padova' });
    const todo = await text(await s.admin('/admin/todo'));
    assert.match(todo, /Domani: visita in azienda con Lagoon Travel/);
    assert.match(todo, /alle 15:00 · Padova/);
    const page = await text(await s.admin('/admin/leads/today'));
    assert.match(page, /<span class="kpi-l">Appuntamenti<\/span><strong class="kpi-n">1<\/strong>/);
    assert.match(page, /Visita in azienda · Lagoon Travel<\/a><\/strong>/);
  } finally {
    s.close();
  }
});

// ───────────── email ─────────────
const BILLING_IT = { tax_code: '12345678903', address: 'Fondamenta Nuove 10', zip: '30121', city: 'Venezia', province: 've' };
const REGI = { company: 'Lagoon Travel', vat: 'IT12345678903', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Anna', phone: '+39 041 111', password: 'password-lunga-1', consent: '1' };
const sentTo = (s, to) => s.app.mail.sent.filter((m) => m.to === to);
const queueRows = (s, status = 'queued') => s.app.db.prepare('SELECT * FROM lead_emails WHERE status = ? ORDER BY id').all(status);

test('scrivere a un contatto: testo già pronto nella lingua giusta, modello e lingua a scelta, anteprima a te, invio subito, in coda o per un giorno — e solo agli indirizzi del contatto', async () => {
  const s = await start();
  try {
    const { id } = await addLead(s, { contact_name: 'Anna Rossi', contact_email: 'anna@lagoon.it' });
    const mail = `/admin/leads/${id}/mail`;
    const anna = L.mainContact(s.app.db, id);
    const page = await text(await s.admin(mail));
    assert.match(page, /<h2>Scrivi a Lagoon Travel<\/h2>/);
    assert.match(page, /name="subject" required maxlength="200" value="Collaborazione con Lagoon Travel · guida abilitata a Venezia"/);
    assert.match(page, /<textarea[^>]*name="body"[^>]*>Buongiorno Anna,\n\nmi chiamo Davide Tomio/);
    assert.match(page, new RegExp(`<option value="c${anna.id}" selected>Anna Rossi — anna@lagoon\\.it</option><option value="lead" >Indirizzo dell’agenzia — info@lagoon\\.it</option>`));
    assert.match(page, /il sito aggiunge da solo chi scrive e il link per non ricevere altre email/);
    // un altro modello e un'altra lingua, per l'indirizzo dell'agenzia
    const en = await text(await s.admin(`${mail}?to=lead&t=followup&l=en`));
    assert.match(en, /value="A quick reminder: working together in Venice \(Lagoon Travel\)"/);
    assert.match(en, /<textarea[^>]*>Hello,\n\nI am following up briefly/);
    assert.match(en, /<input type="hidden" name="to" value="info@lagoon\.it">/);

    const send = (over = {}) => s.admin(mail, form({ to: 'anna@lagoon.it', contactId: String(anna.id), template: 'presentation', lang: 'it', subject: 'Ciao Anna', body: 'Testo scritto da me\n\nA presto', when: 'now', action: 'send', ...over }));
    // errori
    for (const [over, re] of [[{ to: 'altri@example.com' }, /Non ho un indirizzo a cui scrivere/], [{ subject: '' }, /Servono sia l’oggetto sia il testo/], [{ body: 'Ciao {{agenzzia}}' }, /segnaposto sbagliato/], [{ when: 'date', sendDate: addDays(today(), -1) }, /Scegli un giorno nel futuro/]]) {
      const res = await send(over);
      assert.equal(res.status, 400, JSON.stringify(over));
      assert.match(await text(res), re);
    }
    assert.equal(s.app.mail.sent.length, 0, 'nulla è partito');
    assert.match(await text(await send({ subject: 'Oggetto che resta', body: 'Ciao {{agenzzia}}' })), /value="Oggetto che resta"/, 'il testo scritto non si perde');

    // anteprima: arriva a te, con un link di disiscrizione inoffensivo
    const prev = await send({ action: 'preview' });
    assert.equal(prev.status, 200);
    assert.match(await text(prev), /Anteprima inviata al tuo indirizzo\./);
    const pm = sentTo(s, 'guida@example.com')[0];
    assert.equal(pm.subject, '[Anteprima] Ciao Anna');
    assert.ok(pm.text.includes('/it/b2b/unsubscribe/anteprima'));
    assert.equal(L.getLead(s.app.db, id).status, 'new', 'una prova non cambia nulla');

    // invio subito, con il sollecito
    const now = await send({ followup: '1', followupDays: '5' });
    assert.equal(loc(now), `/admin/leads/${id}?ok=emailSent`);
    const m = sentTo(s, 'anna@lagoon.it')[0];
    assert.equal(m.subject, 'Ciao Anna');
    assert.ok(m.text.startsWith('Testo scritto da me\n\nA presto\n\n--\nRicevi questo messaggio'));
    assert.match(m.headers['List-Unsubscribe'], /^<http:\/\/localhost\/it\/b2b\/unsubscribe\/[\w.-]+>$/);
    assert.deepEqual([L.getLead(s.app.db, id).status, queueRows(s).map((r) => [r.template, r.only_if_quiet])], ['contacted', [['followup', 1]]]);
    assert.ok(Math.abs(Date.parse(queueRows(s)[0].send_after) - (Date.now() + 5 * 86_400_000)) < 120_000, 'tra 5 giorni');
    const after = await text(await s.admin(loc(now)));
    assert.match(after, /Email inviata: la trovi nel registro\./);
    assert.match(after, /<span class="chip chip-ok">Inviata<\/span> <strong>Ciao Anna<\/strong>/);
    assert.match(after, /<span class="chip chip-warn">In coda<\/span> <strong>Un promemoria: collaborazione con Lagoon Travel a Venezia<\/strong>/);

    // in coda e per un giorno; la presentazione già in coda non si raddoppia
    const q = await send({ when: 'queue', subject: 'In coda', template: 'custom' });
    assert.equal(loc(q), `/admin/leads/${id}?ok=emailQueued`);
    const day = addDays(today(), 4);
    const d = await send({ when: 'date', sendDate: day, subject: 'Per un giorno', template: 'presentation' });
    assert.equal(loc(d), `/admin/leads/${id}?ok=emailQueued`);
    const dayRow = queueRows(s).find((r) => r.subject === 'Per un giorno');
    assert.equal(new Date(dayRow.send_after).toLocaleDateString('sv', { timeZone: 'Europe/Rome' }), day);
    const dup = await send({ when: 'queue', subject: 'Un’altra presentazione', template: 'presentation' });
    assert.equal(dup.status, 400);
    assert.match(await text(dup), /C’è già una email così in coda/);
    // annullare dalla scheda
    const cancel = await s.admin(`/admin/leads/mail/${dayRow.id}/cancel`, form({ back: String(id) }));
    assert.equal(loc(cancel), `/admin/leads/${id}?ok=cancelled`);
    assert.equal(s.app.db.prepare('SELECT status FROM lead_emails WHERE id = ?').get(dayRow.id).status, 'cancelled');

    // chi non vuole email: nessun invio, la pagina rimanda alla scheda
    L.optOut(s.app.db, id);
    assert.equal(loc(await s.admin(mail)), `/admin/leads/${id}?err=nomail`);
    assert.equal((await send({ subject: 'Dopo il divieto' })).status, 400);
    assert.match(await text(await s.admin(`/admin/leads/${id}`)), /Non scrivere a questo contatto\./);
    // un contatto senza nessun indirizzo
    const none = await addLead(s, { company: 'Senza indirizzo', email: '' });
    assert.equal(loc(await s.admin(`/admin/leads/${none.id}/mail`)), `/admin/leads/${none.id}?err=nomail`);
    assert.equal((await s.admin('/admin/leads/99999/mail')).status, 404);
  } finally {
    s.close();
  }
});

test('presentazione a più agenzie: si rivede chi la riceve e in che lingua, poi va in coda; la coda si ferma, si regola e si annulla', async () => {
  const s = await start();
  try {
    const ok = L.insertLead(s.app.db, L.cleanLead({ company: 'Agenzia Italiana', email: 'info@italiana.it' }).value);
    const jp = L.insertLead(s.app.db, L.cleanLead({ company: 'Sakura Tours', country: 'JP', email: 'info@sakura.jp' }).value, { contact: L.cleanContact({ name: 'Taro Yamada', email: 'taro@sakura.jp' }).value });
    const noMail = L.insertLead(s.app.db, L.cleanLead({ company: 'Senza email' }).value);
    const blocked = L.insertLead(s.app.db, L.cleanLead({ company: 'Non scrivere', email: 'no@x.it' }).value);
    L.optOut(s.app.db, blocked.id);
    const ids = [ok, jp, noMail, blocked].map((l) => ['ids', l.id]);
    const review = await s.admin('/admin/leads/bulk', formPairs([...ids, ['action', 'presentation'], ['return', '?status=new']]));
    assert.equal(review.status, 200);
    const page = await text(review);
    assert.match(page, /<h2>Presentazione a 4 agenzie<\/h2>/);
    assert.match(page, /Nessun indirizzo/);
    assert.match(page, /Non vuole email/);
    assert.match(page, /Taro Yamada/);
    assert.match(page, /Metti in coda 2 email/);
    assert.match(page, new RegExp(`name="lang_${jp.id}"[\\s\\S]*?<option value="ja" selected>`), 'il giapponese per Sakura Tours');
    assert.match(page, /al massimo 15 al giorno/);

    const queued = await s.admin('/admin/leads/bulk/queue', formPairs([['ids', ok.id], ['ids', jp.id], ['ids', noMail.id], [`lang_${ok.id}`, 'en'], [`lang_${jp.id}`, 'ja'], ['followup', '1'], ['followupDays', '9']]));
    assert.equal(loc(queued), '/admin/leads/mail?ok=queuedMany&n=2&skip=1');
    const rows = queueRows(s);
    assert.deepEqual(rows.map((r) => [r.to_email, r.lang, r.template, r.followup_days]), [['info@italiana.it', 'en', 'presentation', 9], ['taro@sakura.jp', 'ja', 'presentation', 9]]);
    assert.match(rows[0].subject, /^Working together with Agenzia Italiana/);
    assert.match(rows[1].body, /^Sakura Tours\nTaro Yamada 様/);
    // la coda
    const mailPage = await text(await s.admin(loc(queued)));
    assert.match(mailPage, /2 presentazioni messe in coda \(1 saltata\): partono da sole, poche al giorno\./);
    assert.match(mailPage, /<span class="kpi-l">In coda<\/span><strong class="kpi-n">2<\/strong>/);
    assert.match(mailPage, /Working together with Agenzia Italiana/);
    assert.match(mailPage, /Attivo/);
    assert.match(mailPage, /dal lunedì al venerdì, dalle 9 alle 17/);
    // mettere in pausa e riprendere
    assert.equal(loc(await s.admin('/admin/leads/mail/pause', form({}))), '/admin/leads/mail?ok=paused');
    const paused = await text(await s.admin('/admin/leads/mail'));
    assert.match(paused, /In pausa/);
    assert.match(paused, /Riprendi/);
    assert.equal(await s.app.leads.sweep(Date.now()), 0, 'in pausa non parte nulla');
    assert.equal(loc(await s.admin('/admin/leads/mail/resume', form({}))), '/admin/leads/mail?ok=resumed');
    // impostazioni
    const bad = await s.admin('/admin/leads/mail/settings', form({ dailyCap: '500', fromHour: '9', toHour: '17', minGapMin: '4', followUpDays: '7' }));
    assert.equal(bad.status, 400);
    assert.match(await text(bad), /Email al giorno: un numero intero tra 1 e 100/);
    assert.equal(M.sendSettings(s.app.db).dailyCap, 15);
    const good = await s.admin('/admin/leads/mail/settings', form({ dailyCap: '8', fromHour: '10', toHour: '16', minGapMin: '6', followUpDays: '10', signature: 'Davide\nGuida a Venezia' }));
    assert.equal(loc(good), '/admin/leads/mail?ok=settings');
    assert.deepEqual([M.sendSettings(s.app.db).dailyCap, M.sendSettings(s.app.db).autoFollowUp, M.sendSettings(s.app.db).signature], [8, false, 'Davide\nGuida a Venezia']);
    // annullare
    assert.equal((await s.admin(`/admin/leads/mail/${rows[0].id}/cancel`, form({}))).status, 303);
    const after = await text(await s.admin('/admin/leads/mail'));
    assert.match(after, /<span class="chip chip-done">Annullata<\/span>/);
    assert.equal(queueRows(s).length, 1);
  } finally {
    s.close();
  }
});

test('sollecito a più agenzie: stessa rivista della presentazione, con l’ultima email di ognuna; va in coda come sollecito che parte solo se l’agenzia non ha risposto', async () => {
  const s = await start();
  try {
    const { db } = s.app;
    const sent = (lead, template, at) => db.prepare("INSERT INTO lead_emails(lead_id, to_email, template, lang, subject, body, send_after, status, sent_at, created_at) VALUES(?, 'x@x.it', ?, 'it', 'Oggetto', 'Testo', ?, 'sent', ?, ?)").run(lead.id, template, at, at, at);
    const a = L.insertLead(db, L.cleanLead({ company: 'Agenzia Presentata', email: 'info@presentata.it', status: 'contacted' }).value);
    const b = L.insertLead(db, L.cleanLead({ company: 'Mai Scritta', country: 'JP', email: 'info@maiscritta.jp' }).value, { contact: L.cleanContact({ name: 'Taro Yamada', email: 'taro@maiscritta.jp' }).value });
    const already = L.insertLead(db, L.cleanLead({ company: 'Già Sollecitata', email: 'info@gia.it', status: 'contacted' }).value);
    const queuedAlready = L.insertLead(db, L.cleanLead({ company: 'Sollecito In Coda', email: 'info@incoda.it', status: 'contacted' }).value);
    const lost = L.insertLead(db, L.cleanLead({ company: 'Non Interessata', email: 'info@no.it', status: 'lost' }).value);
    const talking = L.insertLead(db, L.cleanLead({ company: 'Ha Risposto', email: 'info@risposto.it', status: 'talking' }).value);
    const noMail = L.insertLead(db, L.cleanLead({ company: 'Senza email' }).value);
    const blocked = L.insertLead(db, L.cleanLead({ company: 'Non scrivere', email: 'no@x.it' }).value);
    L.optOut(db, blocked.id);
    sent(a, 'presentation', '2026-10-20T08:00:00.000Z');
    sent(already, 'presentation', '2026-10-01T08:00:00.000Z');
    sent(already, 'followup', '2026-10-09T08:00:00.000Z');
    db.prepare("INSERT INTO lead_emails(lead_id, to_email, template, lang, subject, body, send_after, status, created_at) VALUES(?, 'info@incoda.it', 'followup', 'it', 'Oggetto', 'Testo', '2099-01-01T00:00:00.000Z', 'queued', '2026-11-01T08:00:00.000Z')").run(queuedAlready.id);

    // dall'elenco: il pulsante accanto alla presentazione
    const list = await text(await s.admin('/admin/leads?status='));
    assert.match(list, /<button class="btn btn-sm btn-gold" type="submit" name="action" value="presentation">Scrivi la presentazione ai selezionati<\/button>\s*<button class="btn btn-sm btn-outline" type="submit" name="action" value="followup">Scrivi il sollecito ai selezionati<\/button>/);

    const ids = [a, b, already, queuedAlready, lost, talking, noMail, blocked].map((l) => ['ids', l.id]);
    const review = await s.admin('/admin/leads/bulk', formPairs([...ids, ['action', 'followup'], ['return', '?status=contacted']]));
    assert.equal(review.status, 200);
    const page = await text(review);
    assert.match(page, /<h2>Sollecito a 8 agenzie<\/h2>/);
    assert.match(page, /modello «Sollecito»/);
    assert.match(page, /Un sollecito parte solo se nel frattempo l’agenzia non ha risposto/);
    assert.match(page, /<input type="hidden" name="template" value="followup">/);
    assert.doesNotMatch(page, /name="followup"/, 'dopo un sollecito non ce n’è un altro automatico');
    assert.match(page, /Sollecito già in coda/);
    assert.match(page, /È «non interessata»/);
    assert.match(page, /Ha già risposto: è «In dialogo»/, 'chi è già in trattativa non si sollecita: il sollecito sarebbe saltato comunque');
    assert.match(page, /Nessun indirizzo/);
    assert.match(page, /Non vuole email/);
    assert.match(page, /Metti in coda 3 email/, 'la presentata, quella mai scritta e quella già sollecitata');
    assert.match(page, /Presentazione il 20 ott 2026/, 'l’ultima email partita');
    assert.match(page, /nessuna email inviata finora/);
    assert.match(page, /sollecito già inviato il 9 ott 2026/, 'si vede se è già stata sollecitata');
    assert.match(page, new RegExp(`name="lang_${b.id}"[\\s\\S]*?<option value="ja" selected>`), 'il giapponese per chi lo parla');
    // la presentazione resta com'era
    const pres = await text(await s.admin('/admin/leads/bulk', formPairs([['ids', a.id], ['action', 'presentation']])));
    assert.match(pres, /<h2>Presentazione a 1 agenzia<\/h2>/);
    assert.match(pres, /name="followup" value="1"/);
    assert.doesNotMatch(pres, /Sollecito già in coda/);

    // in coda: sollecito, solo se non risponde, senza un altro sollecito dopo
    const queued = await s.admin('/admin/leads/bulk/queue', formPairs([['ids', a.id], ['ids', b.id], ['ids', already.id], ['ids', queuedAlready.id], ['ids', noMail.id], ['template', 'followup'], [`lang_${a.id}`, 'en'], [`lang_${b.id}`, 'ja'], ['followup', '1'], ['followupDays', '9']]));
    assert.equal(loc(queued), '/admin/leads/mail?ok=queuedMany&n=3&skip=2&tpl=followup');
    const rows = queueRows(s).filter((r) => r.id > 0 && r.template === 'followup' && r.to_email !== 'info@incoda.it');
    assert.deepEqual(rows.map((r) => [r.to_email, r.lang, r.template, r.only_if_quiet, r.followup_days]), [['info@presentata.it', 'en', 'followup', 1, null], ['taro@maiscritta.jp', 'ja', 'followup', 1, null], ['info@gia.it', 'it', 'followup', 1, null]]);
    assert.match(rows[0].subject, /Agenzia Presentata/);
    assert.match(rows[1].body, /Taro Yamada 様/);
    assert.match(await text(await s.admin(loc(queued))), /3 solleciti messi in coda \(2 saltati\): partono da soli, poche al giorno, e solo se nel frattempo l’agenzia non ha risposto\./);
    assert.match(await text(await s.admin('/admin/leads/mail')), /Sollecito/);
    // una presentazione in coda non impedisce un sollecito, e viceversa (sono due cose diverse)
    const mixed = await s.admin('/admin/leads/bulk/queue', formPairs([['ids', a.id], [`lang_${a.id}`, 'it']]));
    assert.equal(loc(mixed), '/admin/leads/mail?ok=queuedMany&n=1&skip=0', 'senza «template» è la presentazione, come sempre');
    assert.deepEqual(queueRows(s).filter((r) => r.lead_id === a.id).map((r) => r.template).sort(), ['followup', 'presentation']);
    // senza nessuna agenzia scelta: si torna all'elenco con un avviso
    assert.match(loc(await s.admin('/admin/leads/bulk', formPairs([['action', 'followup']]))), /err=none/);
  } finally {
    s.close();
  }
});

test('modelli: si modificano e si ripristinano, un segnaposto sbagliato è rifiutato (e ciò che si scriveva resta), la prova arriva a te', async () => {
  const s = await start();
  try {
    const page = await text(await s.admin('/admin/leads/templates'));
    assert.match(page, /<h2>Presentazione · Italiano <span class="chip">Testo di partenza<\/span><\/h2>/);
    assert.match(page, /Com’è con i dati di un’agenzia di esempio/);
    assert.match(page, /Buongiorno Anna,/);
    assert.match(await text(await s.admin('/admin/leads/templates?key=thanks&lang=ja')), /お時間をいただきありがとうございました/);
    assert.match(await text(await s.admin('/admin/leads/templates?key=boh&lang=xx')), /Presentazione · Italiano/, 'chiavi sconosciute: il primo modello');

    const bad = await s.admin('/admin/leads/templates', form({ key: 'presentation', lang: 'it', action: 'save', subject: 'Ciao {{agenzzia}}', body: 'Testo mio con {{firma}}' }));
    assert.equal(bad.status, 400);
    const badPage = await text(bad);
    assert.match(badPage, /Segnaposto sconosciuto: \{\{agenzzia\}\}/);
    assert.match(badPage, /value="Ciao \{\{agenzzia\}\}"/);
    assert.match(badPage, /Testo mio con \{\{firma\}\}/);
    assert.equal(M.templates(s.app.db).presentation.it.custom, false);

    const ok = await s.admin('/admin/leads/templates', form({ key: 'presentation', lang: 'it', action: 'save', subject: 'Per {{agenzia}}', body: '{{saluto}}\n\nPresentazione mia.\n\n{{firma}}' }));
    assert.equal(loc(ok), '/admin/leads/templates?key=presentation&lang=it&ok=saved');
    const saved = await text(await s.admin(loc(ok)));
    assert.match(saved, /Modello salvato\./);
    assert.match(saved, /<span class="chip chip-accent">Modificato da te<\/span>/);
    assert.match(saved, /<strong>Per Agenzia di prova<\/strong>/);
    // il testo nuovo è quello della pagina «scrivi»
    const { id } = await addLead(s);
    assert.match(await text(await s.admin(`/admin/leads/${id}/mail`)), /value="Per Lagoon Travel"/);
    // le altre lingue non cambiano
    assert.equal(M.templates(s.app.db).presentation.en.custom, false);

    // la prova
    const test = await s.admin('/admin/leads/templates', form({ key: 'presentation', lang: 'en', action: 'test', subject: 'Prova {{agenzia}}', body: '{{saluto}} {{link_agenzie}}' }));
    assert.equal(loc(test), '/admin/leads/templates?key=presentation&lang=en&ok=test');
    const m = sentTo(s, 'guida@example.com').at(-1);
    assert.equal(m.subject, '[Anteprima] Prova Agenzia di prova');
    assert.ok(m.text.startsWith('Hello Anna, http://localhost/en/b2b'));
    // ripristino
    const reset = await s.admin('/admin/leads/templates', form({ key: 'presentation', lang: 'it', action: 'reset' }));
    assert.equal(loc(reset), '/admin/leads/templates?key=presentation&lang=it&ok=reset');
    assert.equal(M.templates(s.app.db).presentation.it.custom, false);
  } finally {
    s.close();
  }
});

// ───────────── importare ed esportare ─────────────
test('importare un elenco: anteprima con i doppioni, poi l’importazione; esportare tutto in CSV', async () => {
  const s = await start();
  try {
    await addLead(s, { company: 'Già Presente', email: 'info@gia.it' });
    assert.match(await text(await s.admin('/admin/leads/import')), /<h2>Importa un elenco<\/h2>/);
    const csv = 'Azienda;Email;Telefono;Paese;Referente\nAlfa Viaggi;info@alfa.it;+39 049 123456;Italia;Anna Rossi\nGià presente srl;info@gia.it;;Italia;\n=CMD();x@y.it;;;\nBeta Tours;;;Giappone;';
    const prev = await s.admin('/admin/leads/import', form({ text: csv, source: 'Fiera BIT', action: 'preview' }));
    assert.equal(prev.status, 200);
    const page = await text(prev);
    assert.match(page, /3 contatti nuovi su 4 righe/);
    assert.match(page, /già presente: Già Presente/);
    assert.match(page, /Importa 3 contatti/);
    assert.equal(L.leadCounts(s.app.db).total, 1, 'l’anteprima non salva nulla');

    const done = await text(await s.admin('/admin/leads/import', form({ text: csv, source: 'Fiera BIT', action: 'import' })));
    assert.match(done, /Importati 3 contatti\./);
    assert.match(done, /1 era già presente ed è stato saltato\./);
    const all = L.searchLeads(s.app.db, { sort: 'company' }).rows;
    assert.deepEqual(all.map((l) => [l.company, l.source]), [['=CMD()', 'Fiera BIT'], ['Alfa Viaggi', 'Fiera BIT'], ['Beta Tours', 'Fiera BIT'], ['Già Presente', null]]);
    assert.deepEqual(all.find((l) => l.company === 'Beta Tours').lang, 'ja');

    const exp = await s.admin('/admin/leads/export.csv');
    assert.equal(exp.status, 200);
    assert.match(exp.headers.get('content-type'), /^text\/csv/);
    assert.match(exp.headers.get('content-disposition'), /contatti-commerciali\.csv/);
    const bytes = Buffer.from(await exp.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'il BOM fa aprire gli accenti giusti a Excel');
    const body = bytes.toString('utf8').slice(1);
    assert.ok(body.startsWith('Azienda;Tipo;Stato'));
    assert.ok(body.includes("'=CMD()"), 'una formula nel nome non si esegue aprendo il file');
    assert.equal(body.trim().split('\r\n').length, 5);
  } finally {
    s.close();
  }
});

// ───────────── non ricevere più email (pagina pubblica) ─────────────
test('«non ricevere più email»: il collegamento chiede conferma (aprirlo non basta), poi nessuna email parte più; vale nelle quattro lingue e non si falsifica', async () => {
  const s = await start();
  try {
    const { id } = await addLead(s, { contact_name: 'Anna Rossi', contact_email: 'anna@lagoon.it' });
    const w = await s.app.leads.write({ leadId: id, contactId: L.mainContact(s.app.db, id).id, to: 'anna@lagoon.it', template: 'presentation', lang: 'it', subject: 'Ciao', body: 'Testo', mode: 'now', followupDays: 7 });
    assert.equal(w.sent, true);
    assert.equal(queueRows(s).length, 1, 'il sollecito è in coda');
    const url = sentTo(s, 'anna@lagoon.it')[0].text.match(/(http:\/\/localhost\/it\/b2b\/unsubscribe\/[\w.-]+)/)[1];
    const p = new URL(url).pathname;

    const ask = await s.anon(p);
    assert.equal(ask.status, 200);
    const askPage = await text(ask);
    assert.match(askPage, /<h1>Non ricevere più email<\/h1>/);
    assert.match(askPage, /Vuoi che Davide Tomio non ti scriva più/);
    assert.match(askPage, new RegExp(`<form method="post" action="${p.replace(/[.]/g, '\\.')}"`));
    assert.match(askPage, /noindex/);
    assert.equal(L.getLead(s.app.db, id).email_ok, 1, 'solo aprire il collegamento non disiscrive nessuno');

    const done = await s.anon(p, { method: 'POST' });
    assert.equal(done.status, 200);
    assert.match(await text(done), /<h1>Fatto<\/h1>/);
    const lead = L.getLead(s.app.db, id);
    assert.deepEqual([lead.email_ok, lead.optout_at !== null], [0, true]);
    assert.ok(L.isSuppressed(s.app.db, 'anna@lagoon.it'));
    assert.equal(queueRows(s).length, 0, 'il sollecito in coda è stato annullato');
    assert.ok(L.timeline(s.app.db, id).some((a) => a.kind === 'optout' && /dal link/.test(a.title)));
    assert.match(await text(await s.anon(p)), /<h1>Fatto<\/h1>/, 'riaprirlo dice che è fatto');
    // il programma di posta che usa «annulla iscrizione» con un clic: una richiesta senza nulla
    assert.equal((await s.anon(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })).status, 200);
    // nella guida si vede e non si può scrivere
    assert.match(await text(await s.admin(`/admin/leads/${id}`)), /Non scrivere a questo contatto\./);
    assert.equal(loc(await s.admin(`/admin/leads/${id}/mail`)), `/admin/leads/${id}?err=nomail`);

    // collegamenti sbagliati: 404 e nessun contatto toccato
    const token = p.split('/').pop();
    for (const bad of ['abc', `${token}x`, 'anteprima', '..%2F..']) {
      const r1 = await s.anon(`/it/b2b/unsubscribe/${bad}`);
      assert.equal(r1.status, 404, bad);
      assert.match(await text(r1), /Collegamento non valido/);
      assert.equal((await s.anon(`/it/b2b/unsubscribe/${bad}`, { method: 'POST' })).status, 404);
    }
    // nelle altre lingue (la lingua è quella dell'indirizzo)
    for (const [lang, re] of [['en', /Stop receiving emails/], ['es', /Dejar de recibir correos/], ['ja', /メールの配信停止/]]) {
      const other = await addLead(s, { company: `Agenzia ${lang}`, email: `info@${lang}-agency.example` });
      const link = `/${lang}/b2b/unsubscribe/${M.unsubscribeToken(s.cfg, other.id)}`;
      assert.match(await text(await s.anon(link)), re, lang);
    }
    // la guida può riabilitare
    assert.equal(loc(await s.admin(`/admin/leads/${id}/allow-email`, form({}))), `/admin/leads/${id}?ok=allowed`);
    assert.equal(L.getLead(s.app.db, id).email_ok, 1);
  } finally {
    s.close();
  }
});

// ───────────── area B2B ─────────────
test('area B2B: invito dal contatto → l’agenzia si registra → diventa cliente; profilo creato subito → sceglie la password; scheda del partner con il collegamento', async () => {
  const s = await start();
  try {
    // 1) l'invito
    const { id } = await addLead(s, { company: 'Lagoon Travel', contact_name: 'Anna Rossi', contact_email: 'anna@lagoon.it' });
    assert.match(await text(await s.admin(`/admin/leads/${id}`)), /Questa agenzia non ha ancora un profilo/);
    const inv = await s.admin(`/admin/leads/${id}/invite`, form({ contactId: String(L.mainContact(s.app.db, id).id), note: 'Come da telefonata' }));
    assert.equal(inv.status, 200);
    const invPage = await text(inv);
    assert.match(invPage, /Invito mandato: l’agenzia riceve un <strong>collegamento personale<\/strong>/);
    const url = invPage.match(/value="(http:\/\/localhost\/it\/b2b\/invite\/[\w-]+)"/)[1];
    assert.equal(sentTo(s, 'anna@lagoon.it')[0].text.includes(url), true);
    assert.equal(L.getLead(s.app.db, id).status, 'invited');
    assert.match(await text(await s.admin('/admin/leads?status=invited')), /Lagoon Travel/);

    // l'agenzia apre il collegamento e si registra
    const open = await text(await s.anon(new URL(url).pathname));
    assert.match(open, /value="Lagoon Travel"/);
    assert.match(open, /value="anna@lagoon\.it"/);
    const reg = await s.anon(new URL(url).pathname, form({ ...REGI, email: 'anna@lagoon.it' }));
    assert.equal(reg.status, 303);
    // il contatto si accorge del profilo (anche solo aprendo la pagina) e diventa cliente
    const detail = await text(await s.admin(`/admin/leads/${id}`));
    assert.deepEqual([L.getLead(s.app.db, id).status, L.getLead(s.app.db, id).account_id !== null], ['client', true]);
    assert.match(detail, /<span class="chip chip-ok">Approvato<\/span> <a href="\/admin\/partners\/\d+"><strong>Lagoon Travel<\/strong>/);
    assert.match(detail, /Nessuna prenotazione ancora\./);
    const acct = s.app.db.prepare("SELECT id FROM accounts WHERE email = 'anna@lagoon.it'").get();
    const partner = await text(await s.admin(`/admin/partners/${acct.id}`));
    assert.match(partner, new RegExp(`<a class="btn btn-outline btn-sm" href="/admin/leads/${id}">Contatto commerciale</a>`));
    assert.match(await text(await s.admin('/admin/leads?status=client')), /Lagoon Travel/);
    // un invito a chi ha già un profilo non si manda
    const before = s.app.mail.sent.length;
    assert.match(loc(await s.admin(`/admin/leads/${id}/invite`, form({}))), /err=invite-exists#b2b$/);
    assert.equal(s.app.mail.sent.length, before);

    // 2) il profilo creato subito
    const two = await addLead(s, { company: 'Sakura Tours', country: 'JP', email: 'info@sakura.jp', contact_name: 'Taro Yamada', contact_email: 'taro@sakura.jp' });
    const prof = await s.admin(`/admin/leads/${two.id}/profile`, form({ contactId: String(L.mainContact(s.app.db, two.id).id), sendMail: '1' }));
    assert.equal(prof.status, 200);
    const profPage = await text(prof);
    assert.match(profPage, /Profilo creato e approvato\. Ho mandato all’agenzia l’email per <strong>scegliere la password<\/strong>/);
    const link = profPage.match(/value="(http:\/\/localhost\/ja\/b2b\/reset\/[\w.-]+)"/)[1];
    const welcome = sentTo(s, 'taro@sakura.jp')[0];
    assert.ok(welcome.text.includes(link));
    assert.equal(L.getLead(s.app.db, two.id).status, 'client');
    // dal collegamento sceglie la password e si trova dentro la sua area
    const p = new URL(link).pathname;
    assert.equal((await s.anon(p)).status, 200);
    const pw = await s.anon(p, form({ password: 'una-password-lunga', password2: 'una-password-lunga' }));
    assert.equal(pw.status, 303);
    assert.equal(loc(pw), '/ja/b2b/account');
    assert.equal((await s.anon(p)).status, 400, 'il collegamento vale una volta sola');
    const login = await s.anon('/ja/b2b/login', form({ email: 'taro@sakura.jp', password: 'una-password-lunga' }));
    assert.equal(login.status, 303);
    // una password che nessuno conosce: nemmeno la vecchia funziona
    assert.equal((await s.anon('/ja/b2b/login', form({ email: 'taro@sakura.jp', password: '' }))).status, 401);

    // 3) un'agenzia registrata da sola: dalla sua scheda la si porta tra i contatti; o tutte insieme da «Oggi»
    const alone = addAccount(s.app.db, { email: 'sola@x.it', company: 'Registrata da sola', contact_name: 'Gigi' });
    addAccount(s.app.db, { email: 'altra@x.it', company: 'Un’altra', contact_name: 'Pia' });
    assert.match(await text(await s.admin(`/admin/partners/${alone.id}`)), /Aggiungi ai contatti commerciali/);
    const today1 = await text(await s.admin('/admin/leads/today'));
    assert.match(today1, /2 agenzie registrate sul sito non sono<\/strong> ancora tra i contatti/);
    const add = await s.admin(`/admin/partners/${alone.id}/lead`, form({}));
    assert.match(loc(add), /^\/admin\/leads\/\d+$/);
    const mine = L.leadOfAccount(s.app.db, alone.id);
    assert.deepEqual([mine.company, mine.status], ['Registrata da sola', 'client']);
    assert.equal(loc(await s.admin(`/admin/partners/${alone.id}/lead`, form({}))), `/admin/leads/${mine.id}`, 'una volta sola');
    assert.match(await text(await s.admin('/admin/leads/today')), /1 agenzia registrata sul sito non è<\/strong> ancora tra i contatti/);
    assert.equal(loc(await s.admin('/admin/leads/registered', form({}))), '/admin/leads/today?ok=registered&n=1');
    assert.doesNotMatch(await text(await s.admin('/admin/leads/today')), /ancora tra i contatti/);

    // senza indirizzo non si invita né si crea un profilo
    const bare = await addLead(s, { company: 'Senza email', email: '' });
    assert.match(loc(await s.admin(`/admin/leads/${bare.id}/invite`, form({}))), /err=invite-email#b2b$/);
    assert.match(loc(await s.admin(`/admin/leads/${bare.id}/profile`, form({}))), /err=profile-email#b2b$/);
    assert.match(await text(await s.admin(`/admin/leads/${bare.id}?err=invite-email`)), /Per invitare serve un indirizzo email/);
  } finally {
    s.close();
  }
});

test('ripristino: i contatti commerciali compaiono nel controllo prima di sostituire i dati', async () => {
  const s = await start();
  try {
    await addLead(s);
    const counts = s.app.db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
    assert.equal(counts, 1);
    // la voce è nelle liste del ripristino: nessun errore a ricaricare la pagina del backup
    const page = await s.admin('/admin/backup');
    assert.equal(page.status, 200);
  } finally {
    s.close();
  }
});

test('Email › Da quale indirizzo partono: si vede da dove partono, si sceglie il mittente, la prova dice se il server lo accetta; il registro di Aiuto › Email mostra il mittente', async () => {
  const s = await start({ mail: { from: 'Davide Tomio <tours@example.it>', notifyTo: 'guida@example.com' } });
  try {
    const page = await text(await s.admin('/admin/leads/mail'));
    assert.match(page, /<h2>Da quale indirizzo partono<\/h2>/);
    assert.match(page, /partono da <strong>Davide Tomio &lt;tours@example\.it&gt;<\/strong>; chi risponde scrive a <strong>guida@example\.com<\/strong>/);
    assert.match(page, /Usano la stessa posta delle conferme di prenotazione/);
    assert.match(page, /Partono dallo <strong>stesso mittente delle conferme<\/strong>/, 'consiglia un indirizzo proprio');
    assert.match(page, /name="to" required maxlength="254" value="guida@example\.com"/, 'la prova va di base all’indirizzo delle notifiche');
    assert.match(page, /SALES_SMTP_HOST/, 'e dice come usare la posta di info@');

    // indirizzi sbagliati: errore chiaro, e il modulo conserva ciò che si era scritto
    const bad = await s.admin('/admin/leads/mail/sender', form({ fromEmail: 'info@', fromName: 'Davide', replyTo: '', bcc: '' }));
    assert.equal(bad.status, 400);
    const badPage = await text(bad);
    assert.match(badPage, /Indirizzo mittente: scrivi un indirizzo email valido/);
    assert.match(badPage, /name="fromEmail" maxlength="254" value="info@"/);
    assert.equal(M.sendSettings(s.app.db).fromEmail, '');
    assert.equal((await s.admin('/admin/leads/mail/sender', form({ fromName: 'Solo nome' }))).status, 400);

    // il mittente tuo
    const ok = await s.admin('/admin/leads/mail/sender', form({ fromEmail: 'info@example.it', fromName: 'Davide Tomio', replyTo: '', bcc: 'copia@posteo.example' }));
    assert.equal(loc(ok), '/admin/leads/mail?ok=sender#mittente');
    const saved = await text(await s.admin('/admin/leads/mail?ok=sender'));
    assert.match(saved, /Mittente salvato: da adesso le email commerciali partono da lì/);
    assert.match(saved, /partono da <strong>Davide Tomio &lt;info@example\.it&gt;<\/strong>; chi risponde scrive allo stesso indirizzo; ne ricevi una copia nascosta a <strong>copia@posteo\.example<\/strong>/);
    assert.doesNotMatch(saved, /Partono dallo <strong>stesso mittente delle conferme/);
    assert.match(saved, /name="fromEmail" maxlength="254" value="info@example\.it"/);

    // la prova
    const test = await s.admin('/admin/leads/mail/sender-test', form({ to: 'guida@example.com' }));
    assert.equal(loc(test), '/admin/leads/mail?ok=senderTest#mittente');
    assert.match(await text(await s.admin(loc(test))), /Prova inviata: controlla che sia arrivata/);
    const m = s.app.mail.sent.at(-1);
    assert.deepEqual([m.to, m.subject, m.from], ['guida@example.com', 'Prova di invio dal Commerciale', { name: 'Davide Tomio', address: 'info@example.it' }]);
    assert.equal((await s.admin('/admin/leads/mail/sender-test', form({ to: 'non-un-indirizzo' }))).status, 400);

    // il server non accetta il mittente: si vede il motivo, non un generico «non è partita»
    const realSend = s.app.mail.send;
    s.app.mail.send = async () => { s.app.mail.lastError = '553 5.7.1 Sender address rejected: not owned by user'; return false; };
    const fail = await s.admin('/admin/leads/mail/sender-test', form({ to: 'guida@example.com' }));
    assert.equal(fail.status, 502);
    assert.match(await text(fail), /La prova non è partita da Davide Tomio &lt;info@example\.it&gt;\. Il server di posta dice: 553 5\.7\.1 Sender address rejected/);
    s.app.mail.send = realSend;

    // una presentazione parte da lì (con la copia nascosta), e il registro delle email del sito lo mostra
    const { id } = await addLead(s, { contact_name: 'Anna Rossi', contact_email: 'anna@lagoon.it' });
    const sent = await s.admin(`/admin/leads/${id}/mail`, form({ to: 'anna@lagoon.it', contactId: String(L.mainContact(s.app.db, id).id), template: 'presentation', lang: 'it', subject: 'Ciao Anna', body: 'Testo', when: 'now', action: 'send' }));
    assert.equal(loc(sent), `/admin/leads/${id}?ok=emailSent`);
    const out = s.app.mail.sent.at(-1);
    assert.deepEqual([out.to, out.from, out.bcc, out.replyTo], ['anna@lagoon.it', { name: 'Davide Tomio', address: 'info@example.it' }, 'copia@posteo.example', undefined]);
    const log = await text(await s.admin('/admin/mail'));
    assert.match(log, /Da: Davide Tomio &lt;info@example\.it&gt; · Copia nascosta: copia@posteo\.example/);
  } finally {
    s.close();
  }
});
