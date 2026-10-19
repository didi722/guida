// Incassi dalla banca: il file CSV si legge nel browser (UTF-8 o, se non lo è, Windows-1252 come lo esportano alcune banche) e finisce nel campo di testo;
// nell'elenco dei bonifici riconosciuti conta le fatture spuntate e il loro importo.
(function () {
  var file = document.querySelector('[data-bank-file]');
  var text = document.querySelector('[data-bank-text]');
  var status = document.querySelector('[data-bank-status]');
  if (file && text) {
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 6 * 1024 * 1024) { if (status) status.textContent = 'Il file è troppo grande: esporta un periodo più breve dalla banca.'; return; }
      var reader = new FileReader();
      reader.onload = function () {
        var buf = reader.result;
        var out;
        try { out = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { out = new TextDecoder('windows-1252').decode(buf); }
        text.value = out;
        if (status) status.textContent = 'Letto «' + f.name + '» (' + out.split(/\r\n|\n|\r/).length + ' righe). Premi «Controlla i bonifici».';
      };
      reader.onerror = function () { if (status) status.textContent = 'Non riesco a leggere il file: incolla il contenuto qui sotto.'; };
      reader.readAsArrayBuffer(f);
    });
  }

  var count = document.querySelector('[data-bank-count]');
  var apply = document.querySelector('.bank-apply');
  if (count && apply) {
    var update = function () {
      var boxes = apply.querySelectorAll('input[name="pay"]:checked, input[type="radio"]:checked');
      var cents = 0;
      boxes.forEach(function (b) { cents += Number(b.getAttribute('data-cents')) || 0; });
      count.textContent = boxes.length ? boxes.length + (boxes.length === 1 ? ' fattura selezionata' : ' fatture selezionate') + (cents ? ' · ' + (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : '') : 'Nessuna fattura selezionata';
    };
    apply.addEventListener('change', update);
    update();
  }
})();
