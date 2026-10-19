// Menù dei paesi con ricerca (paese dell'azienda, prefisso del telefono). Il <select> resta nella pagina (invisibile): è lui che si invia con il modulo e che il
// browser controlla («campo obbligatorio»), quindi senza JavaScript funziona il menù del browser. Qui lo si sostituisce con un elenco in cui si può scrivere
// per cercare (nome in qualsiasi lingua del sito, sigla, prefisso), con bandiere e tastiera (frecce, Invio, Esc).
// Nel campo telefono, un numero scritto per esteso («+39 333…», «0039 333…», anche incollato o compilato dal browser) sceglie da solo il prefisso.
(function () {
  'use strict';
  var plain = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  var seq = 0;
  var current = null; // l'elenco aperto (uno alla volta)

  function enhance(select) {
    if (select.dataset.comboReady) return;
    select.dataset.comboReady = '1';
    var kind = select.dataset.combo;
    var phone = kind === 'phone';
    var uid = 'combo' + (++seq);
    var placeholderOption = select.options.length && select.options[0].value === '' ? select.options[0] : null;
    var items = [].slice.call(select.options).filter(function (o) { return o.value !== ''; }).map(function (o) {
      return { value: o.value, flag: o.getAttribute('data-flag') || '', name: o.getAttribute('data-name') || o.textContent, dial: o.getAttribute('data-dial') || '', main: o.hasAttribute('data-main'), key: o.getAttribute('data-s') || plain(o.textContent) };
    });

    var root = el('div', 'combo combo-' + kind);
    select.parentNode.insertBefore(root, select);
    root.appendChild(select);
    select.classList.add('combo-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var btn = el('button', 'combo-btn');
    btn.type = 'button';
    btn.id = uid + '-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', uid + '-list');
    var bFlag = el('span', 'flag'); bFlag.setAttribute('aria-hidden', 'true');
    var bText = el('span', 'combo-text');
    var caret = el('span', 'combo-caret'); caret.setAttribute('aria-hidden', 'true');
    btn.appendChild(bFlag); btn.appendChild(bText); btn.appendChild(caret);
    root.insertBefore(btn, select);

    var panel = el('div', 'combo-panel');
    panel.hidden = true;
    var search = el('input', 'combo-search');
    search.type = 'search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.setAttribute('autocapitalize', 'off');
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-controls', uid + '-list');
    search.setAttribute('aria-autocomplete', 'list');
    var searchLabel = select.getAttribute('data-search-label') || '';
    search.placeholder = searchLabel;
    search.setAttribute('aria-label', searchLabel);
    var list = el('ul', 'combo-list');
    list.id = uid + '-list';
    list.setAttribute('role', 'listbox');
    var none = el('p', 'combo-none', select.getAttribute('data-none-label') || '');
    none.hidden = true;
    panel.appendChild(search); panel.appendChild(list); panel.appendChild(none);
    root.appendChild(panel);

    items.forEach(function (it, i) {
      var li = el('li', 'combo-item');
      li.id = uid + '-o' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.value = it.value;
      var f = el('span', 'flag', it.flag); f.setAttribute('aria-hidden', 'true');
      li.appendChild(f);
      li.appendChild(el('span', 'combo-name', it.name));
      if (phone && it.dial) li.appendChild(el('span', 'combo-dial', '+' + it.dial.replace(/^(1)(\d{3})$/, '$1 $2')));
      it.li = li;
      list.appendChild(li);
    });

    var shown = items.slice();
    var active = -1;

    function selectedItem() { return items.filter(function (it) { return it.value === select.value; })[0] || null; }
    function dialText(it) { return '+' + it.dial.replace(/^(1)(\d{3})$/, '$1 $2'); }
    function sync() {
      var it = selectedItem();
      bFlag.textContent = it ? it.flag : '';
      bFlag.hidden = !it;
      bText.textContent = it ? (phone ? dialText(it) : it.name) : (placeholderOption ? placeholderOption.textContent : '');
      btn.classList.toggle('is-empty', !it);
      var label = select.getAttribute('aria-label') || '';
      btn.setAttribute('aria-label', (label ? label + ': ' : '') + (it ? it.name + (phone ? ' ' + dialText(it) : '') : bText.textContent));
      items.forEach(function (x) { x.li.setAttribute('aria-selected', it && x === it ? 'true' : 'false'); });
    }

    function setActive(i, scroll) {
      if (active >= 0 && shown[active]) shown[active].li.classList.remove('is-active');
      active = i;
      if (i >= 0 && shown[i]) {
        shown[i].li.classList.add('is-active');
        search.setAttribute('aria-activedescendant', shown[i].li.id);
        if (scroll !== false) shown[i].li.scrollIntoView({ block: 'nearest' });
      } else search.removeAttribute('aria-activedescendant');
    }

    function filter(q) {
      var text = plain(q).replace(/\+/g, ' ').trim();
      var tokens = text.split(/\s+/).filter(Boolean);
      var digits = text.replace(/\D/g, '');
      var numeric = phone && /^\+?\s*\d+$/.test(q.trim()); // «+81» o «81»: i prefissi che iniziano così (non quelli che contengono la cifra)
      var ok = items.filter(function (it) { return numeric ? it.dial.indexOf(digits) === 0 : tokens.every(function (t) { return it.key.indexOf(t) !== -1; }); });
      var rank = function (it) { return plain(it.name).indexOf(text) === 0 ? 0 : (digits && it.dial.indexOf(digits) === 0 ? 1 : 2); };
      if (tokens.length) ok = ok.map(function (it, i) { return { it: it, i: i, r: rank(it) }; }).sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.it; });
      items.forEach(function (it) { it.li.hidden = ok.indexOf(it) === -1; });
      ok.forEach(function (it) { list.appendChild(it.li); }); // in ordine di pertinenza (senza ricerca resta l'ordine alfabetico)
      shown = ok;
      none.hidden = ok.length > 0;
      setActive(ok.length ? 0 : -1, false);
    }

    function place() {
      panel.classList.remove('is-right');
      var r = panel.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) panel.classList.add('is-right');
    }

    function open() {
      if (current && current !== close) current(false);
      current = close;
      panel.hidden = false;
      root.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      search.value = '';
      filter('');
      var it = selectedItem();
      if (it) { var i = shown.indexOf(it); setActive(i, true); }
      place();
      search.focus({ preventScroll: true });
    }
    function close(refocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      root.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      if (current === close) current = null;
      if (refocus !== false) btn.focus({ preventScroll: true });
    }
    function choose(it) {
      select.value = it.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close(true);
    }

    btn.addEventListener('click', function () { if (panel.hidden) open(); else close(true); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (panel.hidden) open(); }
    });
    search.addEventListener('input', function () { filter(search.value); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) setActive(Math.min(shown.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) setActive(Math.max(0, active - 1)); }
      else if (e.key === 'Home' && !search.value) { e.preventDefault(); setActive(0); }
      else if (e.key === 'End' && !search.value) { e.preventDefault(); setActive(shown.length - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // il clic non toglie il fuoco alla ricerca prima di scegliere
    list.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.combo-item') : null;
      if (!li) return;
      var it = items.filter(function (x) { return x.li === li; })[0];
      if (it) choose(it);
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest ? e.target.closest('.combo-item') : null;
      var i = li ? shown.map(function (x) { return x.li; }).indexOf(li) : -1;
      if (i >= 0 && i !== active) setActive(i, false);
    });
    document.addEventListener('pointerdown', function (e) { if (!panel.hidden && !root.contains(e.target)) close(false); });
    select.addEventListener('change', sync);

    // l'etichetta del campo apre l'elenco (il campo vero è invisibile)
    var lbl = select.id ? document.querySelector('label[for="' + select.id + '"]') : null;
    if (lbl) lbl.addEventListener('click', function (e) { e.preventDefault(); btn.focus(); });

    // telefono: un numero scritto per esteso sceglie il prefisso e resta solo il resto
    var num = phone ? root.parentNode.querySelector('input[type="tel"]') : null;
    if (num) {
      var dials = items.filter(function (it) { return it.dial; });
      var absorb = function () {
        var m = /^\s*(\+|00)\s*([\d\s().-]+)$/.exec(num.value);
        if (!m) return;
        var digits = m[2].replace(/\D/g, '');
        var codes = dials.map(function (it) { return it.dial; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort(function (a, b) { return b.length - a.length; });
        for (var k = 0; k < codes.length; k++) {
          var d = codes[k];
          if (digits.indexOf(d) === 0 && digits.length - d.length >= 4) {
            var now = selectedItem();
            var pick = now && now.dial === d ? now : dials.filter(function (it) { return it.dial === d && it.main; })[0] || dials.filter(function (it) { return it.dial === d; })[0];
            select.value = pick.value;
            num.value = digits.slice(d.length);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
      };
      num.addEventListener('paste', function () { setTimeout(absorb, 0); });
      num.addEventListener('change', absorb);
      num.addEventListener('blur', absorb);
      num.addEventListener('input', function (e) { if (!e.inputType || e.inputType === 'insertFromPaste' || e.inputType === 'insertReplacementText') absorb(); });
    }

    sync();
  }

  [].slice.call(document.querySelectorAll('select[data-combo]')).forEach(enhance);
})();
