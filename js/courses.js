// courses.js
// Render the shopping list grouped by category.
// Checked items move to a "Validé" section at the bottom, persisted in localStorage.

function itemKey(category, name) {
  return `${category}::${name}`;
}

function renderCourses(data) {
  const root = document.getElementById('courses-root');
  root.innerHTML = '';

  const portionsByDay = Store.loadPortionsByDay();

  // Build a lookup { day: { midi, soir } } using saved values, else the
  // meal's own YAML portions.
  const days = App.listDays(data.meals);
  const perDay = {};
  for (const day of days) perDay[day] = { midi: 0, soir: 0 };
  for (const meal of data.meals) {
    const d = App.dayOf(meal.name);
    const slot = App.slotOf(meal.name);
    const fallback = Number(meal.portions) || 0;
    perDay[d][slot] = Store.getSlotPortions(portionsByDay, d, slot, fallback);
  }

  // Summary of portions per day at the top (per-slot).
  const summary = document.createElement('div');
  summary.className = 'portions-summary';
  summary.innerHTML = '<strong>Personnes par jour :</strong> ';
  summary.innerHTML += days
    .map((d) => `${d} : midi ${perDay[d].midi} / soir ${perDay[d].soir}`)
    .join(' &middot; ');
  root.appendChild(summary);

  // Action buttons (reset + partager)
  const actions = document.createElement('div');
  actions.className = 'courses-actions';

  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset-btn';
  resetBtn.textContent = 'Réinitialiser la liste';
  resetBtn.addEventListener('click', () => {
    Store.clearCheckedItems();
    renderCourses(data);
  });
  actions.appendChild(resetBtn);

  if (window.Share) {
    const shareBtn = document.createElement('button');
    shareBtn.id = 'share-btn';
    shareBtn.textContent = '📤 Partager';
    shareBtn.addEventListener('click', () => Share.shareCoursesList());
    actions.appendChild(shareBtn);
  }

  root.appendChild(actions);

  const byCategory = Shopping.buildShoppingList(data, portionsByDay);
  const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b, 'fr'));

  if (categories.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Aucun ingrédient (le nombre de personnes est-il à 0 partout ?).';
    root.appendChild(p);
    return;
  }

  const checked = Store.loadCheckedItems();
  const doneByCategory = {};

  for (const cat of categories) {
    const remaining = [];
    for (const it of byCategory[cat]) {
      if (checked[itemKey(cat, it.name)]) {
        if (!doneByCategory[cat]) doneByCategory[cat] = [];
        doneByCategory[cat].push(it);
      } else {
        remaining.push(it);
      }
    }
    if (remaining.length === 0) continue;
    root.appendChild(buildCategorySection(cat, remaining, data, false));
  }

  const doneCats = Object.keys(doneByCategory).sort((a, b) => a.localeCompare(b, 'fr'));
  if (doneCats.length > 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'done-wrapper';
    const title = document.createElement('h2');
    title.className = 'done-title';
    title.textContent = 'Validé';
    wrapper.appendChild(title);
    for (const cat of doneCats) {
      wrapper.appendChild(buildCategorySection(cat, doneByCategory[cat], data, true));
    }
    root.appendChild(wrapper);
  }
}

function buildCategorySection(cat, items, data, isDone) {
  const section = document.createElement('section');
  section.className = 'category' + (isDone ? ' done-category' : '');
  const h2 = document.createElement('h2');
  h2.textContent = cat;
  section.appendChild(h2);
  const ul = document.createElement('ul');
  ul.className = 'shopping-list';
  for (const item of items) {
    ul.appendChild(buildItem(cat, item, data, isDone));
  }
  section.appendChild(ul);
  return section;
}

function buildItem(category, item, data, isDone) {
  const li = document.createElement('li');
  if (isDone) li.classList.add('checked');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'item-check';
  cb.checked = !!isDone;
  li.appendChild(cb);

  const label = document.createElement('label');
  const spec = (data.ingredients || {})[item.name] || {};
  const convert = spec.convert || null;
  const qtyStr = item.parts
    .map((p) => Parser.promoteUnit(p.amount, p.unit, data.unitScales))
    .map((p) => `${Parser.formatAmount(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
    .join(' + ');
  // Equivalent in a metric unit (mass/volume), shown next to the purchase qty.
  const metricTarget = Shopping.pickMetricTarget(spec);
  let equivStr = '';
  if (metricTarget) {
    const parts = [];
    for (const p of item.parts) {
      if (p.unit === metricTarget) { parts.push(p); continue; }
      const v = Shopping.convertAmount(p.amount, p.unit, metricTarget, convert);
      if (v != null && isFinite(v) && v > 0) parts.push({ amount: v, unit: metricTarget });
    }
    if (parts.length > 0) {
      const promoted = parts
        .map((p) => Parser.promoteUnit(p.amount, p.unit, data.unitScales))
        .map((p) => `${Parser.formatAmount(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
        .join(' + ');
      // Only show if it adds info (different from the main qty string).
      if (promoted !== qtyStr) equivStr = promoted;
    }
  }
  label.innerHTML = `<span class="ingr-name">${item.name}</span><span class="ingr-qtys"><span class="ingr-qty has-popover" title="Voir les conversions">${qtyStr}</span>${equivStr ? `<span class="ingr-qty-equiv">≈ ${equivStr}</span>` : ''}</span>`;
  li.appendChild(label);

  const qtyEl = label.querySelector('.ingr-qty');
  qtyEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    Popover.showConversions(item.name, spec, qtyEl, item.parts, data.unitScales);
  });

  cb.addEventListener('change', () => {
    Store.setItemChecked(itemKey(category, item.name), cb.checked);
    renderCourses(data);
  });
  return li;
}

window.Courses = { renderCourses };

// --- Single-page print scaling ---
// Before printing, apply the `print-courses` class so the dedicated print
// layout (2 columns, hidden chrome) is active. Measure the resulting
// rendered size against an A4 page and shrink with `zoom` if needed so the
// shopping list always fits on a single page. Reset on `afterprint`.
(function () {
  // A4 portrait at 96dpi minus the 10mm @page margin on all sides.
  // 297mm - 20mm = 277mm tall, 210mm - 20mm = 190mm wide.
  const MM_TO_PX = 96 / 25.4;
  const PAGE_W = 190 * MM_TO_PX;
  const PAGE_H = 277 * MM_TO_PX;

  function fitToOnePage() {
    const main = document.querySelector('main');
    if (!main) return;
    document.body.classList.add('print-courses');
    // Reset any previous zoom before measuring so we always start from 1.
    main.style.setProperty('--print-zoom', '1');
    // Force reflow so the just-applied class (column-count, etc.) is in effect.
    void main.offsetHeight;
    const w = main.scrollWidth;
    const h = main.scrollHeight;
    if (w <= 0 || h <= 0) return;
    const scale = Math.min(1, PAGE_W / w, PAGE_H / h);
    if (scale < 1) {
      // Slight safety margin so rounding doesn't push to a 2nd page.
      main.style.setProperty('--print-zoom', String(scale * 0.97));
    }
  }

  function resetScale() {
    const main = document.querySelector('main');
    if (main) main.style.removeProperty('--print-zoom');
    document.body.classList.remove('print-courses');
  }

  window.addEventListener('beforeprint', fitToOnePage);
  window.addEventListener('afterprint', resetScale);
  // Some browsers (Safari) only fire matchMedia change for print.
  if (window.matchMedia) {
    const mql = window.matchMedia('print');
    if (mql && mql.addEventListener) {
      mql.addEventListener('change', (e) => {
        if (e.matches) fitToOnePage();
        else resetScale();
      });
    }
  }
})();
