// Il giro interattivo dell'area agenzie: cinque passi sul sito vero. Un riquadro indica il punto da cliccare e il giro avanza quando lo si clicca,
// anche cambiando pagina (la posizione si ricorda nella scheda del browser). Non prenota mai nulla: si ferma prima di ogni conferma.
// I testi arrivano dal server (#tour-config, nella lingua della pagina). Parte da «Inizia il giro» (finestra della prima pagina), dal riquadro
// per chi è nuovo e da «Guida e FAQ»; finito o abbandonato, la prima volta si ricorda che è stato visto.
(function () {
  'use strict';
  var holder = document.getElementById('tour-config');
  if (!holder) return;
  var cfg;
  try { cfg = JSON.parse(holder.getAttribute('data-config')); } catch (e) { return; }
  var T = cfg.t;
  var KEY = 'guida.tour';
  var P = location.pathname;
  var Q = new URLSearchParams(location.search);
  var nodes = null; // { spot, tip }
  var current = null; // { target }
  var undo = []; // gli ascoltatori del passo in corso
  var timer = 0;

  function load() { try { var s = JSON.parse(sessionStorage.getItem(KEY)); return s && s.acct === cfg.acct ? s : null; } catch (e) { return null; } }
  function save(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* senza memoria della scheda il giro non prosegue tra le pagine */ } }
  function clear() { try { sessionStorage.removeItem(KEY); } catch (e) { /* niente */ } }
  function fill(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }
  function visible(n) { var r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function find(sel) { if (!sel) return null; var n = document.querySelector(sel); return n && visible(n) ? n : null; }
  function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  var CHECKOUT = /\/book\/checkout\/?$/;
  // mode: click (si clicca il punto), submit (si invia il modulo), interact (si prova, poi «Avanti»), info (si legge, poi «Avanti»; il punto non si clicca)
  var STOPS = [
    { step: 1, text: 's1', path: /\/b2b\/account\/?$/, target: '[data-tour="new"]', mode: 'click', go: cfg.urls.book, resume: [0, cfg.urls.home] },
    { step: 2, text: 's2', path: /\/book\/?$/, target: '.search-card', mode: 'submit', soft: true, auto: function () { return Q.has('date'); }, resume: [1, cfg.urls.book] },
    { step: 2, text: 's3', path: /\/book\/?$/, target: '.slot-list .slot', mode: 'click', missing: 's3m', missingTarget: '.search-card', prereq: function () { return Q.has('date'); }, back: 1, resume: [1, cfg.urls.book] },
    { step: 2, text: 's4', path: CHECKOUT, target: '#co-party', mode: 'interact', soft: true, resume: [1, cfg.urls.book] },
    { step: 3, text: 's5', path: CHECKOUT, target: '#option-submit', mode: 'info', skip: true, resume: [1, cfg.urls.book] },
    { step: 4, text: 's6', path: CHECKOUT, target: '#package-add', mode: 'info', skip: true, resume: [1, cfg.urls.book] },
    { step: 5, text: 's7', path: CHECKOUT, target: '.summary-card .policy-box', mode: 'info', skip: true, resume: [1, cfg.urls.book] },
    { step: 5, text: 's8', path: CHECKOUT, target: '.main-nav a[href$="/b2b/invoices"]', mode: 'click', go: cfg.urls.invoices, resume: [1, cfg.urls.book] },
    { step: 5, text: 's9', path: /\/b2b\/invoices\/?$/, target: '.page-head h1', mode: 'info', last: true, resume: [8, cfg.urls.invoices] },
  ];

  function ensure() {
    if (nodes) return nodes;
    nodes = { spot: mk('div', 'tour-spot'), tip: mk('div', 'tour-tip') };
    nodes.tip.setAttribute('role', 'dialog');
    nodes.tip.setAttribute('aria-live', 'polite');
    document.body.appendChild(nodes.spot);
    document.body.appendChild(nodes.tip);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    timer = setInterval(place, 400); // la pagina può cambiare altezza dopo il caricamento
    return nodes;
  }

  function teardown() {
    undo.forEach(function (f) { f(); });
    undo = [];
    current = null;
    if (nodes) {
      clearInterval(timer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      nodes.spot.remove(); nodes.tip.remove();
      nodes = null;
    }
  }

  function on(node, type, fn, capture) {
    node.addEventListener(type, fn, !!capture);
    undo.push(function () { node.removeEventListener(type, fn, !!capture); });
  }

  function place() {
    if (!nodes || !current) return;
    var tip = nodes.tip, spot = nodes.spot, t = current.target;
    var narrow = window.innerWidth < 640;
    tip.classList.toggle('is-sheet', narrow);
    var r = t && document.contains(t) ? t.getBoundingClientRect() : null;
    spot.hidden = !r;
    if (r) {
      spot.style.top = (r.top - 6) + 'px'; spot.style.left = (r.left - 6) + 'px';
      spot.style.width = (r.width + 12) + 'px'; spot.style.height = (r.height + 12) + 'px';
    }
    if (narrow) { tip.style.top = ''; tip.style.left = ''; return; }
    var th = tip.offsetHeight, tw = tip.offsetWidth;
    if (!r) { tip.style.top = Math.max(8, (window.innerHeight - th) / 2) + 'px'; tip.style.left = Math.max(8, (window.innerWidth - tw) / 2) + 'px'; return; }
    var below = r.bottom + 18;
    var top = below + th < window.innerHeight - 8 ? below : Math.max(8, r.top - 18 - th);
    tip.style.top = top + 'px';
    tip.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - tw - 8)) + 'px';
  }

  // porta il punto in vista (e, su telefono, sopra il riquadro che sta in basso)
  function reveal(t) {
    if (!t) return;
    t.scrollIntoView({ block: 'center' });
    requestAnimationFrame(function () {
      if (!nodes || window.innerWidth >= 640) return;
      var over = t.getBoundingClientRect().bottom - (window.innerHeight - nodes.tip.offsetHeight - 16);
      if (over > 0 && t.getBoundingClientRect().top - over > 70) window.scrollBy(0, over);
      place();
    });
  }

  function post() {
    try { fetch(cfg.done, { method: 'POST', headers: { 'X-Requested-With': 'tutorial' }, credentials: 'same-origin', keepalive: true }); } catch (e) { /* al prossimo accesso lo rivedrà */ }
  }
  function done() { post(); var b = document.querySelector('[data-tut-banner]'); if (b) b.remove(); }

  function finish() {
    var s = load();
    if (s && s.mark) done();
    clear();
    teardown();
  }

  function advance() {
    var s = load();
    if (!s) return;
    s.i += 1;
    save(s);
    teardown();
    run();
  }

  // un clic (o un invio) sul punto: si passa al prossimo e la pagina fa il suo corso; se non cambia pagina si ricontrolla poco dopo
  function advanceAfter() {
    var s = load();
    if (!s) return;
    s.i += 1;
    save(s);
    teardown();
    setTimeout(run, 700);
  }

  function show(stop, target, text, o) {
    var n = ensure();
    current = { target: target };
    n.tip.className = 'tour-tip' + (o.resume ? ' is-resume' : '');
    n.spot.className = 'tour-spot' + (stop.soft || o.soft ? ' is-soft' : '');
    n.tip.replaceChildren();
    if (!o.resume) n.tip.appendChild(mk('p', 'tour-count', fill(T.count, { n: stop.step, total: cfg.total }) + ' · ' + T.titles[stop.step]));
    n.tip.appendChild(mk('p', 'tour-text', text));
    if (o.hint) n.tip.appendChild(mk('p', 'tour-hint', T.hint));
    var actions = mk('div', 'tour-actions');
    var exit = mk('button', 'tour-exit', T.exit);
    exit.type = 'button';
    exit.addEventListener('click', finish);
    actions.appendChild(exit);
    if (o.skipLabel) {
      var sk = mk('button', 'tour-skip-stop', o.skipLabel);
      sk.type = 'button';
      sk.addEventListener('click', o.onSkip);
      actions.appendChild(sk);
    }
    if (o.next) {
      var nx = mk('button', 'btn btn-gold btn-sm', o.next);
      nx.type = 'button';
      nx.addEventListener('click', o.onNext);
      actions.appendChild(nx);
    }
    n.tip.appendChild(actions);
    place();
    reveal(target);
    on(document, 'keydown', function (e) { if (e.key === 'Escape') finish(); });
  }

  function showResume(s, stop) {
    show(stop, null, fill(T.resume, { n: stop.step, total: cfg.total }), {
      resume: true,
      next: T.resumeBtn,
      onNext: function () { s.i = stop.resume[0]; save(s); location.href = stop.resume[1]; },
    });
  }

  function run() {
    teardown();
    var s = load();
    if (!s) return;
    var stop = STOPS[s.i];
    if (!stop) { finish(); return; }
    if (!stop.path.test(P)) { showResume(s, stop); return; }
    if (stop.prereq && !stop.prereq()) { s.i = stop.back; save(s); run(); return; }
    if (stop.auto && stop.auto()) { s.i += 1; save(s); run(); return; }
    var target = find(stop.target);
    var text = T.stops[stop.text];
    var goOn = function () { if (stop.last) finish(); else advance(); };
    if (!target) {
      if (stop.skip) { s.i += 1; save(s); run(); return; }
      if (stop.go) { show(stop, null, text, { next: T.next, onNext: function () { s.i += 1; save(s); location.href = stop.go; } }); return; }
      if (stop.missing) { show(stop, find(stop.missingTarget), T.stops[stop.missing], { soft: true }); return; }
      show(stop, null, text, { next: stop.last ? T.finish : T.next, onNext: goOn });
      return;
    }
    if (stop.mode === 'click') {
      show(stop, target, text, stop.go ? { hint: true, skipLabel: T.skipStop, onSkip: function () { s.i += 1; save(s); location.href = stop.go; } } : { hint: true });
      on(document, 'click', function (e) { if (target.contains(e.target)) advanceAfter(); }, true);
    } else if (stop.mode === 'submit') {
      show(stop, target, text, {});
      on(target, 'submit', advanceAfter);
    } else if (stop.mode === 'interact') {
      show(stop, target, text, { next: T.next, onNext: advance });
      on(target, 'change', advanceAfter);
    } else {
      show(stop, target, text, { next: stop.last ? T.finish : T.next, onNext: goOn });
      // il punto si guarda, non si clicca: niente prenotazioni per sbaglio
      on(document, 'click', function (e) { if (target.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);
    }
  }

  function start(opts) {
    save({ acct: cfg.acct, i: 0, mark: !!(opts && opts.mark) });
    if (STOPS[0].path.test(P)) run();
    else location.href = cfg.urls.home;
  }

  window.guidaTour = { start: start, done: done };
  [].slice.call(document.querySelectorAll('[data-tour-start]')).forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); start({ mark: el.hasAttribute('data-tour-mark') }); });
  });
  run();
})();
