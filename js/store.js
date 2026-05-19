// store.js
// Persist user state in localStorage.
// - portionsByDay : nb de personnes par jour
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

function loadPortionsByDay() { return loadJSON(STORAGE_KEY); }
function savePortionsByDay(portionsByDay) { saveJSON(STORAGE_KEY, portionsByDay); }

function getDayPortions(portionsByDay, day, fallback) {
  if (portionsByDay[day] != null) return Number(portionsByDay[day]);
  return Number(fallback) || 0;
}

function setDayPortions(day, value) {
  const current = loadPortionsByDay();
  current[day] = Number(value) || 0;
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
  loadPortionsByDay, savePortionsByDay, getDayPortions, setDayPortions,
  loadCheckedItems, setItemChecked, clearCheckedItems,
  loadCustomRecipes, saveCustomRecipe, deleteCustomRecipe,
  loadCustomIngredients, saveCustomIngredient,
  loadMealOverrides, setMealOverride, clearMealOverride,
};
