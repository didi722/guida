// Impostazioni dal pannello: contatti, regole, buoni/recensioni e dati fiscali sovrascrivono la configurazione del server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { setTextOverrides } from '../server/i18n.js';
import { configProblems } from '../server/invoices.js';
import { createSettings } from '../server/settings.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-settings-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const cfgFor = (over = {}) => createConfig({ __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, ...over });

async function start(over = {}) {
  const cfg = cfgFor(over);
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
  await admin('/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
  return { app, cfg, jar, admin, close: () => { app.close(); http.close(); setTextOverrides(new Map()); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');

const BUSINESS = { 'site.name': 'Davide Tomio', 'site.legalName': 'Davide Tomio', 'site.email': 'info@davidetomio.it', 'mail.notifyTo': 'vecchia@example.com', 'site.phone': '+39 333 123 4567', 'site.whatsapp': '393331234567', 'site.instagram': 'https://instagram.com/davide.tomio', 'site.vatNumber': 'IT12345678903', 'site.guideLicense': 'n. 4321', 'site.address': 'Calle del Test 1, 30100 Venezia' };
const INVOICE = {
  'invoice.seller.name': '', 'invoice.seller.firstName': 'Mario', 'invoice.seller.lastName': 'Rossi', 'invoice.seller.fiscalCode': 'rssmra80a01h501u', 'invoice.seller.regime': 'RF19',
  'invoice.seller.address.street': 'Calle del Test 1', 'invoice.seller.address.zip': '30100', 'invoice.seller.address.city': 'Venezia', 'invoice.seller.address.province': 've',
  'invoice.vatBp': '0', 'invoice.nature': 'N2.2', 'invoice.bollo': 'auto', 'invoice.contributionPercent': '0', 'invoice.withholdingPercent': '0', 'invoice.withholdingCause': 'A',
  'invoice.notes': 'Operazione in regime forfettario.', 'invoice.legalReference': 'Regime forfettario', 'invoice.iban': 'IT60 X054 2811 1010 0000 0123 456', 'invoice.bank': 'Banca di Prova', 'invoice.b2bDueDays': '30', 'reminders.overdue.enabled': '1', 'reminders.overdue.firstAfterDays': '1', 'reminders.overdue.everyDays': '7', 'reminders.overdue.max': '3', 'invoice.giftInvoiceAt': 'sale', 'invoice.startDate': '2027-01-01',
};

test('contatti e regole: si cambiano dal pannello, valgono subito, restano dopo il riavvio e si ripristinano', async () => {
  const s = await start({ site: { email: 'vecchia@example.com', whatsapp: '' }, mail: { notifyTo: 'vecchia@example.com' } });
  try {
    const anon = s.jar();
    const page = await s.admin('/admin/settings');
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const t of ['Attività e contatti', 'Regole di prenotazione', 'Buoni regalo, programmi e recensioni', 'Fatturazione elettronica']) assert.match(html, new RegExp(t));
    assert.match(html, /name="policy.b2cFreeCancelHours" value="48"/);
    assert.equal(loc(await anon('/admin/settings')), '/admin/login', 'serve il login');
    assert.equal(loc(await anon('/admin/settings/business', form(BUSINESS))), '/admin/login');

    // contatti: sito, email e WhatsApp cambiano subito
    assert.doesNotMatch(await (await anon('/it/contact')).text(), /wa\.me/);
    assert.equal(loc(await s.admin('/admin/settings/business', form(BUSINESS))), '/admin/settings?ok=saved&s=business#business');
    assert.equal(s.cfg.site.email, 'info@davidetomio.it');
    assert.equal(s.cfg.site.vatNumber, 'IT12345678903');
    const contact = await (await anon('/it/contact')).text();
    assert.match(contact, /href="https:\/\/wa\.me\/393331234567"/);
    assert.match(contact, /info@davidetomio\.it/);
    assert.match(await (await anon('/it/')).text(), /P\.IVA IT12345678903/);
    // le notifiche seguono l'email di contatto finché non se ne sceglie un'altra
    assert.equal(s.cfg.mail.notifyTo, 'info@davidetomio.it');
    assert.match(await (await s.admin('/admin/settings?s=business')).text(), /Predefinito: vecchia@example\.com/);

    // regole di prenotazione
    const rules = { 'policy.b2cFreeCancelHours': '24', 'policy.b2bFreeCancelHours': '72', 'policy.b2cMinNoticeHours': '12', 'policy.b2bMinNoticeHours': '6', 'policy.maxAdvanceDays': '200', 'policy.bufferMin': '45', 'policy.slotStepMin': '30', 'policy.holdMinutes': '35', 'reminders.enabled': '1', 'reminders.sendHour': '18', 'reminders.briefing.enabled': '1', 'reminders.briefing.hour': '18', 'statements.enabled': '1', 'statements.day': '5', 'policy.allowPayOnSite': '1' };
    assert.equal(loc(await s.admin('/admin/settings/rules', form(rules))), '/admin/settings?ok=saved&s=rules#rules');
    assert.deepEqual(s.cfg.statements, { enabled: true, day: 5 }, 'estratto conto mensile alle agenzie');
    assert.deepEqual([s.cfg.policy.b2cFreeCancelHours, s.cfg.policy.b2cMinNoticeHours, s.cfg.policy.maxAdvanceDays, s.cfg.policy.bufferMin, s.cfg.policy.allowPayOnSite], [24, 12, 200, 45, true]);
    // la casella non spuntata vale «no»
    await s.admin('/admin/settings/rules', form({ ...rules, 'policy.allowPayOnSite': '' }));
    assert.equal(s.cfg.policy.allowPayOnSite, false);
    // i campi non toccati restano quelli del server: nessun valore «bloccato» senza motivo
    const stored = JSON.parse(s.app.db.prepare("SELECT value FROM settings WHERE key = 'config_overrides'").get().value);
    assert.deepEqual(Object.keys(stored).filter((k) => k.startsWith('policy.')).sort(), ['policy.b2cFreeCancelHours', 'policy.b2cMinNoticeHours', 'policy.bufferMin', 'policy.maxAdvanceDays', 'policy.b2bMinNoticeHours'].sort());

    // riavvio: stessa base di dati, configurazione nuova
    const fresh = cfgFor({ site: { email: 'vecchia@example.com' } });
    assert.equal(fresh.site.email, 'vecchia@example.com');
    createSettings({ cfg: fresh, db: s.app.db });
    assert.equal(fresh.site.email, 'info@davidetomio.it');
    assert.equal(fresh.policy.b2cFreeCancelHours, 24);
    assert.equal(fresh.mail.notifyTo, 'info@davidetomio.it');

    // ripristino di una sezione
    assert.equal(loc(await s.admin('/admin/settings/business/reset', form({}))), '/admin/settings?ok=reset&s=business#business');
    assert.equal(s.cfg.site.email, 'vecchia@example.com');
    assert.equal(s.cfg.site.whatsapp, '');
    assert.equal(s.cfg.policy.b2cFreeCancelHours, 24, 'le altre sezioni non cambiano');
    assert.equal(loc(await s.admin('/admin/settings/inesistente', form({}))), '/admin/settings');
  } finally {
    s.close();
  }
});

test('impostazioni: validazioni (nulla viene salvato se un campo è sbagliato) e testi sempre protetti', async () => {
  const s = await start();
  try {
    const before = JSON.stringify(s.cfg.site);
    const bad = await s.admin('/admin/settings/business', form({ ...BUSINESS, 'site.email': 'non-una-email', 'site.whatsapp': '+39 abc', 'site.instagram': 'javascript:alert(1)', 'site.vatNumber': 'IT12345678900', 'site.name': '' }));
    assert.equal(bad.status, 400);
    const html = await bad.text();
    assert.match(html, /Indirizzo email non valido/);
    assert.match(html, /Solo cifre, con il prefisso/);
    assert.match(html, /deve iniziare con https/);
    assert.match(html, /Partita IVA non valida/);
    assert.match(html, /Campo obbligatorio/);
    assert.match(html, /non è stato salvato nulla/);
    assert.match(html, /name="site.email" value="non-una-email"/, 'si ritrova quello che si era scritto');
    assert.equal(JSON.stringify(s.cfg.site), before, 'configurazione intatta');
    assert.equal(s.app.db.prepare("SELECT value FROM settings WHERE key = 'config_overrides'").get(), undefined);

    // numeri fuori scala, importi, coerenza fra minimo e massimo dei buoni
    const rules = await s.admin('/admin/settings/rules', form({ 'policy.b2cFreeCancelHours': '-1', 'policy.b2bFreeCancelHours': '72', 'policy.b2cMinNoticeHours': 'tanti', 'policy.b2bMinNoticeHours': '12', 'policy.maxAdvanceDays': '0', 'policy.bufferMin': '30', 'policy.slotStepMin': '30', 'policy.holdMinutes': '35' }));
    assert.equal(rules.status, 400);
    assert.match(await rules.text(), /numero intero tra 0 e 2000/);
    const extras = { 'gift.validityMonths': '12', 'gift.minCents': '50', 'gift.maxCents': '30', 'program.depositPercent': '30', 'program.validityDays': '7', 'reviews.enabled': '1', 'reviews.googleUrl': '', 'reviews.tripadvisorUrl': '', 'reviews.sendHour': '10' };
    const badGift = await s.admin('/admin/settings/extras', form(extras));
    assert.equal(badGift.status, 400);
    assert.match(await badGift.text(), /Il massimo deve essere almeno pari al minimo/);
    assert.equal(loc(await s.admin('/admin/settings/extras', form({ ...extras, 'gift.maxCents': '300', 'gift.minCents': '10,50' }))), '/admin/settings?ok=saved&s=extras#extras');
    assert.deepEqual([s.cfg.gift.minCents, s.cfg.gift.maxCents, s.cfg.gift.validityMonths], [1050, 30000, 12], 'euro nel modulo, centesimi nella configurazione');
    assert.match(await (await s.admin('/admin/settings?s=extras')).text(), /name="gift.minCents" value="10,5"/);

    // valori «strani» nel database vengono ignorati senza rompere l'avvio
    s.app.db.prepare("INSERT INTO settings(key, value) VALUES('config_overrides', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ 'site.name': 42, 'policy.bufferMin': 'x', 'sconosciuta.chiave': 1, 'site.phone': '+39 041 000000' }));
    const fresh = cfgFor();
    createSettings({ cfg: fresh, db: s.app.db });
    assert.equal(fresh.site.name, 'Davide Tomio');
    assert.equal(fresh.policy.bufferMin, 30);
    assert.equal(fresh.site.phone, '+39 041 000000');
    assert.equal(fresh.sconosciuta, undefined);
  } finally {
    s.close();
  }
});

test('impostazioni fiscali: dal pannello si completano i dati per fatturare', async () => {
  const s = await start();
  try {
    assert.ok(configProblems(s.cfg).length >= 4, 'senza dati fiscali non si può emettere');
    const settings = await (await s.admin('/admin/invoices?tab=settings')).text();
    assert.match(settings, /href="\/admin\/settings#invoice"/);
    assert.match(settings, /Completa i dati fiscali/);
    assert.doesNotMatch(settings, /VAT_NUMBER|INVOICE_REGIME|FISCAL_CODE/, 'niente nomi di variabili d’ambiente');

    // codice fiscale, IBAN, provincia e data non validi
    const bad = await s.admin('/admin/settings/invoice', form({ ...INVOICE, 'invoice.seller.fiscalCode': 'XYZ', 'invoice.iban': 'IT00', 'invoice.seller.address.province': 'Venezia', 'invoice.startDate': '2027-13-45', 'invoice.nature': 'N9' }));
    assert.equal(bad.status, 400);
    const badHtml = await bad.text();
    for (const m of [/Codice fiscale non valido/, /IBAN non valido/, /provincia è di 2 lettere/, /Data non valida/, /Natura non valida/]) assert.match(badHtml, m);

    // la Partita IVA sta nei dati dell'attività; il resto qui
    assert.equal(loc(await s.admin('/admin/settings/business', form(BUSINESS))), '/admin/settings?ok=saved&s=business#business');
    assert.equal(loc(await s.admin('/admin/settings/invoice', form(INVOICE))), '/admin/settings?ok=saved&s=invoice#invoice');
    assert.equal(s.cfg.invoice.seller.fiscalCode, 'RSSMRA80A01H501U', 'maiuscole');
    assert.equal(s.cfg.invoice.seller.address.province, 'VE');
    assert.equal(s.cfg.invoice.iban, 'IT60X0542811101000000123456', 'senza spazi');
    assert.equal(s.cfg.invoice.startDate, '2027-01-01');
    assert.deepEqual(configProblems(s.cfg), [], 'ora i dati bastano per emettere');
    assert.doesNotMatch(await (await s.admin('/admin/settings')).text(), /Per poter emettere fatture mancano/);

    // IVA ordinaria: percentuale in punti base, natura vuota
    assert.equal(loc(await s.admin('/admin/settings/invoice', form({ ...INVOICE, 'invoice.seller.regime': 'RF01', 'invoice.vatBp': '22', 'invoice.nature': '', 'invoice.vatIncluded.b2c': '1' }))), '/admin/settings?ok=saved&s=invoice#invoice');
    assert.deepEqual([s.cfg.invoice.vatBp, s.cfg.invoice.nature, s.cfg.invoice.vatIncluded.b2c, s.cfg.invoice.vatIncluded.b2b], [2200, '', true, false]);
    assert.deepEqual(configProblems(s.cfg), []);
    assert.match(await (await s.admin('/admin/settings?s=invoice')).text(), /name="invoice.vatBp" value="22"/);
    // forfettario con IVA: il sito lo segnala
    await s.admin('/admin/settings/invoice', form({ ...INVOICE, 'invoice.vatBp': '22', 'invoice.nature': '' }));
    assert.match(configProblems(s.cfg).join(' '), /forfettario.*non prevede IVA/);
    // ripristino: tornano i valori della configurazione
    assert.equal(loc(await s.admin('/admin/settings/invoice/reset', form({}))), '/admin/settings?ok=reset&s=invoice#invoice');
    assert.equal(s.cfg.invoice.seller.fiscalCode, '');
  } finally {
    s.close();
  }
});

test('impostazioni: le notifiche seguono l’email di contatto solo se andavano già a quella', () => {
  const dir = tmp + '-unit-' + crypto.randomBytes(2).toString('hex');
  const db = openDb(':memory:');
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, site: { email: 'a@example.com' }, mail: { notifyTo: 'a@example.com' } });
  try {
    const st = createSettings({ cfg, db });
    const biz = (email, notify) => st.save('business', { 'site.name': 'X', 'site.email': email, 'mail.notifyTo': notify });
    // si cambia solo il contatto: le notifiche (che andavano allo stesso indirizzo) seguono
    assert.ok(biz('b@example.com', 'a@example.com').ok);
    assert.equal(cfg.mail.notifyTo, 'b@example.com');
    // si sceglie un indirizzo diverso per le notifiche: resta quello anche se cambia il contatto
    assert.ok(biz('b@example.com', 'segreteria@example.com').ok);
    assert.ok(biz('c@example.com', 'segreteria@example.com').ok);
    assert.equal(cfg.mail.notifyTo, 'segreteria@example.com');
    // svuotato: nessuna notifica (come con la configurazione del server senza indirizzo)
    assert.ok(biz('c@example.com', '').ok);
    assert.equal(cfg.mail.notifyTo, '');
    assert.ok(biz('d@example.com', '').ok);
    assert.equal(cfg.mail.notifyTo, '', 'vuoto non è «collegato»: nessuna notifica improvvisa');
    // un valore uguale a quello del server non si memorizza
    assert.ok(biz('a@example.com', 'a@example.com').ok);
    const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'config_overrides'").get().value);
    assert.equal(stored['site.email'], undefined);
    assert.equal(stored['mail.notifyTo'], undefined);
    assert.equal(stored['site.name'], 'X');
    assert.equal(cfg.mail.notifyTo, 'a@example.com');
    assert.equal(st.describe().find((x) => x.id === 'business').changed, true);
    assert.equal(st.save('nessuna', {}).ok, false);
    // un server che manda le notifiche a un indirizzo diverso dal contatto non viene toccato
    const cfg2 = createConfig({ __skipDotEnv: true, dataDir: dir, site: { email: 'a@example.com' }, mail: { notifyTo: 'altra@example.com' } });
    const st2 = createSettings({ cfg: cfg2, db: openDb(':memory:') });
    assert.ok(st2.save('business', { 'site.name': 'X', 'site.email': 'z@example.com', 'mail.notifyTo': 'altra@example.com' }).ok);
    assert.equal(cfg2.mail.notifyTo, 'altra@example.com');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
