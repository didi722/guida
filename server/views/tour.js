// Il giro interattivo dell'area agenzie: i testi nella lingua della pagina, per public/js/tour.js (che gira su tutte le pagine dell'area).
import { html } from '../html.js';
import { TUTORIAL_STEPS } from '../tutorial.js';

const STOPS = ['s1', 's2', 's3', 's3m', 's4', 's5', 's6', 's7', 's8', 's9'];

/** La configurazione del giro e lo script: sulle pagine dei partner approvati. Il giro parte solo se la persona lo avvia (finestra, riquadro o «Guida e FAQ»). */
export function tourBlock(ctx) {
  const { t, u, acct, app } = ctx;
  const cfg = {
    acct: acct.id,
    total: TUTORIAL_STEPS.length,
    done: u('/b2b/tutorial/done'),
    urls: { home: u('/b2b/account'), book: u('/book'), invoices: u('/b2b/invoices') },
    t: {
      titles: Object.fromEntries(TUTORIAL_STEPS.map((n) => [n, t(`tut.${n}.title`, { company: acct.company })])),
      stops: Object.fromEntries(STOPS.map((k) => [k, t(`tour.${k}`)])),
      count: t('tut.step', { n: '{n}', total: '{total}' }),
      next: t('tut.next'),
      exit: t('tour.exit'),
      skipStop: t('tour.skipStop'),
      hint: t('tour.hint'),
      finish: t('tour.finish'),
      resume: t('tour.resume', { n: '{n}', total: '{total}' }),
      resumeBtn: t('tour.resumeBtn'),
    },
  };
  return html`<div id="tour-config" hidden data-config="${JSON.stringify(cfg)}"></div><script src="/js/tour.js?v=${app.assetVersion}" defer></script>`;
}
