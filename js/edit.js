// edit.js
// Form for creating/editing a custom recipe.
// URL params : ?slot=Mardi+midi (open from menu picker, will assign the recipe to the slot)
//              ?nom=<existing custom recipe name> (edit mode)
// Quantities are always saved for 1 person, matching the YAML convention.

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    slot: p.get('slot') || '',
    nom: p.get('nom') || '',
    from: p.get('from') || '',
    scan: p.get('scan') === '1',
  };
}

function backUrl(from) {
  if (from === 'recettes') return 'recettes.html';
  return 'index.html';
}

const STEP_MARKER = '--- cuisson ---';
const MARKER_RE = /^\s*-{2,}\s*cuisson\s*-{2,}\s*$/i;

function collectKnownTypes(data) {
  const types = new Set();
  for (const spec of Object.values(data.ingredients || {})) {
    if (spec.type) types.add(spec.type);
  }
  return Array.from(types).sort((a, b) => a.localeCompare(b, 'fr'));
}

function collectKnownUnits(data) {
  const units = new Set(['g', 'kg', 'mg', 'ml', 'cl', 'L', 'u', 'cs', 'cc']);
  for (const spec of Object.values(data.ingredients || {})) {
    if (spec.preferred) units.add(spec.preferred);
    if (spec.purchase) units.add(spec.purchase);
    if (spec.convert) {
      for (const [t, srcs] of Object.entries(spec.convert)) {
        units.add(t);
        for (const s of Object.keys(srcs || {})) units.add(s);
      }
    }
  }
  return Array.from(units).sort();
}

function unitsForSpec(spec) {
  const set = new Set();
  if (!spec) return [];
  if (spec.preferred) set.add(spec.preferred);
  if (spec.purchase) set.add(spec.purchase);
  if (spec.convert) {
    for (const [t, srcs] of Object.entries(spec.convert)) {
      set.add(t);
      for (const s of Object.keys(srcs || {})) set.add(s);
    }
  }
  return Array.from(set);
}

function findSpec(name, data, customIngredients) {
  if (!name) return null;
  return (data.ingredients && data.ingredients[name]) || customIngredients[name] || null;
}

// Returns the factor X such that 1 purchase = X preferred, derived from unitScales.
// Only returns a value when both units belong to the same scale chain (intra-dimension).
// Cross-dimension conversions (e.g. g ↔ cs) require a preset or manual factor.
function deriveConvertFactor(preferred, purchase, unitScales) {
  if (!preferred || !purchase || preferred === purchase || !unitScales) return null;
  const walk = (start, target) => {
    let unit = start;
    let factor = 1;
    const seen = new Set([unit]);
    while (unitScales[unit]) {
      const step = unitScales[unit];
      factor *= step.factor;
      unit = step.upper;
      if (seen.has(unit)) break;
      seen.add(unit);
      if (unit === target) return factor;
    }
    return null;
  };
  // 1 purchase = factor preferred via walk preferred → ... → purchase.
  let f = walk(preferred, purchase);
  if (f != null) return f;
  // Or walk purchase → ... → preferred, inverted.
  f = walk(purchase, preferred);
  if (f != null) return 1 / f;
  return null;
}

// Factor X such that 1 from = X to, using a preset block as the source of truth.
// Walks through the preset's base unit if no direct entry exists.
function factorFromPreset(preset, from, to) {
  if (!preset || !from || !to) return null;
  if (from === to) return 1;
  // Direct: convert[to][from] = factor → 1 from = factor to.
  if (preset[to] && preset[to][from] != null) return preset[to][from];
  // Inverse: convert[from][to] = factor → 1 to = factor from → 1 from = 1/factor to.
  if (preset[from] && preset[from][to] != null) {
    const f = preset[from][to];
    return f !== 0 ? 1 / f : null;
  }
  // Via the base unit (the first key of the preset).
  const base = Object.keys(preset)[0];
  if (!base || base === from || base === to) return null;
  // 1 from = X base, 1 to = Y base → 1 from = (X / Y) to.
  const fromInBase = preset[base] && preset[base][from] != null ? preset[base][from] : null;
  const toInBase = preset[base] && preset[base][to] != null ? preset[base][to] : null;
  if (fromInBase != null && toInBase != null && toInBase !== 0) return fromInBase / toInBase;
  return null;
}

function renderEdit(data) {
  const root = document.getElementById('edit-root');
  root.innerHTML = '';
  const { slot, nom, from, scan } = getParams();

  const customIngredients = Store.loadCustomIngredients();
  const customRecipes = Store.loadCustomRecipes();
  const isCustom = !!nom && (nom in customRecipes);

  // Adjust the back-link based on where the user came from.
  const backLink = document.getElementById('back-link');
  if (backLink && from === 'recettes') {
    backLink.textContent = '← Retour aux recettes';
    backLink.href = backUrl(from);
  }

  // Slot context banner.
  if (slot) {
    const ctx = document.createElement('p');
    ctx.className = 'edit-ctx';
    ctx.innerHTML = `Cette recette sera ajoutée à : <strong>${slot}</strong>`;
    root.appendChild(ctx);
  }

  // --- Recipe name
  const nameRow = document.createElement('div');
  nameRow.className = 'edit-row';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Nom de la recette';
  nameLabel.htmlFor = 'recipe-name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'recipe-name';
  nameInput.required = true;
  nameInput.value = nom || '';
  if (nom) nameInput.readOnly = true;
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  root.appendChild(nameRow);

  // --- Recipe base servings (number of people the quantities are written for)
  const portionsRow = document.createElement('div');
  portionsRow.className = 'edit-row';
  const portionsLabel = document.createElement('label');
  portionsLabel.textContent = 'Recette pour combien de personnes';
  portionsLabel.htmlFor = 'recipe-portions';
  const portionsInput = document.createElement('input');
  portionsInput.type = 'number';
  portionsInput.id = 'recipe-portions';
  portionsInput.min = '1';
  portionsInput.step = '1';
  portionsInput.value = '1';
  portionsRow.appendChild(portionsLabel);
  portionsRow.appendChild(portionsInput);
  root.appendChild(portionsRow);

  // --- Ingredients section
  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients';
  root.appendChild(h2i);
  const updateIngrTitle = () => {
    const n = Math.max(1, parseInt(portionsInput.value, 10) || 1);
    h2i.textContent = `Ingrédients (pour ${n} personne${n > 1 ? 's' : ''})`;
  };
  updateIngrTitle();
  portionsInput.addEventListener('input', updateIngrTitle);

  const ingrList = document.createElement('div');
  ingrList.id = 'edit-ingr-list';
  root.appendChild(ingrList);

  const addIngrBtn = document.createElement('button');
  addIngrBtn.type = 'button';
  addIngrBtn.className = 'add-row-btn';
  addIngrBtn.textContent = '+ Ajouter un ingrédient';
  addIngrBtn.addEventListener('click', () => {
    ingrList.appendChild(buildIngredientRow('', '', '', data, customIngredients));
  });
  root.appendChild(addIngrBtn);

  // --- Steps : Découpe + Cuisson
  const h2s = document.createElement('h2');
  h2s.textContent = 'Préparation';
  root.appendChild(h2s);

  const decoupeWrap = buildStepsBlock('Découpe', 'decoupe-list');
  root.appendChild(decoupeWrap.section);

  const cuissonWrap = buildStepsBlock('Cuisson', 'cuisson-list');
  root.appendChild(cuissonWrap.section);

  // --- Prefill if editing
  if (nom) {
    const existing = (data.recipes || {})[nom];
    if (existing) {
      if (Number(existing.portions) > 0) {
        portionsInput.value = String(Number(existing.portions));
        updateIngrTitle();
      }
      for (const [ingr, raw] of Object.entries(existing.ingredients || {})) {
        const { amount, unit } = Parser.parseQuantity(raw);
        ingrList.appendChild(buildIngredientRow(ingr, String(amount), unit, data, customIngredients));
      }
      const steps = (existing.steps || []).map(String);
      const idx = steps.findIndex((s) => MARKER_RE.test(s));
      const decoupe = idx === -1 ? steps : steps.slice(0, idx);
      const cuisson = idx === -1 ? [] : steps.slice(idx + 1);
      for (const s of decoupe) decoupeWrap.addStep(s);
      for (const s of cuisson) cuissonWrap.addStep(s);
    }
  } else if (scan && window.Scan) {
    const draft = Scan.consumeDraft();
    if (draft) {
      if (draft.name) nameInput.value = String(draft.name);
      const draftServings = Math.max(1, parseInt(draft.servings, 10) || 4);
      portionsInput.value = String(draftServings);
      updateIngrTitle();
      // Sequentially open the new-ingredient modal pre-filled for each unknown
      // ingredient so the user can validate before the row is rendered.
      queueScanIngredients(draft.ingredients || [], data, customIngredients, ingrList);
      const steps = (draft.steps || []).map(String);
      const idx = steps.findIndex((s) => MARKER_RE.test(s));
      const decoupe = idx === -1 ? steps : steps.slice(0, idx);
      const cuisson = idx === -1 ? [] : steps.slice(idx + 1);
      for (const s of decoupe) decoupeWrap.addStep(s);
      for (const s of cuisson) cuissonWrap.addStep(s);
    }
  }

  // --- Actions
  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'preview-btn';
  previewBtn.textContent = '👁 Prévisualiser';
  previewBtn.addEventListener('click', () => onPreview(data, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients));
  actions.appendChild(previewBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSave(data, slot, from, nom, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients));
  actions.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { window.location.href = backUrl(from); });
  actions.appendChild(cancelBtn);

  if (nom && isCustom) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-btn';
    delBtn.textContent = 'Supprimer cette recette';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Supprimer la recette « ${nom} » ?`)) return;
      Store.deleteCustomRecipe(nom);
      window.location.href = backUrl(from);
    });
    actions.appendChild(delBtn);
  }

  root.appendChild(actions);
}

function buildStepsBlock(title, listId) {
  const section = document.createElement('div');
  section.className = 'steps-section';

  const h3 = document.createElement('h3');
  h3.textContent = title;
  section.appendChild(h3);

  const list = document.createElement('div');
  list.className = 'edit-steps-list';
  list.id = listId;
  section.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-row-btn';
  addBtn.textContent = '+ Ajouter une étape';
  section.appendChild(addBtn);

  const addStep = (value) => {
    const row = document.createElement('div');
    row.className = 'step-row';

    const num = document.createElement('span');
    num.className = 'step-num';
    row.appendChild(num);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'step-input';
    input.placeholder = 'Étape…';
    input.value = value || '';
    row.appendChild(input);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ingr-del-btn';
    del.textContent = '×';
    del.title = 'Retirer cette étape';
    del.addEventListener('click', () => {
      row.remove();
      renumber();
    });
    row.appendChild(del);

    list.appendChild(row);
    renumber();
  };

  const renumber = () => {
    Array.from(list.querySelectorAll('.step-row')).forEach((row, i) => {
      const n = row.querySelector('.step-num');
      if (n) n.textContent = `${i + 1}.`;
    });
  };

  addBtn.addEventListener('click', () => addStep(''));

  const readSteps = () => Array.from(list.querySelectorAll('.step-input'))
    .map((i) => i.value.trim())
    .filter(Boolean);

  return { section, addStep, readSteps, count: () => list.querySelectorAll('.step-row').length };
}

function buildIngredientRow(name, amount, unit, data, customIngredients) {
  const row = document.createElement('div');
  row.className = 'ingr-row';

  const knownIngredientsList = Array.from(new Set([
    ...Object.keys((data && data.ingredients) || {}),
    ...Object.keys(customIngredients || {}),
  ])).sort((a, b) => a.localeCompare(b, 'fr'));

  const nameField = document.createElement('div');
  nameField.className = 'ingr-name-field';

  const nameSelect = document.createElement('select');
  nameSelect.className = 'ingr-name-select';
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.textContent = '— choisir un ingrédient —';
  placeholderOpt.disabled = true;
  nameSelect.appendChild(placeholderOpt);
  for (const n of knownIngredientsList) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    nameSelect.appendChild(o);
  }
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Nouvel ingrédient';
  nameSelect.appendChild(newOpt);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'nouvel ingrédient';
  nameInput.className = 'ingr-name-input';
  nameInput.value = name;
  nameInput.hidden = true;

  if (name && knownIngredientsList.includes(name)) {
    nameSelect.value = name;
  } else if (name) {
    nameSelect.value = '__new__';
    nameInput.hidden = false;
  } else {
    nameSelect.value = '';
  }

  nameField.appendChild(nameSelect);
  nameField.appendChild(nameInput);

  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.step = '0.01';
  amountInput.min = '0';
  amountInput.placeholder = 'qté';
  amountInput.className = 'ingr-amount-input';
  amountInput.value = amount;

  const unitSelect = document.createElement('select');
  unitSelect.className = 'ingr-unit-select';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'ingr-del-btn';
  delBtn.textContent = '×';
  delBtn.title = 'Retirer cet ingrédient';
  delBtn.addEventListener('click', () => row.remove());

  row.appendChild(nameField);
  row.appendChild(amountInput);
  row.appendChild(unitSelect);
  row.appendChild(delBtn);

  // New ingredients are created via a dedicated modal (see openNewIngredientModal).

  // Replace options of unitSelect, and gate amount/unit on `enable`.
  const setUnits = (units, fallback, enable) => {
    const prev = unitSelect.value || fallback || '';
    unitSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— unité —';
    placeholder.disabled = true;
    unitSelect.appendChild(placeholder);
    for (const u of units) {
      const o = document.createElement('option');
      o.value = u;
      o.textContent = u;
      unitSelect.appendChild(o);
    }
    if (prev && units.includes(prev)) unitSelect.value = prev;
    else if (units.length > 0) unitSelect.value = units[0];
    else unitSelect.value = '';
    const e = enable === undefined ? units.length > 0 : !!enable;
    unitSelect.disabled = !e;
    amountInput.disabled = !e;
    unitSelect.hidden = !e;
    amountInput.hidden = !e;
  };


  const refresh = () => {
    const v = nameInput.value.trim();
    if (!v) {
      setUnits([], unit, false);
      return;
    }
    const spec = findSpec(v, data, customIngredients);
    if (spec) {
      const lockedUnits = spec.preferred ? [spec.preferred] : unitsForSpec(spec);
      setUnits(lockedUnits, unit, true);
    } else {
      setUnits([], unit, false);
    }
  };

  // Helper to add a newly-created ingredient option to this row's select.
  const addIngredientOption = (n) => {
    if (Array.from(nameSelect.options).some((o) => o.value === n)) return;
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    nameSelect.insertBefore(o, newOpt);
  };
  row._addIngredientOption = addIngredientOption;

  nameSelect.addEventListener('change', () => {
    const v = nameSelect.value;
    if (v === '__new__') {
      // Revert select so the placeholder/previous value is visible while modal is open.
      const prev = nameInput.value.trim();
      nameSelect.value = (prev && Array.from(nameSelect.options).some((o) => o.value === prev)) ? prev : '';
      if (typeof window.openNewIngredientModal === 'function') {
        window.openNewIngredientModal({
          data,
          customIngredients,
          initialName: '',
          onSave: ({ name: newName, spec }) => {
            customIngredients[newName] = spec;
            if (window.Store && typeof Store.saveCustomIngredient === 'function') {
              Store.saveCustomIngredient(newName, spec);
            }
            // Propagate option to all ingredient rows on the page.
            document.querySelectorAll('#edit-ingr-list .ingr-row').forEach((r) => {
              if (typeof r._addIngredientOption === 'function') r._addIngredientOption(newName);
            });
            nameSelect.value = newName;
            nameInput.value = newName;
            refresh();
          },
        });
      }
    } else if (v) {
      nameInput.value = v;
      refresh();
    }
  });
  refresh();
  if (unit) {
    const opts = Array.from(unitSelect.options).map((o) => o.value);
    if (!opts.includes(unit) && unit) {
      const o = document.createElement('option');
      o.value = unit;
      o.textContent = unit;
      unitSelect.appendChild(o);
    }
    unitSelect.value = unit;
  }

  return row;
}

function readIngredientRow(row) {
  const name = row.querySelector('.ingr-name-input').value.trim();
  const amount = row.querySelector('.ingr-amount-input').value.trim();
  const unit = row.querySelector('.ingr-unit-select').value.trim();
  return { name, amount, unit };
}

// Build a recipe object from the current form state. Returns { name, recipe, mergedIngredients } or { error }.
function buildRecipeFromForm(data, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients, { requireName = true } = {}) {
  const name = nameInput.value.trim();
  if (requireName && !name) return { error: 'Le nom de la recette est obligatoire.' };

  const portions = Math.max(1, parseInt(portionsInput && portionsInput.value, 10) || 1);

  const decoupe = decoupeWrap.readSteps();
  const cuisson = cuissonWrap.readSteps();
  const steps = [];
  for (const s of decoupe) steps.push(s);
  if (cuisson.length > 0) {
    steps.push(STEP_MARKER);
    for (const s of cuisson) steps.push(s);
  }
  if (steps.length === 0) return { error: 'Au moins une étape de préparation est obligatoire.' };

  const rows = Array.from(ingrList.querySelectorAll('.ingr-row'));
  const parsed = rows.map((r) => readIngredientRow(r)).filter((r) => r.name);
  if (parsed.length === 0) return { error: 'Ajoute au moins un ingrédient.' };

  for (const r of parsed) {
    if (!r.amount || !isFinite(parseFloat(r.amount))) return { error: `Quantité manquante pour « ${r.name} ».` };
    if (!r.unit) return { error: `Unité manquante pour « ${r.name} ».` };
  }

  const ingredients = {};
  for (const r of parsed) {
    const a = parseFloat(r.amount);
    ingredients[r.name] = `${a}${r.unit}`;
  }
  const recipe = { ingredients, steps };
  if (portions > 1) recipe.portions = portions;

  const mergedIngredients = Object.assign({}, data.ingredients || {}, customIngredients);
  return { name, recipe, mergedIngredients };
}

function onPreview(data, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients) {
  const errEl = document.getElementById('error');
  errEl.hidden = true;
  const built = buildRecipeFromForm(data, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients, { requireName: false });
  if (built.error) { errEl.hidden = false; errEl.textContent = built.error; return; }
  openPreviewModal(built.name || '(sans nom)', built.recipe, built.mergedIngredients, data.unitScales || {});
}

function openPreviewModal(name, recipe, ingredientsSpec, unitScales, portionsOverride) {
  // Remove any previous preview.
  document.querySelectorAll('.preview-backdrop, .preview-modal').forEach((n) => n.remove());

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop preview-backdrop';
  backdrop.addEventListener('click', () => { backdrop.remove(); modal.remove(); });
  document.body.appendChild(backdrop);

  const modal = document.createElement('div');
  modal.className = 'modal preview-modal';
  const close = document.createElement('button');
  close.className = 'modal-close';
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => { backdrop.remove(); modal.remove(); });
  modal.appendChild(close);

  const inner = document.createElement('div');
  inner.id = 'preview-root';
  modal.appendChild(inner);

  const previewPortions = Number(portionsOverride) > 0
    ? Number(portionsOverride)
    : (Number(recipe.portions) > 0 ? Number(recipe.portions) : 1);
  renderRecipePreview(inner, name, recipe, previewPortions, ingredientsSpec, unitScales);
  document.body.appendChild(modal);
}

// Standalone preview rendering : mirrors js/recipe.js logic without depending on URL params.
function renderRecipePreview(root, name, recipe, portions, ingredientsSpec, unitScales) {
  root.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = name;
  root.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'recipe-subtitle';
  const recipeBase = Number(recipe.portions) > 0 ? Number(recipe.portions) : 1;
  const baseSuffix = recipeBase > 1 ? ` (recette de base pour ${recipeBase} personnes)` : '';
  subtitle.textContent = `Prévisualisation — ${portions} portion${portions > 1 ? 's' : ''}${baseSuffix}`;
  root.appendChild(subtitle);

  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients';
  root.appendChild(h2i);

  const ulIngr = document.createElement('ul');
  ulIngr.className = 'ingredients-list';
  for (const [ingrName, rawValue] of Object.entries(recipe.ingredients || {})) {
    const { amount, unit } = Parser.parseQuantity(rawValue);
    const scaled = (amount * portions) / recipeBase;
    const spec = ingredientsSpec[ingrName] || {};
    const displayParts = Shopping.aggregateIngredient(ingrName, { [unit]: scaled }, ingredientsSpec);

    const li = document.createElement('li');
    const labelStr = displayParts
      .map((p) => Parser.promoteUnit(p.amount, p.unit, unitScales))
      .map((p) => `${Parser.formatAmount(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
      .join(' + ');

    const convert = spec.convert || null;
    const metricTarget = Shopping.pickMetricTarget(spec);
    let equivStr = '';
    if (metricTarget) {
      const parts = [];
      for (const p of displayParts) {
        if (p.unit === metricTarget) { parts.push(p); continue; }
        const v = Shopping.convertAmount(p.amount, p.unit, metricTarget, convert);
        if (v != null && isFinite(v) && v > 0) parts.push({ amount: v, unit: metricTarget });
      }
      if (parts.length > 0) {
        const promoted = parts
          .map((p) => Parser.promoteOnly(p.amount, p.unit, unitScales))
          .map((p) => `${Parser.formatAmountSmart(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
          .join(' + ');
        if (promoted !== labelStr) equivStr = promoted;
      }
    }

    li.innerHTML = `<span class="ingr-name">${ingrName}</span><span class="ingr-qtys"><span class="ingr-qty has-popover" title="Voir les conversions">${labelStr}</span>${equivStr ? `<span class="ingr-qty-equiv">≈ ${equivStr}</span>` : ''}</span>`;
    const qtyEl = li.querySelector('.ingr-qty');
    qtyEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      Popover.showConversions(ingrName, spec, qtyEl, displayParts, unitScales);
    });
    ulIngr.appendChild(li);
  }
  root.appendChild(ulIngr);

  const h2s = document.createElement('h2');
  h2s.textContent = 'Préparation';
  root.appendChild(h2s);

  if (!recipe.steps || recipe.steps.length === 0) {
    const p = document.createElement('p');
    p.className = 'no-steps';
    p.textContent = 'Aucune étape de préparation renseignée pour cette recette.';
    root.appendChild(p);
  } else {
    const splitIdx = recipe.steps.findIndex((s) => MARKER_RE.test(String(s)));
    const renderList = (items) => {
      const ol = document.createElement('ol');
      ol.className = 'steps-list';
      for (const step of items) {
        const li = document.createElement('li');
        li.textContent = step;
        ol.appendChild(li);
      }
      root.appendChild(ol);
    };
    const renderBlock = (title, items) => {
      if (!items || items.length === 0) return;
      const h3 = document.createElement('h3');
      h3.textContent = title;
      root.appendChild(h3);
      renderList(items);
    };
    if (splitIdx === -1) {
      renderList(recipe.steps);
    } else {
      renderBlock('Découpe', recipe.steps.slice(0, splitIdx));
      renderBlock('Cuisson', recipe.steps.slice(splitIdx + 1));
    }
  }
}

function normalizeStep(s) {
  const str = String(s);
  return MARKER_RE.test(str) ? STEP_MARKER : str.trim();
}

// Two recipes are considered identical when their ingredient sets (name + parsed amount + unit)
// and their step sequences (after normalization) match exactly.
function recipesEqual(r1, r2) {
  if (!r1 || !r2) return false;
  const base1 = Number(r1.portions) > 0 ? Number(r1.portions) : 1;
  const base2 = Number(r2.portions) > 0 ? Number(r2.portions) : 1;
  if (base1 !== base2) return false;
  const i1 = r1.ingredients || {};
  const i2 = r2.ingredients || {};
  const k1 = Object.keys(i1).sort();
  const k2 = Object.keys(i2).sort();
  if (k1.length !== k2.length) return false;
  for (let i = 0; i < k1.length; i++) {
    if (k1[i] !== k2[i]) return false;
    const p1 = Parser.parseQuantity(i1[k1[i]]);
    const p2 = Parser.parseQuantity(i2[k2[i]]);
    if (Math.abs((p1.amount || 0) - (p2.amount || 0)) > 1e-9) return false;
    if ((p1.unit || '') !== (p2.unit || '')) return false;
  }
  const s1 = (r1.steps || []).map(normalizeStep);
  const s2 = (r2.steps || []).map(normalizeStep);
  if (s1.length !== s2.length) return false;
  for (let i = 0; i < s1.length; i++) if (s1[i] !== s2[i]) return false;
  return true;
}

async function onSave(data, slot, from, originalNom, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients) {
  const errEl = document.getElementById('error');
  errEl.hidden = true;
  const built = buildRecipeFromForm(data, nameInput, portionsInput, ingrList, decoupeWrap, cuissonWrap, customIngredients, { requireName: true });
  if (built.error) { errEl.hidden = false; errEl.textContent = built.error; return; }

  const customRecipes = Store.loadCustomRecipes();
  const yamlRecipes = data.recipesYaml || {};
  const yamlOriginal = yamlRecipes[built.name];
  const matchesYamlOriginal = yamlOriginal && recipesEqual(built.recipe, yamlOriginal);

  // In create mode (no originalNom), a name collision with an existing recipe is a duplicate.
  if (!originalNom && built.name in (data.recipes || {})) {
    errEl.hidden = false;
    errEl.textContent = 'Cette recette existe déjà.';
    return;
  }

  // Duplicate detection: identical content under a different name.
  // Only skip the recipe currently being edited (originalNom), never the new name itself.
  for (const [otherName, otherRecipe] of Object.entries(data.recipes || {})) {
    if (originalNom && otherName === originalNom) continue;
    if (recipesEqual(built.recipe, otherRecipe)) {
      errEl.hidden = false;
      errEl.textContent = 'Cette recette existe déjà.';
      return;
    }
  }

  // Semantic similarity check (creation only, not when editing an existing recipe).
  // If a near-duplicate is found, ask the user how to proceed. On network/AI failure,
  // ask the user whether to save anyway rather than silently bypassing.
  let replaceTargetName = null; // when set, save under this name instead of built.name
  if (!originalNom && window.Similar && typeof Similar.findMatch === 'function') {
    let matched = null;
    let bypassMatch = false;
    while (true) {
      const overlay = Similar.showOverlay('Recherche de recettes similaires…');
      let lookupError = null;
      try {
        matched = await Similar.findMatch({ name: built.name, recipe: built.recipe }, data.recipes || {});
      } catch (e) {
        console.warn('Similar.findMatch failed', e);
        lookupError = e;
      } finally {
        overlay.remove();
      }
      if (!lookupError) break;
      const countdownSeconds = Number(lookupError && lookupError.retryAfterSeconds) || null;
      const choice = await Similar.ask(
        'Votre serviteur est indisponible pour comparer la recette aux existantes. Souhaites-tu enregistrer quand même ?',
        { confirmLabel: 'Enregistrer', cancelLabel: 'Annuler', countdownSeconds, retryLabel: 'Réessayer' }
      );
      if (choice === 'cancel') return;
      if (choice === 'confirm') { bypassMatch = true; break; }
      // 'retry' → loop and re-attempt findMatch.
    }
    if (!bypassMatch && matched && matched !== built.name && (data.recipes || {})[matched]) {
      const choice = await Similar.confirm(built.name, matched, data.recipes[matched], {
        ingredientsSpec: data.ingredients || {},
        unitScales: data.unitScales || {},
      });
      if (choice === 'cancel') return;
      if (choice === 'replace') replaceTargetName = matched;
      // 'add' → fall through to the normal save path.
    }
  }

  if (replaceTargetName) {
    // Override the existing recipe (perso or YAML) under its current name.
    Store.saveCustomRecipe(replaceTargetName, built.recipe);
  } else if (matchesYamlOriginal) {
    // The recipe is back to its original YAML form: it should not be perso.
    if (built.name in customRecipes) Store.deleteCustomRecipe(built.name);
  } else {
    Store.saveCustomRecipe(built.name, built.recipe);
  }

  if (slot) {
    const savedName = replaceTargetName || built.name;
    fetch('repas.yml')
      .then((r) => r.text())
      .then((text) => {
        const yamlData = jsyaml.load(text);
        const overrides = Store.loadMealOverrides();
        let current = [];
        if (slot in overrides) {
          const ov = overrides[slot];
          current = ov && Array.isArray(ov.recipes) ? ov.recipes.slice() : [];
        } else {
          const m = (yamlData.meals || []).find((x) => x.name === slot);
          current = (m && Array.isArray(m.recipes)) ? m.recipes.slice() : [];
        }
        if (!current.includes(savedName)) current.push(savedName);
        Store.setMealOverride(slot, { recipes: current });
        window.location.href = `index.html?openPicker=${encodeURIComponent(slot)}`;
      })
      .catch(() => { window.location.href = `index.html?openPicker=${encodeURIComponent(slot)}`; });
  } else {
    window.location.href = backUrl(from);
  }
}

// Programmatic ingredient creation from AI-supplied fields.
// `fields` shape (all strings unless noted):
//   { type, preferred, purchase, convertFactor?: number, metricFactor?: number, metricUnit?: 'g'|'ml' }
// Returns { ok: true, name, spec } on success or { ok: false, error } on failure.
// Does NOT touch the DOM — caller is responsible for refreshing rows.
function createIngredientFromAi(name, fields, data, customIngredients) {
  if (!name || typeof name !== 'string') return { ok: false, error: 'Nom manquant.' };
  name = name.trim();
  if (!name) return { ok: false, error: 'Nom vide.' };
  if ((data && data.ingredients && data.ingredients[name]) || (customIngredients && customIngredients[name])) {
    return { ok: true, name, spec: (customIngredients && customIngredients[name]) || data.ingredients[name] };
  }
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'Métadonnées manquantes.' };

  const type = String(fields.type || '').trim();
  const preferred = String(fields.preferred || '').trim();
  const purchase = String(fields.purchase || '').trim();
  if (!type || !preferred || !purchase) return { ok: false, error: 'Champs requis manquants (type/preferred/purchase).' };

  const spec = { preferred, purchase, type };

  if (preferred !== purchase) {
    const unitScales = (data && data.unitScales) || {};
    const derived = deriveConvertFactor(preferred, purchase, unitScales);
    if (derived != null) {
      spec.convert = { [preferred]: { [purchase]: derived } };
    } else {
      const f = Number(fields.convertFactor);
      if (!isFinite(f) || f <= 0) return { ok: false, error: `Facteur de conversion ${purchase}→${preferred} manquant.` };
      spec.convert = { [preferred]: { [purchase]: f } };
    }
  }

  // Metric reference if neither pref nor purchase is an equiv unit.
  const needMetric = !Parser.isEquivUnit(preferred) && !Parser.isEquivUnit(purchase);
  if (needMetric) {
    const mf = Number(fields.metricFactor);
    const mu = String(fields.metricUnit || 'g').trim().toLowerCase();
    const metricUnit = mu === 'ml' ? 'ml' : 'g';
    if (!isFinite(mf) || mf <= 0) return { ok: false, error: 'Facteur métrique manquant.' };
    spec.convert = spec.convert || {};
    spec.convert[metricUnit] = spec.convert[metricUnit] || {};
    spec.convert[metricUnit][preferred] = mf;
  }

  customIngredients[name] = spec;
  if (window.Store && typeof Store.saveCustomIngredient === 'function') {
    Store.saveCustomIngredient(name, spec);
  }
  return { ok: true, name, spec };
}

// Sequentially open the new-ingredient modal (pre-filled with AI metadata) for
// each unknown ingredient in a scanned recipe, then append the row. Known
// ingredients are appended directly. Modal opens are awaited so the user
// validates one ingredient before the next modal appears, and so the row's
// unit dropdown resolves correctly once the spec is in customIngredients.
async function queueScanIngredients(ings, data, customIngredients, ingrList) {
  for (const ing of ings) {
    if (!ing || !ing.name) continue;
    const ingName = String(ing.name).trim();
    if (!ingName) continue;

    const knownAlready = (data.ingredients && data.ingredients[ingName]) || customIngredients[ingName];
    if (!knownAlready && typeof window.openNewIngredientModal === 'function') {
      await new Promise((resolve) => {
        window.openNewIngredientModal({
          data,
          customIngredients,
          initialName: ingName,
          prefill: {
            type: ing.type,
            preferred: ing.preferred || ing.unit,
            purchase: ing.purchase || ing.preferred || ing.unit,
            convertFactor: ing.convertFactor,
            metricFactor: ing.metricFactor,
            metricUnit: ing.metricUnit,
          },
          onSave: ({ name, spec }) => {
            customIngredients[name] = spec;
            if (window.Store && typeof Store.saveCustomIngredient === 'function') {
              Store.saveCustomIngredient(name, spec);
            }
            if (data.ingredients) data.ingredients[name] = spec;
            // Propagate option to any rows already on the page.
            document.querySelectorAll('#edit-ingr-list .ingr-row').forEach((r) => {
              if (typeof r._addIngredientOption === 'function') r._addIngredientOption(name);
            });
            resolve();
          },
          onCancel: () => resolve(),
        });
      });
    }

    const amount = Number(ing.quantity);
    const amtStr = isFinite(amount) && amount > 0 ? String(amount) : '';
    ingrList.appendChild(buildIngredientRow(ingName, amtStr, String(ing.unit || ''), data, customIngredients));
  }
}

window.Edit = { renderEdit, createIngredientFromAi };
window.Preview = { open: openPreviewModal };
