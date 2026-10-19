import { html, raw } from '../html.js';
import { KEEP_SNAPSHOTS, MODES, RESTORE_WORD } from '../restore.js';
import { adminLayout } from './admin.js';

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'long', timeStyle: 'short' });
const day = (iso) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', year: '2-digit' });
const daysAgo = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const NAME_DATE = /^guida-backup-(\d{4}-\d{2}-\d{2})\.zip$/;
const script = (ctx) => `<script src="/js/admin-restore.js?v=${ctx.app.assetVersion}" defer></script>`;

const hourText = (h) => `${String(h).padStart(2, '0')}:00`;
const dayText = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' });
const STATE_CHIP = { running: ['chip-warn', 'In corso'], error: ['chip-err', 'Non riuscita'], ok: ['chip-ok', 'Attiva'], off: ['', 'Spenta'], none: ['chip-warn', 'Da configurare'] };

/** La copia giornaliera fuori dal server: stato, prove e copie presenti. */
function autoCard(auto) {
  const state = !auto.configured ? 'none' : !auto.enabled ? 'off' : auto.running ? 'running' : auto.lastError ? 'error' : 'ok';
  const [chip, label] = STATE_CHIP[state];
  const copies = auto.destinations.flatMap((d) => (auto.copies[d.id]?.list ?? []).map((c) => ({ ...c, dest: d })).sort((a, b) => b.name.localeCompare(a.name)));
  const setup = html`<details class="auto-how"${auto.configured ? '' : ' open'}>
    <summary>Come si imposta</summary>
    <p class="muted small">La destinazione e le chiavi si scrivono sul server, nelle variabili d’ambiente (come le chiavi di Stripe), e poi si riavvia il servizio. Puoi usarne una o tutte e due.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Variabile</th><th>Cosa scrivere</th></tr></thead><tbody>
      <tr><td><code>BACKUP_DIR</code></td><td>una cartella fuori dal sito: un disco o un NAS montato, per esempio <code>/backups</code> (con Docker, un volume diverso da quello dei dati)</td></tr>
      <tr><td><code>BACKUP_S3_ENDPOINT</code></td><td>l’indirizzo del servizio di archiviazione online, per esempio <code>https://s3.eu-central-003.backblazeb2.com</code> (Backblaze B2, Cloudflare R2, Wasabi, Scaleway, AWS S3…)</td></tr>
      <tr><td><code>BACKUP_S3_BUCKET</code></td><td>il nome del bucket (<strong>privato</strong>)</td></tr>
      <tr><td><code>BACKUP_S3_REGION</code></td><td>la regione del bucket, per esempio <code>eu-central-003</code> (per Cloudflare R2: <code>auto</code>)</td></tr>
      <tr><td><code>BACKUP_S3_ACCESS_KEY</code> · <code>BACKUP_S3_SECRET_KEY</code></td><td>la chiave di accesso e il suo segreto, creati solo per questo bucket (lettura, scrittura, elenco)</td></tr>
      <tr><td><code>BACKUP_S3_PREFIX</code></td><td>facoltativa: la «cartella» nel bucket (di base <code>guida/</code>)</td></tr>
      <tr><td><code>BACKUP_S3_PATH_STYLE</code></td><td>facoltativa: <code>true</code> di base; <code>false</code> se il servizio vuole l’indirizzo <code>bucket.servizio</code></td></tr>
    </tbody></table></div>
    <p class="muted small">La copia contiene i dati personali dei clienti: usa un bucket <strong>non pubblico</strong>, con una chiave limitata a quel bucket, in un’area europea e con la cifratura a riposo del servizio attiva. Dopo aver impostato le variabili, torna qui e tocca <strong>Prova la connessione</strong>.</p>
  </details>`;
  if (!auto.configured) {
    return html`<div class="card pad" id="copia-automatica" data-auto>
  <h2>Copia giornaliera fuori dal server <span class="chip ${chip}">${label}</span></h2>
  <p>Ogni notte il sito può fare da solo una copia completa e metterla <strong>fuori dal server</strong>: se il server si rompe, o l’hosting chiude l’account, i dati sono salvi altrove. Oggi non c’è nessuna destinazione indicata sul server: finché non la imposti, resta la copia che scarichi a mano qui sotto.</p>
  ${setup}
</div>`;
  }
  return html`<div class="card pad" id="copia-automatica" data-auto ${auto.running ? raw('data-auto-running') : ''}>
  <h2>Copia giornaliera fuori dal server <span class="chip ${chip}">${label}</span></h2>
  <ul class="plain info-list">
    <li><strong>Dove</strong>: ${auto.destinations.map((d, i) => html`${i ? ' · ' : ''}${d.label} <code>${d.where}</code>`)}</li>
    <li><strong>Quando</strong>: ${auto.enabled ? html`ogni giorno alle <strong>${hourText(auto.hour)}</strong> (ora di Venezia)${auto.next ? html` · prossima ${auto.next.soon ? html`<strong>a momenti</strong>` : html`<strong>${dayText(auto.next.date)}</strong> alle ${hourText(auto.next.hour)}`}` : ''}` : html`<strong>spenta</strong>`} · <a href="/admin/settings?s=backup#backup">Cambia orario e quante copie tenere</a></li>
    <li><strong>Quante ne tengo</strong>: le ultime ${auto.keepDays}${auto.keepMonths ? html` e la più vecchia di ognuno degli ultimi ${auto.keepMonths} mesi` : ''}; le altre si cancellano da sole.</li>
    <li><strong>Ultima copia riuscita</strong>: ${auto.lastOk ? html`${when(auto.lastOk.at)} · ${kb(auto.lastOk.bytes)} · ${Math.max(1, Math.round(auto.lastOk.ms / 1000))} s` : html`<span class="muted">ancora nessuna</span>`}</li>
  </ul>
  ${auto.running ? html`<div class="notice notice-info" role="status">Copia in corso: può durare qualche minuto. Questa pagina si aggiorna da sola.</div>` : ''}
  ${auto.lastError && !auto.running ? html`<div class="notice notice-err" role="alert"><strong>L’ultima copia non è riuscita</strong> (${when(auto.lastError.at)}): ${auto.lastError.message} <br>Il sito riprova da solo; intanto scarica una copia a mano qui sotto.</div>` : ''}
  ${auto.lastOk?.warnings?.length ? html`<div class="notice notice-info">${auto.lastOk.warnings.join(' ')}</div>` : ''}
  <div class="btn-row">
    <form method="post" action="/admin/backup/auto/run"><button class="btn btn-gold" type="submit" ${auto.running ? raw('disabled') : ''}>Esegui una copia adesso</button></form>
    <form method="post" action="/admin/backup/auto/test"><button class="btn btn-outline" type="submit" ${auto.running ? raw('disabled') : ''}>Prova la connessione</button></form>
  </div>
  ${auto.lastTest ? html`<ul class="plain info-list auto-test"><li class="muted small">Prova del ${when(auto.lastTest.at)}:</li>${auto.lastTest.results.map((r) => html`<li>${r.ok ? html`<span class="chip chip-ok">Funziona</span>` : html`<span class="chip chip-err">Non funziona</span>`} ${r.label} <code>${r.where}</code>${r.ok ? '' : html`<br><span class="field-error">${r.error}</span>`}</li>`)}</ul>` : ''}
  <h3>Copie presenti</h3>
  ${copies.length
    ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Copia del</th><th>Dove</th><th class="num">Dimensione</th><th></th></tr></thead><tbody>
      ${copies.map((c) => html`<tr><td>${day(`${NAME_DATE.exec(c.name)[1]}T12:00:00Z`)}</td><td>${c.dest.label}</td><td class="num">${kb(c.bytes)}</td><td class="actions"><a class="btn btn-sm btn-outline" href="/admin/backup/auto/download?dest=${c.dest.id}&amp;name=${c.name}">Scarica</a></td></tr>`)}
    </tbody></table></div>`
    : html`<p class="muted">Nessuna copia nell’elenco: compare dopo la prima copia, oppure con <em>Aggiorna l’elenco</em>.</p>`}
  <form method="post" action="/admin/backup/auto/refresh" class="inline-form"><button class="btn btn-sm btn-outline" type="submit">Aggiorna l’elenco</button> ${auto.destinations.map((d) => (auto.copies[d.id]?.at ? html`<span class="muted small">${d.label}: elenco del ${when(auto.copies[d.id].at)}</span> ` : ''))}${auto.destinations.map((d) => (auto.copiesError?.[d.id] ? html`<span class="field-error">${d.label}: ${auto.copiesError[d.id]}</span> ` : ''))}</form>
  <p class="muted small">Per ripristinare una di queste copie: <strong>Scarica</strong>, poi qui sotto <em>Ripristina da una copia</em>. ${setup}</p>
</div>`;
}

export function backupPage(ctx, { last, media, dbBytes, snapshots = [], lastRestore = null, auto = null, flash = '', error = '' }) {
  const old = last ? daysAgo(last) : null;
  const body = html`
${auto ? autoCard(auto) : ''}
<div class="card pad">
  <h2>Copia di sicurezza</h2>
  <p class="muted">Tutto ciò che hai nel sito — prenotazioni, clienti, partner, fatture, tour, articoli, pagine, testi, impostazioni e le foto caricate — sta nel server. Una copia scaricata sul tuo computer ti protegge se il server si rompe o se cancelli qualcosa per errore.</p>
  <p>${last ? html`Ultima copia scaricata: <strong>${when(last)}</strong> ${old >= 30 ? html`<span class="chip chip-warn">${old} giorni fa</span>` : ''}` : html`<span class="chip chip-warn">Non hai ancora scaricato nessuna copia</span>`}</p>
  <form method="post" action="/admin/backup/download" class="inline-form"><button class="btn btn-gold" type="submit">Scarica la copia completa (.zip)</button></form>
  <p class="muted small">Il file contiene il database (circa ${kb(dbBytes)}) e ${media.files} ${media.files === 1 ? 'immagine' : 'immagini'} (${kb(media.bytes)}), più i contenuti in formato leggibile e le istruzioni per il ripristino.</p>
</div>
<div class="card pad" id="ripristino">
  <h2>Ripristina da una copia</h2>
  <p class="muted">Hai uno zip scaricato da questa pagina? Puoi rimettere il sito com’era quel giorno: tutto, oppure solo i contenuti (tour e prezzi, articoli, pagine, testi, foto).</p>
  <p><strong>Non cambia nulla finché non confermi.</strong> Prima controllo il file e ti mostro cosa cambierebbe; poi, prima di sostituire i dati, salvo da solo una copia di sicurezza per poter tornare indietro.</p>
  <div data-restore-upload>
    <div class="restore-pick">
      <input type="file" accept=".zip,application/zip" data-restore-input aria-label="File della copia (.zip)">
      <button class="btn btn-gold" type="button" data-restore-send disabled>Carica e controlla</button>
    </div>
    <p class="muted small" data-restore-status role="status" aria-live="polite"></p>
  </div>
  <p class="muted small">Meglio farlo quando nessuno sta prenotando (per esempio la sera). Serve JavaScript attivo.</p>
  ${lastRestore ? html`<p class="small">Ultimo ripristino: <strong>${when(lastRestore.at)}</strong> · ${MODES[lastRestore.mode]?.label.toLowerCase() ?? lastRestore.mode}${lastRestore.backupAt ? html`, da una copia del ${when(lastRestore.backupAt)}` : ''}.</p>` : ''}
</div>
${snapshots.length
  ? html`<div class="card pad">
  <h2>Copie salvate prima di un ripristino</h2>
  <p class="muted">Prima di ogni ripristino il sito salva da solo com’era (tengo le ultime ${KEEP_SNAPSHOTS}). Se hai ripristinato la copia sbagliata, da qui puoi tornare indietro: <strong>Torna a questa versione</strong> ti mostra prima cosa cambierebbe, come per ogni ripristino.</p>
  <div class="table-wrap"><table class="table"><thead><tr><th>Salvata il</th><th>Prima di</th><th></th></tr></thead><tbody>
  ${snapshots.map((s) => html`<tr><td>${when(s.at)}</td><td>${MODES[s.mode]?.label ?? s.mode}</td>
    <td class="actions"><form method="post" action="/admin/backup/snapshots/${s.id}/stage"><button class="btn btn-sm btn-gold" type="submit">Torna a questa versione</button></form>
    <form method="post" action="/admin/backup/snapshots/${s.id}/download"><button class="btn btn-sm btn-outline" type="submit">Scarica (.zip)</button></form></td></tr>`)}
  </tbody></table></div>
  <p class="muted small">Contengono dati personali dei clienti, come ogni copia.</p>
</div>`
  : ''}
<div class="card pad">
  <h2>Buone abitudini</h2>
  <ul class="plain info-list">
    <li><strong>Scaricala dopo ogni grande modifica</strong> (nuovi tour, tante foto, cambio dei prezzi) e comunque almeno una volta al mese.</li>
    <li><strong>Conservala al sicuro</strong>: contiene dati personali dei clienti. Non inviarla per email e non lasciarla su un computer condiviso.</li>
    <li>Molti hosting fanno anche copie automatiche del disco dei dati: chiedi al tuo se sono attive. La copia che scarichi da qui resta comunque la tua assicurazione.</li>
    <li>Per ripristinarla usa «Ripristina da una copia» qui sopra. Le istruzioni per farlo a mano sul server sono nel file <code>LEGGIMI.txt</code> dentro lo zip e nella guida.</li>
  </ul>
</div>`;
  return adminLayout(ctx, { title: 'Backup', active: '/admin/backup', body, flash, error, scripts: script(ctx) + (auto?.running ? `<script src="/js/admin-backup-auto.js?v=${ctx.app.assetVersion}" defer></script>` : '') });
}

// ───────────── controllo prima di ripristinare ─────────────

const GROUPS = [
  { title: 'Contenuti', note: 'li cambia anche «Solo i contenuti»', rows: [['tours', 'Tour'], ['posts', 'Articoli del blog'], ['pages', 'Pagine'], ['texts', 'Testi modificati'], ['media', 'Immagini']] },
  { title: 'Prenotazioni e conti', note: 'li cambia solo «Tutto»', rows: [['bookings', 'Prenotazioni'], ['accounts', 'Partner'], ['gifts', 'Buoni regalo'], ['programs', 'Programmi'], ['invoices', 'Fatture emesse'], ['feedback', 'Feedback']] },
];
const LOST = {
  bookings: ['prenotazione', 'prenotazioni'],
  gifts: ['buono regalo', 'buoni regalo'],
  programs: ['programma', 'programmi'],
  accounts: ['partner', 'partner'],
  invoices: ['fattura emessa', 'fatture emesse'],
  feedback: ['feedback', 'feedback'],
  promos: ['codice sconto', 'codici sconto'],
};

export function restorePreviewPage(ctx, { token, data, error = '' }) {
  const { meta, now, then, all, content } = data;
  const tourName = (slug) => ctx.app.content.tour?.(slug)?.i18n?.it?.title ?? slug;
  const postName = (slug) => {
    const post = ctx.app.content.postAny?.(slug);
    return (post && Object.values(post.i18n)[0]?.title) || slug;
  };
  const names = (list, name) => `${list.slice(0, 5).map(name).join(', ')}${list.length > 5 ? ` e altri ${list.length - 5}` : ''}`;
  /** Sotto il numero: la data dell'ultima prenotazione, il numero dell'ultima fattura. */
  const latest = (key, side) => {
    if (key === 'bookings' && side.lastBooking) return html`<br><small class="muted">ultima: ${day(side.lastBooking)}</small>`;
    if (key === 'invoices' && side.lastInvoice) return html`<br><small class="muted">ultima: n. ${side.lastInvoice}</small>`;
    return '';
  };

  const lostList = Object.entries(all.lost).filter(([, n]) => n > 0).map(([key, n]) => plural(n, ...LOST[key]));
  const contentNotes = [
    then.counts.tours === 0 ? html`<li class="warn">La copia non contiene nessun tour: il sito resterebbe senza tour da prenotare.</li>` : '',
    content.keptTours.length ? html`<li>Restano come sono adesso, perché hanno delle prenotazioni e la copia non li conosce: <strong>${names(content.keptTours, tourName)}</strong>.</li>` : '',
    content.lostTours.length ? html`<li class="warn">Spariscono i tour creati dopo la copia: <strong>${names(content.lostTours, tourName)}</strong>.</li>` : '',
    content.lostPosts.length ? html`<li class="warn">Spariscono gli articoli scritti dopo la copia: <strong>${names(content.lostPosts, postName)}</strong>.</li>` : '',
    meta.media.missing ? html`<li class="warn">${plural(meta.media.missing, 'immagine citata', 'immagini citate')} dalla copia non ${meta.media.missing === 1 ? 'è' : 'sono'} nello zip: dove servono comparirà un buco.</li>` : '',
    meta.media.skipped ? html`<li>${plural(meta.media.skipped, 'file dello zip non era', 'file dello zip non erano')} un’immagine valida e l${meta.media.skipped === 1 ? 'o' : 'i'} ho ignorat${meta.media.skipped === 1 ? 'o' : 'i'}.</li>` : '',
    !content.keptTours.length && !content.lostTours.length && !content.lostPosts.length ? html`<li>Nessun tour o articolo di adesso andrebbe perso. Le foto che hai già restano in libreria.</li>` : '',
  ];
  const allNotes = [
    lostList.length ? html`<li class="warn">Sparirebbero dal pannello, perché fatti o creati dopo la copia: <strong>${lostList.join(', ')}</strong>.</li>` : html`<li>Non c’è niente di più recente della copia: nessun dato andrebbe perso.</li>`,
    all.lost.bookings > 0 ? html`<li>I pagamenti già incassati per quelle prenotazioni restano su Stripe, ma il sito non le conoscerebbe più: dovresti ricontrollarle e rimetterle a mano.</li>` : '',
    all.lost.invoices > 0 ? html`<li class="warn"><strong>Fatture:</strong> con «Tutto» sparirebbero dal sito e la numerazione ripartirebbe dall’ultima della copia${then.lastInvoice ? ` (n. ${then.lastInvoice})` : ''}. Rifare una fattura con lo stesso numero è un problema fiscale: se quelle fatture sono già state mandate al cliente o a SdI, scegli «Solo i contenuti».</li>` : '',
    meta.upgraded ? html`<li>La copia è di una versione precedente del sito: la aggiorno io prima di usarla.</li>` : '',
    html`<li>Se tra la data della copia e adesso sono partite email automatiche (promemoria, richiesta di recensione, buono regalo), qualche cliente potrebbe riceverle di nuovo.</li>`,
  ];

  const body = html`
<div class="card pad">
  <h2>Controlla prima di ripristinare</h2>
  <p>${meta.source === 'snapshot' ? html`Copia di sicurezza automatica` : html`Copia`}${meta.backupAt ? html` del <strong>${when(meta.backupAt)}</strong>` : html` <span class="muted">(lo zip non dice quando è stata fatta)</span>`}. <span class="chip chip-ok">controllata: è una copia valida di questo sito</span></p>
  <p class="muted"><strong>Per ora non è cambiato niente.</strong> Qui vedi cosa c’è adesso nel sito e cosa c’è nella copia.</p>
  <table class="compare-table"><thead><tr><th scope="col">Cosa</th><th scope="col">Adesso</th><th scope="col">Nella copia</th></tr></thead><tbody>
  ${GROUPS.map((g) => html`<tr class="compare-group"><th colspan="3" scope="colgroup">${g.title} <small class="muted">· ${g.note}</small></th></tr>
    ${g.rows.map(([key, label]) => html`<tr class="${now.counts[key] === then.counts[key] ? '' : 'diff'}"><th scope="row">${label}</th><td>${now.counts[key]}${latest(key, now)}</td><td>${then.counts[key]}${latest(key, then)}</td></tr>`)}`)}
  </tbody></table>
</div>
<form method="post" action="/admin/backup/restore/${token}" class="card pad form restore-form" data-restore-form>
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  <h2>Cosa vuoi ripristinare?</h2>
  <div class="mode-option">
    <input type="radio" id="mode-content" name="mode" value="content" checked>
    <div class="mode-body">
      <label for="mode-content"><strong>Solo i contenuti</strong> <span class="chip chip-ok">consigliato</span></label>
      <p>Per tornare indietro dopo una modifica sbagliata. Tour e prezzi, articoli, pagine, testi del sito e foto tornano come nella copia. <strong>Prenotazioni, clienti, partner, buoni regalo, fatture, feedback, orari e impostazioni non cambiano.</strong></p>
      <ul class="info-list">${contentNotes}</ul>
    </div>
  </div>
  <div class="mode-option">
    <input type="radio" id="mode-all" name="mode" value="all">
    <div class="mode-body">
      <label for="mode-all"><strong>Tutto</strong></label>
      <p>Per rimettere in piedi il sito dopo un guasto o su un server nuovo. Sostituisce ogni dato: anche prenotazioni, clienti, partner, buoni regalo, fatture, feedback, orari e impostazioni.</p>
      <ul class="info-list">${allNotes}</ul>
    </div>
  </div>
  <p class="muted small">Prima di cambiare qualcosa salvo una copia di sicurezza automatica: se cambi idea la ritrovi in Aiuto › Backup, con il pulsante «Torna a questa versione».</p>
  <label class="field"><span class="label">Per confermare scrivi <strong>${RESTORE_WORD}</strong></span>
    <input type="text" name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" required data-restore-confirm></label>
  <div class="btn-row">
    <button class="btn btn-danger" type="submit" data-restore-submit>Ripristina</button>
    <button class="btn btn-outline" type="submit" formaction="/admin/backup/restore/${token}/cancel" formnovalidate>Annulla, non cambiare niente</button>
  </div>
</form>`;
  return adminLayout(ctx, { title: 'Ripristina da una copia', active: '/admin/backup', body, scripts: script(ctx) });
}
