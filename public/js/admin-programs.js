(function () {
  var form = document.getElementById('proposal-form');
  if (!form) return;
  var box = form.querySelector('[data-prows]');
  var addBtn = form.querySelector('[data-add-row]');
  var sum = form.querySelector('[data-sum]');

  function toCents(v) {
    var n = parseFloat(String(v).trim().replace(',', '.'));
    return isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }
  function recalc() {
    var total = 0;
    form.querySelectorAll('input[name="d_price"]').forEach(function (i) { total += toCents(i.value); });
    if (sum) sum.textContent = (total / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  }
  function numberRows() {
    box.querySelectorAll('.prow').forEach(function (row, i) { var n = row.querySelector('.prow-n'); if (n) n.textContent = String(i + 1); });
  }
  function nextDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
    return d.toISOString().slice(0, 10);
  }

  form.addEventListener('input', function (e) { if (e.target && e.target.name === 'd_price') recalc(); });
  recalc();

  if (addBtn && box) {
    addBtn.hidden = false;
    addBtn.addEventListener('click', function () {
      var rows = box.querySelectorAll('.prow');
      var last = rows[rows.length - 1];
      var copy = last.cloneNode(true);
      copy.querySelectorAll('input, textarea').forEach(function (el) {
        if (el.name === 'd_date') el.value = nextDay(last.querySelector('[name="d_date"]').value);
        else if (el.name === 'd_start' || el.name === 'd_end') el.value = last.querySelector('[name="' + el.name + '"]').value;
        else el.value = '';
      });
      var flag = copy.querySelector('.prow-flag');
      if (flag) flag.remove();
      box.appendChild(copy);
      numberRows();
      var title = copy.querySelector('[name="d_title"]');
      if (title) title.focus();
    });
  }
})();
