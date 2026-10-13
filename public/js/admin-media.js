// Caricamento immagini dal pannello: la foto viene ridimensionata e ricodificata nel browser (JPEG),
// in due misure (1600 px e 640 px); così pesa poco e perde i dati di posizione.
(function () {
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImage(file); });
    }
    return viaImage(file);
  }
  function viaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Il file non è un’immagine leggibile.')); };
      img.src = url;
    });
  }
  function render(src, maxSide, quality) {
    var w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    var k = Math.min(1, maxSide / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // niente trasparenze: sfondo bianco
    ctx.drawImage(src, 0, 0, w, h);
    var url = canvas.toDataURL('image/jpeg', quality);
    while (url.length * 0.75 > 3.6e6 && quality > 0.5) { quality -= 0.1; url = canvas.toDataURL('image/jpeg', quality); }
    return { url: url, w: w, h: h };
  }
  function upload(file) {
    return loadBitmap(file).then(function (bmp) {
      var large = render(bmp, 1600, 0.85), small = render(bmp, 640, 0.8);
      return fetch('/admin/media', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ large: large.url, small: small.url, width: large.w, height: large.h }),
      }).then(function (res) { return res.json().then(function (j) { if (!res.ok || !j.ok) throw new Error(j.error || 'Caricamento non riuscito.'); return j; }); });
    });
  }

  document.querySelectorAll('[data-upload]').forEach(function (box) {
    var input = box.querySelector('[data-upload-input]');
    var status = box.querySelector('[data-upload-status]');
    if (!input) return;
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      var done = 0, failed = 0, last = null;
      status.textContent = 'Carico… 0/' + files.length;
      files.reduce(function (p, f) {
        return p.then(function () {
          return upload(f).then(function (r) { last = r; done++; }, function (e) { failed++; status.textContent = e.message; });
        }).then(function () { if (!failed) status.textContent = 'Carico… ' + done + '/' + files.length; });
      }, Promise.resolve()).then(function () {
        input.value = '';
        if (box.hasAttribute('data-media-picker')) {
          // dentro un modulo di modifica: aggiunge le nuove immagini all'elenco e seleziona l'ultima
          if (last) box.dispatchEvent(new CustomEvent('media-added', { detail: last }));
          if (!failed) status.textContent = done + (done === 1 ? ' immagine caricata.' : ' immagini caricate.');
        } else if (!failed) location.reload();
      });
    });
  });

  // selettore di copertina nei moduli: aggiunge la miniatura appena caricata
  document.querySelectorAll('[data-media-picker]').forEach(function (box) {
    box.addEventListener('media-added', function (e) {
      var grid = box.querySelector('.media-picker');
      if (!grid) return;
      var label = document.createElement('label');
      label.className = 'media-choice';
      var radio = document.createElement('input');
      radio.type = 'radio'; radio.name = box.getAttribute('data-field') || 'image'; radio.value = e.detail.name; radio.checked = true;
      var img = document.createElement('img');
      img.src = '/media/' + e.detail.small; img.alt = ''; img.loading = 'lazy';
      label.appendChild(radio); label.appendChild(img);
      grid.insertBefore(label, grid.children[1] || null);
    });
  });
})();
