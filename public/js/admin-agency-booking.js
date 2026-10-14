// Prenotazione di un'agenzia: ricerca nell'elenco delle agenzie e campi della nuova agenzia solo se serve.
(function () {
  'use strict';
  var form = document.querySelector('[data-agency-form]');
  if (!form) return;
  var select = form.querySelector('[data-agency]');
  var search = form.querySelector('[data-agency-search]');
  var box = form.querySelector('[data-newagency]');
  function toggle() { box.hidden = select.value !== 'new'; }
  select.addEventListener('change', toggle);
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    Array.prototype.forEach.call(select.options, function (o) {
      if (!o.value || o.value === 'new') { o.hidden = false; return; }
      o.hidden = q !== '' && o.text.toLowerCase().indexOf(q) === -1;
    });
    // se resta una sola agenzia, la si sceglie
    var shown = Array.prototype.filter.call(select.options, function (o) { return o.value && o.value !== 'new' && !o.hidden; });
    if (q && shown.length === 1) { select.value = shown[0].value; toggle(); }
  });
  toggle();
})();
