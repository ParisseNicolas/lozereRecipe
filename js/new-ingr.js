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
  function populateSelect(sel, units, def, opts) {
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
    if (opts && opts.addNew) {
      const n = document.createElement('option');
      n.value = '__new__';
      n.textContent = '+ Nouvelle unité';
      sel.appendChild(n);
    }
    if (prev && (units.includes(prev) || prev === '__new__')) sel.value = prev;
    else if (def && units.includes(def)) sel.value = def;
    else sel.value = '';
  }

  // Build the form. Returns { root, read }.
  function buildNewIngredientForm(data, customIngredients, initialName) {
    const root = document.createElement('div');
    root.className = 'new-ingr-form';

    const presets = (data && data.ingredientPresets) || {};
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
    const prefInput = document.createElement('input');
    prefInput.type = 'text';
    prefInput.placeholder = 'ex: pincée, gousse, brin';
    prefInput.className = 'new-ingr-pref-input';
    prefInput.hidden = true;
    prefRow.appendChild(prefInput);
    root.appendChild(prefRow);

    // --- Step 3 : Purchase unit.
    const purchaseRow = document.createElement('div');
    purchaseRow.className = 'conv-row';
    purchaseRow.hidden = true;
    purchaseRow.appendChild(document.createTextNode("Unité d'achat : "));
    const purchaseSelect = document.createElement('select');
    purchaseSelect.className = 'new-ingr-purchase-select';
    purchaseRow.appendChild(purchaseSelect);
    const purchaseInput = document.createElement('input');
    purchaseInput.type = 'text';
    purchaseInput.placeholder = 'ex: u, sachet, botte';
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

    // --- Step 5 : Metric reference (only when no metric path exists yet).
    const metricRow = document.createElement('div');
    metricRow.className = 'conv-row';
    metricRow.hidden = true;
    metricRow.appendChild(document.createTextNode('1 '));
    const metricFromLabel = document.createElement('span');
    metricFromLabel.className = 'metric-from-label';
    metricFromLabel.textContent = '(recette)';
    metricRow.appendChild(metricFromLabel);
    metricRow.appendChild(document.createTextNode(' = '));
    const metricFactor = document.createElement('input');
    metricFactor.type = 'number';
    metricFactor.step = '0.001';
    metricFactor.min = '0';
    metricFactor.placeholder = 'facteur';
    metricFactor.className = 'new-ingr-metric-factor';
    metricRow.appendChild(metricFactor);
    metricRow.appendChild(document.createTextNode(' '));
    const metricSelect = document.createElement('select');
    metricSelect.className = 'new-ingr-metric-select';
    for (const u of ['g', 'mL']) {
      const o = document.createElement('option');
      o.value = u === 'mL' ? 'ml' : u;
      o.textContent = u;
      metricSelect.appendChild(o);
    }
    metricRow.appendChild(metricSelect);
    const metricHint = document.createElement('p');
    metricHint.className = 'edit-hint';
    metricHint.hidden = true;
    metricHint.innerHTML = "Pour afficher un équivalent en masse/volume, indique combien pèse (ou fait) 1 unité recette.";
    root.appendChild(metricHint);
    root.appendChild(metricRow);

    // --- Step 6 : Category.
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

    let lastPopulatedMode = null; // 'none' | preset name
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
        if (lastPopulatedMode !== presetName) {
          populateSelect(prefSelect, units, baseUnit);
          populateSelect(purchaseSelect, units, '');
          lastPopulatedMode = presetName;
        }
        presetHint.hidden = false;
        const descLine = presetDesc ? `<em>${presetDesc}</em><br>` : '';
        presetHint.innerHTML = `${descLine}Preset <strong>${presetName}</strong> : ${formatPreset(preset)}`;
        purchaseSelect.hidden = false;
        purchaseInput.hidden = true;
      } else {
        if (lastPopulatedMode !== 'none') {
          populateSelect(prefSelect, allUnits, '', { addNew: true });
          populateSelect(purchaseSelect, allUnits, '', { addNew: true });
          lastPopulatedMode = 'none';
        }
        if (prefSelect.value !== '__new__') prefInput.hidden = true;
        presetHint.hidden = true;
        purchaseSelect.hidden = false;
        if (purchaseSelect.value !== '__new__') purchaseInput.hidden = true;
      }
      prefRow.hidden = false;

      const pref = (!preset && prefSelect.value === '__new__')
        ? prefInput.value.trim()
        : prefSelect.value.trim();
      if (!pref) {
        purchaseRow.hidden = true;
        autoHint.hidden = true;
        convRow.hidden = true;
        typeRow.hidden = true;
        return;
      }
      purchaseRow.hidden = false;

      const purchase = (!preset && purchaseSelect.value === '__new__')
        ? purchaseInput.value.trim()
        : purchaseSelect.value.trim();
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
        metricRow.hidden = true;
        metricHint.hidden = true;
        return;
      }

      // Metric reference step : only required when neither pref/purchase nor
      // any unit reachable through the preset is an equiv unit (metric or piece).
      const presetMetric = preset && presetUnitsOf(preset).some((u) => Parser.isEquivUnit(u));
      const needMetric = !Parser.isEquivUnit(pref) && !Parser.isEquivUnit(purchase) && !presetMetric;
      if (needMetric) {
        metricRow.hidden = false;
        metricHint.hidden = false;
        metricFromLabel.textContent = pref;
        const f = parseFloat(metricFactor.value);
        const metricOk = isFinite(f) && f > 0;
        if (!metricOk) {
          typeRow.hidden = true;
          return;
        }
      } else {
        metricRow.hidden = true;
        metricHint.hidden = true;
      }
      typeRow.hidden = false;
    }

    presetSelect.addEventListener('change', updateFlow);
    prefSelect.addEventListener('change', () => {
      if (prefSelect.value === '__new__') {
        prefInput.hidden = false;
        prefInput.value = '';
        prefInput.focus();
      } else {
        prefInput.hidden = true;
      }
      updateFlow();
    });
    prefInput.addEventListener('input', updateFlow);
    purchaseSelect.addEventListener('change', () => {
      if (purchaseSelect.value === '__new__') {
        purchaseInput.hidden = false;
        purchaseInput.value = '';
        purchaseInput.focus();
      } else {
        purchaseInput.hidden = true;
      }
      updateFlow();
    });
    purchaseInput.addEventListener('input', updateFlow);
    convFactor.addEventListener('input', updateFlow);
    metricFactor.addEventListener('input', updateFlow);
    metricSelect.addEventListener('change', updateFlow);

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

      const pref = (!preset && prefSelect.value === '__new__')
        ? prefInput.value.trim()
        : prefSelect.value.trim();
      if (!pref) return { error: 'Choisis une unité recette.' };
      const purchase = (!preset && purchaseSelect.value === '__new__')
        ? purchaseInput.value.trim()
        : purchaseSelect.value.trim();
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

      // Metric reference : if neither pref/purchase nor any preset unit is an
      // equiv unit, require a factor toward g or mL so `.ingr-qty-equiv` works.
      const presetMetric = preset && presetUnitsOf(preset).some((u) => Parser.isEquivUnit(u));
      const needMetric = !Parser.isEquivUnit(pref) && !Parser.isEquivUnit(purchase) && !presetMetric;
      if (needMetric) {
        const mf = parseFloat(metricFactor.value);
        if (!isFinite(mf) || mf <= 0) return { error: 'Saisis un facteur vers g ou mL.' };
        const metricUnit = metricSelect.value;
        spec.convert = spec.convert || {};
        spec.convert[metricUnit] = spec.convert[metricUnit] || {};
        spec.convert[metricUnit][pref] = mf;
      }

      return { name, spec };
    }

    return { root, read, focusName: () => nameInput.focus() };
  }

  // Pre-fill the form with AI-supplied fields. Goes through the "no preset"
  // path, dispatching change events so updateFlow() recomputes visibility.
  function applyPrefill(modal, prefill) {
    if (!prefill) return;
    const presetSelect = modal.querySelector('.new-ingr-preset');
    const prefSelect = modal.querySelector('.new-ingr-pref');
    const prefInput = modal.querySelector('.new-ingr-pref-input');
    const purchaseSelect = modal.querySelector('.new-ingr-purchase-select');
    const purchaseInput = modal.querySelector('.new-ingr-purchase');
    const convFactor = modal.querySelector('.new-ingr-conv-factor');
    const metricFactor = modal.querySelector('.new-ingr-metric-factor');
    const metricSelect = modal.querySelector('.new-ingr-metric-select');
    const typeSelect = modal.querySelector('.new-ingr-type-select');
    const typeInput = modal.querySelector('.new-ingr-type');

    presetSelect.value = '__none__';
    presetSelect.dispatchEvent(new Event('change'));

    const hasOption = (sel, val) => Array.from(sel.options).some((o) => o.value === val);
    // Insert a unit option into a select if missing, before any sentinel option (__new__).
    const ensureOption = (sel, val) => {
      if (!val || hasOption(sel, val)) return;
      const o = document.createElement('option');
      o.value = val;
      o.textContent = val;
      const sentinel = Array.from(sel.options).find((opt) => opt.value === '__new__');
      if (sentinel) sel.insertBefore(o, sentinel);
      else sel.appendChild(o);
    };

    if (prefill.preferred) {
      ensureOption(prefSelect, prefill.preferred);
      if (hasOption(prefSelect, prefill.preferred)) {
        prefSelect.value = prefill.preferred;
        prefSelect.dispatchEvent(new Event('change'));
      } else if (hasOption(prefSelect, '__new__')) {
        prefSelect.value = '__new__';
        prefSelect.dispatchEvent(new Event('change'));
        prefInput.value = prefill.preferred;
        prefInput.dispatchEvent(new Event('input'));
      }
    }

    if (prefill.purchase) {
      ensureOption(purchaseSelect, prefill.purchase);
      if (hasOption(purchaseSelect, prefill.purchase)) {
        purchaseSelect.value = prefill.purchase;
        purchaseSelect.dispatchEvent(new Event('change'));
      } else if (hasOption(purchaseSelect, '__new__')) {
        purchaseSelect.value = '__new__';
        purchaseSelect.dispatchEvent(new Event('change'));
        purchaseInput.value = prefill.purchase;
        purchaseInput.dispatchEvent(new Event('input'));
      }
    }

    if (prefill.convertFactor != null && isFinite(Number(prefill.convertFactor))) {
      convFactor.value = String(prefill.convertFactor);
      convFactor.dispatchEvent(new Event('input'));
    } else if (
      prefill.metricFactor != null && isFinite(Number(prefill.metricFactor)) && Number(prefill.metricFactor) > 0
      && prefill.metricUnit && prefill.purchase
      && Parser.isMetricUnit(prefill.metricUnit) && Parser.isMetricUnit(prefill.purchase)
    ) {
      // AI gave metricFactor but purchase is already metric → derive convertFactor.
      // Orientation: 1 purchase = X preferred. 1 preferred = metricFactor [metricUnit].
      const SCALE = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, L: 1000 };
      const sP = SCALE[prefill.purchase];
      const sM = SCALE[prefill.metricUnit];
      // Same family (mass↔mass, volume↔volume): mg/g/kg are <=1000, ml/cl/L are 1..1000.
      const massSet = new Set(['mg', 'g', 'kg']);
      const volSet = new Set(['ml', 'cl', 'L']);
      const sameFamily = (massSet.has(prefill.purchase) && massSet.has(prefill.metricUnit))
        || (volSet.has(prefill.purchase) && volSet.has(prefill.metricUnit));
      if (sameFamily && sP && sM) {
        const derived = sP / (sM * Number(prefill.metricFactor));
        convFactor.value = String(Math.round(derived * 1000) / 1000);
        convFactor.dispatchEvent(new Event('input'));
      }
    }

    if (prefill.metricUnit && hasOption(metricSelect, prefill.metricUnit)) {
      metricSelect.value = prefill.metricUnit;
      metricSelect.dispatchEvent(new Event('change'));
    }
    if (prefill.metricFactor != null && isFinite(Number(prefill.metricFactor))) {
      metricFactor.value = String(prefill.metricFactor);
      metricFactor.dispatchEvent(new Event('input'));
    }

    if (prefill.type) {
      if (hasOption(typeSelect, prefill.type)) {
        typeSelect.value = prefill.type;
        typeSelect.dispatchEvent(new Event('change'));
      } else {
        typeSelect.value = '__new__';
        typeSelect.dispatchEvent(new Event('change'));
        typeInput.value = prefill.type;
      }
    }
  }

  function openNewIngredientModal(opts) {
    const { data, customIngredients, initialName, prefill, onSave, onCancel } = opts || {};

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

    if (prefill) applyPrefill(modal, prefill);

    setTimeout(() => form.focusName(), 50);
  }

  window.openNewIngredientModal = openNewIngredientModal;
})();
