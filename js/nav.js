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
