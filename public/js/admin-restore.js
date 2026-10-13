// Ripristino da una copia: carica lo zip (con la percentuale), poi apre la pagina che mostra cosa cambierebbe.
// Nella pagina di controllo il pulsante «Ripristina» si accende solo dopo aver scritto la parola di conferma.
(function () {
  var box = document.querySelector('[data-restore-upload]');
  if (box) {
    var input = box.querySelector('[data-restore-input]');
    var send = box.querySelector('[data-restore-send]');
    var status = box.querySelector('[data-restore-status]');
    var busy = false;
    var idle = function (message) {
      busy = false;
      input.disabled = false;
      send.disabled = !(input.files && input.files.length);
      status.textContent = message || '';
    };
    input.addEventListener('change', function () {
      status.textContent = '';
      send.disabled = busy || !(input.files && input.files.length);
    });
    send.addEventListener('click', function () {
      var file = input.files && input.files[0];
      if (!file || busy) return;
      if (!/\.zip$/i.test(file.name)) { status.textContent = 'Scegli il file .zip che hai scaricato da questa pagina.'; return; }
      busy = true;
      input.disabled = true;
      send.disabled = true;
      status.textContent = 'Carico… 0%';
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/admin/backup/restore/upload');
      xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) status.textContent = 'Carico… ' + Math.round((100 * e.loaded) / e.total) + '%';
      };
      xhr.upload.onload = function () { status.textContent = 'Controllo la copia… (non sto cambiando nulla)'; };
      xhr.onload = function () {
        var reply = null;
        try { reply = JSON.parse(xhr.responseText); } catch (e) { /* risposta non JSON */ }
        if (xhr.status === 200 && reply && reply.ok) { window.location.href = reply.url; return; }
        idle((reply && reply.error) || 'Caricamento non riuscito (errore ' + xhr.status + '). Non ho cambiato nulla.');
      };
      xhr.onerror = function () { idle('Connessione interrotta durante il caricamento: riprova. Non ho cambiato nulla.'); };
      xhr.send(file);
    });
  }

  var form = document.querySelector('[data-restore-form]');
  if (form) {
    var word = form.querySelector('[data-restore-confirm]');
    var go = form.querySelector('[data-restore-submit]');
    var sync = function () { go.disabled = word.value.trim().toUpperCase() !== 'RIPRISTINA'; };
    word.addEventListener('input', sync);
    sync();
    // si può scegliere cliccando su tutta la scheda, non solo sul cerchietto
    form.querySelectorAll('.mode-option').forEach(function (card) {
      card.addEventListener('click', function (e) {
        var radio = card.querySelector('input[type=radio]');
        if (radio && !e.target.closest('a, input, label')) radio.checked = true;
      });
    });
  }
})();
