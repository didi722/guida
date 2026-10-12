// Moduli di modifica dei contenuti: barra di formattazione, inserimento di foto e anteprima del testo in markdown.
(function () {
  function wrap(ta, mark, placeholder) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e) || placeholder;
    ta.value = v.slice(0, s) + mark + sel + mark + v.slice(e);
    ta.focus();
    ta.setSelectionRange(s + mark.length, s + mark.length + sel.length);
  }
  function prefixLines(ta, prefix, placeholder) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var a = v.lastIndexOf('\n', s - 1) + 1, b = v.indexOf('\n', e);
    if (b < 0) b = v.length;
    var block = v.slice(a, b) || placeholder;
    var out = block.split('\n').map(function (l) { return prefix + l; }).join('\n');
    ta.value = v.slice(0, a) + out + v.slice(b);
    ta.focus();
    ta.setSelectionRange(a, a + out.length);
  }
  function insertBlock(ta, text) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, before = v.slice(0, s), after = v.slice(e);
    var pre = !before ? '' : /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    var post = !after ? '' : /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
    ta.value = before + pre + text + post + after;
    var end = (before + pre + text).length;
    ta.focus();
    ta.setSelectionRange(end, end);
  }
  var ACTIONS = {
    bold: function (ta) { wrap(ta, '**', 'testo in grassetto'); },
    italic: function (ta) { wrap(ta, '*', 'testo in corsivo'); },
    heading: function (ta) { prefixLines(ta, '## ', 'Titolo'); },
    list: function (ta) { prefixLines(ta, '- ', 'voce dell’elenco'); },
    link: function (ta) {
      var url = window.prompt('Indirizzo del link (per esempio https://…)');
      if (!url) return;
      var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e) || 'testo del link';
      var md = '[' + sel + '](' + url.trim() + ')';
      ta.value = v.slice(0, s) + md + v.slice(e);
      ta.focus();
      ta.setSelectionRange(s, s + md.length);
    },
  };

  document.querySelectorAll('[data-md]').forEach(function (box) {
    var source = box.querySelector('[data-md-source]');
    var btn = box.querySelector('[data-md-toggle]');
    var out = box.querySelector('[data-md-preview]');
    var bar = box.querySelector('[data-md-toolbar]');
    var photos = box.querySelector('[data-md-photos]');
    if (!source) return;

    if (bar) {
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-md-act]');
        if (!b) return;
        var act = b.getAttribute('data-md-act');
        if (act === 'photos') {
          if (!photos) return;
          photos.hidden = !photos.hidden;
          b.setAttribute('aria-expanded', photos.hidden ? 'false' : 'true');
          return;
        }
        if (ACTIONS[act]) ACTIONS[act](source);
      });
    }
    if (photos) {
      photos.addEventListener('click', function (e) {
        var p = e.target.closest('[data-md-photo]');
        if (!p) return;
        insertBlock(source, '![Descrizione della foto](' + p.getAttribute('data-md-photo') + ')');
        photos.hidden = true;
        if (bar) { var pb = bar.querySelector('[data-md-act="photos"]'); if (pb) pb.setAttribute('aria-expanded', 'false'); }
      });
    }

    if (!btn || !out) return;
    btn.addEventListener('click', function () {
      if (!out.hidden) {
        out.hidden = true; source.hidden = false; if (bar) bar.hidden = false; btn.textContent = 'Anteprima';
        return;
      }
      btn.disabled = true;
      fetch('/admin/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: source.value }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          out.innerHTML = j.html; out.hidden = false; source.hidden = true;
          if (bar) bar.hidden = true;
          if (photos) photos.hidden = true;
          btn.textContent = 'Torna a modificare';
        })
        .catch(function () { out.textContent = 'Anteprima non disponibile.'; out.hidden = false; })
        .then(function () { btn.disabled = false; });
    });
  });
})();
