// Commerciale › Email: modelli, firma e link per non ricevere più email, coda con tetto giornaliero, sollecito condizionato, invito al sito e profilo B2B creato dalla guida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordFingerprint, verifyToken } from '../server/auth.js';
import { LANGS } from '../server/langs.js';
import * as L from '../server/leads.js';
import * as M from '../server/leadMail.js';
import { addAccount, makeApp, NOW } from './helpers.js';

const MIN = 60_000;
const DAY = 86_400_000;
const mk = (db, over = {}) => {
  const { contact, ...rest } = over;
  return L.insertLead(db, L.cleanLead({ company: 'Lagoon Travel', email: 'info@lagoon.it', ...rest }).value, { contact: contact ? L.cleanContact(contact).value : null, nowMs: NOW });
};
const settings = (db, over = {}) => M.saveSendSettings(db, { dailyCap: 15, fromHour: 9, toHour: 17, minGapMin: 4, followUpDays: 7, autoFollowUp: '1', signature: '', ...over });
/** Una presentazione pronta per un contatto, in coda per «adesso». */
const queue = (app, lead, over = {}) => {
  const c = M.composeEmail(app, { lead, contact: L.mainContact(app.db, lead.id), template: 'presentation' });
  return M.queueEmail(app.db, { leadId: lead.id, contactId: L.mainContact(app.db, lead.id)?.id ?? null, to: c.to, template: 'presentation', lang: c.lang, subject: c.subject, body: c.body, sendAfter: NOW, ...over }, NOW);
};
const statusOf = (db, id) => db.prepare('SELECT status, note FROM lead_emails WHERE id = ?').get(id);

test('modelli di partenza: tutti presenti nelle quattro lingue, senza segnaposto sbagliati, con la firma', () => {
  for (const key of M.TEMPLATE_KEYS) {
    for (const lang of LANGS) {
      const t = M.DEFAULT_TEMPLATES[key][lang];
      assert.ok(t.subject.trim() && t.body.trim(), `${key} ${lang}`);
      assert.deepEqual(M.unknownVariables(`${t.subject} ${t.body}`), [], `${key} ${lang}: segnaposto sconosciuti`);
      assert.match(t.body, /\{\{firma\}\}/, `${key} ${lang}: manca la firma`);
      assert.match(t.body, /\{\{link_agenzie\}\}/, `${key} ${lang}: manca il collegamento alla pagina per le agenzie`);
      assert.match(t.body, /\{\{saluto\}\}/);
    }
  }
  assert.match(M.DEFAULT_TEMPLATES.presentation.ja.body, /[\u3040-\u30ff]/, 'il giapponese è scritto in giapponese');
  assert.match(M.DEFAULT_TEMPLATES.presentation.es.body, /agencias/);
  assert.ok(M.unknownVariables('ciao {{agenzzia}} e {{ firma }} {{x y}}').sort().join() === 'agenzzia,x y');
});

test('i modelli si modificano dal pannello: un refuso nel segnaposto è rifiutato, vuoto torna al testo di partenza', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  assert.equal(M.templates(db).presentation.it.custom, false);
  M.saveTemplate(db, 'presentation', 'it', { subject: 'Ciao {{agenzia}}', body: '{{saluto}}\n\nCiao!\n\n{{firma}}' });
  const mine = M.templates(db).presentation.it;
  assert.deepEqual([mine.custom, mine.subject], [true, 'Ciao {{agenzia}}']);
  assert.equal(M.templates(db).presentation.en.custom, false, 'le altre lingue non cambiano');
  const err = (fn) => { try { fn(); } catch (e) { return e; } return null; };
  const bad = err(() => M.saveTemplate(db, 'presentation', 'it', { subject: 'Ciao {{agenzzia}}', body: 'x' }));
  assert.deepEqual([bad.code, bad.names], ['placeholder', ['agenzzia']]);
  assert.equal(err(() => M.saveTemplate(db, 'presentation', 'it', { subject: 'solo oggetto', body: '' })).code, 'empty');
  assert.equal(err(() => M.saveTemplate(db, 'inventato', 'it', { subject: 'a', body: 'b' })).code, 'template');
  assert.equal(M.templates(db).presentation.it.subject, 'Ciao {{agenzia}}', 'un salvataggio rifiutato non cambia nulla');
  M.saveTemplate(db, 'presentation', 'it', { subject: '', body: '' });
  assert.equal(M.templates(db).presentation.it.custom, false);
});

test('impostazioni d’invio: valori validi, estremi rifiutati con un messaggio, la pausa si conserva', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  assert.deepEqual(M.sendSettings(db), M.SEND_DEFAULTS);
  assert.deepEqual(settings(db, { dailyCap: '20', signature: ' Davide\r\nGuida ' }), { ok: true });
  assert.deepEqual([M.sendSettings(db).dailyCap, M.sendSettings(db).signature], [20, 'Davide\nGuida']);
  for (const [k, v] of [['dailyCap', '0'], ['dailyCap', '101'], ['fromHour', '25'], ['minGapMin', 'x'], ['followUpDays', '1']]) assert.ok(settings(db, { [k]: v }).error, `${k}=${v}`);
  assert.match(settings(db, { fromHour: '17', toHour: '9' }).error, /dopo/);
  assert.equal(M.sendSettings(db).dailyCap, 20, 'un salvataggio rifiutato non cambia nulla');
  M.setPaused(db, true);
  settings(db, { dailyCap: '10' });
  assert.deepEqual([M.sendSettings(db).paused, M.sendSettings(db).dailyCap], [true, 10], 'salvare le impostazioni non riaccende l’invio');
  M.setPaused(db, false);
  assert.equal(M.sendSettings(db).paused, false);
});

test('comporre: saluto e lingua del referente, firma dai dati del sito, collegamenti, nessun segnaposto rimasto', (t) => {
  const app = makeApp({ site: { name: 'Davide Tomio', phone: '+39 333 1234567', email: 'info@davide.it', guideLicense: 'Abilitazione n. 123' } });
  t.after(app.cleanup);
  const it = mk(app.db, { contact: { name: 'Anna Rossi', email: 'anna@lagoon.it' } });
  const c = M.composeEmail(app, { lead: it, contact: L.mainContact(app.db, it.id) });
  assert.equal(c.to, 'anna@lagoon.it');
  assert.equal(c.lang, 'it');
  assert.match(c.subject, /^Collaborazione con Lagoon Travel/);
  assert.match(c.body, /^Buongiorno Anna,\n\nmi chiamo Davide Tomio/);
  assert.ok(c.body.includes(`${app.cfg.baseUrl}/it/b2b\n`), 'il collegamento alla pagina per le agenzie, nella lingua');
  assert.match(c.body, /Davide Tomio\nGuida turistica · Venezia\nAbilitazione n\. 123\nTel\. \+39 333 1234567\ninfo@davide\.it\nhttp/, 'la firma');
  assert.ok(!c.body.includes('{{'));
  // senza referente: saluto generico e indirizzo generale
  assert.match(M.composeEmail(app, { lead: it }).body, /^Buongiorno,\n/);
  assert.equal(M.composeEmail(app, { lead: it }).to, 'info@lagoon.it');
  // un referente che è solo un indirizzo non si saluta per nome
  const anon = mk(app.db, { company: 'Anon', email: '', hintEmail: 'booking@anon.it', contact: { email: 'booking@anon.it' } });
  assert.match(M.composeEmail(app, { lead: anon, contact: L.mainContact(app.db, anon.id) }).body, /^Buongiorno,\n/);
  // la lingua del referente vince su quella dell'agenzia; ogni lingua ha il suo saluto
  const jp = mk(app.db, { company: 'Sakura Tours', country: 'JP', email: 'info@sakura.jp', contact: { name: 'Taro Yamada', email: 'taro@sakura.jp' } });
  const ja = M.composeEmail(app, { lead: jp, contact: L.mainContact(app.db, jp.id) });
  assert.equal(ja.lang, 'ja');
  assert.match(ja.body, /^Sakura Tours\nTaro Yamada 様\n\n突然のご連絡/);
  assert.match(ja.subject, /Sakura Tours様/);
  assert.match(M.composeEmail(app, { lead: jp, contact: null }).body, /^Sakura Tours\nご担当者様\n/);
  assert.match(M.composeEmail(app, { lead: it, contact: L.mainContact(app.db, it.id), lang: 'en' }).body, /^Hello Anna,\n\nmy name is/);
  assert.match(M.composeEmail(app, { lead: it, contact: L.mainContact(app.db, it.id), lang: 'es' }).body, /^Hola Anna,\n\nme llamo/);
  assert.match(M.composeEmail(app, { lead: it, template: 'followup', lang: 'en' }).subject, /reminder/);
  assert.match(M.composeEmail(app, { lead: it, template: 'thanks' }).body, /grazie per il tempo/);
  // una firma scelta dalla guida sostituisce quella composta
  settings(app.db, { signature: 'Davide\nVenezia' });
  assert.match(M.composeEmail(app, { lead: it }).body, /\n\nDavide\nVenezia$/);
});

test('l’email com’è spedita: piede con chi scrive e link per non riceverne altre (firmato), intestazioni del programma di posta, HTML sicuro', (t) => {
  const app = makeApp({ site: { name: 'Davide Tomio', legalName: 'Davide Tomio', vatNumber: 'IT12345678903', address: 'Via Roma 1, Venezia' } });
  t.after(app.cleanup);
  const lead = mk(app.db, { lang: 'en' });
  const out = M.renderOutgoing(app, { lead, lang: 'en', subject: 'Hi\nthere', body: 'Hello <b>Anna</b>,\n\nSee https://example.com/a?x=1&y=2.\n\nBye' }, NOW);
  assert.equal(out.subject, 'Hi there', 'l’oggetto è una riga sola');
  const url = out.headers['List-Unsubscribe'].slice(1, -1);
  assert.match(url, new RegExp(`^${app.cfg.baseUrl.replace(/[.]/g, '\\.')}/en/b2b/unsubscribe/[\\w-]+\\.[\\w-]+$`));
  assert.equal(out.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(out.text.includes(`\n--\nYou are receiving this message because your business address`));
  assert.ok(out.text.includes(url));
  assert.ok(out.text.includes('Davide Tomio · VAT no. IT12345678903 · Via Roma 1, Venezia'), 'chi scrive, con i dati dell’attività');
  assert.ok(out.html.includes('Hello &lt;b&gt;Anna&lt;/b&gt;'), 'il testo è sempre escapato');
  assert.ok(!out.html.includes('<b>Anna'));
  assert.ok(out.html.includes('<a href="https://example.com/a?x=1&amp;y=2" style="color:#7a5c2e">https://example.com/a?x=1&amp;y=2</a>.'), 'il collegamento è cliccabile, il punto finale no');
  assert.ok(out.html.includes(`href="${url.replace(/&/g, '&amp;')}"`));
  for (const lang of LANGS) assert.ok(M.renderOutgoing(app, { lead, lang, subject: 's', body: 'b' }).text.includes(`/${lang}/b2b/unsubscribe/`), lang);

  // il collegamento riporta al contatto, e solo a lui; uno manomesso non vale; l'anteprima non disiscrive nessuno
  const token = url.split('/').pop();
  assert.equal(M.leadOfToken(app.cfg, token), lead.id);
  assert.equal(M.leadOfToken(app.cfg, `${token}x`), null);
  assert.equal(M.leadOfToken(app.cfg, 'abc.def'), null);
  assert.equal(M.leadOfToken(app.cfg, undefined), null);
  assert.equal(verifyToken('altro-segreto', token), null);
  const preview = M.renderOutgoing(app, { lead, lang: 'en', subject: 's', body: 'b', preview: true });
  assert.ok(preview.headers['List-Unsubscribe'].endsWith('/unsubscribe/anteprima>'));
  assert.equal(M.leadOfToken(app.cfg, 'anteprima'), null);
});

test('la coda: controlli all’inserimento (indirizzo, divieto, testo, segnaposto, doppioni)', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  const lead = mk(db, { contact: { name: 'Anna', email: 'anna@lagoon.it' } });
  const err = (over) => { try { queue(app, lead, over); } catch (e) { return e.code; } return null; };
  assert.equal(err({ to: 'senza-chiocciola' }), 'email');
  assert.equal(err({ subject: '' }), 'empty');
  assert.equal(err({ body: 'Ciao {{agenzzia}}' }), 'placeholder');
  assert.equal(M.queuedCount(db), 0);
  const first = queue(app, lead);
  assert.deepEqual([first.status, first.to_email, first.lang, first.send_after], ['queued', 'anna@lagoon.it', 'it', new Date(NOW).toISOString()]);
  assert.equal(err({}), 'duplicate', 'una presentazione in coda alla volta');
  assert.equal(err({ to: 'ANNA@lagoon.it' }), 'duplicate', 'lo stesso indirizzo, anche scritto in maiuscolo');
  assert.equal(queue(app, lead, { to: 'luca@lagoon.it' }).to_email, 'luca@lagoon.it', 'a un collega della stessa agenzia si può scrivere lo stesso: è un’altra persona');
  assert.equal(queue(app, lead, { template: 'custom' }).template, 'custom', 'le email scritte a mano non hanno questo limite');
  assert.equal(queue(app, lead, { template: 'thanks' }).template, 'thanks');
  assert.equal(queue(app, lead, { template: 'inventato' }).template, 'custom');
  assert.equal(queue(app, lead, { template: 'followup', contactId: 99999 }).contact_id, null, 'un referente di un altro contatto non vale');
  assert.equal(M.cancelEmail(db, first.id), true);
  assert.equal(M.cancelEmail(db, first.id), false, 'si annulla una volta sola');
  assert.equal(err({}), null, 'annullata quella in coda, se ne può mettere un’altra');
  L.optOut(db, lead.id, { nowMs: NOW });
  assert.equal(M.queuedCount(db), 0, 'chi non vuole più email non ha nulla in coda');
  assert.equal(err({}), 'blocked');
  assert.equal(err({ to: 'ANNA@lagoon.it' }), 'blocked');
  assert.equal(M.queuedEmails(db).length, 0);
  const history = M.recentEmails(db);
  assert.ok(history.every((e) => e.status === 'cancelled'));
  assert.equal(history.filter((e) => e.note === 'Non vuole più ricevere email').length, 6, 'le sei ancora in coda sono state annullate dal divieto');
});

test('scrivere subito: parte, finisce nel registro, porta in «Contattata», fissa il richiamo e mette in coda il sollecito', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  const lead = mk(db, { contact: { name: 'Anna', email: 'anna@lagoon.it' } });
  const c = M.composeEmail(app, { lead, contact: L.mainContact(db, lead.id) });
  const r = await app.leads.write({ leadId: lead.id, contactId: L.mainContact(db, lead.id).id, to: c.to, template: 'presentation', lang: c.lang, subject: c.subject, body: c.body, mode: 'now', followupDays: 7 }, NOW);
  assert.equal(r.sent, true);
  assert.equal(r.row.status, 'sent');
  const mail = app.mail.sent.at(-1);
  assert.deepEqual([mail.to, mail.subject, mail.replyTo], ['anna@lagoon.it', c.subject, app.cfg.mail.notifyTo || undefined]);
  assert.ok(mail.text.includes('Buongiorno Anna,') && mail.text.includes('/b2b/unsubscribe/'));
  assert.ok(mail.headers['List-Unsubscribe']);
  const after = L.getLead(db, lead.id);
  assert.deepEqual([after.status, after.last_contact_on, after.next_action_on, after.next_action], ['contacted', '2027-01-04', '2027-01-11', 'Sollecito automatico in coda']);
  const act = L.timeline(db, lead.id)[0];
  assert.deepEqual([act.kind, act.title, act.contact_name], ['email_out', c.subject, 'Anna']);
  assert.equal(act.body, c.body, 'nel registro c’è ciò che è stato scritto, senza il piede');
  const queued = M.queuedEmails(db);
  assert.equal(queued.length, 1);
  assert.deepEqual([queued[0].template, queued[0].only_if_quiet, queued[0].send_after, queued[0].subject], ['followup', 1, new Date(NOW + 7 * DAY).toISOString(), M.composeEmail(app, { lead, template: 'followup' }).subject]);

  // senza sollecito automatico il richiamo è solo un promemoria per la guida
  const other = mk(db, { company: 'Altra', email: 'altra@x.it' });
  await app.leads.write({ leadId: other.id, to: 'altra@x.it', template: 'presentation', lang: 'it', subject: 'Ciao', body: 'Testo', mode: 'now' }, NOW);
  assert.deepEqual([L.getLead(db, other.id).next_action_on, L.getLead(db, other.id).next_action], ['2027-01-11', 'Ricontattare se non risponde']);
  assert.equal(M.queuedEmails(db).length, 1, 'nessun sollecito in coda');

  // la posta non risponde: l'email non risulta spedita e non cambia nulla nel contatto
  const third = mk(db, { company: 'Terza', email: 'terza@x.it' });
  app.mail.send = async () => false;
  const bad = await app.leads.write({ leadId: third.id, to: 'terza@x.it', template: 'presentation', lang: 'it', subject: 'Ciao', body: 'Testo', mode: 'now' }, NOW);
  assert.deepEqual([bad.sent, bad.failed, bad.row.status], [false, true, 'failed']);
  assert.match(bad.row.note, /non è partita/);
  assert.deepEqual([L.getLead(db, third.id).status, L.timeline(db, third.id).length], ['new', 0]);
  // un divieto blocca anche l'invio immediato
  L.optOut(db, third.id, { nowMs: NOW });
  await assert.rejects(app.leads.write({ leadId: third.id, to: 'terza@x.it', template: 'custom', lang: 'it', subject: 'a', body: 'b', mode: 'now' }, NOW), { code: 'blocked' });
});

test('la coda parte da sola: solo nei giorni feriali dentro la finestra, un’email alla volta con una pausa, con un tetto al giorno e un interruttore di pausa', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  settings(db, { dailyCap: '2', minGapMin: '3' });
  const leads = ['A', 'B', 'C'].map((n) => mk(db, { company: `Agenzia ${n}`, email: `${n.toLowerCase()}@x.it` }));
  const rows = leads.map((l, i) => queue(app, l, { sendAfter: NOW + i }));
  const sweep = (ms) => app.leads.sweep(ms);
  const sentTo = () => app.mail.sent.map((m) => m.to);

  assert.equal(await sweep(NOW - 2 * 60 * MIN), 0, 'alle 8 è presto');
  assert.equal(await sweep(NOW + 7 * 60 * MIN + 1), 0, 'dopo le 17 è tardi');
  assert.equal(await sweep(NOW - DAY), 0, 'domenica niente (3 gennaio)');
  M.setPaused(db, true);
  assert.equal(await sweep(NOW + 10), 0, 'in pausa');
  M.setPaused(db, false);

  assert.equal(await sweep(NOW + 10), 1);
  assert.deepEqual(sentTo(), ['a@x.it'], 'prima quella messa in coda per prima');
  assert.equal(await sweep(NOW + 10 + MIN), 0, 'pausa di 3 minuti');
  assert.equal(await sweep(NOW + 10 + 3 * MIN), 1);
  assert.deepEqual(sentTo(), ['a@x.it', 'b@x.it']);
  assert.equal(await sweep(NOW + 10 + 10 * MIN), 0, 'tetto di 2 al giorno raggiunto');
  assert.equal(M.sentOn(db, '2027-01-04'), 2);
  assert.equal(statusOf(db, rows[2].id).status, 'queued');
  assert.equal(await sweep(NOW + DAY + 10), 1, 'il giorno dopo ricomincia');
  assert.deepEqual(sentTo().at(-1), 'c@x.it');
  assert.ok(leads.every((l) => L.getLead(db, l.id).status === 'contacted'));

  // un'email programmata per più avanti non parte prima
  const later = mk(db, { company: 'Futura', email: 'f@x.it' });
  queue(app, later, { sendAfter: NOW + 3 * DAY });
  assert.equal(await sweep(NOW + 2 * DAY), 0);
  assert.equal(await sweep(NOW + 3 * DAY), 1);
});

test('al momento dell’invio si ricontrolla tutto: chi non vuole email, chi ha risposto o è diventato cliente non riceve ciò che era in coda', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  settings(db, { minGapMin: '1' });
  const optout = mk(db, { company: 'No', email: 'no@x.it' });
  const lost = mk(db, { company: 'Persa', email: 'persa@x.it' });
  const client = mk(db, { company: 'Cliente', email: 'cliente@x.it' });
  const ok = mk(db, { company: 'Va bene', email: 'ok@x.it' });
  const rows = [optout, lost, client, ok].map((l, i) => queue(app, l, { sendAfter: NOW + i }));
  // il divieto arriva «da fuori» (per esempio dal link), senza passare dalla coda
  db.prepare('UPDATE leads SET email_ok = 0 WHERE id = ?').run(optout.id);
  db.prepare("UPDATE leads SET status = 'lost' WHERE id = ?").run(lost.id);
  db.prepare("UPDATE leads SET status = 'client' WHERE id = ?").run(client.id);
  assert.equal(await app.leads.sweep(NOW + 100), 1, 'le prime tre vengono saltate subito, senza aspettare un altro giro');
  assert.deepEqual(app.mail.sent.map((m) => m.to), ['ok@x.it']);
  assert.deepEqual(rows.map((r) => statusOf(db, r.id).status), ['skipped', 'skipped', 'skipped', 'sent']);
  assert.equal(statusOf(db, rows[0].id).note, 'Non vuole più ricevere email');
  assert.equal(statusOf(db, rows[1].id).note, 'Il contatto è «Non interessata»');

  // il sollecito parte solo se nel frattempo è rimasta «fredda»
  const quiet = mk(db, { company: 'Silenziosa', email: 'silenzio@x.it' });
  const replied = mk(db, { company: 'Ha risposto', email: 'risposto@x.it' });
  for (const l of [quiet, replied]) await app.leads.write({ leadId: l.id, to: l.email, template: 'presentation', lang: 'it', subject: 'Ciao', body: 'Testo', mode: 'now', followupDays: 7 }, NOW);
  L.logActivity(db, replied.id, { kind: 'reply', title: 'Mi ha risposto', nowMs: NOW + DAY });
  const before = app.mail.sent.length;
  assert.equal(await app.leads.sweep(NOW + 6 * DAY), 0, 'non è ancora il momento');
  assert.equal(await app.leads.sweep(NOW + 7 * DAY), 1);
  assert.equal(await app.leads.sweep(NOW + 7 * DAY + 2 * MIN), 0, 'il secondo sollecito è stato saltato');
  assert.deepEqual(app.mail.sent.slice(before).map((m) => m.to), ['silenzio@x.it']);
  assert.match(app.mail.sent.at(-1).subject, /promemoria/i);
  const skipped = M.recentEmails(db).find((e) => e.lead_id === replied.id && e.template === 'followup');
  assert.deepEqual([skipped.status, skipped.note], ['skipped', 'Nel frattempo il contatto è passato a «In dialogo»']);
  assert.equal(M.queuedEmails(db).length, 0);
  // dopo il sollecito la guida ha una cosa da fare: telefonare o chiudere
  assert.match(L.getLead(db, quiet.id).next_action, /telefonare o chiudere/);
});

test('se la posta non risponde si riprova dopo mezz’ora, al massimo tre volte; un’email non parte mai due volte', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  settings(db, { minGapMin: '1' });
  const lead = mk(db);
  const row = queue(app, lead);
  const real = app.mail.send;
  let calls = 0;
  app.mail.send = async (...a) => { calls++; return calls < 3 ? false : real(...a); };
  assert.equal(await app.leads.sweep(NOW), 0);
  assert.deepEqual([statusOf(db, row.id).status, db.prepare('SELECT send_after FROM lead_emails WHERE id = ?').get(row.id).send_after], ['queued', new Date(NOW + 30 * MIN).toISOString()]);
  assert.equal(await app.leads.sweep(NOW + 10 * MIN), 0, 'non prima di mezz’ora');
  assert.equal(calls, 1);
  assert.equal(await app.leads.sweep(NOW + 30 * MIN), 0);
  assert.equal(await app.leads.sweep(NOW + 60 * MIN), 1, 'alla terza va');
  assert.equal(statusOf(db, row.id).status, 'sent');
  // spedita: nessun altro giro la rimanda
  assert.equal((await app.leads.deliver(row.id, { nowMs: NOW + 90 * MIN })).sent, false);
  assert.equal(calls, 3);

  const dead = mk(db, { company: 'Irraggiungibile', email: 'x@x.it' });
  const row2 = queue(app, dead);
  app.mail.send = async () => false;
  for (let i = 0; i < 6; i++) await app.leads.sweep(NOW + 2 * DAY + i * 31 * MIN);
  assert.deepEqual([statusOf(db, row2.id).status, /non è partita/.test(statusOf(db, row2.id).note)], ['failed', true]);
});

test('segnare un contatto come perso o cliente toglie dalla coda solo le email «a freddo»', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  const lead = mk(db);
  const cold = queue(app, lead);
  const thanks = queue(app, lead, { template: 'thanks' });
  const custom = queue(app, lead, { template: 'custom' });
  L.setStatus(db, lead.id, 'lost', { nowMs: NOW });
  assert.deepEqual([cold, thanks, custom].map((r) => statusOf(db, r.id).status), ['cancelled', 'queued', 'queued']);
  assert.equal(statusOf(db, cold.id).note, 'Segnata come non interessata');
});

test('invito al sito dal contatto: collegamento personale per email, stato «Invitata», e quando si registra diventa cliente', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  const lead = mk(db, { contact: { name: 'Anna Rossi', email: 'anna@lagoon.it', lang: 'en' } });
  const r = await app.leads.invite(lead.id, { note: 'Come ci siamo detti al telefono' }, NOW);
  assert.equal(r.sent, true);
  assert.match(r.url, /\/en\/b2b\/invite\/[\w-]{20,}$/, 'nella lingua del referente');
  const mail = app.mail.sent.at(-1);
  assert.deepEqual([mail.to, mail.text.includes(r.url), mail.text.includes('Come ci siamo detti al telefono')], ['anna@lagoon.it', true, true]);
  assert.equal(db.prepare('SELECT lead_id FROM partner_invites WHERE id = ?').get(r.invite.id).lead_id, lead.id);
  assert.equal(db.prepare('SELECT sent_at FROM partner_invites WHERE id = ?').get(r.invite.id).sent_at !== null, true);
  assert.equal(L.getLead(db, lead.id).status, 'invited');
  assert.ok(L.timeline(db, lead.id).some((a) => a.kind === 'invite' && a.title === 'Invito al sito mandato a anna@lagoon.it'));

  // si registra dal collegamento: il contatto si aggancia da solo e diventa cliente
  const acct = addAccount(db, { email: 'anna@lagoon.it', company: 'Lagoon Travel', status: 'approved' });
  db.prepare('UPDATE partner_invites SET used_at = ?, account_id = ? WHERE id = ?').run(new Date(NOW).toISOString(), acct.id, r.invite.id);
  assert.equal(L.syncAccounts(db, NOW), 1);
  assert.deepEqual([L.getLead(db, lead.id).status, L.getLead(db, lead.id).account_id], ['client', acct.id]);
  // ora ha un profilo: un altro invito non serve
  assert.deepEqual(await app.leads.invite(lead.id, {}, NOW), { error: 'exists' });

  // senza indirizzo, o se non vuole email, non si invita
  const none = mk(db, { company: 'Senza', email: '' });
  assert.deepEqual(await app.leads.invite(none.id, {}, NOW), { error: 'email' });
  const no = mk(db, { company: 'No', email: 'no@x.it' });
  L.optOut(db, no.id, { nowMs: NOW });
  assert.deepEqual(await app.leads.invite(no.id, {}, NOW), { error: 'blocked' });
  // l'email non parte: il collegamento si mostra comunque
  const down = mk(db, { company: 'Posta giù', email: 'giu@x.it' });
  app.mail.send = async () => false;
  const r2 = await app.leads.invite(down.id, {}, NOW);
  assert.deepEqual([r2.sent, typeof r2.url], [false, 'string']);
  assert.equal(L.getLead(db, down.id).status, 'invited');
});

test('profilo B2B creato subito: account approvato, password che non conosce nessuno, collegamento per sceglierla (7 giorni, una volta sola), contatto «Cliente»', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { db } = app;
  const lead = mk(db, { country: 'ES', website: 'lagoon.es', phone: '+34 91 123 4567', contact: { name: 'Carla Ruiz', email: 'carla@lagoon.es', phone: '+34 600 123 456' } });
  const r = await app.leads.createProfile(lead.id, {}, NOW);
  assert.equal(r.sent, true);
  const a = r.account;
  assert.deepEqual([a.email, a.company, a.contact_name, a.status, a.country, a.lang, a.website, a.phone, a.allow_invoice, a.discount_percent], ['carla@lagoon.es', 'Lagoon Travel', 'Carla Ruiz', 'approved', 'ES', 'es', 'https://lagoon.es', '+34 600123456', 1, 0]);
  assert.equal(a.approved_at, new Date(NOW).toISOString());
  assert.match(a.password_hash, /^scrypt\$/);
  const fresh = L.getLead(db, lead.id);
  assert.deepEqual([fresh.status, fresh.account_id], ['client', a.id]);
  assert.ok(L.timeline(db, lead.id).some((x) => x.kind === 'profile' && x.title === 'Profilo B2B creato dalla guida'));

  // il collegamento: nella lingua dell'agenzia, valido 7 giorni, legato alla password di adesso
  assert.match(r.url, /\/es\/b2b\/reset\//);
  const token = r.url.split('/').pop();
  const p = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()); // (senza controllare la scadenza con l'orologio vero: i test vivono nel 2027)
  assert.deepEqual([p.k, p.id, p.f, p.exp], ['pwreset', a.id, passwordFingerprint(a), NOW + 7 * DAY], 'valido sette giorni, legato alla password di adesso');
  const live = verifyToken(app.cfg.sessionSecret, app.leads.passwordLink(a, Date.now()).split('/').pop());
  assert.deepEqual([live.k, live.id], ['pwreset', a.id], 'firmato con il segreto del sito');
  const mail = app.mail.sent.at(-1);
  assert.deepEqual([mail.to, mail.subject, mail.text.includes(r.url), /7 días/.test(mail.text)], ['carla@lagoon.es', 'He creado tu cuenta en el área para agencias', true, true]);
  assert.deepEqual(await app.leads.createProfile(lead.id, {}, NOW), { error: 'exists' }, 'un profilo solo');

  // senza indirizzo non si può; con un indirizzo già registrato si aggancia
  assert.deepEqual(await app.leads.createProfile(mk(db, { company: 'Senza', email: '' }).id, {}, NOW), { error: 'email' });
  addAccount(db, { email: 'gia@x.it', company: 'Già registrata' });
  const dup = mk(db, { company: 'Già registrata', email: 'gia@x.it' });
  assert.deepEqual(await app.leads.createProfile(dup.id, {}, NOW), { error: 'exists' });
  assert.ok(L.getLead(db, dup.id).account_id, 'il contatto è stato agganciato al profilo che c’è già');
  // senza email di benvenuto: il collegamento si mostra e basta
  const quiet = await app.leads.createProfile(mk(db, { company: 'Discreta', email: 'd@x.it' }).id, { sendMail: false }, NOW);
  assert.deepEqual([quiet.sent, typeof quiet.url], [false, 'string']);
  assert.equal(app.mail.sent.filter((m) => m.to === 'd@x.it').length, 0);
});

// ───────────── da quale indirizzo partono ─────────────
test('mittente: di base come le conferme (con le risposte all’indirizzo delle notifiche); scelto un indirizzo tuo, le risposte tornano lì; la posta commerciale separata ha la precedenza giusta', (t) => {
  const app = makeApp({ site: { name: 'Davide Tomio' }, mail: { from: 'Davide Tomio <tours@example.it>', notifyTo: 'notifiche@posteo.example' } });
  t.after(app.cleanup);
  const { db } = app;
  assert.deepEqual(M.senderOf(app), { from: 'Davide Tomio <tours@example.it>', replyTo: 'notifiche@posteo.example', bcc: undefined, transport: 'main', own: false, label: 'Davide Tomio <tours@example.it>' });

  assert.deepEqual(M.saveSender(db, { fromEmail: ' INFO@Example.it ', fromName: 'Davide <Tomio>', replyTo: '', bcc: 'Copia@Posteo.example' }), { ok: true });
  const own = M.senderOf(app);
  assert.deepEqual(own.from, { name: 'Davide Tomio', address: 'info@example.it' }, 'il nome ripulito dai caratteri che romperebbero l’intestazione');
  assert.deepEqual([own.replyTo, own.bcc, own.own, own.transport, own.label], [undefined, 'copia@posteo.example', true, 'main', 'Davide Tomio <info@example.it>'], 'senza «rispondi a» si risponde al mittente');
  M.saveSender(db, { fromEmail: 'info@example.it', fromName: '', replyTo: 'ufficio@example.it', bcc: '' });
  assert.deepEqual([M.senderOf(app).from.name, M.senderOf(app).replyTo, M.senderOf(app).bcc], ['Davide Tomio', 'ufficio@example.it', undefined], 'senza nome si usa quello del sito');

  // tornare indietro: tutto vuoto = come le conferme
  M.saveSender(db, { fromEmail: '', fromName: '', replyTo: '', bcc: '' });
  assert.equal(M.senderOf(app).own, false);

  // posta commerciale tutta sua: il mittente di base è la sua casella, quello scelto nel pannello vince
  const sep = makeApp({ mail: { from: 'Davide <tours@example.it>', notifyTo: 'n@x.it', sales: { host: 'smtp.hosting.example', user: 'info@example.it', pass: 'x' } } });
  t.after(sep.cleanup);
  assert.deepEqual([M.senderOf(sep).from.address, M.senderOf(sep).transport, M.senderOf(sep).own, M.senderOf(sep).replyTo], ['info@example.it', 'sales', true, undefined]);
  M.saveSender(sep.db, { fromEmail: 'vendite@example.it' });
  assert.equal(M.senderOf(sep).from.address, 'vendite@example.it');
  // un utente che non è un indirizzo (alcuni servizi usano una chiave): serve il pannello, altrimenti si ripiega sul mittente di tutti
  const key = makeApp({ mail: { from: 'Davide <tours@example.it>', notifyTo: 'n@x.it', sales: { host: 'smtp.api.example', user: 'apikey', pass: 'x' } } });
  t.after(key.cleanup);
  assert.deepEqual([M.senderOf(key).from, M.senderOf(key).transport, M.senderOf(key).own, M.senderOf(key).replyTo], ['Davide <tours@example.it>', 'sales', false, 'n@x.it']);
});

test('mittente: indirizzi validi o vuoti, il nome solo con un indirizzo; salvare il mittente non tocca le altre impostazioni e viceversa', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  settings(db, { dailyCap: '9', signature: 'Firma mia' });
  M.setPaused(db, true);
  for (const [k, v] of [['fromEmail', 'senza-chiocciola'], ['replyTo', 'a@b'], ['bcc', 'due@@x.it']]) assert.match(M.saveSender(db, { [k]: v }).error, /indirizzo email valido/, k);
  assert.match(M.saveSender(db, { fromName: 'Davide' }).error, /Il nome mostrato serve solo insieme all’indirizzo/);
  assert.equal(M.sendSettings(db).fromEmail, '', 'un salvataggio rifiutato non cambia nulla');
  assert.deepEqual(M.saveSender(db, { fromEmail: 'info@example.it', fromName: '  Davide   Tomio ' }), { ok: true });
  const s = M.sendSettings(db);
  assert.deepEqual([s.fromName, s.dailyCap, s.signature, s.paused], ['Davide Tomio', 9, 'Firma mia', true], 'le altre impostazioni e la pausa restano');
  settings(db, { dailyCap: '12' });
  assert.deepEqual([M.sendSettings(db).fromEmail, M.sendSettings(db).dailyCap, M.sendSettings(db).paused], ['info@example.it', 12, true], 'salvare orari e tetto non cancella il mittente');
  // dati rovinati nel database: stringhe vuote, non errori
  db.prepare("UPDATE settings SET value = '{\"fromEmail\": 5, \"bcc\": null}' WHERE key = 'lead_send'").run();
  assert.deepEqual([M.sendSettings(db).fromEmail, M.sendSettings(db).bcc], ['', '']);
});

test('l’invio parte dal mittente scelto, con le risposte dove vuoi e la copia nascosta (mai a chi è già il destinatario); un errore del server di posta finisce nella nota', async (t) => {
  const app = makeApp({ mail: { from: 'Davide <tours@example.it>', notifyTo: 'notifiche@posteo.example', sales: { host: 'smtp.hosting.example', user: 'info@example.it', pass: 'x' } } });
  t.after(app.cleanup);
  const { db } = app;
  // (il mailer di prova non apre connessioni: si guarda cosa gli viene chiesto)
  const calls = [];
  const real = app.mail.send;
  app.mail.send = async (msg) => { calls.push(msg); return real({ ...msg, transport: undefined }); };
  M.saveSender(db, { fromEmail: 'info@example.it', fromName: 'Davide Tomio', replyTo: 'risposte@example.it', bcc: 'copia@posteo.example' });
  const lead = mk(db, { contact: { name: 'Anna', email: 'anna@lagoon.it' } });
  const send = (over = {}) => app.leads.write({ leadId: lead.id, contactId: L.mainContact(db, lead.id).id, to: 'anna@lagoon.it', template: 'custom', lang: 'it', subject: 'Ciao', body: 'Testo', mode: 'now', ...over }, NOW);
  assert.equal((await send()).sent, true);
  const m = calls.at(-1);
  assert.deepEqual([m.from, m.replyTo, m.bcc, m.transport], [{ name: 'Davide Tomio', address: 'info@example.it' }, 'risposte@example.it', 'copia@posteo.example', 'sales']);
  assert.ok(m.headers['List-Unsubscribe'], 'il resto non cambia');
  // la copia nascosta a chi è già il destinatario non si manda due volte
  M.saveSender(db, { fromEmail: 'info@example.it', bcc: 'ANNA@lagoon.it' });
  await send({ template: 'thanks', subject: 'Altro' });
  assert.equal(calls.at(-1).bcc, undefined);

  // un invio rifiutato dal server: la nota dice perché, e il contatto non cambia
  const other = mk(db, { company: 'Altra', email: 'altra@x.it' });
  app.mail.send = async () => { app.mail.lastError = '553 5.7.1 Sender address rejected: not owned by user'; return false; };
  const bad = await app.leads.write({ leadId: other.id, to: 'altra@x.it', template: 'custom', lang: 'it', subject: 'Ciao', body: 'Testo', mode: 'now' }, NOW);
  assert.deepEqual([bad.sent, bad.row.status], [false, 'failed']);
  assert.match(bad.row.note, /^L’email non è partita: controlla la posta in Aiuto › Email e il mittente in Commerciale › Email\. Il server di posta dice: 553 5\.7\.1 Sender address rejected/);
  assert.equal(L.getLead(db, other.id).status, 'new');
});

test('anteprima e prova di invio: dal mittente scelto, senza copia nascosta; la prova dice se il server di posta lo accetta', async (t) => {
  const app = makeApp({ mail: { from: 'Davide <tours@example.it>', notifyTo: 'notifiche@posteo.example' } });
  t.after(app.cleanup);
  const { db } = app;
  const lead = mk(db);
  // senza un mittente tuo: come prima, le risposte all'indirizzo delle notifiche
  assert.equal(await app.leads.preview({ lead, lang: 'it', subject: 'Ciao', body: 'Testo' }), true);
  let m = app.mail.sent.at(-1);
  assert.deepEqual([m.to, m.from, m.replyTo, m.subject], ['notifiche@posteo.example', 'Davide <tours@example.it>', 'notifiche@posteo.example', '[Anteprima] Ciao']);
  assert.deepEqual(await app.leads.testSender('me@posteo.example'), { ok: true, from: 'Davide <tours@example.it>' });
  assert.match(app.mail.sent.at(-1).text, /partono da Davide <tours@example\.it>/);

  M.saveSender(db, { fromEmail: 'info@example.it', bcc: 'copia@posteo.example' });
  await app.leads.preview({ lead, lang: 'it', subject: 'Ciao', body: 'Testo' });
  m = app.mail.sent.at(-1);
  assert.deepEqual([m.from, m.replyTo, m.bcc], [{ name: app.cfg.site.name, address: 'info@example.it' }, 'notifiche@posteo.example', undefined], 'l’anteprima è già per te: niente copia nascosta');
  const t2 = await app.leads.testSender('me@posteo.example');
  assert.equal(t2.ok, true);
  assert.match(app.mail.sent.at(-1).text, /torna a /, 'senza «rispondi a» la risposta torna al mittente');

  app.mail.send = async () => { app.mail.lastError = '535 5.7.8 Authentication failed'; return false; };
  assert.deepEqual(await app.leads.testSender('me@posteo.example'), { ok: false, from: `${app.cfg.site.name} <info@example.it>`, error: '535 5.7.8 Authentication failed' });
  app.mail.send = async () => { app.mail.lastError = ''; return false; }; // rifiuta senza dire perché
  assert.match((await app.leads.testSender('me@posteo.example')).error, /non ha accettato/);
});

test('coda: l’orario stimato segue la pausa, il tetto del giorno, la finestra e i giorni lavorativi; in pausa non c’è stima', async (t) => {
  const app = await makeApp();
  t.after(app.cleanup);
  const { db } = app;
  settings(db, { dailyCap: 3, minGapMin: 10 });
  const leads = ['uno', 'due', 'tre', 'quattro', 'cinque'].map((n) => mk(db, { company: `Agenzia ${n}`, email: `info@${n}.it` }));
  for (const l of leads) queue(app, l);
  const rome = (ms) => (ms == null ? null : new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 16));
  const est = M.estimateSendTimes(db, M.queuedEmails(db), NOW); // lunedì 4 gennaio 2027, 10:00
  assert.deepEqual(est.map(rome), ['2027-01-04 10:00', '2027-01-04 10:10', '2027-01-04 10:20', '2027-01-05 09:00', '2027-01-05 09:10'], 'una ogni 10 minuti; finito il tetto di 3, riparte il giorno dopo');
  // il venerdì sera la coda riparte lunedì mattina
  const fri = M.estimateSendTimes(db, M.queuedEmails(db).slice(0, 1), NOW + 4 * DAY + 7 * 60 * MIN); // venerdì 8 gennaio, 17:00
  assert.equal(rome(fri[0]), '2027-01-11 09:00');
  // una pausa dall'ultimo invio già avvenuto sposta la prima
  db.prepare("UPDATE lead_emails SET status = 'sent', sent_at = ? WHERE id = (SELECT MIN(id) FROM lead_emails)").run(new Date(NOW - 3 * MIN).toISOString());
  const after = M.estimateSendTimes(db, M.queuedEmails(db), NOW);
  assert.equal(rome(after[0]), '2027-01-04 10:07', '10 minuti dopo l’ultimo invio delle 9:57');
  M.setPaused(db, true);
  assert.deepEqual(M.estimateSendTimes(db, M.queuedEmails(db), NOW), [null, null, null, null]);
});
