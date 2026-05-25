// yaml-merge.js
// Merge an incoming shared dataset (from YamlShare) with the user's local
// state via a 4-phase interactive flow :
//   1. Ingredient conflicts        — user picks keep/take per ingredient.
//   2. Recipe-line fixups          — for every ingredient whose chosen version
//                                    introduces unit incompatibilities, walk
//                                    the recipes (local + incoming) that
//                                    reference it with an obsolete unit and
//                                    ask for a new quantity expressed in a
//                                    supported unit.
//   3. Recipe conflicts            — remaining recipe-level disagreements.
//   4. Meal conflicts              — meal-slot recipe lists.
//
// Persistence (after all phases) :
//   - recipes      → Store.saveCustomRecipe
//   - ingredients  → Store.saveCustomIngredient
//   - meals        → Store.setMealOverride(name, { recipes })
//
// We intentionally do NOT touch localStorage.importedYamlData : we only enrich
// the "custom*" / "mealOverrides" layers which app.js merges at runtime.

(function () {
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function parseQty(value) {
    if (window.Parser && Parser.parseQuantity) return Parser.parseQuantity(value);
    return { amount: 0, unit: 'u' };
  }

  function collectIngredientUnits(ing) {
    const out = new Set();
    if (!isPlainObject(ing)) return out;
    if (ing.preferred) out.add(String(ing.preferred));
    if (ing.purchase) out.add(String(ing.purchase));
    if (isPlainObject(ing.convert)) {
      for (const [base, sub] of Object.entries(ing.convert)) {
        out.add(base);
        if (isPlainObject(sub)) Object.keys(sub).forEach((u) => out.add(u));
      }
    }
    return out;
  }

  function isUnitCompatible(qty, ingSpec, knownGlobalUnits) {
    const parsed = parseQty(qty);
    const unit = parsed && parsed.unit;
    if (!unit || unit === 'u') return true;
    const ingUnits = collectIngredientUnits(ingSpec);
    return ingUnits.has(unit) || knownGlobalUnits.has(unit);
  }

  function summarizeRecipe(name, recipe) {
    const lines = [];
    const ings = (recipe && recipe.ingredients) || {};
    const names = Object.keys(ings);
    if (names.length === 0) lines.push('(aucun ingrédient)');
    for (const n of names) lines.push(`• ${n} — ${ings[n]}`);
    const steps = (recipe && recipe.steps) || [];
    if (steps.length > 0) {
      lines.push('');
      steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    }
    return lines.join('\n');
  }

  function summarizeIngredient(name, spec) {
    if (spec && typeof spec === 'object') {
      return Object.entries(spec).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
    }
    return String(spec);
  }

  function summarizeMeal(name, meal) {
    const rs = (meal && meal.recipes) || [];
    return rs.length ? rs.map((r) => `• ${r}`).join('\n') : '(vide / restes)';
  }

  function summarize(kind, key, value) {
    if (kind === 'recipe') return summarizeRecipe(key, value);
    if (kind === 'ingredient') return summarizeIngredient(key, value);
    if (kind === 'meal') return summarizeMeal(key, value);
    return JSON.stringify(value, null, 2);
  }

  function askConflict(conflict, index, total) {
    return new Promise((resolve) => {
      document.querySelectorAll('.yaml-merge-backdrop, .yaml-merge-modal').forEach((n) => n.remove());

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop yaml-merge-backdrop';

      const modal = document.createElement('div');
      modal.className = 'modal yaml-merge-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const h = document.createElement('h3');
      const kindFr = conflict.kind === 'recipe' ? 'Recette' : conflict.kind === 'ingredient' ? 'Ingrédient' : 'Repas';
      h.textContent = `Conflit ${index + 1}/${total} — ${kindFr} : ${conflict.key}`;
      modal.appendChild(h);

      const cols = document.createElement('div');
      cols.className = 'yaml-merge-cols';

      const local = document.createElement('div');
      local.className = 'yaml-merge-col';
      const localTitle = document.createElement('h4');
      localTitle.textContent = 'Version locale';
      local.appendChild(localTitle);
      const localPre = document.createElement('pre');
      localPre.textContent = summarize(conflict.kind, conflict.key, conflict.local);
      local.appendChild(localPre);

      const incoming = document.createElement('div');
      incoming.className = 'yaml-merge-col';
      const incomingTitle = document.createElement('h4');
      incomingTitle.textContent = 'Version reçue';
      incoming.appendChild(incomingTitle);
      const incomingPre = document.createElement('pre');
      incomingPre.textContent = summarize(conflict.kind, conflict.key, conflict.incoming);
      incoming.appendChild(incomingPre);

      cols.appendChild(local);
      cols.appendChild(incoming);
      modal.appendChild(cols);

      const actions = document.createElement('div');
      actions.className = 'similar-recipe-actions';

      const abortBtn = document.createElement('button');
      abortBtn.type = 'button';
      abortBtn.className = 'btn-secondary';
      abortBtn.textContent = 'Annuler le merge';

      const keepBtn = document.createElement('button');
      keepBtn.type = 'button';
      keepBtn.className = 'btn-secondary';
      keepBtn.textContent = 'Garder le local';

      const takeBtn = document.createElement('button');
      takeBtn.type = 'button';
      takeBtn.className = 'btn-primary';
      takeBtn.textContent = "Prendre l'entrant";

      actions.appendChild(abortBtn);
      actions.appendChild(keepBtn);
      actions.appendChild(takeBtn);
      modal.appendChild(actions);

      function close(result) {
        modal.remove();
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') close('abort'); }
      document.addEventListener('keydown', onKey);

      abortBtn.addEventListener('click', () => close('abort'));
      keepBtn.addEventListener('click', () => close('keep'));
      takeBtn.addEventListener('click', () => close('take'));

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
    });
  }

  // Modal asking the user to update a single (recipe, ingredient) line that
  // became unit-incompatible after an ingredient was reconciled.
  // Returns 'abort' | 'skip' | <new quantity string>.
  function askLineFix({ recipeName, ingredientName, oldQty, ingSpec, sourceLabel, knownGlobalUnits, index, total }) {
    return new Promise((resolve) => {
      document.querySelectorAll('.yaml-merge-backdrop, .yaml-merge-modal').forEach((n) => n.remove());

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop yaml-merge-backdrop';
      const modal = document.createElement('div');
      modal.className = 'modal yaml-merge-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const h = document.createElement('h3');
      h.textContent = `Mise à jour ${index + 1}/${total} — ${ingredientName} dans « ${recipeName} »`;
      modal.appendChild(h);

      const intro = document.createElement('p');
      const parsed = parseQty(oldQty);
      intro.textContent = `L'ingrédient « ${ingredientName} » a été réconcilié. La ${sourceLabel} contient « ${oldQty} » (unité « ${parsed.unit} ») qui n'est plus convertible. Choisis une nouvelle quantité.`;
      modal.appendChild(intro);

      const form = document.createElement('div');
      form.className = 'yaml-merge-linefix';

      const amount = document.createElement('input');
      amount.type = 'number';
      amount.step = 'any';
      amount.min = '0';
      amount.value = parsed.amount != null ? String(parsed.amount) : '';
      amount.className = 'yaml-merge-linefix-amount';

      const select = document.createElement('select');
      select.className = 'yaml-merge-linefix-unit';
      const units = new Set([...collectIngredientUnits(ingSpec)]);
      for (const u of knownGlobalUnits) units.add(u);
      if (units.size === 0) units.add('u');
      for (const u of units) {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        select.appendChild(opt);
      }

      form.appendChild(amount);
      form.appendChild(select);
      modal.appendChild(form);

      const actions = document.createElement('div');
      actions.className = 'similar-recipe-actions';

      const abortBtn = document.createElement('button');
      abortBtn.type = 'button';
      abortBtn.className = 'btn-secondary';
      abortBtn.textContent = 'Annuler le merge';

      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'btn-secondary';
      skipBtn.textContent = 'Garder tel quel';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn-primary';
      okBtn.textContent = 'Mettre à jour';

      actions.appendChild(abortBtn);
      actions.appendChild(skipBtn);
      actions.appendChild(okBtn);
      modal.appendChild(actions);

      function close(result) {
        modal.remove();
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') close('abort'); }
      document.addEventListener('keydown', onKey);

      abortBtn.addEventListener('click', () => close('abort'));
      skipBtn.addEventListener('click', () => close('skip'));
      okBtn.addEventListener('click', () => {
        const a = (amount.value || '').trim();
        if (!a) { amount.focus(); return; }
        close(`${a}${select.value}`);
      });

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
      amount.focus();
    });
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'yaml-merge-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  function findKeyCI(obj, name) {
    if (window.App && App.findKeyCI) return App.findKeyCI(obj, name);
    if (!obj) return null;
    if (name in obj) return name;
    const lc = String(name).toLowerCase();
    for (const k of Object.keys(obj)) if (k.toLowerCase() === lc) return k;
    return null;
  }

  async function start(incoming) {
    if (!incoming) return;
    let local;
    try {
      local = await App.loadData();
    } catch (e) {
      alert('Impossible de charger les données locales : ' + e.message);
      return;
    }

    // Working (mutable) copies of recipes/ingredients on both sides.
    const localRecipes = clone(local.recipes || {});
    const incRecipes = clone(incoming.recipes || {});
    const localIng = clone(local.ingredients || {});
    const incIng = clone(incoming.ingredients || {});
    const baseLocalRecipes = clone(local.recipes || {}); // for diff check at apply time

    // Truly global units only : 'u' (unitless count) + keys declared in unitScales
    // (which provide bidirectional conversions independent of the ingredient).
    // Units like 'gousse', 'feuille', 'cs', 'cc', 'petit peu' are ingredient-specific
    // and must NOT be considered globally compatible — otherwise Phase 2 would miss
    // real incompatibilities when an ingredient is reconciled to a spec that drops them.
    const knownGlobalUnits = new Set(Object.keys((local && local.unitScales) || {}));
    knownGlobalUnits.add('u');

    const autoAddRecipes = {};
    const autoAddIngredients = {};
    let added = 0;
    let skipped = 0;

    // ---------- Phase 1 : ingredient conflicts ----------
    const ingConflicts = [];
    for (const [name, spec] of Object.entries(incIng)) {
      const lk = findKeyCI(localIng, name);
      if (lk == null) { autoAddIngredients[name] = spec; added++; }
      else if (deepEqual(localIng[lk], spec)) { skipped++; }
      else ingConflicts.push({ kind: 'ingredient', key: lk, incomingKey: name, local: localIng[lk], incoming: spec });
    }

    const ingDecisions = {}; // localKey -> 'keep' | 'take'
    for (let i = 0; i < ingConflicts.length; i++) {
      const choice = await askConflict(ingConflicts[i], i, ingConflicts.length);
      if (choice === 'abort') { toast('Merge annulé. Aucune modification.'); return; }
      ingDecisions[ingConflicts[i].key] = choice;
    }

    // Effective ingredient definition by name (working copy that recipes will be checked against).
    const effIngredients = Object.assign({}, localIng);
    for (const [n, s] of Object.entries(autoAddIngredients)) effIngredients[n] = s;
    for (const c of ingConflicts) {
      if (ingDecisions[c.key] === 'take') effIngredients[c.key] = c.incoming;
    }

    // ---------- Phase 2 : recipe-line fixups ----------
    // For each reconciled ingredient, find every recipe (local + incoming)
    // that uses it with an incompatible unit and let the user enter a new
    // quantity. Apply edits in-place on the working copies.
    const fixupTargets = [];
    for (const c of ingConflicts) {
      const ingName = c.key;
      const effSpec = effIngredients[ingName];
      // Scan local recipes
      for (const [rname, recipe] of Object.entries(localRecipes)) {
        if (!isPlainObject(recipe) || !isPlainObject(recipe.ingredients)) continue;
        const ingKey = findKeyCI(recipe.ingredients, ingName);
        if (ingKey == null) continue;
        if (isUnitCompatible(recipe.ingredients[ingKey], effSpec, knownGlobalUnits)) continue;
        fixupTargets.push({ side: 'local', recipeName: rname, ingredientName: ingName, ingKey, effSpec });
      }
      // Scan incoming recipes
      for (const [rname, recipe] of Object.entries(incRecipes)) {
        if (!isPlainObject(recipe) || !isPlainObject(recipe.ingredients)) continue;
        const ingKey = findKeyCI(recipe.ingredients, ingName);
        if (ingKey == null) continue;
        if (isUnitCompatible(recipe.ingredients[ingKey], effSpec, knownGlobalUnits)) continue;
        fixupTargets.push({ side: 'incoming', recipeName: rname, ingredientName: ingName, ingKey, effSpec });
      }
    }
    for (let i = 0; i < fixupTargets.length; i++) {
      const t = fixupTargets[i];
      const sideRecipes = t.side === 'local' ? localRecipes : incRecipes;
      const recipe = sideRecipes[t.recipeName];
      const oldQty = recipe.ingredients[t.ingKey];
      const result = await askLineFix({
        recipeName: t.recipeName,
        ingredientName: t.ingredientName,
        oldQty,
        ingSpec: t.effSpec,
        sourceLabel: t.side === 'local' ? 'recette locale' : 'recette reçue',
        knownGlobalUnits,
        index: i,
        total: fixupTargets.length,
      });
      if (result === 'abort') { toast('Merge annulé. Aucune modification.'); return; }
      if (result === 'skip') continue;
      recipe.ingredients[t.ingKey] = result;
    }

    // ---------- Phase 3 : recipe conflicts (recomputed after fixups) ----------
    const recipeConflicts = [];
    for (const [name, r] of Object.entries(incRecipes)) {
      const lk = findKeyCI(localRecipes, name);
      if (lk == null) { autoAddRecipes[name] = r; added++; }
      else if (deepEqual(localRecipes[lk], r)) { skipped++; }
      else recipeConflicts.push({ kind: 'recipe', key: lk, incomingKey: name, local: localRecipes[lk], incoming: r });
    }
    const recipeDecisions = {};
    for (let i = 0; i < recipeConflicts.length; i++) {
      const choice = await askConflict(recipeConflicts[i], i, recipeConflicts.length);
      if (choice === 'abort') { toast('Merge annulé. Aucune modification.'); return; }
      recipeDecisions[recipeConflicts[i].key] = choice;
    }

    // ---------- Phase 4 : meal conflicts ----------
    const localMealsByName = {};
    for (const m of (local.meals || [])) localMealsByName[m.name] = m;
    const mealConflicts = [];
    for (const m of (incoming.meals || [])) {
      const lmKey = findKeyCI(localMealsByName, m.name);
      if (lmKey == null) continue; // unknown slot — skip
      const lm = localMealsByName[lmKey];
      const lRecipes = lm.recipes || [];
      const iRecipes = m.recipes || [];
      if (deepEqual(lRecipes, iRecipes)) { skipped++; }
      else mealConflicts.push({ kind: 'meal', key: lmKey, incomingKey: m.name, local: { recipes: lRecipes }, incoming: { recipes: iRecipes } });
    }
    const mealDecisions = {};
    for (let i = 0; i < mealConflicts.length; i++) {
      const choice = await askConflict(mealConflicts[i], i, mealConflicts.length);
      if (choice === 'abort') { toast('Merge annulé. Aucune modification.'); return; }
      mealDecisions[mealConflicts[i].key] = choice;
    }

    // ---------- Apply ----------
    let replaced = 0;
    let kept = 0;

    // Ingredients : auto-adds + 'take' decisions.
    for (const [name, s] of Object.entries(autoAddIngredients)) Store.saveCustomIngredient(name, s);
    for (const c of ingConflicts) {
      if (ingDecisions[c.key] === 'take') { Store.saveCustomIngredient(c.key, c.incoming); replaced++; }
      else kept++;
    }

    // Recipes : auto-adds (possibly fixed up), then conflicts, then local-only recipes whose lines were edited in Phase 2.
    for (const [name, r] of Object.entries(autoAddRecipes)) Store.saveCustomRecipe(name, r);
    const handledRecipeKeys = new Set();
    for (const c of recipeConflicts) {
      handledRecipeKeys.add(c.key);
      if (recipeDecisions[c.key] === 'take') {
        // Use the working copy of the incoming recipe (carries Phase 2 fixups).
        Store.saveCustomRecipe(c.key, incRecipes[c.incomingKey]);
        replaced++;
      } else {
        // Keep local — but persist if Phase 2 touched it.
        if (!deepEqual(baseLocalRecipes[c.key], localRecipes[c.key])) {
          Store.saveCustomRecipe(c.key, localRecipes[c.key]);
        }
        kept++;
      }
    }
    // Local recipes not in conflict but mutated by Phase 2 → save.
    for (const [name, r] of Object.entries(localRecipes)) {
      if (handledRecipeKeys.has(name)) continue;
      if (name in autoAddRecipes) continue;
      if (!(name in baseLocalRecipes)) continue;
      if (!deepEqual(baseLocalRecipes[name], r)) Store.saveCustomRecipe(name, r);
    }

    // Meals.
    for (const c of mealConflicts) {
      if (mealDecisions[c.key] === 'take') {
        Store.setMealOverride(c.key, { recipes: (c.incoming && c.incoming.recipes) || [] });
        replaced++;
      } else kept++;
    }

    toast(`Merge terminé : ${added} ajouts, ${replaced} remplacements, ${kept + skipped} conservés.`);
    setTimeout(() => window.location.reload(), 1200);
  }

  window.YamlMerge = { start };
})();
