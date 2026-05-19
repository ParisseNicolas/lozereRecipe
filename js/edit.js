// edit.js
// Form for creating/editing a custom recipe.
// URL params : ?slot=Mardi+midi (open from menu picker, will assign the recipe to the slot)
//              ?nom=<existing custom recipe name> (edit mode)
// Quantities are always saved for 1 person, matching the YAML convention.

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return { slot: p.get('slot') || '', nom: p.get('nom') || '' };
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
// Also bridges cc/cs ↔ g (1 cc = 5 g, 1 cs = 15 g), chaining through unitScales for kg/mg.
// Returns null if no chain exists.
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
  // Bridge via grams for spoon units.
  const SPOON_G = { cc: 5, cs: 15 };
  const inGrams = (u) => {
    if (u === 'g') return 1;
    const a = walk('g', u);
    if (a != null) return a;
    const b = walk(u, 'g');
    if (b != null) return 1 / b;
    return null;
  };
  if (SPOON_G[purchase]) {
    const grams = SPOON_G[purchase];
    const prefInG = preferred === 'g' ? 1 : inGrams(preferred);
    if (prefInG != null && prefInG > 0) return grams / prefInG;
  }
  if (SPOON_G[preferred]) {
    const gramsPerSpoon = SPOON_G[preferred];
    const purInG = purchase === 'g' ? 1 : inGrams(purchase);
    if (purInG != null) return purInG / gramsPerSpoon;
  }
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
  const { slot, nom } = getParams();

  const knownIngredients = Object.keys(data.ingredients || {}).sort((a, b) => a.localeCompare(b, 'fr'));
  const knownUnits = collectKnownUnits(data);
  const knownTypes = collectKnownTypes(data);
  const customIngredients = Store.loadCustomIngredients();

  // Datalists.
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
  } else {
    ingrList.appendChild(buildIngredientRow('', '', '', data, customIngredients));
    decoupeWrap.addStep('');
    cuissonWrap.addStep('');
  }
  if (decoupeWrap.count() === 0) decoupeWrap.addStep('');
  if (cuissonWrap.count() === 0) cuissonWrap.addStep('');

  // --- Actions
  const actions = document.createElement('div');
  actions.className = 'edit-actions';

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'preview-btn';
  previewBtn.textContent = '👁 Prévisualiser';
  previewBtn.addEventListener('click', () => onPreview(data, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients));
  actions.appendChild(previewBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSave(data, slot, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients));
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

  const unitSelect = document.createElement('select');
  unitSelect.className = 'ingr-unit-select';

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'ingr-del-btn';
  delBtn.textContent = '×';
  delBtn.title = 'Retirer cet ingrédient';
  delBtn.addEventListener('click', () => row.remove());

  row.appendChild(nameInput);
  row.appendChild(amountInput);
  row.appendChild(unitSelect);
  row.appendChild(delBtn);

  // Sub-block for unknown ingredients : progressive flow preset → preferred → purchase → conversion.
  const sub = document.createElement('div');
  sub.className = 'new-ingr-sub';
  sub.hidden = true;
  row.appendChild(sub);

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
  };

  let subBuiltFor = '';

  const buildSub = (v) => {
    sub.hidden = false;
    sub.innerHTML = '';
    subBuiltFor = v;

    const presets = (data && data.commonConverts) || {};
    const presetNames = Object.keys(presets);
    const allUnits = collectKnownUnits(data);

    const hint = document.createElement('p');
    hint.className = 'edit-hint';
    hint.innerHTML = `Nouvel ingrédient « <strong>${v}</strong> ». Réponds aux questions une à une.`;
    sub.appendChild(hint);

    // --- Step 1 : Preset.
    const presetRow = document.createElement('div');
    presetRow.className = 'conv-row';
    presetRow.appendChild(document.createTextNode('Preset : '));
    const presetSelect = document.createElement('select');
    presetSelect.className = 'new-ingr-preset';
    const choosePresetOpt = document.createElement('option');
    choosePresetOpt.value = '';
    choosePresetOpt.textContent = '— choisir —';
    choosePresetOpt.disabled = true;
    choosePresetOpt.selected = true;
    presetSelect.appendChild(choosePresetOpt);
    const noneOpt = document.createElement('option');
    noneOpt.value = '__none__';
    noneOpt.textContent = '(aucun)';
    presetSelect.appendChild(noneOpt);
    for (const pn of presetNames) {
      const o = document.createElement('option');
      o.value = pn;
      o.textContent = pn;
      presetSelect.appendChild(o);
    }
    presetRow.appendChild(presetSelect);
    sub.appendChild(presetRow);

    const presetHint = document.createElement('p');
    presetHint.className = 'edit-hint';
    presetHint.hidden = true;
    sub.appendChild(presetHint);

    // --- Step 2 : Preferred unit.
    const prefRow = document.createElement('div');
    prefRow.className = 'conv-row';
    prefRow.hidden = true;
    prefRow.appendChild(document.createTextNode('Unité recette : '));
    const prefSelect = document.createElement('select');
    prefSelect.className = 'new-ingr-pref';
    prefRow.appendChild(prefSelect);
    sub.appendChild(prefRow);

    // --- Step 3 : Purchase unit (<select> if preset, free <input> otherwise).
    const purchaseRow = document.createElement('div');
    purchaseRow.className = 'conv-row';
    purchaseRow.hidden = true;
    purchaseRow.appendChild(document.createTextNode("Unité d'achat : "));
    const purchaseSelect = document.createElement('select');
    purchaseSelect.className = 'new-ingr-purchase';
    purchaseRow.appendChild(purchaseSelect);
    const purchaseInput = document.createElement('input');
    purchaseInput.type = 'text';
    purchaseInput.placeholder = 'ex: u, sachet, botte';
    purchaseInput.setAttribute('list', 'dl-units');
    purchaseInput.className = 'new-ingr-purchase';
    purchaseInput.hidden = true;
    purchaseRow.appendChild(purchaseInput);
    sub.appendChild(purchaseRow);

    // --- Step 4 : Conversion (auto hint OR manual factor row).
    const autoHint = document.createElement('p');
    autoHint.className = 'edit-hint';
    autoHint.hidden = true;
    sub.appendChild(autoHint);

    const convRow = document.createElement('div');
    convRow.className = 'conv-row';
    convRow.hidden = true;
    convRow.appendChild(document.createTextNode('1 '));
    const fromLabel = document.createElement('span');
    fromLabel.className = 'conv-from-label';
    fromLabel.textContent = '(achat)';
    convRow.appendChild(fromLabel);
    convRow.appendChild(document.createTextNode(' = '));
    const convFactor = document.createElement('input');
    convFactor.type = 'number';
    convFactor.step = '0.001';
    convFactor.min = '0';
    convFactor.placeholder = 'facteur';
    convFactor.className = 'new-ingr-conv-factor';
    convRow.appendChild(convFactor);
    convRow.appendChild(document.createTextNode(' '));
    const toLabel = document.createElement('span');
    toLabel.className = 'conv-to-label';
    toLabel.textContent = '(recette)';
    convRow.appendChild(toLabel);
    sub.appendChild(convRow);

    // --- Step 5 : Category.
    const typeRow = document.createElement('div');
    typeRow.className = 'conv-row';
    typeRow.hidden = true;
    typeRow.appendChild(document.createTextNode('Catégorie : '));
    const typeInput = document.createElement('input');
    typeInput.type = 'text';
    typeInput.placeholder = 'ex: Fruits et légumes';
    typeInput.setAttribute('list', 'dl-types');
    typeInput.className = 'new-ingr-type';
    typeRow.appendChild(typeInput);
    sub.appendChild(typeRow);

    const formatFactor = (n) => {
      if (!isFinite(n)) return '0';
      return Number(n.toPrecision(4)).toString();
    };
    const formatPreset = (block) => {
      const lines = [];
      for (const [tgt, srcs] of Object.entries(block || {})) {
        for (const [src, f] of Object.entries(srcs || {})) {
          lines.push(`1 ${src} = ${formatFactor(f)} ${tgt}`);
        }
      }
      return lines.join(' · ');
    };
    const presetUnitsOf = (block) => {
      if (!block) return [];
      const s = new Set();
      for (const [tgt, srcs] of Object.entries(block)) {
        s.add(tgt);
        for (const src of Object.keys(srcs || {})) s.add(src);
      }
      return Array.from(s);
    };

    const populateSelect = (sel, units, def) => {
      const prev = sel.value;
      sel.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '— choisir —';
      ph.disabled = true;
      ph.selected = true;
      sel.appendChild(ph);
      for (const u of units) {
        const o = document.createElement('option');
        o.value = u;
        o.textContent = u;
        sel.appendChild(o);
      }
      if (prev && units.includes(prev)) sel.value = prev;
      else if (def && units.includes(def)) sel.value = def;
      else sel.value = '';
    };

    const updateFlow = () => {
      const presetRaw = presetSelect.value;
      const presetChosen = presetRaw !== '';
      const presetName = presetRaw === '__none__' ? '' : presetRaw;
      const presetEntry = presetName ? (presets[presetName] || null) : null;
      const preset = presetEntry ? (presetEntry.convert || presetEntry) : null;
      const presetDesc = presetEntry ? (presetEntry.desc || '') : '';

      // Step 1 not done → hide everything below.
      if (!presetChosen) {
        prefRow.hidden = true;
        purchaseRow.hidden = true;
        autoHint.hidden = true;
        convRow.hidden = true;
        typeRow.hidden = true;
        presetHint.hidden = true;
        setUnits([], unit, false);
        return;
      }

      // Step 2 : recipe-unit select. Preset = locked to preset units, sinon libre.
      if (preset) {
        const units = presetUnitsOf(preset);
        const baseUnit = Object.keys(preset)[0] || '';
        populateSelect(prefSelect, units, baseUnit);
        presetHint.hidden = false;
        const descLine = presetDesc ? `<em>${presetDesc}</em><br>` : '';
        presetHint.innerHTML = `${descLine}Preset <strong>${presetName}</strong> : ${formatPreset(preset)}`;
        purchaseSelect.hidden = false;
        purchaseInput.hidden = true;
        populateSelect(purchaseSelect, units, '');
      } else {
        populateSelect(prefSelect, allUnits, '');
        presetHint.hidden = true;
        purchaseSelect.hidden = true;
        purchaseInput.hidden = false;
      }
      prefRow.hidden = false;

      const pref = prefSelect.value.trim();
      if (!pref) {
        purchaseRow.hidden = true;
        autoHint.hidden = true;
        convRow.hidden = true;
        typeRow.hidden = true;
        setUnits([], unit, false);
        return;
      }
      purchaseRow.hidden = false;

      const purchase = (preset ? purchaseSelect.value : purchaseInput.value).trim();
      fromLabel.textContent = purchase || '(achat)';
      toLabel.textContent = pref || '(recette)';

      if (!purchase) {
        autoHint.hidden = true;
        convRow.hidden = true;
        typeRow.hidden = true;
        setUnits([], unit, false);
        return;
      }

      // Step 4 : conversion.
      let conversionOk = false;
      if (pref === purchase) {
        autoHint.hidden = true;
        convRow.hidden = true;
        conversionOk = true;
      } else if (preset) {
        // Preset = tout figé : facteur dérivé du preset, jamais saisi.
        const derived = factorFromPreset(preset, purchase, pref);
        convRow.hidden = true;
        convFactor.value = '';
        if (derived != null) {
          autoHint.hidden = false;
          autoHint.innerHTML = `Conversion (preset) : <strong>1 ${purchase} = ${formatFactor(derived)} ${pref}</strong>`;
          conversionOk = true;
        } else {
          autoHint.hidden = false;
          autoHint.innerHTML = `<span style="color:#c62828">Pas de conversion dans le preset entre ${purchase} et ${pref}.</span>`;
        }
      } else {
        const derived = deriveConvertFactor(pref, purchase, (data && data.unitScales) || {});
        if (derived != null) {
          autoHint.hidden = false;
          autoHint.innerHTML = `Conversion automatique : <strong>1 ${purchase} = ${formatFactor(derived)} ${pref}</strong>`;
          convRow.hidden = true;
          convFactor.value = '';
          conversionOk = true;
        } else {
          autoHint.hidden = true;
          convRow.hidden = false;
          const f = parseFloat(convFactor.value);
          conversionOk = isFinite(f) && f > 0;
        }
      }

      if (!conversionOk) {
        typeRow.hidden = true;
        setUnits([], unit, false);
        return;
      }
      typeRow.hidden = false;

      // Top unit verrouillée sur l'unité recette.
      setUnits([pref], unit, true);
    };

    presetSelect.addEventListener('change', updateFlow);
    prefSelect.addEventListener('change', updateFlow);
    purchaseSelect.addEventListener('change', updateFlow);
    purchaseInput.addEventListener('input', updateFlow);
    convFactor.addEventListener('input', updateFlow);

    updateFlow();
  };

  const refresh = () => {
    const v = nameInput.value.trim();
    if (!v) {
      sub.hidden = true;
      sub.innerHTML = '';
      subBuiltFor = '';
      setUnits([], unit, false);
      return;
    }
    const spec = findSpec(v, data, customIngredients);
    if (spec) {
      sub.hidden = true;
      sub.innerHTML = '';
      subBuiltFor = '';
      const lockedUnits = spec.preferred ? [spec.preferred] : unitsForSpec(spec);
      setUnits(lockedUnits, unit, true);
      return;
    }
    if (subBuiltFor !== v) buildSub(v);
  };

  nameInput.addEventListener('input', refresh);
  nameInput.addEventListener('blur', refresh);
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

function readIngredientRow(row, data) {
  const unitScales = (data && data.unitScales) || {};
  const presets = (data && data.commonConverts) || {};
  const name = row.querySelector('.ingr-name-input').value.trim();
  const amount = row.querySelector('.ingr-amount-input').value.trim();
  const unit = row.querySelector('.ingr-unit-select').value.trim();
  const sub = row.querySelector('.new-ingr-sub');
  const out = { name, amount, unit, newSpec: null };
  if (!name) return out;
  if (sub && !sub.hidden) {
    const type = (row.querySelector('.new-ingr-type') || {}).value || '';
    const pref = (row.querySelector('.new-ingr-pref') || {}).value || '';
    // Two .new-ingr-purchase elements coexist (select + input) — pick the visible one.
    const purchaseEl = row.querySelector('.new-ingr-purchase:not([hidden])');
    const purchase = (purchaseEl || {}).value || '';
    const factorEl = row.querySelector('.new-ingr-conv-factor');
    const factor = factorEl && !factorEl.closest('.conv-row[hidden]') ? parseFloat(factorEl.value || '') : NaN;
    const presetName = (row.querySelector('.new-ingr-preset') || {}).value || '';
    const spec = { type: type.trim(), preferred: pref.trim(), purchase: purchase.trim() };
    if (presetName && presetName !== '__none__' && presets[presetName]) {
      // Preset = tout figé : deep clone, no manual merge.
      const entry = presets[presetName];
      const block = entry.convert || entry;
      spec.convert = JSON.parse(JSON.stringify(block));
    } else if (isFinite(factor) && factor > 0 && spec.preferred && spec.purchase && spec.preferred !== spec.purchase) {
      spec.convert = { [spec.preferred]: { [spec.purchase]: factor } };
    } else if (spec.preferred && spec.purchase && spec.preferred !== spec.purchase) {
      const derived = deriveConvertFactor(spec.preferred, spec.purchase, unitScales);
      if (derived != null) spec.convert = { [spec.preferred]: { [spec.purchase]: derived } };
    }
    out.newSpec = spec;
  }
  return out;
}

// Build a recipe object from the current form state. Returns { name, recipe, mergedIngredients } or { error }.
function buildRecipeFromForm(data, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients, { requireName = true } = {}) {
  const name = nameInput.value.trim();
  if (requireName && !name) return { error: 'Le nom de la recette est obligatoire.' };

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
  const parsed = rows.map((r) => readIngredientRow(r, data)).filter((r) => r.name);
  if (parsed.length === 0) return { error: 'Ajoute au moins un ingrédient.' };

  for (const r of parsed) {
    if (!r.amount || !isFinite(parseFloat(r.amount))) return { error: `Quantité manquante pour « ${r.name} ».` };
    if (!r.unit) return { error: `Unité manquante pour « ${r.name} ».` };
    if (r.newSpec) {
      if (!r.newSpec.type) return { error: `Catégorie manquante pour le nouvel ingrédient « ${r.name} ».` };
      if (!r.newSpec.preferred) return { error: `Unité recette manquante pour « ${r.name} ».` };
      if (!r.newSpec.purchase) return { error: `Unité d'achat manquante pour « ${r.name} ».` };
    }
  }

  const ingredients = {};
  for (const r of parsed) {
    const a = parseFloat(r.amount);
    ingredients[r.name] = `${a}${r.unit}`;
  }
  const recipe = { ingredients, steps };

  // Merged spec map : YAML + saved customs + pending new specs (for preview).
  const mergedIngredients = Object.assign({}, data.ingredients || {}, customIngredients);
  for (const r of parsed) {
    if (r.newSpec) mergedIngredients[r.name] = r.newSpec;
  }
  return { name, recipe, mergedIngredients, newSpecs: parsed.filter((r) => r.newSpec) };
}

function onPreview(data, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients) {
  const errEl = document.getElementById('error');
  errEl.hidden = true;
  const built = buildRecipeFromForm(data, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients, { requireName: false });
  if (built.error) { errEl.hidden = false; errEl.textContent = built.error; return; }
  openPreviewModal(built.name || '(sans nom)', built.recipe, built.mergedIngredients, data.unitScales || {});
}

function openPreviewModal(name, recipe, ingredientsSpec, unitScales) {
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

  renderRecipePreview(inner, name, recipe, 1, ingredientsSpec, unitScales);
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
  subtitle.textContent = `Prévisualisation — ${portions} portion${portions > 1 ? 's' : ''}`;
  root.appendChild(subtitle);

  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients';
  root.appendChild(h2i);

  const ulIngr = document.createElement('ul');
  ulIngr.className = 'ingredients-list';
  for (const [ingrName, rawValue] of Object.entries(recipe.ingredients || {})) {
    const { amount, unit } = Parser.parseQuantity(rawValue);
    const scaled = amount * portions;
    const spec = ingredientsSpec[ingrName] || {};
    const displayParts = Shopping.aggregateIngredient(ingrName, { [unit]: scaled }, ingredientsSpec);

    const li = document.createElement('li');
    const labelStr = displayParts
      .map((p) => Parser.promoteUnit(p.amount, p.unit, unitScales))
      .map((p) => `${Parser.formatAmount(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
      .join(' + ');

    const purchase = spec.purchase || null;
    const convert = spec.convert || null;
    let equivStr = '';
    if (purchase) {
      const parts = [];
      for (const p of displayParts) {
        if (p.unit === purchase) { parts.push(p); continue; }
        const v = Shopping.convertAmount(p.amount, p.unit, purchase, convert);
        if (v != null && isFinite(v) && v > 0) parts.push({ amount: v, unit: purchase });
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

function onSave(data, slot, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients) {
  const errEl = document.getElementById('error');
  errEl.hidden = true;
  const built = buildRecipeFromForm(data, nameInput, ingrList, decoupeWrap, cuissonWrap, customIngredients, { requireName: true });
  if (built.error) { errEl.hidden = false; errEl.textContent = built.error; return; }

  for (const r of built.newSpecs) {
    Store.saveCustomIngredient(r.name, r.newSpec);
  }
  Store.saveCustomRecipe(built.name, built.recipe);

  if (slot) {
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
        if (!current.includes(built.name)) current.push(built.name);
        Store.setMealOverride(slot, { recipes: current });
        window.location.href = 'index.html';
      })
      .catch(() => { window.location.href = 'index.html'; });
  } else {
    window.location.href = 'index.html';
  }
}

window.Edit = { renderEdit };
