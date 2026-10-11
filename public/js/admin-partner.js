// Scheda partner: i «modelli» riempiono le righe della politica di annullo.
(function () {
  var form = document.getElementById('policy-form');
  if (!form) return;
  form.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var rows = JSON.parse(btn.getAttribute('data-preset'));
      for (var i = 1; i <= 3; i++) {
        var r = rows[i - 1];
        form.elements['h' + i].value = r ? r[0] : '';
        form.elements['u' + i].value = r ? r[1] : 'd';
        form.elements['r' + i].value = r ? r[2] : '';
      }
    });
  });
})();
