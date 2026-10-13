// Agenda: nel modulo «un tour preso fuori dal sito», gli orari si mostrano solo se non è «tutto il giorno».
(function () {
  var box = document.querySelector('[data-allday]');
  var times = document.querySelector('[data-times]');
  if (!box || !times) return;
  function sync() { times.hidden = box.checked; }
  box.addEventListener('change', sync);
  sync();
})();
