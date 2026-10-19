// La guida d'uso: si vede nel pannello, i collegamenti dell'indice funzionano e i nomi dei pulsanti citati esistono davvero.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { guideAnchors, readGuide, renderGuide, slugify } from '../server/guide.js';
import { openDb } from '../server/db.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-guide-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('guida: identificativi dei titoli come su GitHub (lettere accentate, punteggiatura e frecce tolte)', () => {
  assert.equal(slugify('3. Voglio… → vado in…'), '3-voglio-vado-in');
  assert.equal(slugify('12. Prenotazioni, annulli e programmi di più giorni'), '12-prenotazioni-annulli-e-programmi-di-più-giorni');
  assert.equal(slugify('14. Partner (agenzie, DMC, tour operator)'), '14-partner-agenzie-dmc-tour-operator');
});

test('guida: ogni collegamento interno punta a un titolo che esiste', () => {
  const { ids, links } = guideAnchors();
  assert.ok(links.length >= 20, 'l’indice c’è');
  assert.deepEqual(links.filter((l) => !ids.includes(l)), [], 'collegamenti rotti');
  assert.equal(new Set(ids).size, ids.length, 'identificativi duplicati');
  const html = renderGuide();
  for (const id of guideAnchors(readGuide().replace(/^# .*\r?\n/, '')).ids) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!/^<h1/m.test(html), 'il titolo principale lo mostra già il pannello');
  assert.equal((html.match(/<table/g) ?? []).length, (html.match(/class="table-wrap"><table/g) ?? []).length, 'tabelle scorrevoli');
});

test('guida: i nomi di pulsanti e schede citati nella guida esistono nel pannello', () => {
  const guide = readGuide();
  const sources = ['server/views', 'server/routes', 'server/settings.js', 'public/js'].flatMap((d) => {
    const dir = path.join(ROOT, d);
    return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')) : [fs.readFileSync(dir, 'utf8')];
  }).join('\n');
  const LABELS = [
    'Nuovo tour B2C', 'Nuovo tour B2B', 'Duplica come tour', 'Duplica', 'Crea il tour', 'Salva le modifiche', 'Salva i prezzi', 'Nuovo articolo', 'Crea l’articolo', 'Elimina l’articolo', 'Carica una foto', 'Usa qui', 'Togli la foto', 'Immagini del sito',
    'Salva questa sezione', 'Ripristina i valori predefiniti', 'Scarica la copia completa (.zip)', 'Emetti la fattura', 'Correggi e riemetti', 'Prepara la fattura con le voci scelte', 'Nuova fattura a mano', 'Registro CSV',
    'Segna come incassata', 'Annulla e avvisa il cliente', 'Annulla prenotazione', 'Invia ora', 'Non inviare', 'Voucher PDF', 'Crea e prepara la proposta', 'Salva e invia al cliente', 'Salva bozza', 'Il cliente ha accettato',
    'Segna come rifiutata', 'Riapri come bozza', 'Sincronizza ora', 'Collega un calendario', 'Disattiva', 'Scollega', 'Orario speciale per un giorno', 'Prossime eccezioni', 'Calendari collegati', 'Impegni esterni',
    'Listino dedicato', 'Politica di annullo', 'Stato e pagamento', 'Salva il listino', 'Salva la politica', 'Nuovo codice sconto', 'Nuovo buono regalo', 'Rettifica il saldo', 'Reinvia all’acquirente', 'Annulla buono',
    'Esporta CSV', 'Come sono calcolati i numeri', 'Salva i testi di questa pagina', 'Carica nuove foto', 'Salva la pagina', 'Prenotazioni aperte fino a', 'Prima data fatturabile', 'Calendario sul telefono', 'Pagamenti in corso',
    'Programmi da preparare', 'Partner da approvare', 'Promemoria al cliente', 'Domande frequenti', 'Mostra sul sito', 'Pagina con tutte le recensioni', 'Cosa dicono i clienti', 'Ripristina da una copia', 'Carica e controlla', 'Solo i contenuti', 'Torna a questa versione', 'Copie salvate prima di un ripristino', 'Annulla, non cambiare niente', 'Elenco, 14 giorni', 'Calendario', 'Elimina la bozza', 'Apri come la vede il cliente', 'PDF della proposta', 'Nascondi', 'Foto', 'Grassetto', 'Anteprima',
    'Aggiungi il periodo', 'Copia giornaliera fuori dal server', 'Prova la connessione', 'Esegui una copia adesso', 'Copie presenti', 'Attiva i due passaggi', 'Conferma e attiva', 'Esci da tutti gli altri dispositivi', 'Genera nuovi codici', 'Incassi dalla banca', 'Controlla i bonifici', 'Segna come incassate le fatture selezionate',
    'Invia l’invito', 'Verifica ora', 'Rinvia', 'Verifica P.IVA', 'Inviti', 'Togli l’accesso',
    'Salva le tariffe', 'Prova il calcolatore', 'Ripristina le tariffe iniziali', 'Quali giorni sono festivi', 'Chi vede le tariffe', 'Ogni ora in più', 'Il cliente sceglie quante ore', 'A chi è rivolto', 'Prezzo fisso',
  ];
  const missing = LABELS.filter((l) => !sources.includes(l) && !sources.replace(/ /g, ' ').includes(l));
  assert.deepEqual(missing, [], 'etichette non trovate nel codice: la guida o il pannello sono cambiati');
  // le voci del menu citate nella guida sono quelle del pannello
  for (const [group, tabs] of [['Agenda', ['Agenda', 'Prenotazioni', 'Programmi', 'Disponibilità']], ['Clienti', ['Partner', 'Sconti', 'Feedback']], ['Conti', ['Fatture', 'Statistiche']], ['Sito', ['Tour B2C', 'Tour B2B', 'Listino', 'Tariffe a ore', 'Blog', 'Pagine', 'Testi', 'Immagini', 'Periodi', 'Impostazioni']], ['Aiuto', ['Guida', 'Backup', 'Sicurezza', 'Email']]]) {
    assert.match(guide, new RegExp(`\\*\\*${group}\\*\\*`), group);
    for (const t of tabs) assert.ok(guide.includes(t), `${group} › ${t}`);
    assert.ok(sources.includes(`'${group}'`), `gruppo «${group}» nel menu`);
    for (const t of tabs) assert.ok(sources.includes(`'${t}'`), `scheda «${t}» nel menu`);
  }
});

test('guida: nel pannello, solo per l’admin', async () => {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp, adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  try {
    const anon = await fetch(`${base}/admin/guide`, { redirect: 'manual' });
    assert.equal(anon.headers.get('location'), '/admin/login');
    const login = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const res = await fetch(`${base}/admin/guide`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Guida all’uso del sito · Admin<\/title>/);
    assert.match(html, /id="13-fatture"/);
    assert.match(html, /Come funziona, in cinque righe/);
    assert.match(html, /aria-current="page">Guida<\/a>/, 'scheda attiva nel menu');
    assert.equal((html.match(/<h1/g) ?? []).length, 1);
    assert.ok(!html.includes('undefined') && !html.includes('[object'));
  } finally {
    app.close();
    http.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});
