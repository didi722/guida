// Logo dell'agenzia: il browser lo ridimensiona (lato massimo 700 px; PNG, o JPEG se era un JPEG) e lo invia come testo;
// il server lo ricontrolla. Se pesa troppo lo rimpicciolisce finché sta sotto i 480 KB.
(function () {
  var box = document.querySelector('[data-logo-upload]');
  if (!box) return;
  var input = box.querySelector('input[type=file]');
  var status = box.querySelector('[data-logo-status]');
  if (!input || !status) return;
  var MAX_SIDE = 700;
  var MAX_BYTES = 480 * 1024;

  function load(file) {
    if (window.createImageBitmap) return createImageBitmap(file).catch(function () { return viaImage(file); });
    return viaImage(file);
  }
  // senza createImageBitmap (o con un file che non sa leggere) si passa da un indirizzo «data:», l'unico tipo che la politica di sicurezza del sito ammette per le immagini
  function viaImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error(box.getAttribute('data-error'))); };
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error(box.getAttribute('data-error'))); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function render(src, side, jpeg) {
    var w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    var k = Math.min(1, side / Math.max(w0, h0));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * k));
    canvas.height = Math.max(1, Math.round(h0 * k));
    var ctx = canvas.getContext('2d');
    if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } // un JPEG non ha trasparenze
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
  }

  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file) return;
    status.textContent = box.getAttribute('data-working');
    load(file).then(function (img) {
      var jpeg = file.type === 'image/jpeg';
      var side = MAX_SIDE;
      var url = render(img, side, jpeg);
      while (url.length * 0.75 > MAX_BYTES && side > 120) { side = Math.round(side * 0.8); url = render(img, side, jpeg); }
      return fetch(box.getAttribute('data-url'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo: url }) });
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || !j.ok) throw new Error(j.error || box.getAttribute('data-error'));
        window.location.href = box.getAttribute('data-done');
      });
    }).catch(function (err) {
      status.textContent = (err && err.message) || box.getAttribute('data-error');
      input.value = '';
    });
  });
})();
