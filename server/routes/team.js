// Più persone per agenzia: la pagina Team del titolare (invita, rinvia, toglie) e il collegamento d'invito con cui un collaboratore sceglie la password.
import express from 'express';
import { hashPassword } from '../auth.js';
import { sendTeamInvite } from '../emails.js';
import { loginPartner, send, tooMany } from '../http.js';
import { normLang } from '../langs.js';
import { MAX_MEMBERS, TeamError, activateMember, inviteMember, listMembers, memberByToken, removeMember, renewMemberInvite } from '../team.js';
import { joinPage, joinStatePage, teamPage } from '../views/team.js';
import { needPartner } from './guards.js';

export function teamRouter(app) {
  const r = express.Router();
  const { db, cfg } = app;
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  const ip = (req) => req.ip ?? 'ip';

  // dati personali e collegamenti personali: mai in cache del browser o di proxy
  r.use(['/b2b/team', '/b2b/join'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** Solo il titolare (chi ha registrato l'agenzia) gestisce il team: un collaboratore torna alla sua pagina. */
  const needOwner = (req, res, next) => (req.actor?.owner ? next() : res.redirect(303, `/${req.lang}/b2b/account`));
  const link = (user, token) => `${cfg.baseUrl}/${normLang(user.lang)}/b2b/join/${token}`;

  const FLASH = { removed: 'team.ok.removed' };
  const ERR = { gone: 'team.err.gone' };
  const show = (req, res, o = {}, status = 200) => {
    const { t } = res.locals.ctx;
    const flash = o.flash ?? (FLASH[String(req.query.ok ?? '')] ? t(FLASH[String(req.query.ok)]) : '');
    const error = o.error ?? (ERR[String(req.query.err ?? '')] ? t(ERR[String(req.query.err)]) : '');
    send(res, teamPage(res.locals.ctx, { acct: req.acct, members: listMembers(db, req.acct.id), values: o.values, flash, error }), status);
  };

  r.get('/b2b/team', needPartner, needOwner, (req, res) => show(req, res));

  // invita un collaboratore: nasce senza password e riceve un collegamento personale per sceglierla
  r.post('/b2b/team', needPartner, needOwner, form, async (req, res) => {
    const { t } = res.locals.ctx;
    if (!app.limits.team(String(req.acct.id))) return tooMany(res);
    const values = { name: String(req.body.name ?? ''), email: String(req.body.email ?? ''), lang: String(req.body.lang ?? '') };
    let made;
    try {
      made = inviteMember(db, req.acct, values);
    } catch (e) {
      if (!(e instanceof TeamError)) throw e;
      const error = { name: t('team.err.name'), email: t('err.email'), exists: t('team.err.exists'), limit: t('team.err.limit', { n: MAX_MEMBERS }) }[e.code];
      return show(req, res, { values, error }, 400);
    }
    const sent = await sendTeamInvite(app, { account: req.acct, inviter: req.actor.name, user: made.user }, link(made.user, made.token));
    show(req, res, sent !== false ? { flash: t('team.ok.invited', { email: made.user.email }) } : { flash: t('team.ok.mailFailed') });
  });

  // un collegamento nuovo (il vecchio smette di valere) per chi non ha ancora scelto la password
  r.post('/b2b/team/:id/resend', needPartner, needOwner, form, async (req, res) => {
    const { t } = res.locals.ctx;
    if (!app.limits.team(String(req.acct.id))) return tooMany(res);
    const renewed = renewMemberInvite(db, req.acct.id, Number(req.params.id));
    if (!renewed) return res.redirect(303, `/${req.lang}/b2b/team?err=gone`);
    const sent = await sendTeamInvite(app, { account: req.acct, inviter: req.actor.name, user: renewed.user }, link(renewed.user, renewed.token));
    show(req, res, sent !== false ? { flash: t('team.ok.resent', { email: renewed.user.email }) } : { flash: t('team.ok.mailFailed') });
  });

  r.post('/b2b/team/:id/remove', needPartner, needOwner, form, (req, res) => {
    removeMember(db, req.acct.id, Number(req.params.id));
    res.redirect(303, `/${req.lang}/b2b/team?ok=removed`);
  });

  // ───── il collegamento dell'invito (pubblico: chi lo riceve non ha ancora un accesso) ─────
  const gone = (res, ctx, state) => send(res, joinStatePage(ctx, { state }), state === 'used' || state === 'expired' ? 410 : 404);

  r.get('/b2b/join/:token', (req, res) => {
    const ctx = res.locals.ctx;
    const { state, user, account } = memberByToken(db, req.params.token);
    if (state !== 'open') return gone(res, ctx, state);
    send(res, joinPage(ctx, { token: req.params.token, user, account }));
  });

  r.post('/b2b/join/:token', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    if (req.body.website2) return res.status(400).end();
    if (!app.limits.register(ip(req))) return tooMany(res);
    const { state, user, account } = memberByToken(db, req.params.token);
    if (state !== 'open') return gone(res, ctx, state);
    const again = (error) => send(res, joinPage(ctx, { token: req.params.token, user, account, error }), 400);
    const pw = String(req.body.password ?? '');
    if (pw.length < 10) return again(t('err.password'));
    if (pw !== String(req.body.password2 ?? '')) return again(t('b2b.reset.mismatch'));
    if (!activateMember(db, user.id, await hashPassword(pw))) return gone(res, ctx, memberByToken(db, req.params.token).state); // due richieste insieme: vince la prima
    loginPartner(res, cfg, account.id, user.id);
    res.redirect(303, `/${normLang(user.lang)}/b2b/account?flash=welcome`);
  });

  return r;
}
