// Modal flow for creating a new ingredient.
// Exposes window.openNewIngredientModal({ data, customIngredients, initialName, onSave }).
// Relies on helpers exposed by edit.js (collectKnownTypes, collectKnownUnits,
// deriveConvertFactor, factorFromPreset).

(function () {
  function formatFactor(n) {
    if (!isFinite(n)) return '0';
    return Number(n.toPrecision(4)).toString();
  }
  function formatPreset(block) {
    const lines = [];
    for (const [tgt, srcs] of Object.entries(block || {})) {
      for (const [src, f] of Object.entries(srcs || {})) {
        lines.push(`1 ${src} = ${formatFactor(f)} ${tgt}`);
      }
    }
    return lines.join(' · ');
  }
  function presetUnitsOf(block) {
    if (!block) return [];
    const s = new Set();
    for (const [tgt, srcs] of Object.entries(block)) {
      s.add(tgt);
      for (const src of Object.keys(srcs || {})) s.add(src);
    }
    return Array.from(s);
  }
  function populateSelect(sel, units, def) {
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
  }

  // Build the form. Returns { root, read }.
  function buildNewIngredientForm(data, customIngredients, initialName) {
    const root = document.createElement('div');
    root.className = 'new-ingr-form';

    const presets = (data && data.commonConverts) || {};
    const presetNames = Object.keys(presets);
    const allUnits = collectKnownUnits(data);

    // --- Name input.
    const nameRow = document.createElement('div');
    nameRow.className = 'conv-row';
    nameRow.appendChild(document.createTextNode('Nom : '));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'ex: Carotte';
    nameInput.className = 'new-ingr-name';
    nameInput.value = initialName || '';
    nameRow.appendChild(nameInput);
    root.appendChild(nameRow);

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
    root.appendChild(presetRow);

    const presetHint = document.createElement('p');
    presetHint.className = 'edit-hint';
    presetHint.hidden = true;
    root.appendChild(presetHint);

    // --- Step 2 : Preferred unit.
    const prefRow = document.createElement('div');
    prefRow.className = 'conv-row';
    prefRow.hidden = true;
    prefRow.appendChild(document.createTextNode('Unité recette : '));
    const prefSelect = document.createElement('select');
    prefSelect.className = 'new-ingr-pref';
    prefRow.appendChild(prefSelect);
    root.appendChild(prefRow);

    // --- Step 3 : Purchase unit.
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
    root.appendChild(purchaseRow);

    // --- Step 4 : Conversion.
    const autoHint = document.createElement('p');
    autoHint.className = 'edit-hint';
    autoHint.hidden = true;
    root.appendChild(autoHint);

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
    root.appendChild(convRow);

    // --- Step 5 : Category.
    const typeRow = document.createElement('div');
    typeRow.className = 'conv-row';
    typeRow.hidden = true;
    typeRow.appendChild(document.createTextNode('Catégorie : '));
    const typeSelect = document.createElement('select');
    typeSelect.className = 'new-ingr-type-select';
    const typePh = document.createElement('option');
    typePh.value = '';
    typePh.textContent = '— choisir —';
    typePh.disabled = true;
    typePh.selected = true;
    typeSelect.appendChild(typePh);
    for (const t of collectKnownTypes(data)) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      typeSelect.appendChild(o);
    }
    const typeNewOpt = document.createElement('option');
    typeNewOpt.value = '__new__';
    typeNewOpt.textContent = '+ Nouvelle catégorie';
    typeSelect.appendChild(typeNewOpt);
    typeRow.appendChild(typeSelect);
    const typeInput = document.createElement('input');
    typeInput.type = 'text';
    typeInput.placeholder = 'ex: Fruits et légumes';
    typeInput.className = 'new-ingr-type';
    typeInput.hidden = true;
    typeRow.appendChild(typeInput);
    typeSelect.addEventListener('change', () => {
      const v = typeSelect.value;
      if (v === '__new__') {
        typeInput.hidden = false;
        typeInput.value = '';
        typeInput.focus();
      } else if (v) {
        typeInput.hidden = true;
        typeInput.value = v;
      }
    });
    root.appendChild(typeRow);

    function updateFlow() {
      const presetRaw = presetSelect.value;
      const presetChosen = presetRaw !== '';
      const presetName = presetRaw === '__none__' ? '' : presetRaw;
      const presetEntry = presetName ? (presets[presetName] || null) : null;
      const preset = presetEntry ? (presetEntry.convert || presetEntry) : null;
      const presetDesc = presetEntry ? (presetEntry.desc || '') : '';

      if (!presetChosen) {
        prefRow.hidden = true;
        purchaseRow.hidden = true;
        autoHint.hidden = true;
        convRow.hidden = true;
        typeRow.hidden = true;
        presetHint.hidden = true;
        return;
      }

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
        return;
      }

      let conversionOk = false;
      if (pref === purchase) {
        autoHint.hidden = true;
        convRow.hidden = true;
        conversionOk = true;
      } else if (preset) {
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
        return;
      }
      typeRow.hidden = false;
    }

    presetSelect.addEventListener('change', updateFlow);
    prefSelect.addEventListener('change', updateFlow);
    purchaseSelect.addEventListener('change', updateFlow);
    purchaseInput.addEventListener('input', updateFlow);
    convFactor.addEventListener('input', updateFlow);

    updateFlow();

    function read() {
      const name = nameInput.value.trim();
      if (!name) return { error: 'Le nom est obligatoire.' };
      if (customIngredients && customIngredients[name]) {
        return { error: `« ${name} » existe déjà dans tes ingrédients.` };
      }
      if (data && data.ingredients && data.ingredients[name]) {
        return { error: `« ${name} » existe déjà.` };
      }

      const presetRaw = presetSelect.value;
      if (!presetRaw) return { error: 'Choisis un preset (ou « aucun »).' };
      const presetName = presetRaw === '__none__' ? '' : presetRaw;
      const presetEntry = presetName ? (presets[presetName] || null) : null;
      const preset = presetEntry ? (presetEntry.convert || presetEntry) : null;

      const pref = prefSelect.value.trim();
      if (!pref) return { error: 'Choisis une unité recette.' };
      const purchase = (preset ? purchaseSelect.value : purchaseInput.value).trim();
      if (!purchase) return { error: "Choisis une unité d'achat." };

      const spec = { preferred: pref, purchase: purchase };

      if (pref !== purchase) {
        if (preset) {
          const block = preset;
          if (factorFromPreset(block, purchase, pref) == null) {
            return { error: `Le preset ne connaît pas la conversion ${purchase} → ${pref}.` };
          }
          spec.convert = JSON.parse(JSON.stringify(block));
        } else {
          const derived = deriveConvertFactor(pref, purchase, (data && data.unitScales) || {});
          if (derived != null) {
            spec.convert = { [pref]: { [purchase]: derived } };
          } else {
            const f = parseFloat(convFactor.value);
            if (!isFinite(f) || f <= 0) return { error: 'Saisis le facteur de conversion.' };
            spec.convert = { [pref]: { [purchase]: f } };
          }
        }
      }

      const type = typeInput.value.trim();
      if (!type) return { error: 'Choisis une catégorie.' };
      spec.type = type;

      return { name, spec };
    }

    return { root, read, focusName: () => nameInput.focus() };
  }

  function openNewIngredientModal(opts) {
    const { data, customIngredients, initialName, onSave, onCancel } = opts || {};

    // Clean any stale instance.
    document.querySelectorAll('.new-ingr-backdrop, .new-ingr-modal').forEach((n) => n.remove());

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop new-ingr-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal new-ingr-modal';

    const h = document.createElement('h2');
    h.textContent = 'Nouvel ingrédient';
    h.className = 'new-ingr-title';
    modal.appendChild(h);

    const errEl = document.createElement('p');
    errEl.className = 'new-ingr-error';
    errEl.hidden = true;
    modal.appendChild(errEl);

    const form = buildNewIngredientForm(data, customIngredients, initialName);
    modal.appendChild(form.root);

    const actions = document.createElement('div');
    actions.className = 'new-ingr-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Annuler';
    cancelBtn.className = 'btn-secondary';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Enregistrer';
    saveBtn.className = 'btn-primary';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    modal.appendChild(actions);

    function close() {
      backdrop.remove();
      modal.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); if (onCancel) onCancel(); }
    }

    backdrop.addEventListener('click', () => { close(); if (onCancel) onCancel(); });
    cancelBtn.addEventListener('click', () => { close(); if (onCancel) onCancel(); });
    saveBtn.addEventListener('click', () => {
      const res = form.read();
      if (res.error) {
        errEl.hidden = false;
        errEl.textContent = res.error;
        return;
      }
      close();
      if (onSave) onSave({ name: res.name, spec: res.spec });
    });

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    document.addEventListener('keydown', onKey);

    setTimeout(() => form.focusName(), 50);
  }

  window.openNewIngredientModal = openNewIngredientModal;
})();
