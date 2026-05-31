// store.js
// Persist user state in localStorage.
// - portionsByDay : nb de personnes par jour et par créneau  { day: { midi, soir } }
// - checkedItems  : cases cochées sur la liste de courses
// - customRecipes : recettes créées depuis l'UI (fusionnées dans data.recipes au runtime)
// - customIngredients : ingrédients créés depuis l'UI (fusionnés dans data.ingredients)
// - mealOverrides : remplacements / vidages de créneaux du menu

const STORAGE_KEY = 'portionsByDay';
const CHECKED_KEY = 'checkedItems';
const CUSTOM_RECIPES_KEY = 'customRecipes';
const CUSTOM_INGREDIENTS_KEY = 'customIngredients';
const MEAL_OVERRIDES_KEY = 'mealOverrides';

function loadJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadPortionsByDay() {
  const raw = loadJSON(STORAGE_KEY);
  // One-shot migration : ancien format { day: number } -> { day: { midi, soir } }.
  // On copie la valeur unique sur les deux créneaux.
  // ATTENTION : on ne force PAS les slots manquants à 0 — un slot absent doit
  // rester absent pour que getSlotPortions puisse retomber sur le fallback YAML.
  let migrated = false;
  for (const day of Object.keys(raw)) {
    const v = raw[day];
    if (v != null && typeof v !== 'object') {
      const n = Number(v) || 0;
      raw[day] = { midi: n, soir: n };
      migrated = true;
    }
  }
  if (migrated) savePortionsByDay(raw);
  return raw;
}
function savePortionsByDay(portionsByDay) { saveJSON(STORAGE_KEY, portionsByDay); }

function getSlotPortions(portionsByDay, day, slot, fallback) {
  const o = portionsByDay && portionsByDay[day];
  if (o && o[slot] != null) return Number(o[slot]);
  return Number(fallback) || 0;
}

function setSlotPortions(day, slot, value) {
  const current = loadPortionsByDay();
  // Ne pas matérialiser le slot opposé : il doit rester absent tant que
  // l'utilisateur n'y a pas touché, sinon getSlotPortions ne peut plus
  // retomber sur le fallback YAML pour ce slot (et le partage casse).
  if (!current[day] || typeof current[day] !== 'object') current[day] = {};
  current[day][slot] = Number(value) || 0;
  savePortionsByDay(current);
}

function loadCheckedItems() { return loadJSON(CHECKED_KEY); }

function setItemChecked(key, checked) {
  const current = loadCheckedItems();
  if (checked) current[key] = true;
  else delete current[key];
  saveJSON(CHECKED_KEY, current);
}

function clearCheckedItems() { localStorage.removeItem(CHECKED_KEY); }

// --- Custom recipes ---
function loadCustomRecipes() { return loadJSON(CUSTOM_RECIPES_KEY); }

function saveCustomRecipe(name, recipe) {
  const current = loadCustomRecipes();
  current[name] = recipe;
  saveJSON(CUSTOM_RECIPES_KEY, current);
}

function deleteCustomRecipe(name) {
  const current = loadCustomRecipes();
  delete current[name];
  saveJSON(CUSTOM_RECIPES_KEY, current);
}

// --- Custom ingredients ---
function loadCustomIngredients() { return loadJSON(CUSTOM_INGREDIENTS_KEY); }

function saveCustomIngredient(name, spec) {
  const current = loadCustomIngredients();
  current[name] = spec;
  saveJSON(CUSTOM_INGREDIENTS_KEY, current);
}

// --- Meal overrides ---
// value shape : { recipes: ["..."] }  OR  null (créneau vidé)
function loadMealOverrides() { return loadJSON(MEAL_OVERRIDES_KEY); }

function setMealOverride(slot, value) {
  const current = loadMealOverrides();
  current[slot] = value;
  saveJSON(MEAL_OVERRIDES_KEY, current);
}

function clearMealOverride(slot) {
  const current = loadMealOverrides();
  delete current[slot];
  saveJSON(MEAL_OVERRIDES_KEY, current);
}

window.Store = {
  loadPortionsByDay, savePortionsByDay, getSlotPortions, setSlotPortions,
  loadCheckedItems, setItemChecked, clearCheckedItems,
  loadCustomRecipes, saveCustomRecipe, deleteCustomRecipe,
  loadCustomIngredients, saveCustomIngredient,
  loadMealOverrides, setMealOverride, clearMealOverride,
};
