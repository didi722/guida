// Copia giornaliera: mentre una copia è in corso, ogni pochi secondi controlla se è finita e ricarica la pagina con l'esito.
(function () {
  var box = document.querySelector('[data-auto-running]');
  if (!box || !window.fetch) return;
  var tries = 0;
  function check() {
    tries += 1;
    fetch('/admin/backup/auto/status', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s.running) location.reload();
        else if (tries < 400) setTimeout(check, 3000);
      })
      .catch(function () { if (tries < 400) setTimeout(check, 6000); });
  }
  setTimeout(check, 2500);
})();
