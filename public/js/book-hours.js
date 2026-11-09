// Ricerca per data delle agenzie: la durata si sceglie solo per i servizi a durata libera. Quando cambia il servizio, compare il menu della sua durata
// (ogni servizio ne ha uno suo, già scritto dal server) e gli altri spariscono; per gli altri servizi il campo sta nascosto.
(function () {
  'use strict';
  var form = document.querySelector('form.search-card');
  var tour = form && form.querySelector('select[name="tour"]');
  var field = form && form.querySelector('[data-hours-field]');
  if (!tour || !field) return;
  var menus = [].slice.call(field.querySelectorAll('select[data-hours-for]'));
  function sync() {
    var shown = false;
    menus.forEach(function (m) {
      var mine = m.getAttribute('data-hours-for') === tour.value;
      m.hidden = !mine;
      m.disabled = !mine; // un menu nascosto non deve partire con il modulo
      if (mine) shown = true;
    });
    field.hidden = !shown;
    form.classList.toggle('has-hours', shown);
  }
  tour.addEventListener('change', sync);
  sync();
})();
