// Pannello › Commerciale › Email, Modelli e Importa: scrivere a un contatto, mettere in coda la presentazione per più agenzie, la coda e lo storico, i modelli, l'importazione di un elenco.
import { html, raw } from '../html.js';
import { LANGS, LANG_META } from '../langs.js';
import { IMPORT_COLUMNS, IMPORT_WARNING, MAX_IMPORT_ROWS } from '../leads.js';
import { SEND_LABEL, TEMPLATE_HINT, TEMPLATE_KEYS, TEMPLATE_LABEL, VARIABLES } from '../leadMail.js';
import { fmtDate } from '../time.js';
import { adminLayout } from './admin.js';
import { statusChip } from './admin-leads.js';

const when = (iso) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const sel = (cond) => (cond ? raw('selected') : '');
const day = (d) => fmtDate(d, 'it', 'short');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const langSelect = (name, value, { auto = false } = {}) => html`<select name="${name}">${auto ? html`<option value="">Come l’agenzia</option>` : ''}${LANGS.map((l) => html`<option value="${l}" ${sel(value === l)}>${LANG_META[l].name}</option>`)}</select>`;
const FOOT_NOTE = 'In fondo a ogni email il sito aggiunge da solo chi scrive e il link per non ricevere altre email: non si può togliere.';

// ───────────── scrivere a un contatto ─────────────
/**
 * @param {object} o lead, recipients ({key, contactId, name, email, lang}[]), pick (la chiave del destinatario scelto), template, lang, compose ({to, subject, body}), settings
 */
export function composePage(ctx, { lead, recipients, pick, template, lang, compose, settings, flash = '', error = '' }) {
  const r = recipients.find((x) => x.key === pick) ?? recipients[0];
  const body = html`
<p class="back-link"><a href="/admin/leads/${lead.id}">← ${lead.company}</a></p>
<form class="card pad form lead-compose-pick" method="get" action="/admin/leads/${lead.id}/mail">
  <h2>Scrivi a ${lead.company}</h2>
  <div class="form-grid">
    <label class="field"><span class="label">A chi</span><select name="to" data-autosubmit>${recipients.map((x) => html`<option value="${x.key}" ${sel(x.key === pick)}>${x.name ? `${x.name} — ` : 'Indirizzo dell’agenzia — '}${x.email}</option>`)}</select></label>
    <label class="field"><span class="label">Modello</span><select name="t" data-autosubmit>${TEMPLATE_KEYS.map((k) => html`<option value="${k}" ${sel(template === k)}>${TEMPLATE_LABEL[k]}</option>`)}</select></label>
    <label class="field"><span class="label">Lingua</span><select name="l" data-autosubmit>${LANGS.map((x) => html`<option value="${x}" ${sel(lang === x)}>${LANG_META[x].name}</option>`)}</select></label>
  </div>
  <p class="small muted">${TEMPLATE_HINT[template]} Cambiando modello o lingua il testo si rifà da capo. <noscript><button class="btn btn-sm btn-outline" type="submit">Aggiorna il testo</button></noscript></p>
</form>
<form class="card pad form" method="post" action="/admin/leads/${lead.id}/mail">
  <input type="hidden" name="contactId" value="${r.contactId ?? ''}"><input type="hidden" name="to" value="${r.email}"><input type="hidden" name="template" value="${template}"><input type="hidden" name="lang" value="${lang}">
  <p class="lead-dest"><span class="label">Destinatario</span><strong>${r.email}</strong>${r.name ? ` · ${r.name}` : ''}</p>
  <label class="field"><span class="label">Oggetto</span><input name="subject" required maxlength="200" value="${compose.subject}"></label>
  <label class="field"><span class="label">Testo <em>(puoi cambiarlo prima di inviare)</em></span><textarea name="body" required rows="20" maxlength="8000" class="lead-body">${compose.body}</textarea></label>
  <p class="small muted">${FOOT_NOTE}</p>
  <fieldset class="lead-when"><legend class="label">Quando</legend>
    <label class="check"><input type="radio" name="when" value="now" checked> Invia ora</label>
    <label class="check"><input type="radio" name="when" value="queue"> Mettila in coda: parte da sola nei giorni lavorativi, dalle ${settings.fromHour} alle ${settings.toHour}</label>
    <label class="check"><input type="radio" name="when" value="date"> Programmala per il giorno <input type="date" name="sendDate" class="lead-date"></label></fieldset>
  ${template === 'presentation' || template === 'thanks'
    ? html`<label class="check"><input type="checkbox" name="followup" value="1" ${settings.autoFollowUp ? raw('checked') : ''}> <span>Se non risponde, manda un <strong>sollecito</strong> dopo <input type="number" name="followupDays" min="2" max="60" value="${settings.followUpDays}" class="lead-days"> giorni <em class="muted">(parte solo se nel frattempo nulla è cambiato; ne parte uno solo)</em></span></label>`
    : ''}
  <div class="btn-row"><button class="btn btn-gold" type="submit" name="action" value="send">Invia</button><button class="btn btn-outline" type="submit" name="action" value="preview">Mandami un’anteprima</button><a class="btn btn-outline" href="/admin/leads/${lead.id}">Annulla</a></div>
</form>`;
  return adminLayout(ctx, { title: 'Scrivi', active: '/admin/leads', body, flash, error });
}

// ───────────── la presentazione (o il sollecito) a più agenzie ─────────────
/**
 * @param {object} o items ({lead, to, lang, problem, contactId, last, followedUp}), settings, template ('presentation' | 'followup')
 */
export function bulkReviewPage(ctx, { items, settings, ret = '', error = '', template = 'presentation' }) {
  const followup = template === 'followup';
  const ready = items.filter((i) => !i.problem).length;
  const days = Math.max(1, Math.ceil(ready / settings.dailyCap));
  // l'ultima email partita: aiuta a capire se un sollecito ha senso (mai scritto prima? già sollecitata?)
  const lastLine = (i) => (i.last ? html`<small class="muted">${TEMPLATE_LABEL[i.last.template] ?? i.last.template} il ${day(i.last.sent_at.slice(0, 10))}</small>` : html`<small class="muted">nessuna email inviata finora</small>`);
  const note = (i) => (i.followedUp ? html`<br><small class="field-error">sollecito già inviato il ${day(i.followedUp.slice(0, 10))}</small>` : '');
  const body = html`
<p class="back-link"><a href="/admin/leads${ret}">← Torna all’elenco</a></p>
<form class="card pad form" method="post" action="/admin/leads/bulk/queue">
  <input type="hidden" name="return" value="${ret}"><input type="hidden" name="template" value="${template}">
  <h2>${followup ? 'Sollecito' : 'Presentazione'} a ${plural(items.length, 'agenzia', 'agenzie')}</h2>
  <p class="muted">Controlla chi ${followup ? 'lo' : 'la'} riceve e in che lingua: ogni email usa il <a href="/admin/leads/templates">modello «${TEMPLATE_LABEL[template]}»</a> con il nome dell’agenzia e del referente. Vengono messe <strong>in coda</strong> e partono da sole, nei giorni lavorativi dalle ${settings.fromHour} alle ${settings.toHour}, al massimo ${settings.dailyCap} al giorno (con una pausa di ${settings.minGapMin} minuti): ${ready ? `${plural(ready, 'email', 'email')} in circa ${plural(days, 'giorno', 'giorni')}` : 'nessuna da inviare'}. Puoi annullarle una per una da <a href="/admin/leads/mail">Email</a>.${followup ? ' Un sollecito parte solo se nel frattempo l’agenzia non ha risposto: se il contatto è andato avanti (in trattativa, cliente…) viene saltato da solo.' : ''}</p>
  <div class="card table-wrap"><table class="table"><thead><tr><th aria-label="Includi"></th><th>Agenzia</th><th>Scrivo a</th><th>Ultima email</th><th>Lingua</th></tr></thead><tbody>
  ${items.map((i) => html`<tr class="${i.problem ? 'is-skip' : ''}">
    <td class="lead-check">${i.problem ? '' : html`<input type="checkbox" name="ids" value="${i.lead.id}" checked aria-label="Includi ${i.lead.company}">`}</td>
    <td><a href="/admin/leads/${i.lead.id}">${i.lead.company}</a><br>${statusChip(i.lead.status)}${i.lead.last_contact_on ? html` <small class="muted">ultimo contatto il ${day(i.lead.last_contact_on)}</small>` : ''}</td>
    <td>${i.problem ? html`<span class="field-error">${i.problem}</span>` : html`${i.to}${i.name ? html`<br><small class="muted">${i.name}</small>` : ''}`}</td>
    <td>${i.problem ? '' : html`${lastLine(i)}${note(i)}`}</td>
    <td>${i.problem ? '' : html`<select name="lang_${i.lead.id}" aria-label="Lingua per ${i.lead.company}">${LANGS.map((l) => html`<option value="${l}" ${sel(i.lang === l)}>${LANG_META[l].name}</option>`)}</select>`}</td></tr>`)}
  </tbody></table></div>
  ${followup
    ? ''
    : html`<label class="check"><input type="checkbox" name="followup" value="1" ${settings.autoFollowUp ? raw('checked') : ''}> <span>Se non rispondono, manda un <strong>sollecito</strong> dopo <input type="number" name="followupDays" min="2" max="60" value="${settings.followUpDays}" class="lead-days"> giorni <em class="muted">(solo a chi non ha fatto nulla nel frattempo)</em></span></label>`}
  <p class="small muted">${FOOT_NOTE}</p>
  <div class="btn-row"><button class="btn btn-gold" type="submit" ${ready ? '' : raw('disabled')}>Metti in coda ${ready ? plural(ready, 'email', 'email') : ''}</button><a class="btn btn-outline" href="/admin/leads${ret}">Annulla</a></div>
</form>`;
  return adminLayout(ctx, { title: followup ? 'Sollecito' : 'Presentazione', active: '/admin/leads', body, error });
}

// ───────────── coda e storico ─────────────
const STATE = { queued: ['chip-warn', 'In coda'], sent: ['chip-ok', 'Inviata'], failed: ['chip-err', 'Non partita'], cancelled: ['chip-done', 'Annullata'], skipped: ['chip-done', 'Saltata'] };

export function mailPage(ctx, { queue, history, settings, sender, notifyTo = '', sentToday, flash = '', error = '' }) {
  const body = html`
<div class="kpis">
  <div class="kpi"><span class="kpi-l">In coda</span><strong class="kpi-n">${queue.length}</strong><span class="kpi-s">${settings.paused ? 'invio in pausa' : queue.length ? 'partono da sole' : 'nessuna'}</span></div>
  <div class="kpi"><span class="kpi-l">Inviate oggi</span><strong class="kpi-n">${sentToday}</strong><span class="kpi-s">tetto: ${settings.dailyCap} al giorno</span></div>
  <div class="kpi ${settings.paused ? 'kpi-warn' : ''}"><span class="kpi-l">Invio automatico</span><strong class="kpi-n">${settings.paused ? 'In pausa' : 'Attivo'}</strong>
    <form method="post" action="/admin/leads/mail/${settings.paused ? 'resume' : 'pause'}"><button class="btn btn-sm btn-outline" type="submit">${settings.paused ? 'Riprendi' : 'Metti in pausa'}</button></form></div>
</div>
<section class="card pad lead-card" id="mittente"><h2>Da quale indirizzo partono</h2>
  <p>Adesso le email commerciali partono da <strong>${sender.label}</strong>${sender.replyTo ? html`; chi risponde scrive a <strong>${sender.replyTo}</strong>` : html`; chi risponde scrive allo stesso indirizzo`}${sender.bcc ? html`; ne ricevi una copia nascosta a <strong>${sender.bcc}</strong>` : ''}. ${sender.transport === 'sales' ? 'Usano la loro posta (SALES_SMTP_*), separata dalle conferme.' : 'Usano la stessa posta delle conferme di prenotazione.'}</p>
  ${sender.own ? '' : html`<div class="notice notice-info" role="note">Partono dallo <strong>stesso mittente delle conferme</strong>: le risposte arrivano a ${sender.replyTo ?? 'chi le legge per quell’indirizzo'} solo se chi scrive usa «Rispondi». Meglio un indirizzo che leggi tu, per esempio <strong>info@</strong> del tuo dominio.</div>`}
  <form class="form" method="post" action="/admin/leads/mail/sender">
    <div class="form-grid">
      <label class="field"><span class="label">Indirizzo mittente <em>(es. info@tuodominio.it)</em></span><input type="email" name="fromEmail" maxlength="254" value="${settings.fromEmail ?? ''}" placeholder="vuoto = lo stesso delle conferme" autocomplete="off"></label>
      <label class="field"><span class="label">Nome mostrato <em>(vuoto = il nome del sito)</em></span><input name="fromName" maxlength="80" value="${settings.fromName ?? ''}" autocomplete="off"></label>
      <label class="field"><span class="label">Rispondi a <em>(facoltativo)</em></span><input type="email" name="replyTo" maxlength="254" value="${settings.replyTo ?? ''}" placeholder="vuoto = il mittente" autocomplete="off"></label>
      <label class="field"><span class="label">Copia nascosta a <em>(facoltativo)</em></span><input type="email" name="bcc" maxlength="254" value="${settings.bcc ?? ''}" placeholder="es. la tua casella, per ritrovarle" autocomplete="off"></label>
    </div>
    <details class="lead-more"><summary>Come scegliere</summary>
      <ul class="info-list">
        <li>Se il servizio con cui parte la posta del sito ha <strong>verificato il tuo dominio</strong> (per esempio <code>tuodominio.it</code>), di solito accetta ogni indirizzo di quel dominio: scrivi qui <code>info@tuodominio.it</code> e basta.</li>
        <li>Se <code>info@</code> è una casella con <strong>le sue credenziali SMTP</strong> (il tuo hosting, Google Workspace…) e vuoi che le email partano proprio da lì, mettile in <code>SALES_SMTP_HOST</code>, <code>SALES_SMTP_USER</code> e <code>SALES_SMTP_PASS</code> sul server: le commerciali useranno quella posta e le conferme restano separate (vedi la guida).</li>
        <li>Se <code>info@</code> è solo un <strong>inoltro</strong> (per esempio verso Posteo), usalo comunque come mittente: le risposte arrivano nella tua casella.</li>
        <li>L’indirizzo deve avere <strong>SPF e DKIM</strong> in regola presso chi spedisce, altrimenti le email finiscono nello spam. La <strong>copia nascosta</strong> ti fa trovare nella tua posta ciò che hai mandato, insieme alle risposte.</li>
      </ul></details>
    <div class="btn-row"><button class="btn btn-gold" type="submit">Salva il mittente</button></div></form>
  <form class="form lead-b2b" method="post" action="/admin/leads/mail/sender-test"><h3>Prova di invio</h3>
    <p class="small muted">Manda un messaggio di prova dal mittente scelto. Se non arriva, il server di posta non lo accetta e qui vedi il motivo (di solito: il mittente non è consentito, o SPF/DKIM mancano).</p>
    <div class="lead-search"><label class="field"><span class="label">A</span><input type="email" name="to" required maxlength="254" value="${notifyTo}" autocomplete="off"></label><button class="btn btn-outline" type="submit">Invia una prova da qui</button></div></form></section>
<section class="card pad lead-card"><h2>In coda</h2>
${queue.length
  ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Parte</th><th>Agenzia</th><th>Oggetto</th><th>Tipo</th><th aria-label="Azioni"></th></tr></thead><tbody>
  ${queue.map((e) => html`<tr><td>${e.eta ? html`circa ${when(e.eta)}` : settings.paused ? 'in pausa' : when(e.send_after)}</td><td><a href="/admin/leads/${e.lead_id}">${e.company}</a><br><small class="muted">${e.to_email}</small></td><td>${e.subject}</td>
    <td>${TEMPLATE_LABEL[e.template] ?? e.template}${e.only_if_quiet ? html`<br><small class="muted">solo se non risponde</small>` : ''}</td>
    <td class="actions"><form method="post" action="/admin/leads/mail/${e.id}/cancel"><button class="btn btn-sm btn-outline" type="submit">Annulla</button></form></td></tr>`)}</tbody></table></div>
  <p class="small muted">Partono da sole dal lunedì al venerdì, dalle ${settings.fromHour} alle ${settings.toHour} (ora di Venezia), una alla volta con una pausa di ${settings.minGapMin} minuti, fino a ${settings.dailyCap} al giorno. Prima di ogni invio il sito ricontrolla: se l’agenzia non vuole email, ha risposto o è diventata cliente, quella email salta.</p>`
  : html`<p class="muted">Nessuna email in coda. Dalla scheda di un contatto, o selezionando più agenzie nell’<a href="/admin/leads">elenco</a>, puoi metterne in coda.</p>`}</section>
<section class="card pad lead-card"><h2>Come e quando partono</h2>
<form class="form" method="post" action="/admin/leads/mail/settings">
  <div class="form-grid">
    <label class="field"><span class="label">${SEND_LABEL.dailyCap}</span><input type="number" name="dailyCap" min="1" max="100" required value="${settings.dailyCap}"></label>
    <label class="field"><span class="label">${SEND_LABEL.minGapMin} <em>(minuti)</em></span><input type="number" name="minGapMin" min="1" max="120" required value="${settings.minGapMin}"></label>
    <label class="field"><span class="label">${SEND_LABEL.fromHour}</span><input type="number" name="fromHour" min="0" max="23" required value="${settings.fromHour}"></label>
    <label class="field"><span class="label">${SEND_LABEL.toHour}</span><input type="number" name="toHour" min="1" max="24" required value="${settings.toHour}"></label>
    <label class="field"><span class="label">${SEND_LABEL.followUpDays}</span><input type="number" name="followUpDays" min="2" max="60" required value="${settings.followUpDays}"></label>
    <label class="check"><input type="checkbox" name="autoFollowUp" value="1" ${settings.autoFollowUp ? raw('checked') : ''}> <span>Proponi il sollecito automatico già spuntato</span></label>
  </div>
  <label class="field"><span class="label">Firma <em>(vuota = nome, abilitazione e recapiti dalle <a href="/admin/settings?s=business#business">Impostazioni</a>)</em></span><textarea name="signature" rows="4" maxlength="600">${settings.signature}</textarea></label>
  <p class="small muted">Un tetto basso protegge la reputazione della tua posta: le email di presentazione partono dallo stesso indirizzo delle conferme di prenotazione. Se le agenzie le segnalano come spam, anche le conferme possono finire nella posta indesiderata.</p>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva</button></div></form></section>
<section class="card pad lead-card"><h2>Ultime email</h2>
${history.length
  ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Stato</th><th>Agenzia</th><th>Oggetto</th><th>Quando</th></tr></thead><tbody>
  ${history.map((e) => {
    const [chip, label] = STATE[e.status] ?? ['', e.status];
    return html`<tr><td><span class="chip ${chip}">${label}</span></td><td><a href="/admin/leads/${e.lead_id}">${e.company}</a><br><small class="muted">${e.to_email}</small></td><td>${e.subject}<br><small class="muted">${TEMPLATE_LABEL[e.template] ?? e.template}${e.note ? ` · ${e.note}` : ''}</small></td><td>${when(e.sent_at ?? e.created_at)}</td></tr>`;
  })}</tbody></table></div>`
  : html`<p class="muted">Ancora nessuna email.</p>`}</section>`;
  return adminLayout(ctx, { title: 'Email commerciali', active: '/admin/leads/mail', body, flash, error });
}

// ───────────── i modelli ─────────────
export function templatesPage(ctx, { templates, key, lang, sample, flash = '', error = '' }) {
  const t = templates[key][lang];
  const link = (k, l) => `/admin/leads/templates?key=${k}&lang=${l}`;
  const body = html`
<p class="muted">Sono i testi delle email commerciali, in quattro lingue. Ogni lingua ha il suo testo: modificalo come vuoi. Nei testi puoi usare i segnaposto qui sotto; il sito li sostituisce con i dati di ogni agenzia.</p>
<div class="tabs-bar"><nav class="tabs" aria-label="Modello">${TEMPLATE_KEYS.map((k) => html`<a class="tab" href="${link(k, lang)}" ${key === k ? raw('aria-current="page"') : ''}>${TEMPLATE_LABEL[k]}</a>`)}</nav>
  <nav class="tabs" aria-label="Lingua">${LANGS.map((l) => html`<a class="tab" href="${link(key, l)}" ${lang === l ? raw('aria-current="page"') : ''}>${LANG_META[l].name}</a>`)}</nav></div>
<form class="card pad form" method="post" action="/admin/leads/templates">
  <input type="hidden" name="key" value="${key}"><input type="hidden" name="lang" value="${lang}">
  <h2>${TEMPLATE_LABEL[key]} · ${LANG_META[lang].name} ${t.custom ? html`<span class="chip chip-accent">Modificato da te</span>` : html`<span class="chip">Testo di partenza</span>`}</h2>
  <p class="muted small">${TEMPLATE_HINT[key]}</p>
  <label class="field"><span class="label">Oggetto</span><input name="subject" required maxlength="200" value="${t.subject}"></label>
  <label class="field"><span class="label">Testo</span><textarea name="body" required rows="22" maxlength="6000" class="lead-body">${t.body}</textarea></label>
  <details class="lead-more"><summary>Segnaposto che puoi usare</summary><dl class="lead-vars">${VARIABLES.map(([k, d]) => html`<div><dt><code>{{${k}}}</code></dt><dd>${d}</dd></div>`)}</dl>
    <p class="small muted">Un segnaposto scritto male (per esempio <code>{{agenzzia}}</code>) viene rifiutato al salvataggio, così non parte mai un’email con un buco. I testi in giapponese e in spagnolo sono bozze: fai rileggere a un madrelingua prima di usarli.</p></details>
  <p class="small muted">${FOOT_NOTE}</p>
  <div class="btn-row"><button class="btn btn-gold" type="submit" name="action" value="save">Salva</button>
    <button class="btn btn-outline" type="submit" name="action" value="test">Mandami una prova</button>
    ${t.custom ? html`<button class="btn btn-link-danger" type="submit" name="action" value="reset" data-confirm-click="Tornare al testo di partenza? Le tue modifiche a questo modello vanno perse.">Torna al testo di partenza</button>` : ''}</div>
</form>
<section class="card pad lead-card"><h2>Com’è con i dati di un’agenzia di esempio</h2>
  <p class="lead-dest"><span class="label">Oggetto</span><strong>${sample.subject}</strong></p>
  <pre class="lead-preview">${sample.body}</pre></section>`;
  return adminLayout(ctx, { title: 'Modelli delle email', active: '/admin/leads/templates', body, flash, error, scripts: `<script src="/js/admin-leads.js?v=${ctx.app.assetVersion}" defer></script>` });
}

// ───────────── importare un elenco ─────────────
/**
 * @param {object} o text, source, parsed ({columns, rows, tooMany}), checks (per riga: doppione o no), result ({created, duplicates, skipped})
 */
export function importPage(ctx, { text = '', source = '', parsed = null, checks = [], result = null, flash = '', error = '' }) {
  const ok = parsed ? parsed.rows.filter((r, i) => r.lead && !checks[i]).length : 0;
  const body = html`
${result
  ? html`<div class="notice notice-ok" role="status"><strong>Importati ${plural(result.created, 'contatto', 'contatti')}.</strong>
    ${result.duplicates.length ? ` ${plural(result.duplicates.length, 'era già presente ed è stato saltato', 'erano già presenti e sono stati saltati')}.` : ''}${result.skipped ? ` ${plural(result.skipped, 'riga senza nome saltata', 'righe senza nome saltate')}.` : ''}
    <a href="/admin/leads?sort=created">Vedi i contatti</a></div>
  ${result.duplicates.length ? html`<div class="card pad"><h3>Già presenti</h3><ul class="plain">${result.duplicates.map((d) => html`<li>riga ${d.line}: <strong>${d.company}</strong> → <a href="/admin/leads/${d.of.id}">${d.of.company}</a> <small class="muted">(${d.of.why})</small></li>`)}</ul></div>` : ''}`
  : ''}
<form class="card pad form" method="post" action="/admin/leads/import">
  <h2>Importa un elenco</h2>
  <p class="muted">Incolla le righe copiate da un foglio di calcolo (Excel, Google Fogli) o da un file CSV. La prima riga può avere le intestazioni: <em>${Object.values(IMPORT_COLUMNS).join(', ')}</em> (le riconosco anche in inglese). Senza intestazioni l’ordine è: <em>azienda, referente, email, telefono, sito, paese, città</em>. Le agenzie già presenti (stesso nome, sito o email) si saltano. Al massimo ${MAX_IMPORT_ROWS} righe alla volta.</p>
  <label class="field"><span class="label">Elenco</span><textarea name="text" rows="12" required class="lead-body" placeholder="Azienda;Email;Telefono;Paese&#10;Lagoon Travel;info@lagoon.it;+39 041 123456;Italia">${text}</textarea></label>
  <label class="field"><span class="label">Fonte <em>(dove hai trovato l’elenco; per le righe che non ne hanno una)</em></span><input name="source" maxlength="120" value="${source}" placeholder="es. Fiera BIT 2026, elenco ENIT, ricerca su Google"></label>
  <div class="btn-row"><button class="btn btn-gold" type="submit" name="action" value="preview">Controlla prima di importare</button><a class="btn btn-outline" href="/admin/leads">Annulla</a></div>
</form>
${parsed
  ? html`<section class="card pad"><h2>Anteprima</h2>
  ${parsed.rows.length
    ? html`<p>${plural(ok, 'contatto nuovo', 'contatti nuovi')} su ${parsed.rows.length} righe${parsed.tooMany ? html` — <strong>ho letto solo le prime ${MAX_IMPORT_ROWS}</strong>` : ''}. Colonne riconosciute: <em>${parsed.columns.map((c) => IMPORT_COLUMNS[c]).join(', ')}</em>.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Riga</th><th>Azienda</th><th>Paese · lingua</th><th>Email · telefono</th><th>Esito</th></tr></thead><tbody>
    ${parsed.rows.slice(0, 80).map((r, i) => html`<tr class="${checks[i] || !r.lead ? 'is-skip' : ''}"><td>${r.line}</td>
      <td>${r.lead ? html`<strong>${r.lead.company}</strong>${r.contact ? html`<br><small class="muted">${r.contact.name}${r.contact.role ? `, ${r.contact.role}` : ''}</small>` : ''}` : html`<span class="muted">—</span>`}</td>
      <td>${r.lead ? `${r.lead.country || '—'} · ${LANG_META[r.lead.lang].name}` : ''}</td>
      <td>${r.lead ? html`${r.lead.email || r.contact?.email || '—'}<br><small class="muted">${r.lead.phone || r.contact?.phone || ''}</small>` : ''}</td>
      <td>${!r.lead ? html`<span class="field-error">saltata: ${r.error}</span>` : checks[i] ? html`<span class="muted">già presente: ${checks[i].company}</span>` : html`<span class="ok-text">nuovo</span>`}${r.warnings?.length ? html`<br><small class="field-error">${r.warnings.map((w) => IMPORT_WARNING[w] ?? w).join('; ')}</small>` : ''}</td></tr>`)}
    </tbody></table></div>
    ${parsed.rows.length > 80 ? html`<p class="small muted">… e altre ${parsed.rows.length - 80} righe, controllate allo stesso modo.</p>` : ''}
    <form class="form" method="post" action="/admin/leads/import"><input type="hidden" name="text" value="${text}"><input type="hidden" name="source" value="${source}">
      <div class="btn-row"><button class="btn btn-gold" type="submit" name="action" value="import" ${ok ? '' : raw('disabled')}>Importa ${plural(ok, 'contatto', 'contatti')}</button></div></form>`
    : html`<p class="muted">Non ho trovato righe da importare.</p>`}</section>`
  : ''}`;
  return adminLayout(ctx, { title: 'Importa contatti', active: '/admin/leads', body, flash, error });
}

