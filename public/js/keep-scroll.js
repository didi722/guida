// Dopo un clic che riporta alla stessa pagina (mese successivo, «Mostra/Nascondi», «Applica»…) la pagina resta dov'era invece di tornare in cima.
// Si ricorda la posizione solo per il passaggio successivo: se la pagina che si apre è la stessa (stesso indirizzo, senza #ancora) si riporta lì.
// Nel pannello e nell'area agenzie vale anche per i collegamenti (data-links); sul sito pubblico solo per i moduli.
(function () {
  'use strict';
  var KEY = 'keep-scroll';
  var tag = document.currentScript;
  var links = !!(tag && tag.hasAttribute('data-links'));

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify({ p: location.pathname, y: window.scrollY, t: Date.now() })); } catch (e) { /* senza memoria: si resta in cima */ }
  }

  document.addEventListener('submit', function (e) { if (!e.defaultPrevented) save(); }, true);
  if (links) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-top')) return;
      var u;
      try { u = new URL(a.href, location.href); } catch (x) { return; }
      if (u.origin === location.origin && u.pathname === location.pathname && !u.hash) save();
    }, true);
  }

  try {
    var raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    var s = JSON.parse(raw);
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type !== 'navigate') return; // ricarica o «indietro»: ci pensa già il browser
    if (!s || s.p !== location.pathname || Date.now() - s.t > 20000 || location.hash) return;
    window.scrollTo({ top: s.y, left: 0, behavior: 'instant' }); // senza l'animazione del sito: deve restare lì, non scivolarci
  } catch (e) { /* niente */ }
})();
