// Commerciale: «Seleziona tutti» nell'elenco dei contatti e conferma sui pulsanti che cancellano (i moduli con data-confirm li gestisce main.js).
(function () {
  document.querySelectorAll('[data-check-all]').forEach(function (box) {
    var scope = document.querySelector(box.getAttribute('data-check-all'));
    if (!scope) return;
    var boxes = function () { return scope.querySelectorAll('input[type=checkbox][name=ids]'); };
    box.addEventListener('change', function () { boxes().forEach(function (b) { b.checked = box.checked; }); });
    scope.addEventListener('change', function (e) {
      if (e.target === box || e.target.name !== 'ids') return;
      var all = boxes();
      box.checked = all.length > 0 && [].every.call(all, function (b) { return b.checked; });
    });
  });
  document.querySelectorAll('button[data-confirm-click]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (!window.confirm(btn.getAttribute('data-confirm-click'))) e.preventDefault();
    });
  });
})();
