// Sicurezza del pannello: il secondo passo dell'accesso (prima del controllo di sessione) e la pagina Aiuto › Sicurezza (dopo).
import express from 'express';
import { notifySecurity } from '../emails.js';
import { inSecondStep, loginAdmin, send, tooMany } from '../http.js';
import { clearCookie } from '../auth.js';
import { login2faPage, recoveryPage, securityPage, setupPage } from '../views/admin-security.js';

const FLASH = {
  off: 'Due passaggi disattivati: il pannello si apre di nuovo con la sola password.',
  revoked: 'Fatto: tutti gli altri dispositivi sono stati scollegati. Questo browser resta collegato.',
};

/** L'avviso per email parte senza far aspettare la risposta (e un errore di posta non rompe l'accesso). */
const notify = (app, opts) => notifySecurity(app, opts).catch((err) => console.error('[sicurezza] avviso non partito:', err));
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));
const hourOf = (ms) => new Date(ms).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });

/** Perché un codice non è stato accettato, in parole. */
function refusal(out, nowMs = Date.now()) {
  if (out.reason === 'locked' || out.locked) return `Troppi codici sbagliati: i due passaggi sono bloccati per ${minutes(out.retryAfterMs)} minuti (fino alle ${hourOf(nowMs + out.retryAfterMs)}). Riprova dopo.`;
  if (out.reason === 'format') return 'Scrivi i 6 numeri che vedi nell’app, oppure un codice di emergenza.';
  return 'Codice non corretto. Scrivi quello che l’app mostra adesso (cambia ogni 30 secondi) e controlla che l’ora del telefono sia impostata in automatico. Un codice vale una volta sola.';
}

export function adminSecondStepRouter(app) {
  const r = express.Router();
  const { cfg } = app;
  const form = express.urlencoded({ extended: false, limit: '2kb' });
  const ctxOf = (req) => ({ app, req });

  r.get('/login/2fa', (req, res) => (inSecondStep(req, app) && app.adminSecurity.enabled() ? send(res, login2faPage(ctxOf(req))) : res.redirect('/admin/login')));
  r.post('/login/2fa', form, (req, res) => {
    if (!inSecondStep(req, app) || !app.adminSecurity.enabled()) return res.redirect(303, '/admin/login');
    if (!app.limits.login(`admin2fa|${req.ip}`)) return tooMany(res);
    const nowMs = Date.now();
    const out = app.adminSecurity.verify(String(req.body.code || req.body.recovery || ''), nowMs);
    if (!out.ok) {
      if (out.locked) notify(app, { subject: 'Accesso al pannello bloccato', lines: [`Dopo troppi codici sbagliati il secondo passaggio è bloccato per ${minutes(out.retryAfterMs)} minuti.`, 'Qualcuno conosce la password del pannello e sta provando a entrare.'], ip: req.ip });
      return send(res, login2faPage(ctxOf(req), { error: refusal(out, nowMs) }), out.reason === 'locked' || out.locked ? 429 : 401);
    }
    clearCookie(res, cfg, 'gp');
    loginAdmin(res, cfg, app.adminSecurity.sessionTag());
    if (out.kind === 'recovery') notify(app, { subject: 'Usato un codice di emergenza', lines: [`Sei entrato nel pannello con un codice di emergenza: ne restano ${out.recoveryLeft}.`, out.recoveryLeft <= 2 ? 'Ne restano pochi: genera nuovi codici da Aiuto › Sicurezza.' : null].filter(Boolean), ip: req.ip });
    res.redirect(303, '/admin');
  });
  return r;
}

export function adminSecurityRouter(app) {
  const r = express.Router();
  const { cfg } = app;
  const form = express.urlencoded({ extended: false, limit: '2kb' });
  const ctxOf = (req) => ({ app, req });
  const limited = (req) => !app.limits.login(`admin-security|${req.ip}`);

  const show = (req, res, { error = '', status = 200 } = {}) => send(res, securityPage(ctxOf(req), { status: app.adminSecurity.status(), flash: FLASH[String(req.query.ok ?? '')] ?? '', error }), status);
  /** Controlla il codice scritto in un modulo; se non va, mostra la pagina con l'errore. */
  function checked(req, res) {
    const nowMs = Date.now();
    const out = app.adminSecurity.verify(String(req.body.code ?? ''), nowMs);
    if (out.ok) return out;
    if (out.locked) notify(app, { subject: 'Accesso al pannello bloccato', lines: [`Dopo troppi codici sbagliati il secondo passaggio è bloccato per ${minutes(out.retryAfterMs)} minuti.`], ip: req.ip });
    show(req, res, { error: refusal(out, nowMs), status: out.reason === 'locked' || out.locked ? 429 : 400 });
    return null;
  }

  r.get('/security', (req, res) => show(req, res));

  // ── attivazione ──
  r.post('/security/2fa/start', form, (req, res) => {
    if (app.adminSecurity.enabled()) return res.redirect(303, '/admin/security');
    app.adminSecurity.beginSetup();
    res.redirect(303, '/admin/security/2fa');
  });
  r.get('/security/2fa', (req, res) => {
    const setup = app.adminSecurity.pendingSetup();
    return setup ? send(res, setupPage(ctxOf(req), { setup })) : res.redirect('/admin/security');
  });
  r.post('/security/2fa/confirm', form, (req, res) => {
    if (limited(req)) return tooMany(res);
    const out = app.adminSecurity.confirmSetup(String(req.body.code ?? ''));
    if (!out.ok) {
      const setup = app.adminSecurity.pendingSetup();
      if (!setup) return res.redirect(303, '/admin/security');
      return send(res, setupPage(ctxOf(req), { setup, error: 'Codice non corretto. Scrivi i 6 numeri che l’app mostra adesso (cambiano ogni 30 secondi) e controlla che l’ora del telefono sia impostata in automatico.' }), 400);
    }
    loginAdmin(res, cfg, app.adminSecurity.sessionTag()); // l'attivazione scollega gli altri dispositivi, non questo
    notify(app, { subject: 'Accesso a due passaggi attivato', lines: ['Per entrare nel pannello servono ora la password e il codice dell’app di autenticazione.', 'Gli altri dispositivi sono stati scollegati.'], ip: req.ip });
    send(res, recoveryPage(ctxOf(req), { codes: out.recoveryCodes, fresh: true }));
  });

  // ── con i due passaggi attivi ──
  r.post('/security/2fa/disable', form, (req, res) => {
    if (limited(req)) return tooMany(res);
    if (!app.adminSecurity.enabled()) return res.redirect(303, '/admin/security');
    if (!checked(req, res)) return;
    app.adminSecurity.disable();
    notify(app, { subject: 'Accesso a due passaggi disattivato', lines: ['Il pannello si apre di nuovo con la sola password.'], ip: req.ip });
    res.redirect(303, '/admin/security?ok=off');
  });
  r.post('/security/2fa/recovery', form, (req, res) => {
    if (limited(req)) return tooMany(res);
    if (!app.adminSecurity.enabled()) return res.redirect(303, '/admin/security');
    if (!checked(req, res)) return;
    const codes = app.adminSecurity.regenerateRecovery();
    notify(app, { subject: 'Nuovi codici di emergenza', lines: ['Hai generato nuovi codici di emergenza: i precedenti non valgono più.'], ip: req.ip });
    send(res, recoveryPage(ctxOf(req), { codes, fresh: false }));
  });

  // ── dispositivi ──
  r.post('/security/sessions/revoke', form, (req, res) => {
    app.adminSecurity.revokeSessions();
    loginAdmin(res, cfg, app.adminSecurity.sessionTag());
    res.redirect(303, '/admin/security?ok=revoked');
  });

  return r;
}
