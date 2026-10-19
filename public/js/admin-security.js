// Pannello › Sicurezza: copiare la chiave o i codici di emergenza (un codice per riga) e stamparli.
(function () {
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'sr-only';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      return ok ? resolve() : reject(new Error('copy'));
    });
  }
  document.addEventListener('click', function (e) {
    var print = e.target.closest('[data-print]');
    if (print) { window.print(); return; }
    var btn = e.target.closest('[data-copy-from]');
    if (!btn) return;
    var src = document.querySelector(btn.getAttribute('data-copy-from'));
    if (!src) return;
    var parts = src.children.length ? Array.prototype.slice.call(src.children) : [src];
    var text = parts.map(function (n) { return n.textContent.trim(); }).join('\n');
    var label = btn.textContent;
    copyText(text).then(function () { btn.textContent = 'Copiato'; }, function () { btn.textContent = 'Seleziona e copia a mano'; });
    setTimeout(function () { btn.textContent = label; }, 2000);
  });
})();
