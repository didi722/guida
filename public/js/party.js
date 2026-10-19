// Adulti, bambini e infanti: i tre contatori con − e + (server/views/fields.js › partyField). Tengono il totale entro il massimo del servizio, almeno un adulto,
// e scrivono il totale sotto i campi. Ogni cambio parte come un normale evento «change» (bolle fino al modulo): chi ascolta (prezzi, orari, ricarica del checkout) non deve sapere altro.
(function () {
  'use strict';
  var roots = [].slice.call(document.querySelectorAll('[data-party]'));
  if (!roots.length) return;

  roots.forEach(function (root) {
    var max = parseInt(root.getAttribute('data-max'), 10) || 99;
    var inputs = {};
    [].slice.call(root.querySelectorAll('input[type="number"]')).forEach(function (i) { inputs[i.name] = i; });
    var totalEl = root.querySelector('[data-party-total]');
    var maxEl = root.querySelector('[data-party-max]'); // «Massimo N persone»: compare quando non si può aggiungere nessuno
    var buttons = [].slice.call(root.querySelectorAll('[data-step]'));
    var one = root.getAttribute('data-total-one') || '1';
    var many = root.getAttribute('data-total-many') || '{n}';
    var label = root.getAttribute('data-total-label') || '{text}';

    function num(i) { var n = parseInt(i.value, 10); return isFinite(n) && n >= 0 ? n : 0; }
    function total() { return num(inputs.adults) + num(inputs.children) + num(inputs.infants); }
    function minOf(i) { return parseInt(i.getAttribute('min'), 10) || 0; }

    // il valore di un campo dentro i limiti: il suo minimo e quanto resta del totale agli altri due
    function clamp(i) {
      var others = total() - num(i);
      var v = Math.max(minOf(i), Math.min(num(i), max - others));
      if (String(v) !== i.value) i.value = String(v);
    }

    function refresh() {
      var t = total();
      if (totalEl) totalEl.textContent = label.replace('{text}', t === 1 ? one : many.replace('{n}', String(t)));
      if (maxEl) maxEl.hidden = t < max;
      buttons.forEach(function (b) {
        var i = inputs[b.getAttribute('data-for')];
        var step = parseInt(b.getAttribute('data-step'), 10);
        b.disabled = step < 0 ? num(i) <= minOf(i) : t >= max;
      });
    }

    function changed(i) {
      clamp(i);
      refresh();
    }

    buttons.forEach(function (b) {
      b.hidden = false; // senza JavaScript restano le sole caselle numeriche
      b.addEventListener('click', function () {
        var i = inputs[b.getAttribute('data-for')];
        var next = num(i) + parseInt(b.getAttribute('data-step'), 10);
        if (next < minOf(i) || (next > num(i) && total() >= max)) return;
        i.value = String(next);
        changed(i);
        i.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    Object.keys(inputs).forEach(function (k) {
      var i = inputs[k];
      i.addEventListener('input', function () { refresh(); });
      i.addEventListener('change', function () { changed(i); });
    });
    root.classList.add('is-ready');
    refresh();
  });
})();
