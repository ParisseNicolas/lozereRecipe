// shopping.js
// Build the aggregated shopping list grouped by category.

// Convert an amount expressed in `fromUnit` to `toUnit` using the conversion table.
// Supports direct, inverse, and one-hop chained conversions.
// Returns null if no conversion is possible.
function convertAmount(amount, fromUnit, toUnit, convertTable) {
  if (fromUnit === toUnit) return amount;
  if (!convertTable) return null;

  // Direct : convertTable[toUnit][fromUnit] = factor (fromUnit -> toUnit)
  if (convertTable[toUnit] && convertTable[toUnit][fromUnit] != null) {
    const factor = convertTable[toUnit][fromUnit];
    if (factor === 0) return null;
    return amount * factor;
  }

  // Inverse : convertTable[fromUnit][toUnit] means toUnit -> fromUnit, so reverse it.
  if (convertTable[fromUnit] && convertTable[fromUnit][toUnit] != null) {
    const f = convertTable[fromUnit][toUnit];
    if (f === 0) return null;
    return amount / f;
  }

  // One-hop through a target unit T : fromUnit -> T -> toUnit.
  for (const T of Object.keys(convertTable)) {
    if (convertTable[T][fromUnit] != null && convertTable[T][toUnit] != null) {
      const f = convertTable[T][toUnit];
      if (f === 0) continue;
      return (amount * convertTable[T][fromUnit]) / f;
    }
  }

  return null;
}

// Pick the preferred unit for an ingredient.
// If a totals object has several units, try to convert all to the preferred one.
// `targetOverride` (optional) replaces spec.preferred — used by the shopping list
// to aggregate into the purchase unit instead of the recipe unit.
function aggregateIngredient(ingrName, totalsByUnit, ingredientsSpec, targetOverride) {
  const spec = ingredientsSpec[ingrName] || {};
  const preferred = targetOverride || spec.preferred || null;
  const convert = spec.convert || null;

  const units = Object.keys(totalsByUnit);

  // Try to merge everything into `preferred` (or any common unit).
  const target = preferred || units[0];

  // Single unit and no conversion needed.
  if (units.length === 1 && units[0] === target) {
    return [{ amount: totalsByUnit[target], unit: target }];
  }
  let merged = 0;
  const leftovers = [];
  for (const u of units) {
    if (u === target) {
      merged += totalsByUnit[u];
      continue;
    }
    const converted = convertAmount(totalsByUnit[u], u, target, convert);
    if (converted != null) {
      merged += converted;
    } else {
      leftovers.push({ amount: totalsByUnit[u], unit: u });
    }
  }
  const out = [];
  if (merged > 0) out.push({ amount: merged, unit: target });
  return out.concat(leftovers);
}

// Build the full shopping list.
// Returns : { categoryName: [ { name, parts: [{amount, unit}, ...] }, ... ] }
function buildShoppingList(data, portionsByDay) {
  const ingredientsSpec = data.ingredients || {};
  const recipes = data.recipes || {};
  const meals = data.meals || [];

  // ingrName -> { unit -> amount }
  const totals = {};

  for (const meal of meals) {
    if (!meal.recipes) continue;
    const day = App.dayOf(meal.name);
    const portions = Number(portionsByDay[day]) || 0;
    if (portions <= 0) continue;

    for (const recipeName of meal.recipes) {
      const recipe = recipes[recipeName];
      if (!recipe || !recipe.ingredients) continue;
      for (const [ingrName, rawValue] of Object.entries(recipe.ingredients)) {
        const { amount, unit } = Parser.parseQuantity(rawValue);
        const scaled = amount * portions;
        if (!totals[ingrName]) totals[ingrName] = {};
        totals[ingrName][unit] = (totals[ingrName][unit] || 0) + scaled;
      }
    }
  }

  // Convert and group by category.
  const byCategory = {};
  for (const [ingrName, totalsByUnit] of Object.entries(totals)) {
    const spec = ingredientsSpec[ingrName] || {};
    const category = spec.type || 'Autre';
    const target = spec.purchase || spec.preferred || null;
    const parts = aggregateIngredient(ingrName, totalsByUnit, ingredientsSpec, target);
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push({ name: ingrName, parts });
  }

  // Sort each category by ingredient name.
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  return byCategory;
}

window.Shopping = { buildShoppingList, aggregateIngredient, convertAmount };
