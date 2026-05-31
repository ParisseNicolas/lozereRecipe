// yaml-share.js
// Share the full app state (YAML + custom recipes/ingredients + meal overrides
// + per-day portions) as a URL fragment. The payload is JSON-stringified,
// gzip-compressed when available, then base64url-encoded.
//
// URL shape : https://…/index.html#yaml=<v>.<base64url>
//   v0 = raw JSON, base64url
//   v1 = gzip(JSON), base64url
//
// On reception (index.html), `applySharedYaml()` decodes the payload and lets
// the user choose between « Remplacer » (overwrite local data) or « Fusionner »
// (delegate to YamlMerge).

(function () {
  const HASH_KEY = 'yaml';

  function base64UrlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(s) {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream non supporté par ce navigateur.');
    }
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  function showManualCopy(url) {
    document.querySelectorAll('.modal-backdrop.yaml-share-copy-backdrop, .modal.yaml-share-copy-modal').forEach((n) => n.remove());

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop yaml-share-copy-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal yaml-share-copy-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h3');
    title.textContent = 'Copier le lien';
    modal.appendChild(title);

    const msg = document.createElement('p');
    msg.textContent = 'Clique sur Copier pour copier le lien :';
    modal.appendChild(msg);

    const ta = document.createElement('input');
    ta.type = 'text';
    ta.readOnly = true;
    ta.value = url;
    ta.style.width = '100%';
    ta.style.boxSizing = 'border-box';
    ta.style.marginBottom = '12px';
    modal.appendChild(ta);

    const actions = document.createElement('div');
    actions.className = 'similar-recipe-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-secondary';
    closeBtn.textContent = 'Fermer';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-primary';
    copyBtn.textContent = '📋 Copier';
    copyBtn.addEventListener('click', async () => {
      let copied = false;
      try {
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch { /* fall through */ }
      if (!copied) {
        try {
          ta.focus();
          ta.select();
          copied = document.execCommand('copy');
        } catch { /* best effort */ }
      }
      if (copied) {
        const prev = copyBtn.textContent;
        copyBtn.textContent = '✅ Copié !';
        copyBtn.disabled = true;
        setTimeout(() => { copyBtn.textContent = prev; copyBtn.disabled = false; }, 1200);
      } else {
        ta.focus();
        ta.select();
      }
    });

    actions.appendChild(closeBtn);
    actions.appendChild(copyBtn);
    modal.appendChild(actions);

    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'modal-close';
    xBtn.textContent = '×';
    modal.appendChild(xBtn);

    function close() {
      modal.remove();
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    xBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    setTimeout(() => {
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch { /* best effort */ }
    }, 0);
  }

  async function encodePayload(obj) {
    const json = JSON.stringify(obj);
    const utf8 = new TextEncoder().encode(json);
    let version = 'v1';
    let bytes = await gzip(utf8);
    if (!bytes) {
      version = 'v0';
      bytes = utf8;
    }
    return `${version}.${base64UrlEncode(bytes)}`;
  }

  async function decodePayload(payload) {
    const dot = payload.indexOf('.');
    if (dot < 0) throw new Error('Format de partage invalide.');
    const version = payload.slice(0, dot);
    const body = payload.slice(dot + 1);
    let bytes = base64UrlDecode(body);
    if (version === 'v1') bytes = await gunzip(bytes);
    else if (version !== 'v0') throw new Error('Version de partage inconnue : ' + version);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  }

  function buildBaseUrl() {
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'index.html';
    return base.replace(/127\.0\.0\.1|localhost/, '192.168.1.128');
  }

  async function buildShareUrl() {
    const data = await App.buildFullExportData();
    const encoded = await encodePayload(data);
    const url = `${buildBaseUrl()}#${HASH_KEY}=${encoded}`;
    return { url, payloadSize: encoded.length };
  }

  async function openShareModal() {
    document.querySelectorAll('.modal-backdrop.yaml-share-backdrop, .modal.yaml-share-modal').forEach((n) => n.remove());

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop yaml-share-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal yaml-share-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h3');
    title.textContent = 'Partager mes données';
    modal.appendChild(title);

    const status = document.createElement('p');
    status.className = 'yaml-share-status';
    status.textContent = 'Préparation du lien…';
    modal.appendChild(status);

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

    let info;
    try {
      info = await buildShareUrl();
    } catch (e) {
      status.textContent = 'Erreur : ' + e.message;
      return;
    }
    const { url } = info;
    status.remove();

    if (url.length > 2000) {
      const warn = document.createElement('p');
      warn.className = 'yaml-share-warning';
      warn.textContent = `⚠️ Lien très long (${url.length} caractères). Certaines applis (SMS, WhatsApp, Telegram…) peuvent le tronquer silencieusement. Préfère « Exporter YAML » pour les gros partages.`;
      warn.style.cssText = 'color:#ffb1a3;border:1px solid var(--lp-red,#c0392b);background:rgba(192,57,43,0.12);padding:0.6rem 0.8rem;border-radius:4px;font-size:0.9rem;margin:0 0 0.75rem;';
      modal.appendChild(warn);
    }

    const buttons = document.createElement('div');
    buttons.className = 'share-menu-buttons';
    const shareTitle = 'Mes données menuCourses';
    const shareText = 'Mes données menuCourses';
    const body = `${shareText} : ${url}`;
    const encBody = encodeURIComponent(body);
    const encText = encodeURIComponent(body);
    const encUrl = encodeURIComponent(url);
    const canNativeShare = typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function'
        || navigator.canShare({ title: shareTitle, text: shareText, url }));
    const options = [];
    if (canNativeShare) {
      options.push({ label: '📤 Partager…', action: 'native' });
    }
    options.push(
      { label: '💬 SMS', href: `sms:?&body=${encBody}` },
      { label: '🟢 WhatsApp', href: `https://wa.me/?text=${encText}` },
      { label: '✈️ Telegram', href: `https://t.me/share/url?url=${encUrl}&text=${encodeURIComponent(shareText)}` },
      { label: '✉️ Mail', href: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encBody}` },
      { label: '🔗 Copier le lien', action: 'copy' },
    );
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'share-menu-btn';
      if (opt.action === 'native') btn.classList.add('btn-primary');
      btn.textContent = opt.label;
      btn.addEventListener('click', async () => {
        if (opt.action === 'native') {
          try {
            await navigator.share({ title: shareTitle, text: shareText, url });
            close();
          } catch (e) {
            if (e && e.name === 'AbortError') return;
            console.warn('YamlShare : navigator.share a échoué', e);
          }
          return;
        }
        if (opt.action === 'copy') {
          let copied = false;
          try {
            if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(url);
              copied = true;
            }
          } catch { /* fall through to manual */ }
          if (copied) {
            btn.textContent = '✅ Lien copié !';
            setTimeout(close, 800);
          } else {
            showManualCopy(url);
          }
          return;
        }
        if (opt.href.startsWith('http')) window.open(opt.href, '_blank', 'noopener');
        else window.location.href = opt.href;
        close();
      });
      buttons.appendChild(btn);
    }
    modal.appendChild(buttons);

    const sep = document.createElement('hr');
    sep.className = 'share-menu-sep';
    modal.appendChild(sep);

    const fileButtons = document.createElement('div');
    fileButtons.className = 'share-menu-buttons';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'share-menu-btn';
    exportBtn.textContent = '⬇️ Exporter YAML';
    exportBtn.addEventListener('click', async () => {
      try { await exportYamlFile(); } catch (e) { alert('Export impossible : ' + e.message); }
    });
    fileButtons.appendChild(exportBtn);

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'share-menu-btn';
    importBtn.textContent = '⬆️ Importer YAML';
    importBtn.addEventListener('click', () => {
      close();
      if (window.YamlImport && window.YamlImport.open) window.YamlImport.open();
      else alert('Module d\'import indisponible.');
    });
    fileButtons.appendChild(importBtn);

    modal.appendChild(fileButtons);
  }

  async function exportYamlFile() {
    const ordered = await App.buildFullExportData();
    const yamlStr = jsyaml.dump(ordered, { lineWidth: 120, noRefs: true, sortKeys: false });
    const blob = new Blob([yamlStr], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'repas.yml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Reception side : detect #yaml=… on page load, decode, and offer a choice.
  // Returns true if a shared payload was detected (caller may choose to delay
  // the normal page render).
  async function applySharedYaml() {
    const hash = window.location.hash || '';
    const m = hash.match(new RegExp(`[#&]${HASH_KEY}=([^&]+)`));
    if (!m) return false;

    let incoming;
    try {
      incoming = await decodePayload(m[1]);
    } catch (e) {
      console.warn('YamlShare : payload invalide', e);
      cleanHash();
      return false;
    }
    cleanHash();
    openChoiceModal(incoming);
    return true;
  }

  function cleanHash() {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  }

  function confirmModal(message) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop yaml-confirm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'modal yaml-confirm-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const p = document.createElement('p');
      p.textContent = message;
      modal.appendChild(p);

      const actions = document.createElement('div');
      actions.className = 'similar-recipe-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary';
      cancelBtn.textContent = 'Annuler';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn-primary';
      okBtn.textContent = 'Continuer';

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      modal.appendChild(actions);

      function close(result) {
        modal.remove();
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      backdrop.addEventListener('click', () => close(false));
      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      document.addEventListener('keydown', onKey);

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
    });
  }

  function openChoiceModal(incoming) {
    document.querySelectorAll('.modal-backdrop.yaml-recv-backdrop, .modal.yaml-recv-modal').forEach((n) => n.remove());

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop yaml-recv-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal yaml-recv-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const h = document.createElement('h3');
    h.textContent = 'Données reçues';
    modal.appendChild(h);

    const intro = document.createElement('p');
    const recipeCount = Object.keys((incoming && incoming.recipes) || {}).length;
    const ingCount = Object.keys((incoming && incoming.ingredients) || {}).length;
    const mealCount = Array.isArray(incoming && incoming.meals) ? incoming.meals.length : 0;
    intro.textContent = `Tu viens de recevoir un partage : ${recipeCount} recettes, ${ingCount} ingrédients, ${mealCount} repas. Que veux-tu en faire ?`;
    modal.appendChild(intro);

    const actions = document.createElement('div');
    actions.className = 'similar-recipe-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Annuler';

    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.className = 'btn-secondary';
    mergeBtn.textContent = 'Fusionner';

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'btn-primary';
    replaceBtn.textContent = 'Remplacer';

    actions.appendChild(cancelBtn);
    actions.appendChild(mergeBtn);
    actions.appendChild(replaceBtn);
    modal.appendChild(actions);

    function close() {
      modal.remove();
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    backdrop.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    replaceBtn.addEventListener('click', async () => {
      const ok = await confirmModal('Cela va écraser toutes tes données locales. Continuer ?');
      if (!ok) return;
      if (window.YamlImport && YamlImport.applyReplace) {
        const done = YamlImport.applyReplace(stripRuntimeFields(incoming), null);
        if (done) {
          close();
          setTimeout(() => window.location.reload(), 200);
        }
      } else {
        alert('Module d\'import indisponible.');
      }
    });

    mergeBtn.addEventListener('click', () => {
      close();
      if (window.YamlMerge && YamlMerge.start) YamlMerge.start(stripRuntimeFields(incoming));
      else alert('Module de fusion indisponible.');
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  function stripRuntimeFields(data) {
    if (!data) return data;
    const out = Object.assign({}, data);
    delete out.recipesYaml;
    return out;
  }

  function addShareFab() {
    if (document.getElementById('share-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'share-fab';
    btn.type = 'button';
    btn.className = 'share-fab no-print';
    btn.title = 'Partager mes données';
    btn.setAttribute('aria-label', 'Partager mes données');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';
    btn.addEventListener('click', openShareModal);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addShareFab);
  } else {
    addShareFab();
  }

  window.YamlShare = { openShareModal, applySharedYaml, buildShareUrl, encodePayload, decodePayload, exportYamlFile };
})();
