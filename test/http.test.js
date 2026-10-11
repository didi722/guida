import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { loadContent } from '../server/content.js';
import { openDb } from '../server/db.js';
import { createPayments } from '../server/payments.js';
import { addDays, localToInstant, nowRome } from '../server/time.js';

process.env.GUIDA_QUIET = '1';

const tmp = path.join(ROOT, 'data', 'test-http-' + crypto.randomBytes(3).toString('hex'));
const content = loadContent(ROOT);
const day = (n) => addDays(nowRome().date, n);

async function start({ fakeStripe = false, noOnSite = false, fetchImpl: calFetch } = {}) {
  const cfg = createConfig({
    __skipDotEnv: true,
    dataDir: tmp,
    adminPassword: 'segreto-admin',
    baseUrl: 'http://localhost',
    mail: { notifyTo: 'guida@example.com' },
    policy: { allowPayOnSite: !noOnSite },
    ...(fakeStripe ? { stripe: { secretKey: 'sk_test_x', webhookSecret: 'whsec_test' }, demoPayments: false } : { demoPayments: true }),
  });
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const body = new URLSearchParams(init.body ?? '');
    if (url.endsWith('/checkout/sessions')) return new Response(JSON.stringify({ id: 'cs_test_' + body.get('client_reference_id'), url: 'https://checkout.stripe.com/c/pay/' + body.get('client_reference_id') }), { status: 200 });
    if (url.endsWith('/refunds')) return new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), content, payments: createPayments(cfg, fakeFetch), fetchImpl: calFetch });
  const http = await new Promise((resolve) => {
    const s = server.listen(0, () => resolve(s));
  });
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
  return { app, base, calls, jar, close: () => { app.close(); http.close(); } };
}

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });
const loc = (res) => res.headers.get('location');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('pagine pubbliche, SEO e intestazioni di sicurezza', async () => {
  const s = await start();
  try {
    const f = s.jar();
    for (const lang of ['it', 'en']) {
      for (const p of ['/', '/tours', '/book', '/gift', '/b2b', '/b2b/login', '/b2b/register', '/blog', '/about', '/contact', '/privacy', '/terms', '/cookies', ...content.tours.map((t) => `/tours/${t.slug}`), ...content.postsFor(lang).map((x) => `/blog/${x.slug}`)]) {
        const res = await f(`/${lang}${p}`);
        assert.equal(res.status, 200, `/${lang}${p}`);
        const html = await res.text();
        assert.ok(html.includes(`<html lang="${lang}">`), `/${lang}${p} lang`);
        assert.ok(!html.includes('undefined') && !html.includes('[object'), `/${lang}${p} contiene un valore non renderizzato`);
      }
    }
    assert.equal((await f('/it/nope')).status, 404);
    assert.equal((await f('/it/tours/non-esiste')).status, 404);
    assert.equal(loc(await f('/', { headers: { 'accept-language': 'it-IT,it;q=0.9' } })), '/it/');
    assert.equal(loc(await f('/', { headers: { 'accept-language': 'de-DE,en;q=0.8' } })), '/en/');
    const home = await f('/it/');
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    const sm = await (await f('/sitemap.xml')).text();
    assert.match(sm, /hreflang="en"/);
    assert.match(await (await f('/robots.txt')).text(), /Disallow: \/admin/);
    assert.equal((await f('/admin/calendar.ics?k=sbagliato')).status, 404);
  } finally {
    s.close();
  }
});

test('API disponibilità', async () => {
  const s = await start();
  try {
    const f = s.jar();
    const month = day(20).slice(0, 7);
    const av = await (await f(`/api/availability?tour=san-marco-rialto&month=${month}&pax=2`)).json();
    assert.ok(Object.keys(av.days).length > 5);
    const date = day(20);
    const sl = await (await f(`/api/slots?tour=san-marco-rialto&date=${date}&pax=3`)).json();
    assert.deepEqual(sl.slots.map((x) => x.time), ['09:30', '14:30']);
    assert.equal(sl.slots[0].totalCents, 10500);
    assert.equal((await f('/api/slots?tour=san-marco-rialto&date=2027-13-45&pax=3')).status, 400);
    assert.equal((await f(`/api/slots?tour=san-marco-rialto&date=${date}&pax=99`)).status, 400);
  } finally {
    s.close();
  }
});

test('prenotazione B2C con pagamento demo, voucher, calendario e annullo con rimborso', async () => {
  const s = await start();
  try {
    const f = s.jar();
    const date = day(15);
    const q = `tour=san-marco-rialto&date=${date}&time=09:30&pax=2`;
    assert.equal((await f(`/it/book/checkout?${q}`)).status, 200);
    assert.equal((await f(`/it/book/checkout?tour=san-marco-rialto&date=${date}&time=11:00&pax=2`)).status, 409, 'non è una partenza');

    const data = { tour: 'san-marco-rialto', date, time: '09:30', pax: '2', name: 'Anna <b>Verdi</b>', email: 'anna@example.com', phone: '+39 333 0000000', lang: 'it', paymentMethod: 'card', consent: '1' };
    assert.equal((await f('/it/book/checkout', form({ ...data, consent: '' }))).status, 400, 'serve il consenso');
    assert.equal((await f('/it/book/checkout', form({ ...data, website: 'http://spam' }))).status, 400, 'honeypot');
    const res = await f('/it/book/checkout', form(data));
    assert.equal(res.status, 303);
    const demo = loc(res);
    assert.match(demo, /\/pay\/demo\/VE-/);
    const u = new URL(demo);
    assert.equal((await f(u.pathname + u.search)).status, 200);

    // finché non paga lo slot è bloccato per tutti
    const taken = await (await f(`/api/slots?tour=san-marco-rialto&date=${date}&pax=9`)).json();
    assert.deepEqual(taken.slots.map((x) => x.time), ['14:30']);

    const paid = await f(u.pathname + '/complete', form({ t: u.searchParams.get('t'), lang: 'it' }));
    assert.equal(paid.status, 303);
    const bookingUrl = loc(paid);
    const page = await (await f(bookingUrl)).text();
    assert.match(page, /Prenotazione confermata/);
    assert.ok(page.includes('Anna &lt;b&gt;Verdi&lt;/b&gt;'), 'i dati dell’utente sono escapati');
    assert.ok(!page.includes('<b>Verdi'), 'nessun HTML iniettato');
    const [path, qs] = bookingUrl.split('?');
    const ics = await f(`${path}/calendar.ics?${qs.split('&')[0]}`);
    assert.match(ics.headers.get('content-type'), /text\/calendar/);
    assert.match(await ics.text(), /BEGIN:VEVENT/);
    assert.equal((await f(`${path}/voucher?${qs.split('&')[0]}`)).status, 200);
    assert.equal((await f(`${path}?t=sbagliato`)).status, 404, 'token errato');

    assert.ok(s.app.mail.sent.some((m) => m.to === 'anna@example.com' && /confermata/i.test(m.subject)));
    assert.ok(s.app.mail.sent.some((m) => m.to === 'guida@example.com'));

    const token = qs.split('&')[0].slice(2);
    const cancel = await f(`${path}/cancel`, form({ t: token }));
    assert.equal(cancel.status, 303);
    const after = await (await f(`${path}?t=${token}`)).text();
    assert.match(after, /Prenotazione annullata/);
    assert.match(after, /Rimborsati/);
    const again = await (await f(`/api/slots?tour=san-marco-rialto&date=${date}&pax=9`)).json();
    assert.deepEqual(again.slots.map((x) => x.time), ['09:30', '14:30']);
  } finally {
    s.close();
  }
});

test('pagamento in sede: conferma immediata; fattura negata ai non partner; CSRF', async () => {
  const s = await start();
  try {
    const f = s.jar();
    const date = day(18);
    const data = { tour: 'passeggiata-privata-2h', date, time: '10:00', pax: '3', name: 'Luca', email: 'luca@example.com', lang: 'en', paymentMethod: 'onsite', consent: '1' };
    const res = await f('/en/book/checkout', form(data));
    assert.equal(res.status, 303);
    assert.match(loc(res), /\/en\/booking\/VE-.*&new=1/);
    // stesso slot di nuovo: non più disponibile
    assert.equal((await f('/en/book/checkout', form({ ...data, email: 'x@example.com' }))).status, 409);
    // metodo di pagamento non consentito
    const inv = await f('/en/book/checkout', form({ ...data, time: '15:00', paymentMethod: 'invoice' }));
    assert.equal(inv.status, 400);
    // richieste cross-site rifiutate
    const evil = await f('/en/book/checkout', { ...form({ ...data, time: '15:00' }), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
  } finally {
    s.close();
  }
});

test('Stripe: sessione creata con i dati giusti, webhook firmato conferma, replay innocuo, firma errata rifiutata', async () => {
  const s = await start({ fakeStripe: true });
  try {
    const f = s.jar();
    const date = day(25);
    const res = await f('/it/book/checkout', form({ tour: 'cannaregio-ghetto', date, time: '10:00', pax: '4', name: 'Marta', email: 'marta@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }));
    assert.equal(res.status, 303);
    assert.match(loc(res), /^https:\/\/checkout\.stripe\.com\//);
    const call = s.calls.find((c) => c.url.endsWith('/checkout/sessions'));
    const p = new URLSearchParams(call.init.body);
    assert.equal(p.get('line_items[0][price_data][unit_amount]'), '14000');
    assert.equal(p.get('line_items[0][price_data][currency]'), 'eur');
    assert.equal(p.get('mode'), 'payment');
    assert.equal(call.init.headers.Authorization, 'Bearer sk_test_x');
    assert.match(p.get('success_url'), /\/it\/booking\/VE-.*paid=1/);
    const ref = p.get('client_reference_id');

    const event = (type, over = {}) => Buffer.from(JSON.stringify({ type, data: { object: { id: 'cs_test_' + ref, client_reference_id: ref, payment_status: 'paid', payment_intent: 'pi_123', amount_total: 14000, ...over } } }));
    const sign = (body, secret = 'whsec_test') => {
      const t = Math.floor(Date.now() / 1000);
      return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')}`;
    };
    const post = (body, sig) => f('/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body });

    const body = event('checkout.session.completed');
    assert.equal((await post(body, sign(body, 'altro-segreto'))).status, 400);
    assert.equal((await post(body, 't=1,v1=00')).status, 400);
    const wrongAmount = event('checkout.session.completed', { amount_total: 100 });
    await post(wrongAmount, sign(wrongAmount));
    assert.equal(s.app.db.prepare('SELECT status FROM bookings WHERE ref = ?').get(ref).status, 'held', 'importo diverso: ignorato');

    assert.equal((await post(body, sign(body))).status, 200);
    const b = s.app.db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);
    assert.equal(b.status, 'confirmed');
    assert.equal(b.payment_status, 'paid');
    assert.equal(b.stripe_payment_intent, 'pi_123');
    const mails = s.app.mail.sent.length;
    assert.equal((await post(body, sign(body))).status, 200);
    assert.equal(s.app.mail.sent.length, mails, 'il replay non rimanda email');

    // annullo del cliente entro i termini → rimborso via API Stripe
    const token = b.token;
    await f(`/it/booking/${ref}/cancel`, form({ t: token }));
    const refund = s.calls.find((c) => c.url.endsWith('/refunds'));
    assert.ok(refund, 'rimborso richiesto a Stripe');
    const rp = new URLSearchParams(refund.init.body);
    assert.equal(rp.get('payment_intent'), 'pi_123');
    assert.equal(rp.get('amount'), '14000');
    assert.equal(s.app.db.prepare('SELECT payment_status FROM bookings WHERE ref = ?').get(ref).payment_status, 'refunded');

    // sessione scaduta libera lo slot
    const r2 = await f('/it/book/checkout', form({ tour: 'cannaregio-ghetto', date, time: '15:00', pax: '2', name: 'Marta', email: 'marta@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }));
    const ref2 = new URLSearchParams(s.calls.filter((c) => c.url.endsWith('/checkout/sessions')).at(-1).init.body).get('client_reference_id');
    assert.equal(r2.status, 303);
    const exp = event('checkout.session.expired', { client_reference_id: ref2, id: 'cs_test_' + ref2, payment_status: 'unpaid' });
    await post(exp, sign(exp));
    assert.equal(s.app.db.prepare('SELECT status FROM bookings WHERE ref = ?').get(ref2).status, 'expired');
  } finally {
    s.close();
  }
});

test('B2B: registrazione, approvazione admin, tariffa partner, prenotazione a fattura, regole di cancellazione', async () => {
  const s = await start();
  try {
    const partner = s.jar();
    const admin = s.jar();
    const date = day(30);

    assert.equal((await partner('/it/b2b/account')).status, 302, 'serve il login');
    const reg = await partner('/it/b2b/register', form({ company: 'Venice DMC', vat: 'IT123', country: 'IT', sdi_code: 'ABCDEFG', contact_name: 'Giulia', phone: '+39 041 000', email: 'dmc@example.com', password: 'password-lunga-1', consent: '1' }));
    assert.equal(reg.status, 200);
    assert.equal((await partner('/it/b2b/register', form({ company: 'X', vat: '1', country: 'IT', contact_name: 'G', phone: '1', email: 'dmc@example.com', password: 'corta', consent: '1' }))).status, 400);
    assert.equal((await partner('/it/b2b/register', form({ company: 'X', vat: '1', country: 'IT', contact_name: 'G', phone: '1', email: 'nuovo@example.com', password: 'password-lunga-1', consent: '1' }))).status, 400, 'IT senza SDI/PEC');
    assert.ok(s.app.mail.sent.some((m) => m.to === 'guida@example.com' && /partner/i.test(m.subject)));

    // finché è "pending" paga la tariffa pubblica e non può usare la fattura
    const pending = await (await partner(`/api/slots?tour=servizio-mezza-giornata&date=${date}&pax=10`)).json();
    assert.equal(pending.slots[0].totalCents, 24000);
    const denied = await partner('/it/book/checkout', form({ tour: 'servizio-mezza-giornata', date, time: '09:00', pax: '10', name: 'G', email: 'dmc@example.com', lang: 'it', paymentMethod: 'invoice', consent: '1' }));
    assert.equal(denied.status, 400);

    // admin
    assert.equal(loc(await admin('/admin')), '/admin/login');
    assert.equal((await admin('/admin/login', form({ password: 'no' }))).status, 401);
    assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
    const id = s.app.db.prepare('SELECT id FROM accounts').get().id;
    const ap = await admin(`/admin/partners/${id}`, form({ status: 'approved', discount_percent: '5', cancel_hours: '120', allow_invoice: '1' }));
    assert.equal(ap.status, 303);
    assert.ok(s.app.mail.sent.some((m) => m.to === 'dmc@example.com' && /attivo|active/i.test(m.subject)));

    // partner approvato
    const now = await (await partner(`/api/slots?tour=servizio-mezza-giornata&date=${date}&pax=10`)).json();
    assert.equal(now.slots[0].totalCents, 18050, '190 € − 5%');
    const ok = await partner('/it/book/checkout', form({ tour: 'servizio-mezza-giornata', date, time: '09:00', pax: '10', name: 'Giulia', email: 'dmc@example.com', lang: 'it', paymentMethod: 'invoice', clientRef: 'PRATICA 42', consent: '1' }));
    assert.equal(ok.status, 303);
    const b = s.app.db.prepare('SELECT * FROM bookings WHERE client_ref = ?').get('PRATICA 42');
    assert.equal(b.channel, 'b2b');
    assert.equal(b.status, 'confirmed');
    assert.equal(b.total_cents, 18050);
    assert.equal(b.payment_method, 'invoice');
    assert.equal(Date.parse(b.free_cancel_until), localToInstant(date, '09:00') - 120 * 3600_000, 'partner con 120 h di cancellazione gratuita');
    assert.match(await (await partner('/it/b2b/account')).text(), /PRATICA 42|VE-/);

    // l'admin vede la prenotazione e può annullarla
    const detail = await (await admin(`/admin/bookings/${b.id}`)).text();
    assert.match(detail, /PRATICA 42/);
    assert.equal((await admin(`/admin/bookings/${b.id}/cancel`, form({ refund: 'auto', reason: 'test' }))).status, 303);
    assert.equal(s.app.db.prepare('SELECT status FROM bookings WHERE id = ?').get(b.id).status, 'cancelled');

    // sospendere il partner blocca la tariffa B2B
    await admin(`/admin/partners/${id}`, form({ status: 'suspended', discount_percent: '5' }));
    const susp = await (await partner(`/api/slots?tour=servizio-mezza-giornata&date=${date}&pax=10`)).json();
    assert.equal(susp.slots[0].totalCents, 24000);
  } finally {
    s.close();
  }
});

test('admin: chiusura giorni, blocchi orari, orari settimanali e feed calendario', async () => {
  const s = await start();
  try {
    const admin = s.jar();
    const anon = s.jar();
    await admin('/admin/login', form({ password: 'segreto-admin' }));
    const date = day(12);
    const slots = async () => (await (await anon(`/api/slots?tour=san-marco-rialto&date=${date}&pax=1`)).json()).slots.map((x) => x.time);
    assert.deepEqual(await slots(), ['09:30', '14:30']);

    await admin('/admin/availability/day', form({ date, action: 'close', m: date.slice(0, 7) }));
    assert.deepEqual(await slots(), []);
    await admin('/admin/availability/day', form({ date, action: 'open', m: date.slice(0, 7) }));
    assert.deepEqual(await slots(), ['09:30', '14:30']);

    await admin('/admin/availability/block', form({ date, from: '14:00', to: '16:00', note: 'Agenzia X', m: date.slice(0, 7) }));
    assert.deepEqual(await slots(), ['09:30']);
    const blockId = s.app.db.prepare('SELECT id FROM blocks').get().id;
    await admin(`/admin/availability/block/${blockId}/delete`, form({ m: date.slice(0, 7) }));
    assert.deepEqual(await slots(), ['09:30', '14:30']);

    await admin('/admin/availability/custom', form({ date, from: '09:00', to: '12:00' }));
    assert.deepEqual(await slots(), ['09:30']);
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const wk = {};
    for (let d = 0; d < 7; d++) Object.assign(wk, { [`open_${d}`]: d === dow ? '' : '1', [`from_${d}`]: '08:30', [`to_${d}`]: '19:30' });
    await admin('/admin/availability/day', form({ date, action: 'open' }));
    await admin('/admin/availability/weekly', form(wk));
    assert.deepEqual(await slots(), [], 'giorno della settimana chiuso');

    assert.equal((await admin('/admin/availability')).status, 200);
    assert.equal((await admin('/admin/partners')).status, 200);
    assert.equal((await admin('/admin/bookings?f=all&q=zzz')).status, 200);

    const feed = (await (await admin('/admin')).text()).match(/calendar\.ics\?k=([\w-]+)/)[1];
    const ics = await anon(`/admin/calendar.ics?k=${feed}`);
    assert.equal(ics.status, 200);
    assert.match(await ics.text(), /BEGIN:VCALENDAR/);
    assert.equal((await anon('/admin/bookings')).status, 302);
  } finally {
    s.close();
  }
});

test('codici sconto e buoni regalo: checkout con "Applica", buono acquistato online e usato, ripristino su annullo', async () => {
  const s = await start();
  try {
    const f = s.jar();
    const admin = s.jar();
    await admin('/admin/login', form({ password: 'segreto-admin' }));

    // l'admin crea un codice sconto dal pannello
    assert.equal((await admin('/admin/discounts/promos', form({ code: 'estate10', kind: 'percent', value: '10', max_uses: '5' }))).status, 303);
    assert.equal(loc(await admin('/admin/discounts/promos', form({ code: 'estate10', kind: 'percent', value: '10' }))), '/admin/discounts?tab=promos&err=dup');
    assert.equal(loc(await admin('/admin/discounts/promos', form({ code: 'xx', kind: 'percent', value: '10' }))), '/admin/discounts?tab=promos&err=code');
    assert.equal(loc(await admin('/admin/discounts/promos', form({ code: 'tanto', kind: 'percent', value: '150' }))), '/admin/discounts?tab=promos&err=value');
    assert.match(await (await admin('/admin/discounts')).text(), /ESTATE10/);

    // acquisto di un buono regalo da 50 € con consegna al destinatario oggi
    const date = day(20);
    assert.equal((await f('/it/gift')).status, 200);
    const bad = await f('/it/gift', form({ amount: '5000', buyerName: 'Anna', buyerEmail: 'anna@example.com', delivery: 'recipient', recipientEmail: 'nope', consent: '1' }));
    assert.equal(bad.status, 400);
    assert.equal((await f('/it/gift', form({ amount: 'custom', custom: '5', buyerName: 'Anna', buyerEmail: 'anna@example.com', delivery: 'me', consent: '1' }))).status, 400, 'sotto il minimo');
    const buy = await f('/it/gift', form({ amount: '5000', buyerName: 'Anna', buyerEmail: 'anna@example.com', delivery: 'recipient', recipientName: 'Luca', recipientEmail: 'luca@example.com', deliverOn: day(0), message: 'Buon compleanno!', consent: '1' }));
    assert.equal(buy.status, 303);
    const demo = new URL(loc(buy));
    assert.match(demo.pathname, /^\/pay\/demo\/GC-/);
    const card0 = s.app.db.prepare('SELECT * FROM gift_cards').get();
    assert.equal(card0.status, 'pending');
    assert.equal(card0.balance_cents, 0, 'finché non paga il buono non vale');
    const pendingUse = await f(`/it/book/checkout?tour=san-marco-rialto&date=${date}&time=09:30&pax=1&gift=${card0.code}`);
    assert.match(await pendingUse.text(), /non esiste/);

    const paid = await f(demo.pathname + '/complete', form({ t: demo.searchParams.get('t'), lang: 'it' }));
    assert.equal(paid.status, 303);
    const status = await (await f(loc(paid))).text();
    assert.match(status, /Buono regalo pronto/);
    const card = s.app.db.prepare('SELECT * FROM gift_cards').get();
    assert.equal(card.status, 'active');
    assert.equal(card.balance_cents, 5000);
    assert.ok(card.expires_at > day(700), 'valido 24 mesi');
    assert.ok(status.includes(card.code.slice(0, 4) + '-' + card.code.slice(4, 8)), 'il codice è mostrato');
    const mails = s.app.mail.sent.filter((m) => m.subject.match(/buono regalo|regalato/i));
    assert.ok(mails.some((m) => m.to === 'anna@example.com'), 'conferma all’acquirente');
    assert.ok(mails.some((m) => m.to === 'luca@example.com' && /Buon compleanno!/.test(m.text) && m.text.includes(card.code.slice(0, 4))), 'consegna al destinatario con messaggio e codice');
    assert.ok(card.delivered_at);
    assert.ok(s.app.mail.sent.some((m) => m.to === 'guida@example.com' && /Buono regalo venduto/.test(m.subject)));
    // un secondo webhook/ritorno non attiva due volte né rimanda email
    const before = s.app.mail.sent.length;
    await f(loc(paid) + '&paid=1');
    assert.equal(s.app.mail.sent.length, before);

    // checkout: "Applica" mostra lo sconto senza prenotare
    const co = { tour: 'san-marco-rialto', date, time: '09:30', pax: '3', name: 'Luca', email: 'luca@example.com', lang: 'it', paymentMethod: 'card', consent: '1', promo: 'ESTATE10', gift: card.code };
    const applied = await f('/it/book/checkout', form({ ...co, apply: '1' }));
    assert.equal(applied.status, 200);
    const html = await applied.text();
    assert.match(html, /Codice ESTATE10 applicato/);
    assert.match(html, /−10,50\s*€/, 'sconto 10% su 105 €');
    assert.match(html, /−50\s*€/, 'buono da 50 €');
    assert.match(html, /44,50\s*€/, 'da pagare 44,50 €');
    assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 0, 'applicare non crea prenotazioni');
    const wrong = await (await f('/it/book/checkout', form({ ...co, apply: '1', promo: 'NONESISTE' }))).text();
    assert.match(wrong, /Questo codice sconto non esiste/);

    // prenotazione vera con carta: paga solo la differenza
    const book = await f('/it/book/checkout', form(co));
    assert.equal(book.status, 303);
    const bk = s.app.db.prepare('SELECT * FROM bookings').get();
    assert.equal(bk.total_cents, 9450);
    assert.equal(bk.gift_cents, 5000);
    assert.equal(bk.discount_cents, 1050);
    const u = new URL(loc(book));
    const demoPage = await (await f(u.pathname + u.search)).text();
    assert.match(demoPage, /44,50\s*€/, 'la pagina di pagamento chiede solo 44,50 €');
    await f(u.pathname + '/complete', form({ t: u.searchParams.get('t'), lang: 'it' }));
    assert.equal(s.app.db.prepare('SELECT status FROM bookings').get().status, 'confirmed');
    const page = await (await f(`/it/booking/${bk.ref}?t=${bk.token}`)).text();
    assert.match(page, /Sconto ESTATE10/);
    assert.match(page, /Da pagare/);
    assert.equal(s.app.db.prepare('SELECT balance_cents FROM gift_cards').get().balance_cents, 0);

    // annullo gratuito: il buono torna sul saldo
    await f(`/it/booking/${bk.ref}/cancel`, form({ t: bk.token }));
    assert.equal(s.app.db.prepare('SELECT balance_cents FROM gift_cards').get().balance_cents, 5000);
    assert.match(await (await admin(`/admin/discounts/gifts/${card.id}`)).text(), /Ripristino/);
    // l'admin rettifica ed estende
    assert.equal((await admin(`/admin/discounts/gifts/${card.id}/adjust`, form({ amount: '-60', note: 'x' }))).status, 303);
    assert.equal(s.app.db.prepare('SELECT balance_cents FROM gift_cards').get().balance_cents, 5000, 'saldo non può diventare negativo');
    await admin(`/admin/discounts/gifts/${card.id}/adjust`, form({ amount: '-20,50', note: 'omaggio' }));
    assert.equal(s.app.db.prepare('SELECT balance_cents FROM gift_cards').get().balance_cents, 2950);
    await admin(`/admin/discounts/gifts/${card.id}/void`, form({ note: 'test' }));
    assert.equal(s.app.db.prepare('SELECT status, balance_cents FROM gift_cards').get().balance_cents, 0);
  } finally {
    s.close();
  }
});

test('buono regalo programmato: parte alle 9:00 del giorno scelto, una sola volta', async () => {
  const s = await start();
  try {
    const f = s.jar();
    const future = day(10);
    const buy = await f('/en/gift', form({ amount: '10000', buyerName: 'Sam', buyerEmail: 'sam@example.com', delivery: 'recipient', recipientEmail: 'kim@example.com', deliverOn: future, consent: '1' }));
    const u = new URL(loc(buy));
    await f(u.pathname + '/complete', form({ t: u.searchParams.get('t'), lang: 'en' }));
    assert.ok(!s.app.mail.sent.some((m) => m.to === 'kim@example.com'), 'non parte prima della data');
    const buyerMail = s.app.mail.sent.find((m) => m.to === 'sam@example.com');
    assert.match(buyerMail.text, /We will send it to/);
    const at = (d, hhmm) => localToInstant(d, hhmm);
    assert.equal(await s.app.gifts.deliverDue(at(future, '08:59')), 0);
    assert.equal(await s.app.gifts.deliverDue(at(future, '09:00')), 1);
    assert.equal(await s.app.gifts.deliverDue(at(future, '09:05')), 0, 'una sola volta');
    assert.equal(s.app.mail.sent.filter((m) => m.to === 'kim@example.com').length, 1);
    // data nel passato o oltre un anno: rifiutata
    assert.equal((await f('/en/gift', form({ amount: '10000', buyerName: 'Sam', buyerEmail: 'sam@example.com', delivery: 'recipient', recipientEmail: 'kim@example.com', deliverOn: day(-3), consent: '1' }))).status, 400);
    assert.equal((await f('/en/gift', form({ amount: '10000', buyerName: 'Sam', buyerEmail: 'sam@example.com', delivery: 'recipient', recipientEmail: 'kim@example.com', deliverOn: day(500), consent: '1' }))).status, 400);
  } finally {
    s.close();
  }
});

test('feedback dalla pagina privata: token, voto, pagina di ringraziamento con link pubblici, admin', async () => {
  const s = await start();
  s.app.cfg.reviews.googleUrl = 'https://g.page/r/ABC/review';
  try {
    const f = s.jar();
    const admin = s.jar();
    await admin('/admin/login', form({ password: 'segreto-admin' }));
    const date = day(15);
    const book = await f('/it/book/checkout', form({ tour: 'san-marco-rialto', date, time: '09:30', pax: '2', name: 'Marta', email: 'marta@example.com', lang: 'it', paymentMethod: 'onsite', consent: '1' }));
    assert.equal(book.status, 303);
    const b = s.app.db.prepare('SELECT * FROM bookings').get();
    assert.equal((await f(`/it/feedback/${b.ref}?t=sbagliato`)).status, 404);
    const early = await (await f(`/it/feedback/${b.ref}?t=${b.token}`)).text();
    assert.match(early, /dopo il tour/, 'prima del tour avvisa');
    // simuliamo che il tour sia passato
    s.app.db.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(day(-2), b.id);
    const page = await (await f(`/it/feedback/${b.ref}?t=${b.token}`)).text();
    assert.match(page, /Com’è andato il tour/);
    assert.equal((await f(`/it/feedback/${b.ref}`, form({ t: b.token, comment: 'senza voto' }))).status, 400);
    const ok = await f(`/it/feedback/${b.ref}`, form({ t: b.token, rating: '3', comment: 'Bello ma un po\' veloce', may_publish: '1' }));
    assert.equal(ok.status, 200);
    const thanks = await ok.text();
    assert.match(thanks, /Grazie!/);
    assert.match(thanks, /g\.page\/r\/ABC\/review/, 'il link pubblico è mostrato anche con voto 3');
    assert.ok(s.app.mail.sent.some((m) => m.to === 'guida@example.com' && /Feedback ★★★☆☆/.test(m.subject)));
    const list = await (await admin('/admin/feedback')).text();
    assert.match(list, /Bello ma un po&#39; veloce/);
    assert.match(list, /citabile sul sito/);
    // l'admin può saltare / inviare la richiesta dal dettaglio
    assert.equal((await admin(`/admin/bookings/${b.id}/review`, form({ action: 'skip' }))).status, 303);
    assert.equal(s.app.db.prepare('SELECT review_status FROM bookings WHERE id = ?').get(b.id).review_status, 'skipped');
  } finally {
    s.close();
  }
});

test('admin: collegare un calendario, vedere gli impegni, checkout con riallineamento al volo', async () => {
  const state = { body: '' };
  const day2 = day(14);
  const ymd = day2.replaceAll('-', '');
  const mkIcs = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
  const ev = (uid, from, to, title) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${ymd}T${from}00Z\r\nDTEND:${ymd}T${to}00Z\r\nSUMMARY:${title}\r\nEND:VEVENT`;
  state.body = mkIcs([ev('x1', '0700', '0800', 'Visita medica')]);
  const s = await start({ fetchImpl: async () => new Response(state.body, { status: 200 }) });
  try {
    const f = s.jar();
    const admin = s.jar();
    await admin('/admin/login', form({ password: 'segreto-admin' }));
    const month = day2.slice(0, 7);
    assert.match(loc(await admin('/admin/availability/calendars', form({ name: 'X', url: 'ftp://nope', m: month }))), /err=calurl/);
    assert.match(loc(await admin('/admin/availability/calendars', form({ name: 'Personale', url: 'webcal://calendar.example/private-secret-123/basic.ics', m: month }))), /ok=calendar/);
    const page = await (await admin(`/admin/availability?m=${month}`)).text();
    assert.match(page, /Personale/);
    assert.ok(!page.includes('private-secret-123/basic.ics'), 'l\'indirizzo segreto non è mostrato per intero');
    assert.match(page, /Visita medica/, 'gli impegni compaiono nel mese');

    const slots = async () => (await (await f(`/api/slots?tour=san-marco-rialto&date=${day2}&pax=1`)).json()).slots.map((x) => x.time);
    const before = await slots();

    // l'utente aggiunge un impegno in calendario che si sovrappone alle 14:30: il checkout lo vede subito
    state.body = mkIcs([ev('x1', '0700', '0800', 'Visita medica'), ev('x2', '1330', '1500', 'Appuntamento appena inserito')]);
    s.app.db.prepare('UPDATE calendar_sources SET last_ok_at = ?, last_attempt_at = ?').run(new Date(Date.now() - 600_000).toISOString(), new Date(Date.now() - 600_000).toISOString());
    const co = await f(`/it/book/checkout?tour=san-marco-rialto&date=${day2}&time=14:30&pax=1`);
    assert.equal(co.status, 409, 'lo slot è stato bloccato dall’impegno appena inserito');
    assert.ok(!(await slots()).includes('14:30'));
    assert.ok(before.includes('14:30'), 'prima era libero');

    assert.equal((await admin('/admin/availability/calendars/1/toggle', form({ m: month }))).status, 303);
    assert.ok((await slots()).includes('14:30'), 'calendario disattivato: torna libero');
    assert.equal((await admin('/admin/availability/calendars/1/delete', form({ m: month }))).status, 303);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM calendar_sources').get().n, 0);
  } finally {
    s.close();
  }
});
