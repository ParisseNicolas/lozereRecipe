// recipes.js
// Render the recipes catalog page.
// - Grid of cards for every recipe (YAML + custom).
// - Click card → detail popup (full on desktop, summary on mobile).
// - Edit button → editer-recette.html?from=recettes (custom & YAML alike).
// - Delete button (custom only) → confirmation popup → shake+pop animation.

let modalEl = null;
let backdropEl = null;

function closeModal() {
  if (modalEl) modalEl.remove();
  if (backdropEl) backdropEl.remove();
  modalEl = null;
  backdropEl = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.key === 'Escape') closeModal();
}

function openModal(modal) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
  modalEl = modal;
  backdropEl = backdrop;
  document.addEventListener('keydown', onKey);
}

function render(data) {
  const grid = document.getElementById('recipes-grid');
  grid.innerHTML = '';

  const customRecipes = Store.loadCustomRecipes();
  const allNames = Object.keys(data.recipes || {}).sort((a, b) => a.localeCompare(b, 'fr'));

  if (allNames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recipes-empty';
    empty.textContent = 'Aucune recette pour le moment.';
    grid.appendChild(empty);
  }

  for (const name of allNames) {
    const recipe = data.recipes[name];
    const isCustom = name in customRecipes;
    grid.appendChild(buildCard(name, recipe, isCustom, data));
  }

  const createBtn = document.getElementById('create-recipe-btn');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      sessionStorage.setItem('recettes:scroll', String(window.scrollY));
      window.location.href = 'editer-recette.html?from=recettes';
    });
  }

  // Restore scroll after the grid is in the DOM (page is now tall enough).
  const saved = sessionStorage.getItem('recettes:scroll');
  if (saved !== null) {
    sessionStorage.removeItem('recettes:scroll');
    requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
  }
}

function buildCard(name, recipe, isCustom, data) {
  const card = document.createElement('div');
  card.className = 'recipe-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Voir la recette ${name}`);

  const header = document.createElement('div');
  header.className = 'recipe-card__header';
  const title = document.createElement('h3');
  title.className = 'recipe-card__title';
  title.textContent = name;
  header.appendChild(title);
  if (isCustom) {
    const badge = document.createElement('span');
    badge.className = 'recipe-card__badge';
    badge.textContent = 'perso';
    header.appendChild(badge);
  }
  card.appendChild(header);

  const ingrCount = Object.keys(recipe.ingredients || {}).length;
  const stepCount = (recipe.steps || []).filter((s) => !/^\s*-{2,}\s*cuisson\s*-{2,}\s*$/i.test(String(s))).length;
  const stats = document.createElement('div');
  stats.className = 'recipe-card__stats';
  stats.textContent = `${ingrCount} ingrédient${ingrCount > 1 ? 's' : ''} · ${stepCount} étape${stepCount > 1 ? 's' : ''}`;
  card.appendChild(stats);

  const actions = document.createElement('div');
  actions.className = 'recipe-card__actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'recipe-card__action recipe-card__edit';
  editBtn.title = 'Modifier';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `editer-recette.html?nom=${encodeURIComponent(name)}&from=recettes`;
  });
  actions.appendChild(editBtn);

  if (isCustom) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'recipe-card__action recipe-card__delete';
    delBtn.title = 'Supprimer';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteConfirm(name, card);
    });
    actions.appendChild(delBtn);
  }

  card.appendChild(actions);

  const openDetail = () => openDetail_(name, recipe, isCustom, data);
  card.addEventListener('click', openDetail);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetail();
    }
  });

  return card;
}

function openDetail_(name, recipe, isCustom, data) {
  const modal = document.createElement('div');
  modal.className = 'modal recipe-detail-modal';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeModal);
  modal.appendChild(closeBtn);

  const title = document.createElement('h2');
  title.className = 'recipe-detail__title';
  title.textContent = name;
  modal.appendChild(title);

  if (isCustom) {
    const badge = document.createElement('span');
    badge.className = 'recipe-card__badge';
    badge.textContent = 'perso';
    modal.appendChild(badge);
  }

  const isMobile = window.matchMedia && window.matchMedia('(max-width: 600px)').matches;

  const ingredients = recipe.ingredients || {};
  const steps = (recipe.steps || []).map(String);

  // Ingredients
  const h3i = document.createElement('h3');
  h3i.textContent = 'Ingrédients (pour 1 personne)';
  modal.appendChild(h3i);

  const ulIngr = document.createElement('ul');
  ulIngr.className = 'recipe-detail__ingredients';
  const entries = Object.entries(ingredients);
  const limit = isMobile ? Math.min(5, entries.length) : entries.length;
  for (let i = 0; i < limit; i++) {
    const [ingrName, raw] = entries[i];
    const li = document.createElement('li');
    const { amount, unit } = Parser.parseQuantity(raw);
    const amtStr = Parser.formatAmount(amount);
    const unitStr = Parser.pluralizeUnit(amount, unit);
    li.innerHTML = `<span class="ingr-name">${ingrName}</span><span class="ingr-qty">${amtStr} ${unitStr}</span>`;
    ulIngr.appendChild(li);
  }
  if (isMobile && entries.length > limit) {
    const more = document.createElement('li');
    more.className = 'recipe-detail__more';
    more.textContent = `… et ${entries.length - limit} de plus`;
    ulIngr.appendChild(more);
  }
  modal.appendChild(ulIngr);

  // Steps
  const h3s = document.createElement('h3');
  h3s.textContent = 'Préparation';
  modal.appendChild(h3s);

  if (isMobile) {
    const summary = document.createElement('p');
    summary.className = 'recipe-detail__more';
    summary.textContent = steps.length === 0
      ? 'Aucune étape renseignée.'
      : `${steps.filter((s) => !/^\s*-{2,}\s*cuisson\s*-{2,}\s*$/i.test(s)).length} étape(s). Ouvrez la modification pour voir le détail.`;
    modal.appendChild(summary);
  } else if (steps.length === 0) {
    const p = document.createElement('p');
    p.className = 'no-steps';
    p.textContent = 'Aucune étape renseignée.';
    modal.appendChild(p);
  } else {
    const markerRe = /^\s*-{2,}\s*cuisson\s*-{2,}\s*$/i;
    const idx = steps.findIndex((s) => markerRe.test(s));
    const renderList = (items, container) => {
      const ol = document.createElement('ol');
      ol.className = 'steps-list';
      for (const s of items) {
        const li = document.createElement('li');
        li.textContent = s;
        ol.appendChild(li);
      }
      container.appendChild(ol);
    };
    if (idx === -1) {
      renderList(steps, modal);
    } else {
      const decoupe = steps.slice(0, idx);
      const cuisson = steps.slice(idx + 1);
      if (decoupe.length > 0) {
        const h4 = document.createElement('h4');
        h4.textContent = 'Découpe';
        modal.appendChild(h4);
        renderList(decoupe, modal);
      }
      if (cuisson.length > 0) {
        const h4 = document.createElement('h4');
        h4.textContent = 'Cuisson';
        modal.appendChild(h4);
        renderList(cuisson, modal);
      }
    }
  }

  // Footer actions
  const footer = document.createElement('div');
  footer.className = 'recipe-detail__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'save-btn';
  editBtn.textContent = '✎ Modifier';
  editBtn.addEventListener('click', () => {
    window.location.href = `editer-recette.html?nom=${encodeURIComponent(name)}&from=recettes`;
  });
  footer.appendChild(editBtn);
  modal.appendChild(footer);

  openModal(modal);
}

function openDeleteConfirm(name, cardEl) {
  const modal = document.createElement('div');
  modal.className = 'modal recipe-confirm-modal';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeModal);
  modal.appendChild(closeBtn);

  const h3 = document.createElement('h3');
  h3.textContent = 'Supprimer la recette ?';
  modal.appendChild(h3);

  const p = document.createElement('p');
  p.textContent = `« ${name} » sera définitivement supprimée.`;
  modal.appendChild(p);

  const actions = document.createElement('div');
  actions.className = 'recipe-confirm__actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', closeModal);
  actions.appendChild(cancelBtn);

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'delete-btn';
  okBtn.textContent = 'Supprimer';
  okBtn.addEventListener('click', () => {
    Store.deleteCustomRecipe(name);
    closeModal();
    cardEl.classList.add('recipe-card--removing');
    cardEl.addEventListener('animationend', () => {
      cardEl.remove();
    }, { once: true });
  });
  actions.appendChild(okBtn);

  modal.appendChild(actions);

  openModal(modal);
}

window.Recipes = { render };

// Save scroll position before navigating to editer-recette.html.
document.addEventListener('click', (e) => {
  const t = e.target.closest('a, button');
  if (!t) return;
  const href = t.tagName === 'A' ? t.getAttribute('href') : '';
  const willNavigate = (href && href.includes('editer-recette.html')) ||
    t.id === 'create-recipe-btn' ||
    t.classList.contains('recipe-card__edit') ||
    (t.classList.contains('save-btn') && t.closest('.recipe-detail-modal'));
  if (willNavigate) {
    sessionStorage.setItem('recettes:scroll', String(window.scrollY));
  }
}, true);
