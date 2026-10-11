// Acquisto buono regalo: mostra/nasconde i campi in base alle scelte.
(function () {
  var form = document.getElementById('gift-form');
  if (!form) return;
  var recipient = form.querySelector('.recipient-fields');
  var custom = form.querySelector('.custom-amount');
  function sync() {
    var d = form.querySelector('input[name="delivery"]:checked');
    var a = form.querySelector('input[name="amount"]:checked');
    recipient.hidden = !(d && d.value === 'recipient');
    custom.hidden = !(a && a.value === 'custom');
  }
  form.addEventListener('change', sync);
  sync();
})();
