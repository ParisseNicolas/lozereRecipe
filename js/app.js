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
  const resp = await fetch(YAML_URL);
  if (!resp.ok) throw new Error('Impossible de charger repas.yml');
  const text = await resp.text();
  return jsyaml.load(text);
}

window.App = { loadData, dayOf, listDays, defaultPortionsByDay, effectivePortions };
