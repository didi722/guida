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

  // Conferme (es. annulla prenotazione)
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });
  document.querySelectorAll('[data-select-all]').forEach(function (el) { el.addEventListener('focus', function () { el.select(); }); });
})();
