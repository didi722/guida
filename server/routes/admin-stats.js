// Statistiche e KPI: pagina con i filtri nell'indirizzo (GET, nessun JS necessario) ed esportazione CSV con gli stessi filtri.
import express from 'express';
import { send } from '../http.js';
import { bookingsCsv, filterOptions, parseFilters, statsReport } from '../stats.js';
import { statsPage } from '../views/admin-stats.js';

export function adminStatsRouter(app) {
  const r = express.Router();
  const { db } = app;

  /** Il nome di un tour in italiano; se il tour non esiste più resta lo slug. */
  const tourTitle = (slug) => app.content.tour(slug)?.i18n?.it?.title ?? slug;
  const contentTours = () => (app.content.allTours ?? app.content.tours ?? []).map((t) => ({ slug: t.slug, title: t.i18n?.it?.title ?? t.slug }));

  /** Filtri validati dalla richiesta, con gli elenchi per i menu. */
  function filtersOf(req, nowMs) {
    const options = filterOptions(db, contentTours());
    const filters = parseFilters(req.query, { nowMs, tours: options.tours.map((t) => t.slug), partners: options.partners.map((p) => p.id) });
    return { options, filters };
  }

  r.get('/stats', (req, res) => {
    const nowMs = Date.now();
    const { options, filters } = filtersOf(req, nowMs);
    const report = statsReport(db, filters, { nowMs, tourTitle });
    send(res, statsPage({ app, req }, { report, options }));
  });

  r.get('/stats.csv', (req, res) => {
    const nowMs = Date.now();
    const { filters } = filtersOf(req, nowMs);
    const name = filters.from && filters.to ? `${filters.from}_${filters.to}` : 'tutto';
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="prenotazioni-${name}.csv"`)
      .send(bookingsCsv(db, filters, { nowMs, tourTitle }));
  });

  return r;
}
