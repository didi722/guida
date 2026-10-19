import { html, raw } from '../html.js';
import { fmtDate } from '../time.js';
import { formatMoney } from '../util.js';
import { adminLayout } from './admin.js';
import { ADMIN_CTX, phoneField } from './fields.js';

const eur = (c) => formatMoney(c, 'it');

export function agencyBookingPage(ctx, { agencies, tours, values: v = {}, error = '', today }) {
  const body = html`
<p><a href="/admin?v=cal#privato">← Torna all’agenda</a></p>
<form class="card pad form" method="post" action="/admin/agenda/agency" data-agency-form>
  <p class="muted">Un’agenzia ti ha scritto o chiamato per un servizio? Registralo qui: finisce nell’<strong>agenda</strong>, nelle <strong>prenotazioni dell’agenzia</strong> (che lo vede nella sua area) e tra le fatture da emettere, come se l’avesse fatto online. Non controlla le disponibilità: se hai già messo un impegno in agenda per le stesse ore, toglilo dopo.</p>

  <fieldset class="field">
    <legend class="label">Agenzia</legend>
    <input type="search" data-agency-search placeholder="Cerca per nome o email…" aria-label="Cerca un’agenzia" autocomplete="off">
    <select name="agency" data-agency required>
      <option value="">— scegli —</option>
      ${agencies.map((a) => html`<option value="${a.id}" ${String(v.agency ?? '') === String(a.id) ? raw('selected') : ''}>${a.company} · ${a.contact_name} · ${a.email}</option>`)}
      <option value="new" ${v.agency === 'new' ? raw('selected') : ''}>＋ Nuova agenzia…</option>
    </select>
  </fieldset>
  <div class="card pad" data-newagency ${v.agency === 'new' ? '' : raw('hidden')}>
    <p class="small muted">Si crea un account approvato. Ti mostro una <strong>password provvisoria</strong> da comunicare all’agenzia (che potrà usarla per entrare nella sua area).</p>
    <div class="form-grid">
      <label class="field"><span class="label">Nome agenzia</span><input name="company" maxlength="160" value="${v.company ?? ''}"></label>
      <label class="field"><span class="label">Referente</span><input name="contact_name" maxlength="120" value="${v.contact_name ?? ''}"></label>
      <label class="field"><span class="label">Email</span><input type="email" name="email" maxlength="200" value="${v.email ?? ''}"></label>
      ${phoneField(ADMIN_CTX, { value: v.phone ?? '', cc: v.phone_cc ?? '', defaultCc: 'IT', label: html`Telefono <em>(facoltativo)</em>` })}
      <label class="field"><span class="label">Partita IVA <em>(facoltativo)</em></span><input name="vat" maxlength="40" value="${v.vat ?? ''}"></label>
      <label class="field"><span class="label">Sconto sulle tariffe % <em>(facoltativo)</em></span><input name="discount" inputmode="decimal" value="${v.discount ?? ''}"></label>
    </div>
  </div>

  <label class="field"><span class="label">Servizio</span>
    <select name="tour" required><option value="">— scegli —</option>${tours.map((t) => html`<option value="${t.slug}" ${v.tour === t.slug ? raw('selected') : ''}>${t.i18n.it.title}</option>`)}</select></label>
  <div class="form-grid">
    <label class="field"><span class="label">Data</span><input type="date" name="date" required value="${v.date ?? ''}"></label>
    <label class="field"><span class="label">Ora di inizio</span><input type="time" name="time" required value="${v.time ?? '09:00'}"></label>
    <label class="field"><span class="label">Persone</span><select name="pax" required>${Array.from({ length: 25 }, (_, n) => n + 1).map((n) => html`<option value="${n}" ${String(n) === String(v.pax ?? '2') ? raw('selected') : ''}>${n}</option>`)}</select></label>
    <label class="field"><span class="label">Ore <em>(solo servizi a ore a scelta)</em></span><input name="hours" inputmode="decimal" placeholder="es. 4 o 5,5" value="${v.hours ?? ''}"></label>
  </div>
  <div class="form-grid">
    <label class="field"><span class="label">Prezzo di vendita (€) <em>(vuoto = tariffa dell’agenzia)</em></span><input name="price" inputmode="decimal" placeholder="es. 350" value="${v.price ?? ''}"></label>
    <label class="field"><span class="label">Pratica o cliente <em>(facoltativo)</em></span><input name="clientRef" maxlength="120" placeholder="es. Pratica 42, gruppo Rossi" value="${v.clientRef ?? ''}"></label>
  </div>
  <label class="field"><span class="label">Note <em>(facoltativo)</em></span><textarea name="notes" rows="2" maxlength="1000">${v.notes ?? ''}</textarea></label>
  <label class="check"><input type="checkbox" name="paid" value="1" ${v.paid === '1' ? raw('checked') : ''}> Già pagata <em>(altrimenti resta da fatturare e incassare)</em></label>
  <label class="check"><input type="checkbox" name="sendMail" value="1" ${v.sendMail === '1' ? raw('checked') : ''}> Invia all’agenzia la conferma con il voucher</label>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Registra la prenotazione</button></div>
</form>`;
  return adminLayout(ctx, { title: 'Prenotazione di un’agenzia', active: '/admin', body, error, scripts: '<script src="/js/admin-agency-booking.js" defer></script>' });
}

export function agencyBookingDonePage(ctx, { booking: b, account, tour, tempPassword, mailed }) {
  const body = html`
<div class="card pad">
  <p><strong>Registrata.</strong> ${tour.i18n.it.title} · ${fmtDate(b.date, 'it')} ${b.start_time}–${b.end_time} · ${b.participants} pers. · ${eur(b.total_cents)}${b.payment_status === 'paid' ? ' · già pagata' : ' · da fatturare'}</p>
  <p>Agenzia: <strong>${account.company}</strong> (${account.email}). La prenotazione è nell’agenda e nella sua area, con la pratica <code>${b.ref}</code>.${mailed ? ' Le ho inviato la conferma con il voucher.' : ''}</p>
  ${tempPassword ? html`<div class="notice notice-ok" role="status"><strong>Nuova agenzia creata.</strong> Password provvisoria (la vedi solo qui): <code>${tempPassword}</code><br>Comunicala all’agenzia: entra su <em>Area agenzie</em> con la sua email e, se la perde, può scegliersene una nuova con <em>Password dimenticata</em>.</div>` : ''}
  <p class="btn-row"><a class="btn btn-gold" href="/admin/bookings/${b.id}">Apri la prenotazione</a> <a class="btn btn-outline" href="/admin/agenda/agency">Registrane un’altra</a> <a class="btn btn-outline" href="/admin?v=cal&m=${b.date.slice(0, 7)}&d=${b.date}#giorno">Vedi in agenda</a></p>
</div>`;
  return adminLayout(ctx, { title: 'Prenotazione registrata', active: '/admin', body });
}
