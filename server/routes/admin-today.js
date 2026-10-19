// Pannello › Agenda › Da fare e Scheda del giorno.
import express from 'express';
import { daySheet } from '../daySheet.js';
import { send, sendPdf } from '../http.js';
import { renderDaySheetPdf } from '../pdf-day.js';
import { addDays, isDate, nowRome } from '../time.js';
import { todoList } from '../todo.js';
import { dayPage, todoPage } from '../views/admin-today.js';

const FLASH = {
  sent: 'Scheda inviata alla tua email.',
  empty: 'Non ho inviato nulla: in quel giorno non ci sono servizi.',
  nomail: 'Non ho inviato nulla: manca l’indirizzo che riceve le notifiche (Sito › Impostazioni › Attività e contatti).',
  failed: 'L’email non è partita: controlla le impostazioni della posta.',
};

export function adminTodayRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '5kb' });
  const ctxOf = (req) => ({ app, req });
  const dateOf = (v) => (isDate(String(v ?? '')) ? String(v) : addDays(nowRome().date, 1)); // senza data: domani

  r.get('/todo', (req, res) => {
    const todo = todoList(app);
    app.todoCache = { at: Date.now(), count: todo.count }; // il numero nel menu si allinea a ciò che si vede
    send(res, todoPage(ctxOf(req), { todo, now: nowRome().time }));
  });

  r.get('/day', (req, res) => send(res, dayPage(ctxOf(req), { sheet: daySheet(app, dateOf(req.query.date)), flash: FLASH[String(req.query.ok ?? '')] ?? '' })));

  r.get('/day.pdf', async (req, res) => {
    const date = dateOf(req.query.date);
    sendPdf(res, await renderDaySheetPdf(app, daySheet(app, date)), `scheda-${date}.pdf`);
  });

  /** «Invia a me»: la scheda di quel giorno alla email delle notifiche, subito (la scheda serale parte comunque da sola). */
  r.post('/day/send', form, async (req, res) => {
    const date = dateOf(req.body.date);
    let ok = 'sent';
    if (!app.cfg.mail.notifyTo) ok = 'nomail';
    else if (!daySheet(app, date).services.length) ok = 'empty';
    else if (!(await app.briefing.send(date))) ok = 'failed';
    res.redirect(303, `/admin/day?date=${date}&ok=${ok}`);
  });

  return r;
}
