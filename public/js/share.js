// «Segnala un'agenzia collega» (area agenzie): copia il collegamento e, dove il dispositivo lo permette, apre il menu di condivisione.
// Il messaggio e il collegamento arrivano dal server (data-* di [data-share]); WhatsApp ed email sono semplici collegamenti.
(function () {
  'use strict';
  var box = document.querySelector('[data-share]');
  if (!box) return;
  var url = box.getAttribute('data-url');
  var text = box.getAttribute('data-text');
  var title = box.getAttribute('data-title');
  var copyBtn = box.querySelector('[data-share-copy]');
  var nativeBtn = box.querySelector('[data-share-native]');

  function fallbackCopy() {
    var ta = document.createElement('textarea');
    ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function done() {
    if (!copyBtn) return;
    var old = copyBtn.textContent;
    copyBtn.textContent = box.getAttribute('data-copied');
    copyBtn.setAttribute('aria-live', 'polite');
    setTimeout(function () { copyBtn.textContent = old; }, 2000);
  }
  if (copyBtn) copyBtn.addEventListener('click', function () {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, function () { if (fallbackCopy()) done(); });
    else if (fallbackCopy()) done();
  });
  if (nativeBtn && navigator.share) {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener('click', function () {
      navigator.share({ title: title, text: text, url: url }).catch(function () { /* annullato dalla persona: niente da fare */ });
    });
  }
})();
