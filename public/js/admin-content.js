// Moduli di modifica dei contenuti: barra di formattazione, inserimento di foto e anteprima del testo in markdown.
//
// Importante: i pulsanti NON devono spostare la pagina né il cursore. Per questo
//  - i pulsanti non rubano il fuoco al campo (mousedown annullato): selezione e tastiera del telefono restano dove sono;
//  - il testo si modifica con execCommand('insertText') (così Ctrl+Z / «annulla» funziona) oppure con setRangeText, mai assegnando `value`,
//    che porta il cursore in fondo al testo e fa «scappare» la pagina;
//  - la posizione di scorrimento (del campo e della pagina) si ripristina dopo ogni modifica.
(function () {
  var MAX_PREVIEW = 50000;

  /** Sostituisce [start, end) con `text` e lascia selezionato [selStart, selEnd), senza muovere nulla. */
  function replaceRange(ta, start, end, text, selStart, selEnd) {
    var top = ta.scrollTop, left = ta.scrollLeft, winX = window.scrollX, winY = window.scrollY;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    var done = false;
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (!done) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ta.setSelectionRange(selStart, selEnd);
    ta.scrollTop = top;
    ta.scrollLeft = left;
    if (window.scrollX !== winX || window.scrollY !== winY) window.scrollTo({ left: winX, top: winY, behavior: 'instant' }); // il sito scorre «dolcemente»: qui serve subito
  }

  function countBefore(v, i, ch) { var n = 0; while (i - n - 1 >= 0 && v[i - n - 1] === ch) n++; return n; }
  function countAfter(v, i, ch) { var n = 0; while (i + n < v.length && v[i + n] === ch) n++; return n; }

  /** Grassetto / corsivo: aggiunge i segni attorno alla selezione, oppure li toglie se ci sono già (secondo clic). */
  function toggleWrap(ta, mark, placeholder) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, m = mark.length, ch = mark.charAt(0);
    var before = countBefore(v, s, ch), after = countAfter(v, e, ch);
    // segni subito fuori dalla selezione: «*parola*» con «parola» selezionata (per il corsivo, 1 o 3 asterischi; per il grassetto, almeno 2)
    var outside = Math.min(before, after);
    if (m === 1 ? outside % 2 === 1 : outside >= 2) {
      replaceRange(ta, s - m, e + m, v.slice(s, e), s - m, e - m);
      return;
    }
    // segni dentro la selezione: «*parola*» tutto selezionato
    var sel = v.slice(s, e);
    var inner = countAfter(sel, 0, ch);
    if (sel.length >= 2 * m + 1 && (m === 1 ? inner % 2 === 1 : inner >= 2) && countBefore(sel, sel.length, ch) >= m) {
      replaceRange(ta, s, e, sel.slice(m, sel.length - m), s, e - 2 * m);
      return;
    }
    var text = sel || placeholder;
    replaceRange(ta, s, e, mark + text + mark, s + m, s + m + text.length);
  }

  /** Titolo / elenco: mette (o toglie) un prefisso a ogni riga della selezione. */
  function togglePrefix(ta, prefix, placeholder) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var a = v.lastIndexOf('\n', s - 1) + 1;
    var b = v.indexOf('\n', e);
    if (b < 0) b = v.length;
    var block = v.slice(a, b) || placeholder;
    var lines = block.split('\n');
    var all = lines.every(function (l) { return l.indexOf(prefix) === 0; });
    var out = lines.map(function (l) { return all ? l.slice(prefix.length) : prefix + l; }).join('\n');
    replaceRange(ta, a, b, out, a, a + out.length);
  }

  function insertLink(ta) {
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = ta.value.slice(s, e) || 'testo del link';
    var url = window.prompt('Indirizzo del link (per esempio https://…)');
    if (!url) { ta.focus({ preventScroll: true }); return; }
    var md = '[' + sel + '](' + url.trim() + ')';
    replaceRange(ta, s, e, md, s, s + md.length);
  }

  /** Inserisce un blocco (come una foto) su righe tutte sue. */
  function insertBlock(ta, text) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, before = v.slice(0, s), after = v.slice(e);
    var pre = !before ? '' : /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    var post = !after ? '' : /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
    var at = s + pre.length + text.length;
    replaceRange(ta, s, e, pre + text + post, at, at);
  }

  var ACTIONS = {
    bold: function (ta) { toggleWrap(ta, '**', 'testo in grassetto'); },
    italic: function (ta) { toggleWrap(ta, '*', 'testo in corsivo'); },
    heading: function (ta) { togglePrefix(ta, '## ', 'Titolo'); },
    list: function (ta) { togglePrefix(ta, '- ', 'voce dell’elenco'); },
    link: insertLink,
  };

  document.querySelectorAll('[data-md]').forEach(function (box) {
    var source = box.querySelector('[data-md-source]');
    var toggle = box.querySelector('[data-md-toggle]');
    var preview = box.querySelector('[data-md-preview]');
    var panes = box.querySelector('[data-md-panes]');
    var bar = box.querySelector('[data-md-toolbar]');
    var photos = box.querySelector('[data-md-photos]');
    if (!source) return;

    // ───── anteprima dal vivo: accanto (o sotto) al testo, che resta sempre visibile e modificabile ─────
    var timer = 0;
    var ticket = 0;
    function refresh() {
      if (!preview || preview.hidden) return;
      var mine = ++ticket;
      fetch('/admin/preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md: source.value.slice(0, MAX_PREVIEW) }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (mine === ticket) preview.innerHTML = j.html || '<p class="muted">Niente da mostrare.</p>'; })
        .catch(function () { if (mine === ticket) preview.textContent = 'Anteprima non disponibile.'; });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 350); }
    source.addEventListener('input', schedule);

    if (toggle && preview) {
      toggle.addEventListener('click', function () {
        var open = preview.hidden;
        preview.hidden = !open;
        if (panes) panes.classList.toggle('has-preview', open);
        toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
        toggle.textContent = open ? 'Nascondi l’anteprima' : 'Anteprima';
        if (open) refresh();
      });
    }

    // ───── barra di formattazione ─────
    if (bar) {
      // il pulsante non deve togliere il fuoco al campo: altrimenti sul telefono si chiude la tastiera e la selezione si perde.
      // Solo «mousedown»: annullare «touchstart» sul telefono cancellerebbe anche il tocco (il click non arriverebbe più).
      bar.addEventListener('mousedown', function (e) { if (e.target.closest('[data-md-act]')) e.preventDefault(); });
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
        if (!ACTIONS[act]) return;
        ACTIONS[act](source);
        schedule();
      });
    }

    if (photos) {
      photos.addEventListener('click', function (e) {
        var p = e.target.closest('[data-md-photo]');
        if (!p) return;
        insertBlock(source, '![Descrizione della foto](' + p.getAttribute('data-md-photo') + ')');
        photos.hidden = true;
        if (bar) { var pb = bar.querySelector('[data-md-act="photos"]'); if (pb) pb.setAttribute('aria-expanded', 'false'); }
        schedule();
      });
    }

    // scorciatoie da tastiera: Ctrl/Cmd + B e + I
    source.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); ACTIONS.bold(source); schedule(); }
      else if (k === 'i') { e.preventDefault(); ACTIONS.italic(source); schedule(); }
    });
  });
})();
