// share.js
// Build a shareable URL of the shopping list (encoded state in the hash) and
// send it via the Web Share API or a `sms:` link.

(function () {
  const HASH_KEY = 's';

  function encodeState(state) {
    const json = JSON.stringify(state);
    return btoa(unescape(encodeURIComponent(json)));
  }

  function decodeState(s) {
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  }

  function buildCoursesUrl() {
    const state = {
      p: Store.loadPortionsByDay(),
      o: Store.loadMealOverrides(),
      r: Store.loadCustomRecipes(),
      i: Store.loadCustomIngredients(),
    };
    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'courses.html';
    const lan = base.replace(/127\.0\.0\.1|localhost/, '192.168.1.128');
    return `${lan}#${HASH_KEY}=${encodeState(state)}`;
  }

  // Apply a shared state by monkey-patching Store getters for this page render.
  // Returns true if a shared state was detected and applied.
  function applySharedState() {
    const hash = window.location.hash || '';
    const m = hash.match(new RegExp(`[#&]${HASH_KEY}=([^&]+)`));
    if (!m) return false;
    try {
      const state = decodeState(m[1]);
      if (state.p) Store.loadPortionsByDay = () => Object.assign({}, state.p);
      if (state.o) Store.loadMealOverrides = () => Object.assign({}, state.o);
      if (state.r) Store.loadCustomRecipes = () => Object.assign({}, state.r);
      if (state.i) Store.loadCustomIngredients = () => Object.assign({}, state.i);
      // Reset checked items so the recipient starts from a fresh list.
      Store.loadCheckedItems = () => ({});
      return true;
    } catch (e) {
      console.warn('Share : état partagé invalide', e);
      return false;
    }
  }

  async function shareCoursesList() {
    const url = buildCoursesUrl();
    const body = `Liste de courses : ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Liste de courses', text: body, url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // user cancelled
        // sinon on retombe sur le menu custom
      }
    }
    openShareMenu(url, body);
  }

  function openShareMenu(url, body) {
    // Évite les doublons
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

    const options = [
      { label: '💬 SMS', href: `sms:?&body=${encBody}` },
      { label: '🟢 WhatsApp', href: `https://wa.me/?text=${encText}` },
      { label: '✈️ Telegram', href: `https://t.me/share/url?url=${encUrl}&text=${encodeURIComponent('Liste de courses')}` },
      { label: '✉️ Mail', href: `mailto:?subject=${encodeURIComponent('Liste de courses')}&body=${encBody}` },
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
            // Fallback : sélection manuelle
            prompt('Copiez ce lien :', url);
            overlay.remove();
          }
          return;
        }
        // Pour WhatsApp / Telegram : ouvrir dans un nouvel onglet
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
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.appendChild(menu);
    document.body.appendChild(overlay);
  }

  window.Share = { buildCoursesUrl, applySharedState, shareCoursesList };
})();
