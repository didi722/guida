(function () {
  var doc = document.documentElement;
  var header = document.getElementById('site-header');

  // Tema chiaro/scuro
  document.querySelectorAll('.theme-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = doc.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      doc.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  });

  // Tabelle: ogni cella conosce la sua intestazione (serve alla vista a schede su telefono)
  document.querySelectorAll('table.table').forEach(function (table) {
    var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (td.tagName === 'TD' && heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]);
      });
    });
  });

  // Menu delle lingue: si chiude con un clic fuori o con Esc
  var langMenu = document.querySelector('.lang-menu');
  if (langMenu) {
    document.addEventListener('click', function (e) { if (!langMenu.contains(e.target)) langMenu.open = false; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') langMenu.open = false; });
  }

  // Menu laterale (mobile)
  var burger = document.querySelector('.hamburger');
  var menu = document.getElementById('side-menu');
  var scrim = document.getElementById('scrim');
  function setMenu(open) {
    if (!menu) return;
    if (open) { menu.hidden = false; if (scrim) scrim.hidden = false; }
    requestAnimationFrame(function () {
      doc.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    });
    if (!open) setTimeout(function () { if (!doc.classList.contains('menu-open')) { menu.hidden = true; if (scrim) scrim.hidden = true; } }, 400);
  }
  if (burger && menu) {
    burger.addEventListener('click', function () { setMenu(!doc.classList.contains('menu-open')); });
    if (scrim) scrim.addEventListener('click', function () { setMenu(false); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  // Header che si restringe allo scroll + barra di lettura
  var bar = document.getElementById('progress-bar');
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      if (header) header.classList.toggle('shrink', y > 24);
      if (bar) {
        var h = doc.scrollHeight - window.innerHeight;
        bar.style.width = (h > 0 ? Math.min(100, (y / h) * 100) : 0) + '%';
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Comparsa morbida dei blocchi (solo se JS attivo e senza "riduci movimento")
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('visible'); });
  }

  // Campi che ricaricano la pagina quando cambiano (per esempio persone, data e ore nella modifica di una prenotazione)
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    var wait = 0;
    var go = function () {
      var f = el.form;
      if (!f) return;
      if (f.requestSubmit) f.requestSubmit(); else f.submit();
    };
    el.addEventListener('change', function () {
      if (!el.hasAttribute('data-party')) return go();
      clearTimeout(wait); // adulti, bambini, infanti: più tocchi ravvicinati su − e + fanno un solo invio
      wait = setTimeout(go, 500);
    });
  });

  // Conferme (es. annulla prenotazione)
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) { e.preventDefault(); return; }
      // l'operazione può metterci qualche secondo (email, voucher): un solo invio, con l'attesa ben visibile
      if (f.dataset.sent) { e.preventDefault(); return; }
      f.dataset.sent = '1';
      f.querySelectorAll('button[type=submit]').forEach(function (b) { b.classList.add('is-busy'); b.setAttribute('aria-busy', 'true'); });
    });
  });
  window.addEventListener('pageshow', function (e) { // tornando indietro con il browser i pulsanti tornano utilizzabili
    if (!e.persisted) return;
    document.querySelectorAll('form[data-confirm]').forEach(function (f) { delete f.dataset.sent; f.querySelectorAll('.is-busy').forEach(function (b) { b.classList.remove('is-busy'); b.removeAttribute('aria-busy'); }); });
  });
  // «Copia il link»: copia il testo del campo indicato e lo conferma sul pulsante
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var field = document.querySelector(btn.getAttribute('data-copy'));
      if (!field) return;
      var done = function () { var old = btn.textContent; btn.textContent = btn.getAttribute('data-copied') || '✓'; setTimeout(function () { btn.textContent = old; }, 1800); };
      field.select();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(field.value).then(done, function () { document.execCommand('copy'); done(); });
      else { document.execCommand('copy'); done(); }
    });
  });
  document.querySelectorAll('[data-select-all]').forEach(function (el) { el.addEventListener('focus', function () { el.select(); }); });
})();
