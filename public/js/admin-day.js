// Scheda del giorno: il pulsante «Stampa» apre la stampa del browser (nessuno script in linea, per la politica di sicurezza del sito).
(function () {
  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });
})();
