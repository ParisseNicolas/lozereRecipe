// store.js
// Persist the number of portions per day in localStorage.
// Keyed by day name (e.g. "Mardi", "Mercredi", ..., "Re-Mardi").

const STORAGE_KEY = 'portionsByDay';
const CHECKED_KEY = 'checkedItems';

function loadPortionsByDay() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function savePortionsByDay(portionsByDay) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portionsByDay));
}

function getDayPortions(portionsByDay, day, fallback) {
  if (portionsByDay[day] != null) return Number(portionsByDay[day]);
  return Number(fallback) || 0;
}

function setDayPortions(day, value) {
  const current = loadPortionsByDay();
  current[day] = Number(value) || 0;
  savePortionsByDay(current);
}

window.Store = { loadPortionsByDay, savePortionsByDay, getDayPortions, setDayPortions, loadCheckedItems, setItemChecked, clearCheckedItems };

function loadCheckedItems() {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

function setItemChecked(key, checked) {
  const current = loadCheckedItems();
  if (checked) current[key] = true;
  else delete current[key];
  localStorage.setItem(CHECKED_KEY, JSON.stringify(current));
}

function clearCheckedItems() {
  localStorage.removeItem(CHECKED_KEY);
}
