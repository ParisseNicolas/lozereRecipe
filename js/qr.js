// qr.js
// Floating button (bottom-right) that opens a modal with a QR code of a share
// link carrying the local data (#yaml=… / #s=…), so scanning it transfers the
// user's recipes and menu — not just the bare page URL.

(function () {
  // Error-correction levels from most to least robust. The more redundancy,
  // the less data fits, so we pick the strongest level that still encodes the
  // URL : small links get maximum robustness (H), and we only fall back toward
  // L as the link grows. If even L overflows, buildQrSvg throws.
  const ECC_LEVELS = ['H', 'Q', 'M', 'L'];

  function buildQrSvg(text) {
    let lastError;
    for (const level of ECC_LEVELS) {
      try {
        const qr = qrcode(0, level);
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function localizeHost(url) {
    return url.replace(/127\.0\.0\.1|localhost/, '192.168.1.128');
  }

  // Build the URL the QR code should encode. Prefer a real share link that
  // carries the local data (#yaml=… / #s=…) over the bare page URL, so that
  // scanning the code actually transfers the user's recipes and menu.
  async function resolveShareUrl() {
    // Already on a shared link : reuse it as-is.
    if (/[#&](yaml|s)=/.test(window.location.hash)) {
      return localizeHost(window.location.href);
    }
    if (window.YamlShare && typeof YamlShare.buildShareUrl === 'function') {
      const { url } = await YamlShare.buildShareUrl();
      return url;
    }
    if (window.Share && typeof Share.buildCoursesUrl === 'function') {
      return await Share.buildCoursesUrl();
    }
    return localizeHost(window.location.href);
  }

  function openClassicShare() {
    if (window.YamlShare && typeof YamlShare.openShareModal === 'function') {
      YamlShare.openShareModal();
    } else if (window.Share && typeof Share.shareCoursesList === 'function') {
      Share.shareCoursesList();
    }
  }

  function hasClassicShare() {
    return (window.YamlShare && typeof YamlShare.openShareModal === 'function')
      || (window.Share && typeof Share.shareCoursesList === 'function');
  }

  async function openModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop qr-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal qr-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h3');
    title.textContent = 'Partager mes données';
    modal.appendChild(title);

    const body = document.createElement('div');
    body.className = 'qr-body';
    const loading = document.createElement('p');
    loading.className = 'qr-url';
    loading.textContent = 'Préparation du lien…';
    body.appendChild(loading);
    modal.appendChild(body);

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

    let url;
    try {
      url = await resolveShareUrl();
    } catch (error) {
      console.warn('QR : construction du lien de partage impossible', error);
      url = localizeHost(window.location.href);
    }

    body.innerHTML = '';

    try {
      const qrWrap = document.createElement('div');
      qrWrap.className = 'qr-wrap';
      qrWrap.innerHTML = buildQrSvg(url);
      body.appendChild(qrWrap);
    } catch (error) {
      console.warn('QR : génération impossible (lien trop long)', error);

      const msg = document.createElement('p');
      msg.className = 'qr-error';
      msg.textContent = 'Ce lien est trop long pour être encodé dans un QR code. '
        + 'Utilisez plutôt le partage classique (SMS, WhatsApp, copier le lien…).';
      body.appendChild(msg);

      if (hasClassicShare()) {
        const fallbackBtn = document.createElement('button');
        fallbackBtn.type = 'button';
        fallbackBtn.className = 'share-menu-btn';
        fallbackBtn.textContent = '🔗 Ouvrir le partage classique';
        fallbackBtn.addEventListener('click', () => {
          close();
          openClassicShare();
        });
        body.appendChild(fallbackBtn);
      }
    }
  }

  function addButton() {
    if (document.getElementById('qr-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'qr-fab';
    btn.type = 'button';
    btn.className = 'qr-fab no-print';
    btn.title = 'Partager mes données par QR code';
    btn.setAttribute('aria-label', 'Partager mes données par QR code');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm0 4h2v2h-2v-2zm-4 2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2z"/></svg>';
    btn.addEventListener('click', () => { openModal(); });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }
})();
