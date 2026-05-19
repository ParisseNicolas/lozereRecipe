// menu.js
// Render the weekly menu on index.html with one row per day.
// Each meal cell has an ✎ button to edit (replace / add / clear).
// A button below the table exports user overrides as YAML.

function renderMenu(data) {
  const tbody = document.querySelector('#menu-table tbody');
  tbody.innerHTML = '';

  const saved = Store.loadPortionsByDay();
  const portions = App.effectivePortions(data, saved);
  const days = App.listDays(data.meals);

  // Group meals by day -> { day: { midi: meal, soir: meal } }
  const byDay = {};
  for (const meal of data.meals) {
    const d = App.dayOf(meal.name);
    const slot = /soir/i.test(meal.name) ? 'soir' : 'midi';
    if (!byDay[d]) byDay[d] = {};
    byDay[d][slot] = meal;
  }

  for (const day of days) {
    const tr = document.createElement('tr');

    const tdDay = document.createElement('td');
    tdDay.textContent = day;
    tdDay.className = 'day-cell';
    tr.appendChild(tdDay);

    for (const slot of ['midi', 'soir']) {
      const td = document.createElement('td');
      td.className = 'meal-cell';
      td.dataset.label = slot === 'midi' ? 'Midi' : 'Soir';
      const meal = byDay[day] && byDay[day][slot];
      const recipesList = document.createElement('div');
      recipesList.className = 'recipe-list';
      if (meal && meal.recipes && meal.recipes.length > 0) {
        const dayPortions = portions[day];
        for (const recipeName of meal.recipes) {
          const link = document.createElement('a');
          link.href = `recette.html?nom=${encodeURIComponent(recipeName)}&portions=${dayPortions}&jour=${encodeURIComponent(day)}&moment=${slot}`;
          link.textContent = recipeName;
          link.className = 'recipe-link';
          recipesList.appendChild(link);
        }
      } else if (meal) {
        const span = document.createElement('span');
        span.textContent = '(restes)';
        span.className = 'leftover';
        recipesList.appendChild(span);
      }
      td.appendChild(recipesList);

      if (meal) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'edit-meal-btn';
        edit.title = 'Modifier ce repas';
        edit.textContent = '✎';
        edit.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMealPicker(meal.name, meal.recipes || [], data);
        });
        td.appendChild(edit);
      }
      tr.appendChild(td);
    }

    const tdPortions = document.createElement('td');
    tdPortions.className = 'portions-cell';
    tdPortions.dataset.label = 'Personnes';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = portions[day];
    input.dataset.day = day;
    input.className = 'portions-input';
    const saveAndSync = (e) => {
      const v = Number(e.target.value) || 0;
      Store.setDayPortions(day, v);
      tr.querySelectorAll('a.recipe-link').forEach((a) => {
        const u = new URL(a.href, window.location.href);
        u.searchParams.set('portions', String(v));
        a.href = u.toString();
      });
    };
    input.addEventListener('input', saveAndSync);
    input.addEventListener('change', saveAndSync);
    tdPortions.appendChild(input);
    tr.appendChild(tdPortions);

    tbody.appendChild(tr);
  }

  renderMenuActions(data);

  // Auto-open picker if requested via ?openPicker=<slot> (e.g. after creating a recipe)
  const params = new URLSearchParams(window.location.search);
  const slotToOpen = params.get('openPicker');
  if (slotToOpen) {
    const meal = (data.meals || []).find((m) => m.name === slotToOpen);
    if (meal) {
      openMealPicker(meal.name, meal.recipes || [], data);
    }
    // Clean URL so refresh doesn't reopen
    const url = new URL(window.location.href);
    url.searchParams.delete('openPicker');
    window.history.replaceState({}, '', url.toString());
  }
}

function renderMenuActions(data) {
  let actions = document.getElementById('menu-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.id = 'menu-actions';
    const table = document.getElementById('menu-table');
    table.parentNode.insertBefore(actions, table.nextSibling);
  }
  actions.innerHTML = '';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.id = 'export-yaml-btn';
  exportBtn.textContent = 'Exporter YAML';
  exportBtn.addEventListener('click', exportYaml);
  actions.appendChild(exportBtn);

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.id = 'print-menu-btn';
  printBtn.textContent = '🖨 Imprimer';
  printBtn.addEventListener('click', () => window.print());
  actions.appendChild(printBtn);

  const hasOverrides =
    Object.keys(Store.loadCustomRecipes()).length > 0 ||
    Object.keys(Store.loadCustomIngredients()).length > 0 ||
    Object.keys(Store.loadMealOverrides()).length > 0;
  if (hasOverrides) {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.id = 'reset-overrides-btn';
    resetBtn.textContent = 'Réinitialiser les modifications';
    resetBtn.addEventListener('click', () => {
      if (!confirm('Effacer toutes les modifications locales (repas, recettes, ingrédients) ?')) return;
      localStorage.removeItem('customRecipes');
      localStorage.removeItem('customIngredients');
      localStorage.removeItem('mealOverrides');
      window.location.reload();
    });
    actions.appendChild(resetBtn);
  }
}

function exportYaml() {
  const payload = {
    customRecipes: Store.loadCustomRecipes(),
    customIngredients: Store.loadCustomIngredients(),
    mealOverrides: Store.loadMealOverrides(),
  };
  const yamlStr = jsyaml.dump(payload, { lineWidth: 120, noRefs: true });
  const blob = new Blob([yamlStr], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modifications-repas.yml';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Picker modal ---
let pickerEl = null;
let pickerBackdrop = null;

function closePicker() {
  if (pickerEl) pickerEl.remove();
  if (pickerBackdrop) pickerBackdrop.remove();
  pickerEl = null;
  pickerBackdrop = null;
  document.removeEventListener('keydown', onPickerKey);
}

function onPickerKey(e) {
  if (e.key === 'Escape') closePicker();
}

function openMealPicker(slot, currentRecipes, data) {
  closePicker();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', closePicker);

  const modal = document.createElement('div');
  modal.className = 'modal picker-modal';
  modal.addEventListener('click', (e) => e.stopPropagation());

  const title = document.createElement('h3');
  title.textContent = slot;
  modal.appendChild(title);

  // Current recipes list with inline remove buttons
  const list = document.createElement('ul');
  list.className = 'picker-recipes';
  if (currentRecipes.length === 0) {
    const li = document.createElement('li');
    li.className = 'picker-empty';
    li.textContent = '(vide / restes)';
    list.appendChild(li);
  } else {
    for (const name of currentRecipes) {
      const li = document.createElement('li');
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'picker-recipe-name';
      editBtn.textContent = name;
      editBtn.title = 'Modifier cette recette';
      editBtn.addEventListener('click', () => {
        window.location.href = `editer-recette.html?nom=${encodeURIComponent(name)}`;
      });
      li.appendChild(editBtn);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'picker-remove';
      rm.title = 'Retirer';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        const next = currentRecipes.filter((x) => x !== name);
        Store.setMealOverride(slot, { recipes: next });
        reloadAndKeepPicker(slot);
      });
      li.appendChild(rm);
      list.appendChild(li);
    }
  }
  modal.appendChild(list);

  // Single picker that adds on selection
  const addSelect = document.createElement('select');
  addSelect.className = 'picker-add';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '+ Ajouter une recette…';
  addSelect.appendChild(empty);
  const names = Object.keys(data.recipes || {}).sort((a, b) => a.localeCompare(b, 'fr'));
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    addSelect.appendChild(opt);
  }
  addSelect.addEventListener('change', () => {
    const v = addSelect.value;
    if (!v) return;
    const next = currentRecipes.slice();
    next.push(v);
    Store.setMealOverride(slot, { recipes: next });
    reloadAndKeepPicker(slot);
  });
  modal.appendChild(addSelect);

  // Compact action row
  const actions = document.createElement('div');
  actions.className = 'picker-actions';

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.textContent = '+ Nouvelle recette';
  createBtn.addEventListener('click', () => {
    window.location.href = `editer-recette.html?slot=${encodeURIComponent(slot)}`;
  });
  actions.appendChild(createBtn);

  const emptyBtn = document.createElement('button');
  emptyBtn.type = 'button';
  emptyBtn.textContent = 'Vider';
  emptyBtn.addEventListener('click', () => {
    Store.setMealOverride(slot, null);
    reloadAndKeepPicker(slot);
  });
  actions.appendChild(emptyBtn);

  const overrides = Store.loadMealOverrides();
  if (slot in overrides) {
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.textContent = 'Restaurer';
    restoreBtn.title = "Restaurer la valeur d'origine du YAML";
    restoreBtn.addEventListener('click', () => {
      Store.clearMealOverride(slot);
      reloadAndKeepPicker(slot);
    });
    actions.appendChild(restoreBtn);
  }
  modal.appendChild(actions);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closePicker);
  modal.appendChild(closeBtn);

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
  pickerEl = modal;
  pickerBackdrop = backdrop;
  document.addEventListener('keydown', onPickerKey);
}

function reloadAndRender() {
  App.loadData().then(renderMenu).catch((err) => {
    const e = document.getElementById('error');
    if (e) { e.hidden = false; e.textContent = err.message; }
  });
}

function reloadAndKeepPicker(slot) {
  App.loadData().then((data) => {
    renderMenu(data);
    const meal = (data.meals || []).find((m) => m.name === slot);
    if (meal) openMealPicker(meal.name, meal.recipes || [], data);
  }).catch((err) => {
    const e = document.getElementById('error');
    if (e) { e.hidden = false; e.textContent = err.message; }
  });
}

window.Menu = { renderMenu };
