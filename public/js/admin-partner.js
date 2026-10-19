// Modelli delle condizioni di annullo: un pulsante riempie le tre righe del suo modulo (partner: h1, u1, r1…; periodi: c_h1…, a_h1…).
(function () {
  document.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var form = btn.form || btn.closest('form');
      if (!form) return;
      var prefix = btn.getAttribute('data-prefix') || '';
      var rows = JSON.parse(btn.getAttribute('data-preset'));
      for (var i = 1; i <= 3; i++) {
        var r = rows[i - 1];
        form.elements[prefix + 'h' + i].value = r ? r[0] : '';
        form.elements[prefix + 'u' + i].value = r ? r[1] : 'd';
        form.elements[prefix + 'r' + i].value = r ? r[2] : '';
      }
    });
  });
})();
