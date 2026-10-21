// Selettore di date del sito: sostituisce il calendario del browser con uno più curato (stessi colori del sito, giorni liberi in evidenza,
// quattro lingue, tastiera, a schermo intero in basso sul telefono). Il campo <input type="date"> resta nella pagina (invisibile): è lui che
// si invia con il modulo e che il browser controlla («campo obbligatorio», date minime e massime), quindi senza JavaScript funziona il calendario del browser.
// Un campo con data-native resta quello del browser.
(function () {
  'use strict';
  const lang = (document.documentElement.lang || 'it').slice(0, 2);
  const LOCALE = { it: 'it-IT', en: 'en-GB', es: 'es-ES', ja: 'ja-JP' }[lang] || 'en-GB';
  const TEXT = {
    it: { pick: 'Scegli la data', dialog: 'Scegli una data', today: 'Oggi', clear: 'Cancella', prev: 'Mese precedente', next: 'Mese successivo', months: 'Scegli il mese', prevYear: 'Anno precedente', nextYear: 'Anno successivo', close: 'Chiudi' },
    en: { pick: 'Pick a date', dialog: 'Choose a date', today: 'Today', clear: 'Clear', prev: 'Previous month', next: 'Next month', months: 'Choose month', prevYear: 'Previous year', nextYear: 'Next year', close: 'Close' },
    es: { pick: 'Elige la fecha', dialog: 'Elige una fecha', today: 'Hoy', clear: 'Borrar', prev: 'Mes anterior', next: 'Mes siguiente', months: 'Elegir mes', prevYear: 'Año anterior', nextYear: 'Año siguiente', close: 'Cerrar' },
    ja: { pick: '日付を選択', dialog: '日付を選択してください', today: '今日', clear: 'クリア', prev: '前の月', next: '次の月', months: '月を選択', prevYear: '前の年', nextYear: '次の年', close: '閉じる' },
  }[lang] || null;
  const L = TEXT || { pick: 'Pick a date', dialog: 'Choose a date', today: 'Today', clear: 'Clear', prev: 'Previous month', next: 'Next month', months: 'Choose month', prevYear: 'Previous year', nextYear: 'Next year', close: 'Close' };

  // ── date come stringhe AAAA-MM-GG (calcoli in UTC: nessun problema di fuso o ora legale) ──
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m + 1)}-${pad(d)}`; // m = 0..11
  const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? [Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8))] : null);
  const fromUtc = (ms) => { const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const toUtc = (s) => { const p = parse(s); return Date.UTC(p[0], p[1], p[2]); };
  const addDays = (s, n) => fromUtc(toUtc(s) + n * 86400000);
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const weekdayMon = (s) => (new Date(toUtc(s)).getUTCDay() + 6) % 7; // lunedì = 0
  const shiftMonths = (s, n) => { const p = parse(s); const t = p[1] + n; const y = p[0] + Math.floor(t / 12); const m = ((t % 12) + 12) % 12; return iso(y, m, Math.min(p[2], daysIn(y, m))); };
  const localToday = () => { const d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtFull = (s) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(toUtc(s)));
  const fmtLong = (s) => new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(toUtc(s)));
  const fmtMonth = (y, m) => cap(new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m, 1))));
  const monthName = (m) => cap(new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, m, 1))));
  const dowName = (i) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))); // 1 gen 2024 era un lunedì

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, text, label) => { const b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
  const NS = 'http://www.w3.org/2000/svg';
  function icon() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z', 'M4 9.5h16', 'M8.5 2.8v3.4M15.5 2.8v3.4']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  let current = null; // il selettore aperto (uno alla volta)

  function enhance(native) {
    if (native.dataset.dpReady || native.hasAttribute('data-native') || native.disabled) return;
    native.dataset.dpReady = '1';

    const wrap = el('span', 'dp');
    native.parentNode.insertBefore(wrap, native);
    wrap.appendChild(native);
    native.classList.add('dp-native');
    native.tabIndex = -1;
    native.setAttribute('aria-hidden', 'true');
    const field = button('dp-field');
    field.setAttribute('aria-haspopup', 'dialog');
    field.setAttribute('aria-expanded', 'false');
    const text = el('span', 'dp-text');
    field.append(text, icon());
    wrap.appendChild(field);

    const label = () => { const l = native.labels && native.labels[0]; return l ? l.firstElementChild && l.firstElementChild.classList.contains('label') ? l.firstElementChild.textContent.trim() : l.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : native.getAttribute('aria-label') || ''; };
    function refresh() {
      const v = native.value;
      text.textContent = v ? fmtFull(v) : L.pick;
      field.classList.toggle('is-empty', !v);
      field.setAttribute('aria-label', `${label()}${v ? ': ' + fmtLong(v) : ''}`.trim() || L.pick);
    }
    // se la pagina cambia il valore da codice (o il modulo viene azzerato) il campo visibile lo segue
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(native, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); refresh(); } });
    if (native.form) native.form.addEventListener('reset', () => setTimeout(refresh, 0));
    native.addEventListener('focus', () => { wrap.classList.add('is-focus'); if (!current || current.native !== native) open(); }); // etichetta toccata o campo obbligatorio vuoto: si apre il calendario
    native.addEventListener('blur', () => wrap.classList.remove('is-focus'));
    // il calendario del browser non deve aprirsi mai (nemmeno toccando l'icona o l'etichetta): il campo vero resta solo per il modulo
    native.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    native.addEventListener('mousedown', (e) => e.preventDefault());
    if (typeof native.showPicker === 'function') native.showPicker = () => {};
    refresh();

    function commit(value) {
      desc.set.call(native, value);
      refresh();
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function open() {
      if (current) current.close(false);
      const min = parse(native.min) ? native.min : null;
      const max = parse(native.max) ? native.max : null;
      const today = localToday();
      const selected = native.value || null;
      const inRange = (s) => (!min || s >= min) && (!max || s <= max);
      let cursor = selected || (inRange(today) ? today : min && today < min ? min : max && today > max ? max : today);
      let view = 'days';

      const sheet = window.matchMedia('(max-width: 560px)').matches;
      const backdrop = sheet ? el('div', 'dp-backdrop') : null;
      const pop = el('div', `dp-pop${sheet ? ' is-sheet' : ''}`);
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-modal', 'false');
      pop.setAttribute('aria-label', L.dialog);

      const head = el('div', 'dp-head');
      const prev = button('dp-nav', '‹');
      const next = button('dp-nav', '›');
      const title = button('dp-title');
      title.setAttribute('aria-label', L.months);
      head.append(prev, title, next);
      const body = el('div', 'dp-body');
      const foot = el('div', 'dp-foot');
      const todayBtn = button('dp-link', L.today);
      const clearBtn = button('dp-link', L.clear);
      const closeBtn = button('dp-link dp-close', L.close);
      foot.append(todayBtn, clearBtn, closeBtn);
      pop.append(head, body, foot);

      let lockH = 0;
      function render(focus) {
        const [y, m] = parse(cursor);
        body.replaceChildren();
        body.style.minHeight = lockH ? `${lockH}px` : ''; // le frecce restano ferme: mesi e anni occupano quanto un mese di sei settimane
        if (view === 'months') {
          title.textContent = String(y);
          title.setAttribute('aria-label', String(y));
          prev.setAttribute('aria-label', L.prevYear);
          next.setAttribute('aria-label', L.nextYear);
          prev.disabled = !!(min && iso(y - 1, 11, 31) < min);
          next.disabled = !!(max && iso(y + 1, 0, 1) > max);
          const grid = el('div', 'dp-months');
          for (let i = 0; i < 12; i++) {
            const first = iso(y, i, 1);
            const last = iso(y, i, daysIn(y, i));
            const b = button('dp-month' + (selected && selected.slice(0, 7) === first.slice(0, 7) ? ' is-selected' : '') + (today.slice(0, 7) === first.slice(0, 7) ? ' is-today' : ''), monthName(i));
            b.disabled = !!((min && last < min) || (max && first > max));
            b.addEventListener('click', () => { cursor = iso(y, i, Math.min(parse(cursor)[2], daysIn(y, i))); view = 'days'; render(true); });
            if (i === m) b.dataset.focus = '1';
            grid.appendChild(b);
          }
          body.appendChild(grid);
        } else {
          title.textContent = fmtMonth(y, m);
          title.setAttribute('aria-label', `${fmtMonth(y, m)} — ${L.months}`);
          prev.setAttribute('aria-label', L.prev);
          next.setAttribute('aria-label', L.next);
          prev.disabled = !!(min && iso(y, m, 1) <= min);
          next.disabled = !!(max && iso(y, m, daysIn(y, m)) >= max);
          const grid = el('div', 'dp-grid');
          grid.setAttribute('role', 'grid');
          for (let i = 0; i < 7; i++) grid.appendChild(el('span', 'dp-dow', dowName(i)));
          const first = iso(y, m, 1);
          for (let i = 0; i < weekdayMon(first); i++) grid.appendChild(el('span', 'dp-blank'));
          for (let d = 1; d <= daysIn(y, m); d++) {
            const s = iso(y, m, d);
            const b = button('dp-day' + (s === selected ? ' is-selected' : '') + (s === today ? ' is-today' : ''), String(d), fmtLong(s));
            b.disabled = !inRange(s);
            b.tabIndex = s === cursor ? 0 : -1;
            if (s === selected) b.setAttribute('aria-pressed', 'true');
            if (s === cursor) b.dataset.focus = '1';
            b.dataset.date = s;
            grid.appendChild(b);
          }
          while (grid.children.length < 7 + 42) grid.appendChild(el('span', 'dp-blank')); // sempre sei righe, come i mesi più lunghi: il calendario non cambia altezza
          body.appendChild(grid);
          if (!lockH) lockH = body.offsetHeight;
        }
        todayBtn.hidden = !inRange(today); // «Oggi» c'è solo se oggi si può scegliere
        clearBtn.hidden = native.required || !selected;
        place(); // prima si mette al suo posto, poi si porta il fuoco (altrimenti il browser scorre la pagina fino al fondo, dove il calendario nasce)
        if (focus) { const f = body.querySelector('[data-focus]'); if (f && !f.disabled) f.focus({ preventScroll: true }); }
      }

      function move(to) {
        if (!parse(to) || !inRange(to)) return;
        cursor = to;
        render(true);
      }

      body.addEventListener('click', (e) => {
        const b = e.target.closest('.dp-day');
        if (b && !b.disabled) { commit(b.dataset.date); close(true); }
      });
      body.addEventListener('keydown', (e) => {
        if (view !== 'days') return;
        const keys = { ArrowLeft: () => addDays(cursor, -1), ArrowRight: () => addDays(cursor, 1), ArrowUp: () => addDays(cursor, -7), ArrowDown: () => addDays(cursor, 7),
          Home: () => addDays(cursor, -weekdayMon(cursor)), End: () => addDays(cursor, 6 - weekdayMon(cursor)), PageUp: () => shiftMonths(cursor, e.shiftKey ? -12 : -1), PageDown: () => shiftMonths(cursor, e.shiftKey ? 12 : 1) };
        if (keys[e.key]) { e.preventDefault(); move(keys[e.key]()); }
      });
      prev.addEventListener('click', () => { cursor = view === 'months' ? shiftMonths(cursor, -12) : shiftMonths(cursor, -1); render(false); });
      next.addEventListener('click', () => { cursor = view === 'months' ? shiftMonths(cursor, 12) : shiftMonths(cursor, 1); render(false); });
      title.addEventListener('click', () => { view = view === 'days' ? 'months' : 'days'; render(true); });
      todayBtn.addEventListener('click', () => { if (inRange(today)) { commit(today); close(true); } });
      clearBtn.addEventListener('click', () => { commit(''); close(true); });
      closeBtn.addEventListener('click', () => close(true));
      pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === 'Tab') close(true); // il Tab riparte dal campo, come se il calendario non ci fosse
      });

      function place() {
        if (sheet) return;
        const r = field.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        const root = document.documentElement;
        let left = r.left + window.scrollX;
        left = Math.max(window.scrollX + 8, Math.min(left, window.scrollX + root.clientWidth - w - 8));
        let top = r.bottom + window.scrollY + 6;
        if (r.bottom + h + 12 > window.innerHeight && r.top - h - 12 > 0) top = r.top + window.scrollY - h - 6; // non c'è posto sotto: sopra il campo
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
      }
      const onOutside = (e) => { if (!pop.contains(e.target) && !wrap.contains(e.target)) close(false); };
      const onMove = () => place();

      function close(refocus) {
        if (!current || current.pop !== pop) return;
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onMove);
        window.removeEventListener('scroll', onMove, true);
        pop.remove();
        if (backdrop) backdrop.remove();
        field.setAttribute('aria-expanded', 'false');
        wrap.classList.remove('is-open');
        current = null;
        if (refocus) field.focus({ preventScroll: true });
      }

      if (backdrop) { backdrop.addEventListener('click', () => close(false)); document.body.appendChild(backdrop); }
      document.body.appendChild(pop);
      field.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      current = { native, pop, close };
      render(true);
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('resize', onMove);
      window.addEventListener('scroll', onMove, true);
    }

    field.addEventListener('click', () => { if (current && current.native === native) current.close(true); else open(); });
    field.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && !(current && current.native === native)) { e.preventDefault(); open(); } });
  }

  function scan(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
  }
  scan();
  // campi aggiunti dopo (per esempio un blocco di modulo creato dalla pagina)
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches && n.matches('input[type="date"]')) enhance(n); else scan(n); } }); }).observe(document.body, { childList: true, subtree: true });
})();
