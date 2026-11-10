// Home: la fila delle recensioni avanza da sola, una scheda alla volta.
// Si ferma al passaggio del mouse, al tocco, con la tastiera, quando è aperto un «Vedi originale», quando la scheda non è visibile
// e con il pulsante di pausa; con «riduci movimento» non parte finché non la avvii tu. Senza JavaScript resta una fila da far scorrere.
(function () {
  'use strict';
  var root = document.querySelector('[data-reviews]');
  if (!root) return;
  var track = root.querySelector('[data-reviews-track]');
  var nav = root.querySelector('[data-reviews-nav]');
  var pauseBtn = root.querySelector('[data-rv="pause"]');
  if (!track || !nav) return;
  var cards = Array.prototype.slice.call(track.children);
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var paused = reduce; // scelta di chi guarda
  var held = false; // mouse, tocco o tastiera sulla fila
  var visible = true;
  var timer = null;
  var touchTimer = null;

  function overflows() { return track.scrollWidth - track.clientWidth > 4; }
  function showNav() { nav.hidden = !overflows(); }

  function indexNow() {
    var x = track.scrollLeft + 4;
    for (var i = 0; i < cards.length; i++) if (cards[i].offsetLeft + cards[i].offsetWidth / 2 > x) return i;
    return cards.length - 1;
  }
  function goTo(i) {
    var left = Math.max(0, cards[i].offsetLeft - 2);
    if (track.scrollTo) track.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' });
    else track.scrollLeft = left;
  }
  function step(dir) {
    if (!overflows()) return;
    var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    var i = indexNow();
    if (dir > 0) goTo(atEnd ? 0 : Math.min(cards.length - 1, i + 1));
    else goTo(track.scrollLeft <= 4 ? cards.length - 1 : Math.max(0, i - 1));
  }

  function canRun() {
    return !paused && !held && visible && !document.hidden && !track.querySelector('details[open]') && overflows();
  }
  function start() {
    stop();
    timer = window.setInterval(function () { if (canRun()) step(1); }, 6000);
  }
  function stop() { if (timer) window.clearInterval(timer); timer = null; }

  function setPaused(v) {
    paused = v;
    if (pauseBtn) {
      pauseBtn.setAttribute('aria-pressed', v ? 'true' : 'false');
      pauseBtn.setAttribute('aria-label', pauseBtn.getAttribute(v ? 'data-label-play' : 'data-label-pause'));
    }
    start();
  }

  nav.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rv]');
    if (!b) return;
    var what = b.getAttribute('data-rv');
    if (what === 'pause') return setPaused(!paused);
    step(what === 'next' ? 1 : -1);
    start(); // dopo un gesto, un nuovo intervallo intero prima di avanzare
  });
  root.addEventListener('mouseenter', function () { held = true; });
  root.addEventListener('mouseleave', function () { held = false; start(); });
  root.addEventListener('focusin', function () { held = true; });
  root.addEventListener('focusout', function () { held = false; start(); });
  track.addEventListener('touchstart', function () {
    held = true;
    if (touchTimer) window.clearTimeout(touchTimer);
  }, { passive: true });
  track.addEventListener('touchend', function () {
    if (touchTimer) window.clearTimeout(touchTimer);
    touchTimer = window.setTimeout(function () { held = false; start(); }, 8000);
  }, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; }, { threshold: 0.25 }).observe(root);
  }
  window.addEventListener('resize', showNav);
  setPaused(paused);
  showNav();
})();
