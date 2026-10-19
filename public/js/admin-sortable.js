// Elenchi che si riordinano trascinando le righe dalla maniglia (mouse e dito), con le frecce ▲ ▼ o con la tastiera, e si salvano da soli:
// Sito › Tour (l'ordine nel sito) e Lista d'attesa (chi passa prima, per ogni servizio e giorno). Durante il trascinamento le righe non cambiano
// posto nella pagina: si spostano solo in modo visivo (transform), così il dito o il mouse non perdono mai la riga; l'ordine vero si applica quando si lascia.
// Ogni elenco (un <tbody data-sortable>) dice dove salvare (data-order-url), quale attributo delle righe le identifica (data-key-attr, di partenza data-slug),
// con quale nome mandare la sequenza (data-field, di partenza slugs) e quali altri dati accompagnano la richiesta (data-payload, un oggetto JSON).
(function () {
  document.querySelectorAll('[data-sortable]').forEach(init);

  function init(tbody) {
    var url = tbody.getAttribute('data-order-url');
    var attr = tbody.getAttribute('data-key-attr') || 'data-slug';
    var field = tbody.getAttribute('data-field') || 'slugs';
    var extra = {};
    try { extra = JSON.parse(tbody.getAttribute('data-payload') || '{}'); } catch (e) { extra = {}; }
    var wrap = tbody.closest('[data-sortable-wrap]') || document;
    var statusEl = wrap.querySelector('[data-order-status]') || document.querySelector('[data-order-status]');
    var hideTimer;
    var saving = Promise.resolve();

    function rows() { return Array.prototype.slice.call(tbody.querySelectorAll('tr[' + attr + ']')); }

    /** I numeri d'ordine mostrati nelle righe (se ci sono) seguono la nuova sequenza. */
    function renumber() { rows().forEach(function (r, i) { var n = r.querySelector('[data-rank]'); if (n) n.textContent = String(i + 1); }); }

    function say(text, bad) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.hidden = !text;
      statusEl.className = 'order-status' + (bad ? ' is-error' : '');
      clearTimeout(hideTimer);
      if (text && !bad) hideTimer = setTimeout(function () { statusEl.hidden = true; }, 3000);
    }

    function save() {
      var keys = rows().map(function (r) { return r.getAttribute(attr); });
      var payload = Object.assign({}, extra);
      payload[field] = keys;
      renumber();
      say('Salvo l’ordine…');
      // un salvataggio alla volta, nell'ordine in cui sono stati chiesti
      saving = saving.then(function () {
        return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(function () { say(tbody.getAttribute('data-saved') || 'Ordine salvato: sul sito è già così.'); })
          .catch(function () { say('Non sono riuscito a salvare l’ordine. Ricarica la pagina e riprova.', true); });
      });
    }

    /** Sposta una riga di una posizione (−1 su, +1 giù). @returns {boolean} se si è mossa */
    function move(row, delta) {
      var list = rows();
      var i = list.indexOf(row);
      var j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return false;
      tbody.insertBefore(row, delta < 0 ? list[j] : list[j].nextSibling);
      return true;
    }

    // frecce ▲ ▼
    tbody.addEventListener('click', function (e) {
      var b = e.target.closest('[data-move]');
      if (!b) return;
      var row = b.closest('tr');
      if (move(row, Number(b.getAttribute('data-move')))) {
        save();
        b.focus();
        row.scrollIntoView({ block: 'nearest' });
      }
    });

    // tastiera: sulla maniglia, freccia su / giù
    tbody.addEventListener('keydown', function (e) {
      var h = e.target.closest('.drag-handle');
      if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      var row = h.closest('tr');
      if (move(row, e.key === 'ArrowUp' ? -1 : 1)) {
        save();
        h.focus();
        row.scrollIntoView({ block: 'nearest' });
      }
    });

    // trascinamento (mouse, dito, penna)
    var drag = null;

    function settle() {
      // dove finirebbe la riga trascinata: quante delle altre hanno il centro sopra il suo centro
      var d = drag;
      var dy = d.lastClientY + window.scrollY - d.startPageY;
      var center = d.rects[d.from].top + d.rects[d.from].h / 2 + dy;
      var to = 0;
      d.rects.forEach(function (r, i) { if (i !== d.from && r.top + r.h / 2 < center) to++; });
      d.to = to;
      var shift = d.rects[d.from].h;
      d.list.forEach(function (row, i) {
        if (i === d.from) { row.style.transform = 'translateY(' + dy + 'px)'; return; }
        var y = 0;
        if (d.from < to && i > d.from && i <= to) y = -shift;
        else if (d.from > to && i >= to && i < d.from) y = shift;
        row.style.transform = y ? 'translateY(' + y + 'px)' : '';
      });
    }

    function autoscroll() {
      if (!drag) return;
      var edge = 70;
      var y = drag.lastClientY;
      var step = 0;
      if (y < edge) step = -Math.ceil((edge - y) / 5);
      else if (y > window.innerHeight - edge) step = Math.ceil((y - (window.innerHeight - edge)) / 5);
      if (step) { window.scrollBy(0, step); settle(); }
      drag.raf = requestAnimationFrame(autoscroll);
    }

    function finish(apply) {
      if (!drag) return;
      var d = drag;
      drag = null;
      cancelAnimationFrame(d.raf);
      d.list.forEach(function (row) { row.style.transform = ''; row.classList.remove('is-dragging'); });
      tbody.classList.remove('is-sorting');
      document.removeEventListener('keydown', onKey);
      if (!apply || d.to === d.from) return;
      var others = d.list.filter(function (r) { return r !== d.row; });
      tbody.insertBefore(d.row, others[d.to] || null);
      save();
    }

    function onKey(e) { if (e.key === 'Escape') finish(false); }

    tbody.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.drag-handle');
      if (!h || (e.pointerType === 'mouse' && e.button !== 0) || drag) return;
      var list = rows();
      var row = h.closest('tr');
      drag = {
        row: row,
        list: list,
        from: list.indexOf(row),
        to: list.indexOf(row),
        startPageY: e.clientY + window.scrollY,
        lastClientY: e.clientY,
        rects: list.map(function (r) { var b = r.getBoundingClientRect(); return { top: b.top + window.scrollY, h: b.height }; }),
        raf: 0,
      };
      row.classList.add('is-dragging');
      tbody.classList.add('is-sorting');
      if (h.setPointerCapture) { try { h.setPointerCapture(e.pointerId); } catch (err) { /* il puntatore non è più attivo */ } }
      document.addEventListener('keydown', onKey);
      drag.raf = requestAnimationFrame(autoscroll);
      e.preventDefault();
    });
    tbody.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.lastClientY = e.clientY;
      settle();
    });
    tbody.addEventListener('pointerup', function () { finish(true); });
    tbody.addEventListener('pointercancel', function () { finish(false); });
  }
})();
