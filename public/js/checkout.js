// Checkout: etichetta del bottone secondo il metodo di pagamento; cambio del numero di persone.
(function () {
  var btn = document.getElementById('checkout-submit');
  if (!btn) return;
  document.querySelectorAll('input[name="paymentMethod"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) btn.textContent = r.getAttribute('data-label'); });
  });
  var form = document.getElementById('checkout-form');
  if (form) form.addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.name === 'apply') return; // «Applica» e cambio di persone: si ricarica la pagina, non si prenota
    btn.disabled = true; btn.classList.add('is-busy');
  });
  // cambio del numero di persone: ricalcola prezzo e posti tenendo i dati già scritti
  var pax = document.getElementById('pax-select');
  var apply = document.getElementById('pax-apply');
  if (pax && apply && form) pax.addEventListener('change', function () { if (form.requestSubmit) form.requestSubmit(apply); else apply.click(); });
})();
