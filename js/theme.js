/* theme.js : basculer dark/light mode */
(function () {
  const STORAGE_KEY = 'lp-theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  function getStored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function setStored(v) {
    try { localStorage.setItem(STORAGE_KEY, v); } catch {}
  }

  function apply(theme) {
    if (theme === LIGHT) {
      document.documentElement.setAttribute('data-theme', LIGHT);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === LIGHT ? '🌙' : '☀️';
      btn.setAttribute('aria-label', theme === LIGHT ? 'Passer en mode sombre' : 'Passer en mode clair');
      btn.setAttribute('title', theme === LIGHT ? 'Mode sombre' : 'Mode clair');
    }
  }

  function toggle() {
    const current = document.documentElement.getAttribute('data-theme') === LIGHT ? LIGHT : DARK;
    const next = current === LIGHT ? DARK : LIGHT;
    setStored(next);
    apply(next);
  }

  /* Apply saved or system preference before first paint */
  const saved = getStored();
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const initial = saved || (prefersLight ? LIGHT : DARK);
  apply(initial);

  document.addEventListener('DOMContentLoaded', () => {
    /* Re-apply to sync the button label after DOM is ready */
    const current = document.documentElement.getAttribute('data-theme') === LIGHT ? LIGHT : DARK;
    apply(current);

    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggle);
  });
})();
