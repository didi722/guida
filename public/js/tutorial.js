// Il giro dell'area agenzie: una finestra a passi (Avanti, Indietro, Salta). Alla prima volta si apre da sola; chiuderla in qualsiasi modo (Salta, Fine, Esc,
// un clic fuori) ricorda che è stata vista e non compare più da sola. Si rivede dalla pagina «Guida e FAQ». Senza JavaScript restano il riquadro e quella pagina.
(function () {
  'use strict';
  var dlg = document.getElementById('tutorial');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var steps = [].slice.call(dlg.querySelectorAll('[data-tut-step]'));
  var dots = [].slice.call(dlg.querySelectorAll('.tut-dots li'));
  var prev = dlg.querySelector('[data-tut-prev]');
  var next = dlg.querySelector('[data-tut-next]');
  var skip = dlg.querySelector('[data-tut-skip]');
  var at = 0;
  var reported = false;

  function show(n) {
    at = Math.max(0, Math.min(steps.length - 1, n));
    steps.forEach(function (s, i) { s.hidden = i !== at; });
    dots.forEach(function (d, i) { d.classList.toggle('is-on', i === at); });
    prev.hidden = at === 0;
    next.textContent = at === steps.length - 1 ? next.getAttribute('data-finish') : next.getAttribute('data-next');
  }

  function report() {
    if (reported || !dlg.hasAttribute('data-mark')) return;
    reported = true;
    try { fetch(dlg.getAttribute('data-done-url'), { method: 'POST', headers: { 'X-Requested-With': 'tutorial' }, credentials: 'same-origin', keepalive: true }); } catch (e) { /* al prossimo accesso lo rivedrà */ }
    var banner = document.querySelector('[data-tut-banner]');
    if (banner) banner.remove();
  }

  function open() {
    show(0);
    if (!dlg.open) dlg.showModal();
  }

  prev.addEventListener('click', function () { show(at - 1); });
  next.addEventListener('click', function () { if (at === steps.length - 1) dlg.close(); else show(at + 1); });
  skip.addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('close', report);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); // un clic sullo sfondo
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' && at < steps.length - 1) show(at + 1);
    else if (e.key === 'ArrowLeft' && at > 0) show(at - 1);
  });
  [].slice.call(document.querySelectorAll('[data-open-tutorial]')).forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); open(); });
  });

  if (dlg.hasAttribute('data-auto')) {
    var banner = document.querySelector('[data-tut-banner]');
    if (banner) banner.hidden = true; // si apre la finestra: il riquadro serve solo a chi non ha JavaScript
    open();
  }
})();
