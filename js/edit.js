// edit.js
// Form for creating/editing a custom recipe.
// URL params : ?slot=Mardi+midi (open from menu picker, will assign the recipe to the slot)
//              ?nom=<existing custom recipe name> (edit mode)
// Quantities are always saved for 1 person, matching the YAML convention.

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return { slot: p.get('slot') || '', nom: p.get('nom') || '' };
}

// Collect units seen across the YAML for the unit autocomplete.
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

function collectKnownTypes(data) {
  const types = new Set();
  for (const spec of Object.values(data.ingredients || {})) {
    if (spec.type) types.add(spec.type);
  }
  return Array.from(types).sort((a, b) => a.localeCompare(b, 'fr'));
}

function renderEdit(data) {
  const root = document.getElementById('edit-root');
  root.innerHTML = '';
  const { slot, nom } = getParams();

  const knownIngredients = Object.keys(data.ingredients || {}).sort((a, b) => a.localeCompare(b, 'fr'));
  const knownUnits = collectKnownUnits(data);
  const knownTypes = collectKnownTypes(data);
  const customIngredients = Store.loadCustomIngredients();

  // Hidden datalists.
  const dlIngr = document.createElement('datalist');
  dlIngr.id = 'dl-ingredients';
  for (const n of knownIngredients) {
    const o = document.createElement('option');
    o.value = n;
    dlIngr.appendChild(o);
  }
  root.appendChild(dlIngr);

  const dlUnits = document.createElement('datalist');
  dlUnits.id = 'dl-units';
  for (const u of knownUnits) {
    const o = document.createElement('option');
    o.value = u;
    dlUnits.appendChild(o);
  }
  root.appendChild(dlUnits);

  const dlTypes = document.createElement('datalist');
  dlTypes.id = 'dl-types';
  for (const t of knownTypes) {
    const o = document.createElement('option');
    o.value = t;
    dlTypes.appendChild(o);
  }
  root.appendChild(dlTypes);

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

  // --- Ingredients section
  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients (pour 1 personne)';
  root.appendChild(h2i);

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

  // --- Steps section
  const h2s = document.createElement('h2');
  h2s.textContent = 'Étapes de préparation *';
  root.appendChild(h2s);
  const stepsHint = document.createElement('p');
  stepsHint.className = 'edit-hint';
  stepsHint.textContent = 'Une étape par ligne. Obligatoire.';
  root.appendChild(stepsHint);
  const stepsTa = document.createElement('textarea');
  stepsTa.id = 'recipe-steps';
  stepsTa.rows = 8;
  stepsTa.required = true;
  root.appendChild(stepsTa);

  // --- Prefill if editing
  if (nom) {
    const existing = (data.recipes || {})[nom];
    if (existing) {
      for (const [ingr, raw] of Object.entries(existing.ingredients || {})) {
        const { amount, unit } = Parser.parseQuantity(raw);
        ingrList.appendChild(buildIngredientRow(ingr, String(amount), unit, data, customIngredients));
      }
      stepsTa.value = (existing.steps || []).join('\n');
    }
  } else {
    // Start with one empty row.
    ingrList.appendChild(buildIngredientRow('', '', '', data, customIngredients));
  }

  // --- Actions
  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSave(data, slot, nameInput, ingrList, stepsTa, customIngredients));
  actions.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
  actions.appendChild(cancelBtn);

  if (nom) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'delete-btn';
    delBtn.textContent = 'Supprimer cette recette';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Supprimer la recette « ${nom} » ?`)) return;
      Store.deleteCustomRecipe(nom);
      window.location.href = 'index.html';
    });
    actions.appendChild(delBtn);
  }

  root.appendChild(actions);
}

function buildIngredientRow(name, amount, unit, data, customIngredients) {
  const row = document.createElement('div');
  row.className = 'ingr-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'ingrédient';
  nameInput.setAttribute('list', 'dl-ingredients');
  nameInput.className = 'ingr-name-input';
  nameInput.value = name;

  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.step = '0.01';
  amountInput.min = '0';
  amountInput.placeholder = 'qté';
  amountInput.className = 'ingr-amount-input';
  amountInput.value = amount;

  const unitInput = document.createElement('input');
  unitInput.type = 'text';
  unitInput.placeholder = 'unité';
  unitInput.setAttribute('list', 'dl-units');
  unitInput.className = 'ingr-unit-input';
  unitInput.value = unit;

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'ingr-del-btn';
  delBtn.textContent = '×';
  delBtn.title = 'Retirer cet ingrédient';
  delBtn.addEventListener('click', () => row.remove());

  row.appendChild(nameInput);
  row.appendChild(amountInput);
  row.appendChild(unitInput);
  row.appendChild(delBtn);

  // Sub-block for unknown ingredients : type/preferred/purchase/convert.
  const sub = document.createElement('div');
  sub.className = 'new-ingr-sub';
  sub.hidden = true;
  row.appendChild(sub);

  const refresh = () => {
    const v = nameInput.value.trim();
    const known = !!(v && ((data.ingredients && data.ingredients[v]) || customIngredients[v]));
    if (!v || known) { sub.hidden = true; sub.innerHTML = ''; return; }
    if (sub.dataset.builtFor === v) return;
    sub.dataset.builtFor = v;
    sub.hidden = false;
    sub.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'edit-hint';
    hint.innerHTML = `Nouvel ingrédient « <strong>${v}</strong> » : précise sa catégorie et ses unités.`;
    sub.appendChild(hint);

    const typeInput = document.createElement('input');
    typeInput.type = 'text';
    typeInput.placeholder = 'catégorie (ex: Fruits et légumes)';
    typeInput.setAttribute('list', 'dl-types');
    typeInput.className = 'new-ingr-type';
    sub.appendChild(typeInput);

    const prefInput = document.createElement('input');
    prefInput.type = 'text';
    prefInput.placeholder = 'unité recette (ex: g)';
    prefInput.setAttribute('list', 'dl-units');
    prefInput.className = 'new-ingr-pref';
    prefInput.value = unitInput.value || '';
    sub.appendChild(prefInput);

    const purchaseInput = document.createElement('input');
    purchaseInput.type = 'text';
    purchaseInput.placeholder = "unité d'achat (ex: u)";
    purchaseInput.setAttribute('list', 'dl-units');
    purchaseInput.className = 'new-ingr-purchase';
    sub.appendChild(purchaseInput);

    const convHint = document.createElement('p');
    convHint.className = 'edit-hint';
    convHint.textContent = 'Conversion (optionnelle) : 1 unité achat = X unités recette';
    sub.appendChild(convHint);

    const convRow = document.createElement('div');
    convRow.className = 'conv-row';
    const convFactor = document.createElement('input');
    convFactor.type = 'number';
    convFactor.step = '0.01';
    convFactor.min = '0';
    convFactor.placeholder = 'facteur (ex: 120)';
    convFactor.className = 'new-ingr-conv-factor';
    convRow.appendChild(document.createTextNode('1 '));
    const fromLabel = document.createElement('span');
    fromLabel.className = 'conv-from-label';
    fromLabel.textContent = purchaseInput.value || '(achat)';
    convRow.appendChild(fromLabel);
    convRow.appendChild(document.createTextNode(' = '));
    convRow.appendChild(convFactor);
    convRow.appendChild(document.createTextNode(' '));
    const toLabel = document.createElement('span');
    toLabel.className = 'conv-to-label';
    toLabel.textContent = prefInput.value || '(recette)';
    convRow.appendChild(toLabel);
    sub.appendChild(convRow);

    prefInput.addEventListener('input', () => { toLabel.textContent = prefInput.value || '(recette)'; });
    purchaseInput.addEventListener('input', () => { fromLabel.textContent = purchaseInput.value || '(achat)'; });
  };

  nameInput.addEventListener('input', refresh);
  nameInput.addEventListener('blur', refresh);
  refresh();

  return row;
}

function readIngredientRow(row) {
  const name = row.querySelector('.ingr-name-input').value.trim();
  const amount = row.querySelector('.ingr-amount-input').value.trim();
  const unit = row.querySelector('.ingr-unit-input').value.trim();
  const sub = row.querySelector('.new-ingr-sub');
  const out = { name, amount, unit, newSpec: null };
  if (!name) return out;
  if (sub && !sub.hidden) {
    const type = (row.querySelector('.new-ingr-type') || {}).value || '';
    const pref = (row.querySelector('.new-ingr-pref') || {}).value || '';
    const purchase = (row.querySelector('.new-ingr-purchase') || {}).value || '';
    const factor = parseFloat((row.querySelector('.new-ingr-conv-factor') || {}).value || '');
    const spec = { type: type.trim(), preferred: pref.trim(), purchase: purchase.trim() };
    if (isFinite(factor) && factor > 0 && spec.preferred && spec.purchase && spec.preferred !== spec.purchase) {
      spec.convert = { [spec.preferred]: { [spec.purchase]: factor } };
    }
    out.newSpec = spec;
  }
  return out;
}

function onSave(data, slot, nameInput, ingrList, stepsTa, customIngredients) {
  const errEl = document.getElementById('error');
  errEl.hidden = true;
  const fail = (msg) => { errEl.hidden = false; errEl.textContent = msg; };

  const name = nameInput.value.trim();
  if (!name) return fail('Le nom de la recette est obligatoire.');

  const stepsRaw = stepsTa.value.trim();
  if (!stepsRaw) return fail('Au moins une étape de préparation est obligatoire.');
  const steps = stepsRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return fail('Au moins une étape de préparation est obligatoire.');

  const rows = Array.from(ingrList.querySelectorAll('.ingr-row'));
  const parsed = rows.map(readIngredientRow).filter((r) => r.name);
  if (parsed.length === 0) return fail('Ajoute au moins un ingrédient.');

  // Validate new ingredients have type / preferred / purchase.
  for (const r of parsed) {
    if (!r.amount || !isFinite(parseFloat(r.amount))) return fail(`Quantité manquante pour « ${r.name} ».`);
    if (!r.unit) return fail(`Unité manquante pour « ${r.name} ».`);
    if (r.newSpec) {
      if (!r.newSpec.type) return fail(`Catégorie manquante pour le nouvel ingrédient « ${r.name} ».`);
      if (!r.newSpec.preferred) return fail(`Unité recette manquante pour « ${r.name} ».`);
      if (!r.newSpec.purchase) return fail(`Unité d'achat manquante pour « ${r.name} ».`);
    }
  }

  // Persist new ingredients first.
  for (const r of parsed) {
    if (r.newSpec) Store.saveCustomIngredient(r.name, r.newSpec);
  }

  // Build the recipe object.
  const ingredients = {};
  for (const r of parsed) {
    const a = parseFloat(r.amount);
    // Keep the YAML "100g" form when no space (cleaner) ; otherwise use object form.
    ingredients[r.name] = `${a}${r.unit}`;
  }
  const recipe = { ingredients, steps };
  Store.saveCustomRecipe(name, recipe);

  // If launched from a slot, append to that slot's recipes.
  if (slot) {
    // Read current state of that slot to preserve existing recipes (from YAML or prior override).
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
        if (!current.includes(name)) current.push(name);
        Store.setMealOverride(slot, { recipes: current });
        window.location.href = 'index.html';
      })
      .catch(() => { window.location.href = 'index.html'; });
  } else {
    window.location.href = 'index.html';
  }
}

window.Edit = { renderEdit };
