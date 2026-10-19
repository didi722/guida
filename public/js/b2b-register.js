// Registrazione di un'agenzia: codice fiscale, provincia, SDI e PEC valgono solo per le aziende italiane. Scegliendo un altro paese spariscono;
// per l'Italia codice fiscale e provincia diventano obbligatori. Senza JavaScript restano tutti visibili e li controlla il server.
(function () {
  var form = document.querySelector('form [name="country"]');
  form = form && form.form;
  if (!form) return;
  var country = form.elements.country;
  var fields = [].slice.call(form.querySelectorAll('[data-it]'));
  var apply = function () {
    var it = country.value === 'IT';
    fields.forEach(function (f) {
      f.hidden = !it;
      var input = f.querySelector('input');
      if (input && (input.name === 'tax_code' || input.name === 'province')) input.required = it;
    });
    // CAP: in Italia sono 5 cifre
    var zip = form.elements.zip;
    if (zip) { zip.pattern = it ? '\\d{5}' : ''; zip.inputMode = it ? 'numeric' : 'text'; }
    var province = form.elements.province;
    if (province) {
      province.pattern = it ? '[A-Za-z]{2}' : '';
      var row = province.closest('.form-grid-3');
      if (row) row.classList.toggle('is-two', !it);
    }
  };
  // il prefisso del telefono segue il paese dell'azienda, finché non lo si sceglie a mano
  var prefix = form.elements.phone_cc;
  var follows = !prefix || prefix.value === country.value;
  var setting = false;
  if (prefix) prefix.addEventListener('change', function () { if (!setting) follows = false; });
  country.addEventListener('change', function () {
    apply();
    if (!prefix || !follows) return;
    var has = [].slice.call(prefix.options).some(function (o) { return o.value === country.value; });
    if (!has) return;
    setting = true;
    prefix.value = country.value;
    prefix.dispatchEvent(new Event('change', { bubbles: true }));
    setting = false;
  });
  apply();
  // sigla e codici sempre in maiuscolo
  ['province', 'sdi_code', 'tax_code'].forEach(function (n) {
    var el = form.elements[n];
    if (el) el.addEventListener('input', function () { var p = el.selectionStart; el.value = el.value.toUpperCase(); try { el.setSelectionRange(p, p); } catch (e) { /* ok */ } });
  });
})();
