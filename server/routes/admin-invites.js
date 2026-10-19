// Clienti › Partner › Inviti: la guida invita un'agenzia con un collegamento personale (l'account nasce già approvato).
import express from 'express';
import { sendPartnerInvite } from '../emails.js';
import { send } from '../http.js';
import { InviteError, cancelInvite, createInvite, getInvite, listInvites, markSent, renewInvite } from '../partnerInvites.js';
import { invitesPage } from '../views/admin-invites.js';

const FLASH = { cancelled: 'Invito annullato: il collegamento non vale più.', gone: 'Quell’invito non si può più rinviare (è già stato usato, annullato, o l’agenzia si è registrata da sola).' };
const ERR = {
  email: 'Scrivi un indirizzo email valido.',
  exists: 'Esiste già un’agenzia registrata con questo indirizzo: non serve invitarla (la trovi in «Tutti»).',
};

export function adminInvitesRouter(app) {
  const r = express.Router();
  const { db, cfg } = app;
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  const ctxOf = (req) => ({ app, req });
  const link = (invite, token) => `${cfg.baseUrl}/${invite.lang}/b2b/invite/${token}`;
  const page = (req, res, o = {}, status = 200) => send(res, invitesPage(ctxOf(req), { invites: listInvites(db), flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '', ...o }), status);

  /** Manda l'email e mostra il collegamento (l'unica volta che si vede). */
  async function deliver(req, res, invite, token) {
    const url = link(invite, token);
    const sent = (await sendPartnerInvite(app, invite, url)) !== false;
    if (sent) markSent(db, invite.id);
    page(req, res, { fresh: { invite: getInvite(db, invite.id), url, sent } });
  }

  r.get('/partners/invites', (req, res) => page(req, res));

  r.post('/partners/invites', form, async (req, res) => {
    const input = { email: req.body.email, company: req.body.company, contactName: req.body.contactName, lang: req.body.lang, note: req.body.note };
    let made;
    try {
      made = createInvite(db, input);
    } catch (err) {
      if (!(err instanceof InviteError)) throw err;
      return page(req, res, { values: input, error: ERR[err.code] }, 400);
    }
    await deliver(req, res, made.invite, made.token);
  });

  r.post('/partners/invites/:id/resend', form, async (req, res) => {
    const renewed = renewInvite(db, Number(req.params.id));
    if (!renewed) return res.redirect(303, '/admin/partners/invites?ok=gone');
    await deliver(req, res, renewed.invite, renewed.token);
  });

  r.post('/partners/invites/:id/cancel', form, (req, res) => {
    cancelInvite(db, Number(req.params.id));
    res.redirect(303, '/admin/partners/invites?ok=cancelled');
  });

  return r;
}
