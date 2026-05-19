// parser.js
// Parse a quantity value coming from the YAML.
// Input examples : 50, "100g", "1cs", "0.5 gousse", "2 feuille", "0.05 pot", { quantity: 50, unit: "g" }
// Output : { amount: <Number>, unit: <string> }  (unit = "u" when none provided)

function parseQuantity(value) {
  if (value == null) return { amount: 0, unit: 'u' };

  // Object form : { quantity: 50, unit: "g" }
  if (typeof value === 'object') {
    return {
      amount: Number(value.quantity) || 0,
      unit: (value.unit || 'u').trim(),
    };
  }

  // Number alone (no unit)
  if (typeof value === 'number') {
    return { amount: value, unit: 'u' };
  }

  // String : extract leading number, rest is unit
  const str = String(value).trim();
  const match = str.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return { amount: 0, unit: str || 'u' };

  const amount = parseFloat(match[1]);
  const unit = match[2].trim() || 'u';
  return { amount, unit };
}

// Format a number for display : 2 decimals max, no trailing zeros.
function formatAmount(n) {
  if (!isFinite(n)) return '0';
  return String(Math.ceil(n));
}

// Promote a quantity to a larger unit when the result stays a whole number.
// Iterative : 5000 ml -> 500 cl -> 5 L. Stops at the first non-integer step.
// `scales` shape : { unit: { upper: <string>, factor: <number> } }
function promoteUnit(amount, unit, scales) {
  if (!scales || amount === 0) return { amount, unit };
  let a = amount, u = unit;
  // Promote upward while value >= 1 in the larger unit.
  while (scales[u]) {
    const { upper, factor } = scales[u];
    if (!upper || !factor) break;
    const promoted = a / factor;
    if (Math.abs(promoted) < 1) break;
    a = promoted;
    u = upper;
  }
  // Demote downward while value < 1 in the current unit and a lower unit exists.
  const lower = {};
  for (const [small, def] of Object.entries(scales)) {
    if (def && def.upper) lower[def.upper] = { lower: small, factor: def.factor };
  }
  while (Math.abs(a) < 1 && lower[u]) {
    const { lower: smaller, factor } = lower[u];
    a = a * factor;
    u = smaller;
  }
  return { amount: a, unit: u };
}

window.Parser = { parseQuantity, formatAmount, promoteUnit };
