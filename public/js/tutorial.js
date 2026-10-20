// La finestra che apre il giro dell'area agenzie: «Inizia il giro» avvia il giro vero sul sito (public/js/tour.js); Salta, Esc o un clic fuori
// la chiudono e, se è la prima volta, ricordano che è stata vista. Senza JavaScript restano il riquadro e la pagina «Guida e FAQ».
(function () {
  'use strict';
  var dlg = document.getElementById('tutorial');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var started = false;
  var reported = false;

  function report() {
    if (started || reported || !dlg.hasAttribute('data-mark')) return;
    reported = true;
    if (window.guidaTour) window.guidaTour.done();
    var banner = document.querySelector('[data-tut-banner]');
    if (banner) banner.remove();
  }

  dlg.querySelector('[data-tut-go]').addEventListener('click', function () {
    started = true;
    dlg.close();
    if (window.guidaTour) window.guidaTour.start({ mark: dlg.hasAttribute('data-mark') });
  });
  dlg.querySelector('[data-tut-skip]').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('close', report);
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); // un clic sullo sfondo

  if (dlg.hasAttribute('data-auto')) {
    var banner = document.querySelector('[data-tut-banner]');
    if (banner) banner.hidden = true; // si apre la finestra: il riquadro serve solo a chi non ha JavaScript
    dlg.showModal();
  }
})();
