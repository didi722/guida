// Pannello › Aiuto › Sicurezza, e il secondo passaggio dell'accesso: due passaggi con l'app di autenticazione, codici di emergenza, dispositivi collegati.
import { html, raw } from '../html.js';
import { qrSvg } from '../qr.js';
import { RECOVERY_COUNT } from '../totp.js';
import { adminLayout } from './admin.js';

const when = (iso) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' });
const hourOf = (ms) => new Date(ms).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
const script = (ctx) => `<script src="/js/admin-security.js?v=${ctx.app.assetVersion}" defer></script>`;
const GUIDE = '/admin/guide#sicurezza-del-pannello-due-passaggi-e-dispositivi';

/** Il campo del codice, uguale in tutte le pagine: l'app lo riempie da sola dove sa farlo. */
const codeField = (label = 'Codice a 6 cifre', { autofocus = false, required = true } = {}) => html`<label class="field"><span class="label">${label}</span><input class="otp-input" name="code" ${required ? raw('required') : ''} ${autofocus ? raw('autofocus') : ''} inputmode="numeric" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="12" placeholder="000 000"></label>`;
const anyCodeField = html`<label class="field"><span class="label">Codice dell’app (6 cifre) o codice di emergenza</span><input class="otp-input" name="code" required inputmode="text" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="14" placeholder="000 000"></label>`;

export function securityPage(ctx, { status, flash = '', error = '' }) {
  const lockedNote = status.locked ? html`<div class="notice notice-err" role="alert">Troppi codici sbagliati: i due passaggi sono <strong>bloccati fino alle ${hourOf(status.lockedUntil)}</strong>, anche per i codici giusti. Se è stato un tuo errore, aspetta; altrimenti qualcuno sta provando a entrare: cambia la password del pannello sul server (scolleghi tutti).</div>` : '';
  const twoStep = status.enabled
    ? html`<div class="card pad">
  <h2>Accesso a due passaggi <span class="chip chip-ok">Attivo</span></h2>
  <p class="muted">Per entrare nel pannello servono la password e il codice di 6 cifre dell’app di autenticazione. Attivo dal <strong>${when(status.enabledAt)}</strong>.</p>
  ${lockedNote}
  <p>Codici di emergenza rimasti: <strong>${status.recoveryLeft}</strong> su ${RECOVERY_COUNT} ${status.recoveryLeft <= 2 ? html`<span class="chip chip-warn">${status.recoveryLeft === 0 ? 'Non ne hai più' : 'Ne restano pochi'}</span>` : ''}</p>
  <div class="sec-forms">
    <form method="post" action="/admin/security/2fa/recovery" class="form card-inner">
      <h3>Nuovi codici di emergenza</h3>
      <p class="muted small">Quelli di adesso smettono di valere. Per sicurezza scrivi un codice per confermare.</p>
      ${anyCodeField}
      <button class="btn btn-outline" type="submit">Genera nuovi codici</button>
    </form>
    <form method="post" action="/admin/security/2fa/disable" class="form card-inner">
      <h3>Disattiva i due passaggi</h3>
      <p class="muted small">Il pannello tornerà ad aprirsi con la sola password. Scrivi un codice per confermare.</p>
      ${anyCodeField}
      <button class="btn btn-danger" type="submit">Disattiva</button>
    </form>
  </div>
</div>`
    : html`<div class="card pad">
  <h2>Accesso a due passaggi <span class="chip chip-warn">Spento</span></h2>
  <p>Adesso il pannello si apre con la <strong>sola password</strong>. Con i due passaggi, oltre alla password serve un <strong>codice di 6 cifre</strong> che cambia ogni 30 secondi e compare solo nell’app di autenticazione del tuo telefono (Google Authenticator, Microsoft Authenticator, Authy, 1Password…): se qualcuno scopre la password, senza il tuo telefono non entra.</p>
  <p class="muted">Il pannello contiene i dati dei clienti e le fatture: è la protezione più utile da accendere prima di aprire il sito al pubblico. Ti serviranno due minuti e il telefono.</p>
  <form method="post" action="/admin/security/2fa/start"><button class="btn btn-gold" type="submit">Attiva i due passaggi</button></form>
</div>`;
  const body = html`
${twoStep}
<div class="card pad">
  <h2>Dispositivi collegati</h2>
  <p class="muted">Dopo l’accesso il pannello resta aperto per <strong>7 giorni</strong> su quel browser. Se hai usato un computer che non è tuo o hai perso il telefono, chiudi tutte le sessioni: ovunque dovranno rientrare con la password${status.enabled ? ' e il codice' : ''}. Questo browser resta collegato.</p>
  <form method="post" action="/admin/security/sessions/revoke"><button class="btn btn-outline" type="submit">Esci da tutti gli altri dispositivi</button></form>
  <p class="muted small">Cambiare la password del pannello (<code>ADMIN_PASSWORD</code> sul server) li scollega tutti, anche questo.</p>
</div>
<div class="card pad">
  <h2>Se perdi il telefono</h2>
  <p class="muted">Al posto del codice dell’app puoi scrivere uno dei <strong>codici di emergenza</strong> (ognuno vale una volta). Se hai perso anche quelli, dal terminale del server <code>npm run admin:2fa-off</code> spegne i due passaggi: poi li riattivi con un telefono nuovo. Dettagli nella <a href="${GUIDE}">guida</a>.</p>
</div>`;
  return adminLayout(ctx, { title: 'Sicurezza', active: '/admin/security', body, flash, error });
}

export function setupPage(ctx, { setup, error = '' }) {
  const body = html`
<div class="card pad">
  <ol class="sec-steps">
    <li><strong>Installa un’app di autenticazione</strong> sul telefono, se non ce l’hai: <em>Google Authenticator</em>, <em>Microsoft Authenticator</em>, <em>Authy</em>, oppure il gestore di password che usi (1Password, Bitwarden…).</li>
    <li><strong>Aggiungi il pannello all’app</strong>: nell’app tocca <em>+</em> (aggiungi account) e inquadra questo codice.
      <div class="qr-box">${raw(qrSvg(setup.uri, { label: 'Codice QR per l’app di autenticazione' }))}</div>
      <p class="muted small">Non riesci a inquadrarlo? Scegli «inserisci una chiave di configurazione» e scrivi questa chiave (tipo <em>basata sul tempo</em>):</p>
      <p><code class="otp-key" id="otp-key">${setup.grouped}</code> <button class="btn btn-sm btn-outline" type="button" data-copy-from="#otp-key">Copia</button></p>
      <p class="muted small">Dal telefono stesso, <a href="${setup.uri}">apri direttamente nell’app</a>.</p></li>
    <li><strong>Conferma</strong> scrivendo il codice di 6 cifre che l’app mostra adesso:
      ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
      <form method="post" action="/admin/security/2fa/confirm" class="form sec-confirm">
        ${codeField('Codice a 6 cifre', { autofocus: true })}
        <div class="btn-row"><button class="btn btn-gold" type="submit">Conferma e attiva</button> <a class="btn btn-outline" href="/admin/security">Annulla</a></div>
      </form></li>
  </ol>
  <p class="muted small">La chiave serve solo a te: non condividerla e non fotografare questa pagina. Dopo la conferma ti do dei codici di emergenza per il caso in cui perdessi il telefono.</p>
</div>`;
  return adminLayout(ctx, { title: 'Attiva i due passaggi', active: '/admin/security', body, scripts: script(ctx) });
}

/** I codici di emergenza: si vedono una volta sola, subito dopo l'attivazione o dopo averli rigenerati. */
export function recoveryPage(ctx, { codes, fresh }) {
  const body = html`
<div class="card pad">
  ${fresh ? html`<div class="notice notice-ok" role="status">Fatto: da ora per entrare nel pannello servono la password e il codice dell’app.</div>` : ''}
  <p>Se perdi o rompi il telefono, <strong>ognuno di questi codici sostituisce il codice dell’app, una volta sola</strong>. Scrivili o stampali <strong>adesso</strong> e conservali in un posto sicuro (non nel telefono): da questa pagina non potrò mostrarteli di nuovo.</p>
  <ul class="recovery-codes" id="recovery-codes">${codes.map((c) => html`<li><code>${c}</code></li>`)}</ul>
  <div class="btn-row"><button class="btn btn-outline" type="button" data-copy-from="#recovery-codes">Copia i codici</button> <button class="btn btn-outline" type="button" data-print>Stampa</button> <a class="btn btn-gold" href="/admin/security">Li ho conservati</a></div>
</div>`;
  return adminLayout(ctx, { title: 'Codici di emergenza', active: '/admin/security', body, scripts: script(ctx) });
}

/** Il secondo passo dell'accesso: stessa veste della pagina della password. */
export function login2faPage(ctx, { error = '' } = {}) {
  return html`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Verifica · Admin</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/style.css?v=${ctx.app.assetVersion}"><script src="/js/theme.js"></script></head>
<body class="admin"><main class="wrap narrow admin-login">
  <h1>${ctx.app.cfg.site.name}</h1><p class="muted">Verifica in due passaggi</p>
  <div class="card pad">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <form method="post" action="/admin/login/2fa" class="form">
      <p class="muted">Apri l’app di autenticazione sul telefono e scrivi il <strong>codice di 6 cifre</strong> del pannello (cambia ogni 30 secondi).</p>
      ${codeField('Codice a 6 cifre', { autofocus: true, required: false })}
      <details class="spaced"><summary>Non hai il telefono?</summary>
        <label class="field"><span class="label">Codice di emergenza</span><input class="otp-input" name="recovery" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="14" placeholder="ABCDE-FGHJK"></label>
        <p class="muted small">Ogni codice di emergenza vale una volta sola.</p></details>
      <button class="btn btn-gold btn-block" type="submit">Entra</button>
      <p class="center"><a href="/admin/login">Ricomincia</a></p>
    </form>
  </div>
</main></body></html>`;
}
