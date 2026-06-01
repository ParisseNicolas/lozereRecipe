// share.js
// Build a shareable URL of the shopping list and encode the local overrides in
// a compact, versioned hash payload.
(function () {
  const HASH_KEY = 's';

  function base64UrlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(value) {
    let b64 = value.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Ce navigateur ne sait pas lire les liens compressés.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function collectState() {
    const state = {
      p: Store.loadPortionsByDay(),
      o: Store.loadMealOverrides(),
      r: Store.loadCustomRecipes(),
      i: Store.loadCustomIngredients(),
    };

    return Object.fromEntries(
      Object.entries(state).filter(([, value]) => value && Object.keys(value).length > 0),
    );
  }

  async function encodeState(state) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(state));
    let compressed = null;
    try {
      compressed = await gzip(jsonBytes);
    } catch (error) {
      console.warn('Share : compression indisponible, lien non compressé', error);
    }
    const candidates = compressed
      ? [
        `v1.${base64UrlEncode(compressed)}`,
        `v0.${base64UrlEncode(jsonBytes)}`,
      ]
      : [`v0.${base64UrlEncode(jsonBytes)}`];
    return candidates.sort((a, b) => a.length - b.length)[0];
  }

  async function decodeState(param) {
    const dot = param.indexOf('.');
    if (dot > 0) {
      const version = param.slice(0, dot);
      const body = param.slice(dot + 1);
      let bytes = base64UrlDecode(body);
      if (version === 'v1') bytes = await gunzip(bytes);
      else if (version !== 'v0') throw new Error('Version de partage inconnue : ' + version);
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    // Legacy links used plain base64(JSON) with UTF-8 escaped through btoa.
    return JSON.parse(decodeURIComponent(escape(atob(param))));
  }

  async function buildCoursesUrl() {
    const encoded = await encodeState(collectState());
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'courses.html';
    const lan = base.replace(/127\.0\.0\.1|localhost/, '192.168.1.128');
    return `${lan}#${HASH_KEY}=${encoded}`;
  }

  function migratePortions(p) {
    if (!p || typeof p !== 'object') return {};
    const out = {};
    for (const day of Object.keys(p)) {
      const value = p[day];
      if (value != null && typeof value !== 'object') {
        const portions = Number(value) || 0;
        out[day] = { midi: portions, soir: portions };
      } else {
        out[day] = value;
      }
    }
    return out;
  }

  // Apply a shared state by monkey-patching Store getters for this page render.
  // Returns true if a shared state was detected and applied.
  async function applySharedState() {
    const hash = window.location.hash || '';
    const match = hash.match(new RegExp(`[#&]${HASH_KEY}=([^&]+)`));
    if (!match) return false;

    try {
      const state = await decodeState(match[1]);
      if (state.p) {
        const migrated = migratePortions(state.p);
        Store.loadPortionsByDay = () => Object.assign({}, migrated);
      }
      if (state.o) Store.loadMealOverrides = () => Object.assign({}, state.o);
      if (state.r) Store.loadCustomRecipes = () => Object.assign({}, state.r);
      if (state.i) Store.loadCustomIngredients = () => Object.assign({}, state.i);
      Store.loadCheckedItems = () => ({});
      return true;
    } catch (error) {
      console.warn('Share : état partagé invalide', error);
      return false;
    }
  }

  async function shareCoursesList() {
    const url = await buildCoursesUrl();
    const shareText = 'Liste de courses';
    const body = `${shareText} : ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, text: shareText, url });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    openShareMenu(url, body);
  }

  function openShareMenu(url, body) {
    const existing = document.getElementById('share-menu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'share-menu-overlay';
    overlay.className = 'share-menu-overlay';

    const menu = document.createElement('div');
    menu.className = 'share-menu';
    menu.innerHTML = `
      <h3>Partager la liste</h3>
      <div class="share-menu-buttons"></div>
      <button class="share-menu-close" type="button">Annuler</button>
    `;

    const encBody = encodeURIComponent(body);
    const encText = encodeURIComponent(body);
    const encUrl = encodeURIComponent(url);
    const shareText = 'Liste de courses';

    const options = [
      { label: '💬 SMS', href: `sms:?&body=${encBody}` },
      { label: '🟢 WhatsApp', href: `https://wa.me/?text=${encText}` },
      { label: '✈️ Telegram', href: `https://t.me/share/url?url=${encUrl}&text=${encodeURIComponent(shareText)}` },
      { label: '✉️ Mail', href: `mailto:?subject=${encodeURIComponent(shareText)}&body=${encBody}` },
      { label: '🔗 Copier le lien', action: 'copy' },
    ];

    const btnContainer = menu.querySelector('.share-menu-buttons');
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'share-menu-btn';
      btn.textContent = opt.label;
      btn.addEventListener('click', async () => {
        if (opt.action === 'copy') {
          try {
            await navigator.clipboard.writeText(url);
            btn.textContent = '✅ Lien copié !';
            setTimeout(() => overlay.remove(), 800);
          } catch {
            prompt('Copiez ce lien :', url);
            overlay.remove();
          }
          return;
        }
        if (opt.href.startsWith('http')) {
          window.open(opt.href, '_blank', 'noopener');
        } else {
          window.location.href = opt.href;
        }
        overlay.remove();
      });
      btnContainer.appendChild(btn);
    }

    menu.querySelector('.share-menu-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });

    overlay.appendChild(menu);
    document.body.appendChild(overlay);
  }

  window.Share = { buildCoursesUrl, applySharedState, shareCoursesList };
})();
