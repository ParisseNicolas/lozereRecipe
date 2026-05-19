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
  title.textContent = `Modifier : ${slot}`;
  modal.appendChild(title);

  const cur = document.createElement('p');
  cur.className = 'picker-current';
  cur.textContent = currentRecipes.length > 0
    ? `Actuellement : ${currentRecipes.join(', ')}`
    : 'Actuellement : (vide / restes)';
  modal.appendChild(cur);

  // Action 1 : add an existing recipe
  const addBlock = document.createElement('div');
  addBlock.className = 'picker-block';
  const addLabel = document.createElement('label');
  addLabel.textContent = 'Ajouter une recette existante :';
  addBlock.appendChild(addLabel);
  const select = document.createElement('select');
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— choisir —';
  select.appendChild(empty);
  const names = Object.keys(data.recipes || {}).sort((a, b) => a.localeCompare(b, 'fr'));
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    select.appendChild(opt);
  }
  addBlock.appendChild(select);
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = 'Ajouter';
  addBtn.addEventListener('click', () => {
    const v = select.value;
    if (!v) return;
    const next = currentRecipes.slice();
    next.push(v);
    Store.setMealOverride(slot, { recipes: next });
    closePicker();
    reloadAndRender();
  });
  addBlock.appendChild(addBtn);
  modal.appendChild(addBlock);

  // Action 2 : replace (set as single recipe)
  const replaceBlock = document.createElement('div');
  replaceBlock.className = 'picker-block';
  const replaceLabel = document.createElement('label');
  replaceLabel.textContent = 'Remplacer par une recette existante :';
  replaceBlock.appendChild(replaceLabel);
  const select2 = document.createElement('select');
  select2.appendChild(empty.cloneNode(true));
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    select2.appendChild(opt);
  }
  replaceBlock.appendChild(select2);
  const replaceBtn = document.createElement('button');
  replaceBtn.type = 'button';
  replaceBtn.textContent = 'Remplacer';
  replaceBtn.addEventListener('click', () => {
    const v = select2.value;
    if (!v) return;
    Store.setMealOverride(slot, { recipes: [v] });
    closePicker();
    reloadAndRender();
  });
  replaceBlock.appendChild(replaceBtn);
  modal.appendChild(replaceBlock);

  // Action 3 : remove one of the current recipes
  if (currentRecipes.length > 0) {
    const rmBlock = document.createElement('div');
    rmBlock.className = 'picker-block';
    const rmLabel = document.createElement('label');
    rmLabel.textContent = 'Retirer une recette du créneau :';
    rmBlock.appendChild(rmLabel);
    const rmSel = document.createElement('select');
    rmSel.appendChild(empty.cloneNode(true));
    for (const n of currentRecipes) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      rmSel.appendChild(opt);
    }
    rmBlock.appendChild(rmSel);
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.textContent = 'Retirer';
    rmBtn.addEventListener('click', () => {
      const v = rmSel.value;
      if (!v) return;
      const next = currentRecipes.filter((x) => x !== v);
      Store.setMealOverride(slot, { recipes: next });
      closePicker();
      reloadAndRender();
    });
    rmBlock.appendChild(rmBtn);
    modal.appendChild(rmBlock);
  }

  // Action 4 : create a new recipe
  const createBlock = document.createElement('div');
  createBlock.className = 'picker-block';
  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'picker-primary';
  createBtn.textContent = '+ Créer une nouvelle recette';
  createBtn.addEventListener('click', () => {
    window.location.href = `editer-recette.html?slot=${encodeURIComponent(slot)}`;
  });
  createBlock.appendChild(createBtn);
  modal.appendChild(createBlock);

  // Action 5 : empty slot
  const emptyBlock = document.createElement('div');
  emptyBlock.className = 'picker-block';
  const emptyBtn = document.createElement('button');
  emptyBtn.type = 'button';
  emptyBtn.textContent = 'Vider ce créneau (restes)';
  emptyBtn.addEventListener('click', () => {
    Store.setMealOverride(slot, null);
    closePicker();
    reloadAndRender();
  });
  emptyBlock.appendChild(emptyBtn);
  modal.appendChild(emptyBlock);

  // Action 6 : restore original
  const overrides = Store.loadMealOverrides();
  if (slot in overrides) {
    const restoreBlock = document.createElement('div');
    restoreBlock.className = 'picker-block';
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.textContent = "Restaurer la valeur d'origine du YAML";
    restoreBtn.addEventListener('click', () => {
      Store.clearMealOverride(slot);
      closePicker();
      reloadAndRender();
    });
    restoreBlock.appendChild(restoreBtn);
    modal.appendChild(restoreBlock);
  }

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

window.Menu = { renderMenu };
