// Pannello › Commerciale › Demo: il collegamento riservato all'area agenzie di prova (vedi demo.js).
import { html } from '../html.js';
import { LANGS, LANG_META } from '../langs.js';
import { adminLayout } from './admin.js';

const when = (ms) => new Date(ms).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** @param {object} o link (il collegamento riservato), linkFor (lingua → collegamento), status ({active, builtAt, usedAt}) */
export function demoPage(ctx, { link, linkFor, status, flash = '' }) {
  const body = html`
<section class="card pad">
  <h2>Un’area agenzie di prova, da mostrare in videochiamata</h2>
  <p>Entri come <strong>Laguna Viaggi (demo)</strong>, un’agenzia inventata con prenotazioni in tutti gli stati (confermate, pagate con carta o a fattura, opzioni, annullate, già svolte), <strong>fatture emesse, pagate e scadute</strong>, un preventivo per un cliente, un collaboratore e un programma di più giorni. Con i tuoi tour e le tue tariffe vere: quello che vede l’agenzia è quello che vedrebbe da cliente.</p>
  <p class="btn-row"><a class="btn btn-gold" href="${link}" target="_blank" rel="noopener">Apri la demo</a>
    ${LANGS.map((l) => html`<a class="btn btn-sm btn-outline" href="${linkFor(l)}" target="_blank" rel="noopener">${LANG_META[l].name}</a>`)}</p>
  <label class="field"><span class="label">Il collegamento riservato <em>(chi lo ha entra nella demo, senza password)</em></span><input type="text" readonly value="${link}"></label>
  <p class="small muted">${status.active ? `La demo è accesa: creata il ${when(status.builtAt)}, ultimo uso il ${when(status.usedAt)}.` : 'La demo si accende alla prima apertura del collegamento (ci mette un paio di secondi).'}</p>
</section>

<section class="card pad">
  <h2>Come usarla</h2>
  <ol class="info-list">
    <li><strong>Aprila in una finestra privata del browser</strong>: finché sei dentro la demo, tutto il sito in quel browser è la demo (compreso <code>/admin</code>, che lì è spento). In una finestra privata il tuo pannello vero resta aperto nell’altra.</li>
    <li>In alto, su ogni pagina, c’è la fascia <strong>«Area dimostrativa»</strong>: <strong>Ricomincia</strong> cancella ciò che hai provato e riparte con dati nuovi; <strong>Esci dalla demo</strong> torna al sito vero. Dopo 8 ore si esce da sola.</li>
    <li>Puoi prenotare, opzionare, annullare, preparare preventivi e pagare con carta (finta): <strong>niente di tutto questo esiste fuori dalla demo</strong>.</li>
  </ol>
</section>

<section class="card pad">
  <h2>Cosa non è vero</h2>
  <ul class="info-list">
    <li><strong>Nessun dato vero</strong>: agenzie, prenotazioni, fatture e contatti della demo si creano da zero ogni volta e vivono solo in memoria. Del sito vero copia soltanto tour, tariffe, testi e immagini.</li>
    <li><strong>Nessuna email</strong> parte (né all’agenzia né a te), nessuna carta viene addebitata, nessuna fattura va a SdI.</li>
    <li><strong>Fatture finte</strong>: partita IVA, codice fiscale, IBAN e indirizzo di chi emette sono inventati e ogni fattura porta la dicitura «documento dimostrativo, nessun valore fiscale».</li>
    <li>Le date seguono il giorno in cui apri la demo («tra 6 giorni», «due settimane fa»): la mattina dopo si rifà da sola.</li>
  </ul>
</section>

<section class="card pad">
  <h2>Cambiare il collegamento</h2>
  <p class="small muted">Se lo hai mandato a qualcuno e non vuoi più che entri, fanne uno nuovo: il vecchio smette di funzionare subito.</p>
  <form method="post" action="/admin/leads/demo/key"><button class="btn btn-sm btn-outline" type="submit">Crea un nuovo collegamento</button></form>
</section>`;
  return adminLayout(ctx, { title: 'Demo per le agenzie', active: '/admin/leads/demo', body, flash });
}
