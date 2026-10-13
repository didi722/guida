// Widget di prenotazione: persone → calendario → orari → "Continua".
(function () {
  var root = document.querySelector('[data-widget]');
  if (!root) return;

  var tour = root.dataset.tour;
  var model = root.dataset.model;
  var max = parseInt(root.dataset.max, 10);
  var unit = parseInt(root.dataset.unit, 10);
  var lang = root.dataset.lang;
  var minDate = root.dataset.minDate;
  var bookUrl = root.dataset.bookUrl;
  var L = JSON.parse(root.dataset.i18n);

  var cal = root.querySelector('[data-cal]');
  var slotsEl = root.querySelector('[data-slots]');
  var summary = root.querySelector('[data-summary]');
  var cont = root.querySelector('[data-continue]');
  var paxOut = root.querySelector('[data-pax]');

  var langSel = root.querySelector('[data-tour-lang]');
  var state = { tl: langSel ? langSel.value : '', pax: Math.min(2, max), month: minDate.slice(0, 7), days: {}, date: null, time: null, slots: [], loading: false };
  var seq = 0;

  var locale = { it: 'it-IT', es: 'es-ES', ja: 'ja-JP' }[lang] || 'en-GB';
  var money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  function fill(s, vars) { return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k]; }); }
  function total() { return model === 'person' ? unit * state.pax : unit; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function monthLabel(m) {
    var p = m.split('-');
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+p[0], +p[1] - 1, 15)));
  }
  function shiftMonth(m, d) {
    var p = m.split('-'); var dt = new Date(Date.UTC(+p[0], +p[1] - 1 + d, 1));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function getJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function tlParam() { return state.tl ? '&tl=' + encodeURIComponent(state.tl) : ''; }

  function loadMonth() {
    var my = ++seq;
    state.loading = true; state.error = false;
    renderCal();
    getJson('/api/availability?tour=' + encodeURIComponent(tour) + '&month=' + state.month + '&pax=' + state.pax + tlParam())
      .then(function (d) { if (my !== seq) return; state.days = d.days || {}; state.loading = false; renderCal(); })
      .catch(function () { if (my !== seq) return; state.loading = false; state.error = true; renderCal(); });
  }

  function loadSlots() {
    var my = ++seq;
    slotsEl.hidden = false;
    slotsEl.replaceChildren(el('p', 'muted small', L.loading));
    getJson('/api/slots?tour=' + encodeURIComponent(tour) + '&date=' + state.date + '&pax=' + state.pax + tlParam())
      .then(function (d) { if (my !== seq) return; state.slots = d.slots || []; renderSlots(); })
      .catch(function () { if (my !== seq) return; slotsEl.replaceChildren(el('p', 'muted small', L.error)); });
  }

  function renderCal() {
    var p = state.month.split('-');
    var y = +p[0], m = +p[1];
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    var offset = (first + 6) % 7;
    var count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var head = el('div', 'cal-head');
    var prev = el('button', 'cal-nav', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', L.prev);
    prev.disabled = state.month <= minDate.slice(0, 7);
    prev.addEventListener('click', function () { state.month = shiftMonth(state.month, -1); loadMonth(); });
    var next = el('button', 'cal-nav', '›'); next.type = 'button'; next.setAttribute('aria-label', L.next);
    next.addEventListener('click', function () { state.month = shiftMonth(state.month, 1); loadMonth(); });
    var title = el('strong', 'cal-title', monthLabel(state.month)); title.setAttribute('aria-live', 'polite');
    head.append(prev, title, next);

    var grid = el('div', 'cal-grid'); grid.setAttribute('role', 'grid');
    var dows = { it: ['L', 'M', 'M', 'G', 'V', 'S', 'D'], es: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], ja: ['月', '火', '水', '木', '金', '土', '日'] }[lang] || ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    dows.forEach(function (d) { grid.append(el('span', 'cal-dow', d)); });
    for (var i = 0; i < offset; i++) grid.append(el('span'));
    for (var d = 1; d <= count; d++) {
      var iso = state.month + '-' + pad(d);
      var avail = state.days[iso];
      var b = el('button', 'cal-day' + (avail ? ' is-avail' : '') + (iso === state.date ? ' is-selected' : ''), String(d));
      b.type = 'button'; b.dataset.date = iso;
      if (!avail) b.disabled = true;
      else {
        b.addEventListener('click', onDay);
        b.setAttribute('aria-label', new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')));
      }
      if (iso === state.date) b.setAttribute('aria-pressed', 'true');
      grid.append(b);
    }
    var foot = null;
    if (state.loading) foot = el('p', 'muted small', L.loading);
    else if (state.error) foot = el('p', 'muted small', L.error);
    else if (!Object.keys(state.days).length) foot = el('p', 'muted small', L.noMonth);
    cal.replaceChildren.apply(cal, [head, grid].concat(foot ? [foot] : []));
    cal.classList.toggle('is-loading', state.loading);
  }

  function onDay(e) {
    state.date = e.currentTarget.dataset.date; state.time = null;
    renderCal(); update(); loadSlots();
  }

  function renderSlots() {
    if (!state.slots.length) { slotsEl.replaceChildren(el('p', 'muted small', L.noSlots)); return; }
    var wrap = el('div', 'slot-grid'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', L.pickTime);
    state.slots.forEach(function (s) {
      var b = el('button', 'slot-btn' + (s.time === state.time ? ' is-selected' : ''));
      b.type = 'button'; b.dataset.time = s.time;
      b.append(el('strong', null, s.time));
      var note = model === 'person' ? [s.joined ? L.joined : '', s.lang && L.langNames[s.lang] ? fill(L.inLang, { lang: L.langNames[s.lang] }) : '', s.left <= 4 ? fill(L.left, { n: s.left }) : ''].filter(Boolean).join(' · ') : '';
      if (note) b.append(el('small', null, note));
      b.addEventListener('click', function () { state.time = s.time; renderSlots(); update(); });
      wrap.append(b);
    });
    slotsEl.replaceChildren(el('p', 'label', L.pickTime), wrap);
  }

  function update() {
    paxOut.textContent = String(state.pax);
    if (state.date && state.time) {
      summary.hidden = false;
      var dateStr = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(state.date + 'T12:00:00Z'));
      summary.replaceChildren(el('span', null, dateStr + ' · ' + state.time + ' · ' + (state.pax === 1 ? L.person1 : fill(L.personN, { n: state.pax }))), el('strong', null, L.total + ' ' + money.format(total() / 100)));
      cont.href = bookUrl + '?tour=' + encodeURIComponent(tour) + '&date=' + state.date + '&time=' + state.time + '&pax=' + state.pax + tlParam();
      cont.setAttribute('aria-disabled', 'false');
    } else {
      summary.hidden = true;
      cont.setAttribute('aria-disabled', 'true');
      cont.href = '#book';
    }
  }

  cont.addEventListener('click', function (e) { if (cont.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  function setPax(n) {
    n = Math.max(1, Math.min(max, n));
    if (n === state.pax) return;
    state.pax = n; state.time = null;
    update(); loadMonth();
    if (state.date) loadSlots();
  }
  root.querySelector('[data-pax-minus]').addEventListener('click', function () { setPax(state.pax - 1); });
  root.querySelector('[data-pax-plus]').addEventListener('click', function () { setPax(state.pax + 1); });

  if (langSel) langSel.addEventListener('change', function () { state.tl = langSel.value; state.time = null; update(); loadMonth(); if (state.date) loadSlots(); });

  update();
  loadMonth();
})();
