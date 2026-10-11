// Accesso admin: «Mostra la password» (utile sul telefono, dove è facile sbagliare a digitare).
(function () {
  var box = document.querySelector('[data-show-password]');
  var input = document.querySelector('[data-password]');
  if (!box || !input) return;
  box.addEventListener('change', function () { input.type = box.checked ? 'text' : 'password'; });
})();
