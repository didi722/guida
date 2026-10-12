import { html } from '../html.js';
import { adminLayout } from './admin.js';

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'long', timeStyle: 'short' });
const daysAgo = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

export function backupPage(ctx, { last, media, dbBytes }) {
  const old = last ? daysAgo(last) : null;
  const body = html`
<div class="card pad">
  <h2>Copia di sicurezza</h2>
  <p class="muted">Tutto ciò che hai nel sito — prenotazioni, clienti, partner, fatture, tour, articoli, pagine, testi, impostazioni e le foto caricate — sta nel server. Una copia scaricata sul tuo computer ti protegge se il server si rompe o se cancelli qualcosa per errore.</p>
  <p>${last ? html`Ultima copia scaricata: <strong>${when(last)}</strong> ${old >= 30 ? html`<span class="chip chip-warn">${old} giorni fa</span>` : ''}` : html`<span class="chip chip-warn">Non hai ancora scaricato nessuna copia</span>`}</p>
  <form method="post" action="/admin/backup/download" class="inline-form"><button class="btn btn-gold" type="submit">Scarica la copia completa (.zip)</button></form>
  <p class="muted small">Il file contiene il database (circa ${kb(dbBytes)}) e ${media.files} ${media.files === 1 ? 'immagine' : 'immagini'} (${kb(media.bytes)}), più i contenuti in formato leggibile e le istruzioni per il ripristino.</p>
</div>
<div class="card pad">
  <h2>Buone abitudini</h2>
  <ul class="plain info-list">
    <li><strong>Scaricala dopo ogni grande modifica</strong> (nuovi tour, tante foto, cambio dei prezzi) e comunque almeno una volta al mese.</li>
    <li><strong>Conservala al sicuro</strong>: contiene dati personali dei clienti. Non inviarla per email e non lasciarla su un computer condiviso.</li>
    <li>Molti hosting fanno anche copie automatiche del disco dei dati: chiedi al tuo se sono attive. La copia che scarichi da qui resta comunque la tua assicurazione.</li>
    <li>Come ripristinarla è scritto nel file <code>LEGGIMI.txt</code> dentro lo zip (e nella guida).</li>
  </ul>
</div>`;
  return adminLayout(ctx, { title: 'Backup', active: '/admin/backup', body });
}
