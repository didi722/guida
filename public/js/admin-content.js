// Moduli di modifica dei contenuti: anteprima del testo in markdown.
(function () {
  document.querySelectorAll('[data-md]').forEach(function (box) {
    var source = box.querySelector('[data-md-source]');
    var btn = box.querySelector('[data-md-toggle]');
    var out = box.querySelector('[data-md-preview]');
    if (!source || !btn || !out) return;
    btn.addEventListener('click', function () {
      if (!out.hidden) { out.hidden = true; source.hidden = false; btn.textContent = 'Anteprima'; return; }
      btn.disabled = true;
      fetch('/admin/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: source.value }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { out.innerHTML = j.html; out.hidden = false; source.hidden = true; btn.textContent = 'Torna a modificare'; })
        .catch(function () { out.textContent = 'Anteprima non disponibile.'; out.hidden = false; })
        .then(function () { btn.disabled = false; });
    });
  });
})();
