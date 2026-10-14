// Preventivo a ore: il totale si aggiorna mentre si compone (servizio, data, ore, persone, auricolari); «Vedi gli orari» compare solo con una data.
(function () {
  'use strict';
  var form = document.querySelector('[data-hourly-live]');
  if (!form || !window.fetch || !window.DOMParser) return;
  var quoteBox = document.querySelector('[data-quote]');
  var slotsBox = document.querySelector('[data-slots]');
  var go = form.querySelector('[data-go]');
  var timer = 0, seq = 0;

  function dateValue() { var d = form.querySelector('[name="date"]'); return d ? d.value : ''; }
  function syncGo() { if (go) go.hidden = !dateValue(); }
  syncGo();

  function refresh(swapFields) {
    var my = ++seq;
    var qs = new URLSearchParams(new FormData(form)).toString();
    quoteBox.classList.add('is-loading');
    fetch(form.getAttribute('action') + '?' + qs, { headers: { Accept: 'text/html' }, credentials: 'same-origin' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        if (my !== seq) return;
        var doc = new DOMParser().parseFromString(txt, 'text/html');
        var q = doc.querySelector('[data-quote]');
        if (q) quoteBox.replaceChildren.apply(quoteBox, Array.prototype.slice.call(q.childNodes));
        if (swapFields) {
          ['hours', 'pax', 'ear'].forEach(function (k) {
            var from = doc.querySelector('[data-dyn="' + k + '"]'), to = form.querySelector('[data-dyn="' + k + '"]');
            if (from && to) to.replaceWith(from);
          });
        }
        slotsBox.replaceChildren(); // gli orari valgono per i dati precedenti: si mostrano con «Vedi gli orari»
        quoteBox.classList.remove('is-loading');
      })
      .catch(function () { if (my === seq) quoteBox.classList.remove('is-loading'); });
  }

  function onChange(e) {
    syncGo();
    clearTimeout(timer);
    var product = e.target && e.target.name === 'product';
    timer = setTimeout(function () { refresh(product); }, product ? 0 : 250);
  }
  form.addEventListener('change', onChange);
  form.addEventListener('input', function (e) { if (e.target && e.target.name === 'pax') onChange(e); });
})();
