// app.js
// Load the YAML file and expose helpers shared by all pages.

const YAML_URL = 'repas.yml';

// Case-insensitive helpers. All user-facing string matching (recipe names,
// ingredient names, meal slots, units) should go through these to avoid
// "Carotte" vs "carotte" duplicates and lookup misses.
function eqCI(a, b) {
  return String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
}
function findKeyCI(obj, key) {
  if (!obj || key == null) return null;
  const target = String(key).toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return k;
  }
  return null;
}
function hasKeyCI(obj, key) {
  return findKeyCI(obj, key) != null;
}
function getCI(obj, key) {
  const k = findKeyCI(obj, key);
  return k == null ? undefined : obj[k];
}
function includesCI(arr, value) {
  if (!Array.isArray(arr)) return false;
  const target = String(value == null ? '' : value).toLowerCase();
  return arr.some((x) => String(x == null ? '' : x).toLowerCase() === target);
}

// Extract the day name from a meal name : "Mardi midi" -> "Mardi", "Re-Mardi soir" -> "Re-Mardi".
function dayOf(mealName) {
  return mealName.replace(/\s+(midi|soir)$/i, '').trim();
}

// Build the ordered list of unique days, preserving the order from the YAML.
function listDays(meals) {
  const seen = new Set();
  const out = [];
  for (const meal of meals) {
    const d = dayOf(meal.name);
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

// Default portions for a day = max(portions across the day's meals) from the YAML.
function defaultPortionsByDay(meals) {
  const out = {};
  for (const meal of meals) {
    const d = dayOf(meal.name);
    const p = Number(meal.portions) || 0;
    if (out[d] == null || p > out[d]) out[d] = p;
  }
  return out;
}

// Effective portions = saved value if any, else default from YAML.
function effectivePortions(data, savedPortions) {
  const defaults = defaultPortionsByDay(data.meals);
  const out = {};
  for (const day of Object.keys(defaults)) {
    out[day] = savedPortions[day] != null ? Number(savedPortions[day]) : defaults[day];
  }
  return out;
}

async function loadData() {
  let data;
  // If the user imported a YAML file, prefer that over the bundled one.
  const imported = (typeof localStorage !== 'undefined') ? localStorage.getItem('importedYamlData') : null;
  if (imported) {
    try {
      data = JSON.parse(imported);
    } catch (e) {
      console.warn('importedYamlData corrompu, fallback sur repas.yml', e);
      data = null;
    }
  }
  if (!data) {
    const resp = await fetch(YAML_URL);
    if (!resp.ok) throw new Error('Impossible de charger repas.yml');
    const text = await resp.text();
    data = jsyaml.load(text);
  }

  // Merge user-local customizations from localStorage on top of the YAML.
  // Preserve the original YAML recipes so the edit page can detect when a
  // modified recipe has been reverted to its original (non-perso) state.
  data.recipesYaml = Object.assign({}, data.recipes || {});
  if (window.Store) {
    const customR = Store.loadCustomRecipes();
    const customI = Store.loadCustomIngredients();
    const overrides = Store.loadMealOverrides();
    data.recipes = Object.assign({}, data.recipes || {}, customR);
    data.ingredients = Object.assign({}, data.ingredients || {}, customI);
    if (Array.isArray(data.meals)) {
      for (const m of data.meals) {
        if (!hasKeyCI(overrides, m.name)) continue;
        const ov = getCI(overrides, m.name);
        if (ov === null) m.recipes = [];
        else if (ov && Array.isArray(ov.recipes)) m.recipes = ov.recipes.slice();
      }
    }
  }
  return data;
}

// Build the fully merged dataset (YAML + custom recipes/ingredients + meal
// overrides + per-day portions) shaped like repas.yml. Used by both the YAML
// export feature and the YAML share feature.
async function buildFullExportData() {
  const data = await loadData();

  // Apply per-day portions overrides onto each meal's `portions` field.
  if (window.Store) {
    const portionsByDay = Store.loadPortionsByDay();
    if (Array.isArray(data.meals)) {
      for (const m of data.meals) {
        const d = dayOf(m.name);
        if (portionsByDay[d] != null) m.portions = Number(portionsByDay[d]);
      }
    }
  }

  // Drop runtime-only fields that should not be re-exported.
  delete data.recipesYaml;

  // Re-order top-level keys to match the canonical repas.yml layout.
  const order = ['unitScales', 'ingredientPresets', 'recipes', 'meals', 'ingredients'];
  const ordered = {};
  for (const k of order) {
    if (data[k] !== undefined) ordered[k] = data[k];
  }
  for (const k of Object.keys(data)) {
    if (!(k in ordered)) ordered[k] = data[k];
  }
  return ordered;
}

window.App = { loadData, dayOf, listDays, defaultPortionsByDay, effectivePortions, buildFullExportData, eqCI, findKeyCI, hasKeyCI, getCI, includesCI };
