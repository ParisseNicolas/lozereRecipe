// qr.js
// Floating button (bottom-right) that opens a modal with a QR code of the current URL.

(function () {
  function buildQrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function openModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop qr-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal qr-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h3');
    title.textContent = 'Partager cette page';
    modal.appendChild(title);

    const url = window.location.href;
    const qrWrap = document.createElement('div');
    qrWrap.className = 'qr-wrap';
    qrWrap.innerHTML = buildQrSvg(url);
    modal.appendChild(qrWrap);

    const urlEl = document.createElement('p');
    urlEl.className = 'qr-url';
    urlEl.textContent = url;
    modal.appendChild(urlEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);
    modal.appendChild(closeBtn);

    function close() {
      modal.remove();
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  function addButton() {
    if (document.getElementById('qr-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'qr-fab';
    btn.type = 'button';
    btn.className = 'qr-fab no-print';
    btn.title = 'Afficher le QR code de cette page';
    btn.setAttribute('aria-label', 'Afficher le QR code de cette page');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm0 4h2v2h-2v-2zm-4 2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2z"/></svg>';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }
})();
