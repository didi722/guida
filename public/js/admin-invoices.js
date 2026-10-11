(function () {
  // ── coda: seleziona tutte le voci di un cliente e mostra il totale scelto
  var form = document.querySelector('.queue-form');
  if (form) {
    var out = form.querySelector('[data-selected-total]');
    var boxes = function () { return form.querySelectorAll('input[name="src"]'); };
    var update = function () {
      var n = 0, cents = 0;
      boxes().forEach(function (b) { if (b.checked) { n++; cents += Number(b.getAttribute('data-cents')) || 0; } });
      if (out) out.textContent = n ? n + (n === 1 ? ' voce' : ' voci') + ' · ' + (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : '';
    };
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.hasAttribute('data-select-group')) {
        var key = t.getAttribute('data-select-group');
        boxes().forEach(function (b) { if (b.getAttribute('data-group') === key) b.checked = t.checked; });
      }
      update();
    });
    update();
  }

  // ── bozza: righe aggiuntive, tipo di intestatario, conferma all'emissione
  var invoice = document.getElementById('invoice-form');
  if (invoice) {
    var box = invoice.querySelector('[data-ilines]');
    var add = invoice.querySelector('[data-add-line]');
    if (add && box) {
      add.hidden = false;
      add.addEventListener('click', function () {
        var rows = box.querySelectorAll('.iline');
        var copy = rows[rows.length - 1].cloneNode(true);
        copy.querySelectorAll('input').forEach(function (i) { i.value = ''; });
        var link = copy.querySelector('.iline-src');
        if (link) link.remove();
        box.appendChild(copy);
        var d = copy.querySelector('[name="l_desc"]');
        if (d) d.focus();
      });
    }
    var kind = function () {
      var checked = invoice.querySelector('input[name="b_kind"]:checked');
      var value = checked ? checked.value : 'company';
      invoice.querySelectorAll('[data-kind]').forEach(function (el) { el.hidden = el.getAttribute('data-kind') !== value; });
    };
    invoice.querySelectorAll('input[name="b_kind"]').forEach(function (r) { r.addEventListener('change', kind); });
    kind();
    invoice.querySelectorAll('[data-confirm-submit]').forEach(function (b) {
      b.addEventListener('click', function (e) { if (!window.confirm(b.getAttribute('data-confirm-submit'))) e.preventDefault(); });
    });
  }
})();
