// Aggiorna l'etichetta del bottone in base al metodo di pagamento scelto.
(function () {
  var btn = document.getElementById('checkout-submit');
  if (!btn) return;
  document.querySelectorAll('input[name="paymentMethod"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) btn.textContent = r.getAttribute('data-label'); });
  });
  var form = document.getElementById('checkout-form');
  if (form) form.addEventListener('submit', function () { btn.disabled = true; btn.classList.add('is-busy'); });
})();
