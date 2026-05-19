/* nav.js : toggle du menu hamburger sur mobile */
(function () {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.getElementById('nav-menu');
  if (!btn || !nav) return;

  function close() {
    nav.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function toggle() {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && e.target !== btn) {
      close();
    }
  });
})();

/* Floating dismissible error box (close button + outside click) */
(function () {
  const errEl = document.getElementById('error');
  if (!errEl) return;

  let shownAt = 0;
  function dismiss() { errEl.hidden = true; }

  function ensureCloseButton() {
    if (errEl.hidden) return;
    shownAt = Date.now();
    if (errEl.querySelector('.error-close')) return;
    const text = errEl.textContent;
    errEl.textContent = '';
    const span = document.createElement('span');
    span.className = 'error-msg';
    span.textContent = text;
    const cbtn = document.createElement('button');
    cbtn.type = 'button';
    cbtn.className = 'error-close';
    cbtn.setAttribute('aria-label', 'Fermer');
    cbtn.textContent = '×';
    cbtn.addEventListener('click', dismiss);
    errEl.appendChild(span);
    errEl.appendChild(cbtn);
  }

  const obs = new MutationObserver(ensureCloseButton);
  obs.observe(errEl, { childList: true, attributes: true, attributeFilter: ['hidden'] });
  ensureCloseButton();

  document.addEventListener('click', (e) => {
    if (errEl.hidden) return;
    if (Date.now() - shownAt < 250) return;
    if (!errEl.contains(e.target)) dismiss();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !errEl.hidden) dismiss();
  });
})();
