// app.js
// Load the YAML file and expose helpers shared by all pages.

const YAML_URL = 'repas.yml';

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
        if (!(m.name in overrides)) continue;
        const ov = overrides[m.name];
        if (ov === null) m.recipes = [];
        else if (ov && Array.isArray(ov.recipes)) m.recipes = ov.recipes.slice();
      }
    }
  }
  return data;
}

window.App = { loadData, dayOf, listDays, defaultPortionsByDay, effectivePortions };
