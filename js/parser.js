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
  // Allow one decimal between 1 and 10 so promoted values like 1.125 kg show
  // as "1.2 kg" instead of being ceil'd to "2 kg" (which inflates the number
  // and breaks consistency with secondary equiv displays).
  if (Math.abs(n) >= 1 && Math.abs(n) < 10 && Math.abs(n - Math.round(n)) > 1e-9) {
    return String(Math.ceil(n * 10) / 10);
  }
  return String(Math.ceil(n));
}

// Like formatAmount, but keeps fractional precision when |n| < 1 so a small
// purchase-unit equivalent (e.g. 0.012 kg) isn't rounded up to 1.
function formatAmountSmart(n) {
  if (!isFinite(n)) return '0';
  if (Math.abs(n) >= 1) return formatAmount(n);
  return Number(n.toPrecision(2)).toString();
}

// Promote a quantity to a larger unit when the result stays a whole number.
// Iterative : 5000 ml -> 500 cl -> 5 L. Stops at the first non-integer step.
// `scales` shape : { unit: { upper: <string>, factor: <number> } }
function promoteUnit(amount, unit, scales) {
  if (!scales || amount === 0) return { amount, unit };
  let a = amount, u = unit;
  // Promote upward only while the result is a whole number (avoids surprises
  // like 1125 g -> 1.125 kg displaying as "2 kg" after Math.ceil).
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

// Like promoteUnit, but only promotes upward (never demotes). Useful when the
// caller wants to keep small fractional values (e.g. 0.012 kg) as-is instead of
// being demoted back to a smaller unit.
function promoteOnly(amount, unit, scales) {
  if (!scales || amount === 0) return { amount, unit };
  let a = amount, u = unit;
  while (scales[u]) {
    const { upper, factor } = scales[u];
    if (!upper || !factor) break;
    const promoted = a / factor;
    if (Math.abs(promoted) < 1) break;
    a = promoted;
    u = upper;
  }
  return { amount: a, unit: u };
}

// Pluralize a unit when amount > 1, except for measurement abbreviations.
const INVARIANT_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'cl', 'L', 'cs', 'cc', 'u', 'petit peu']);
const METRIC_UNITS = new Set(['mg', 'g', 'kg', 'ml', 'cl', 'L']);
function isMetricUnit(u) { return METRIC_UNITS.has(u); }
// Countable "piece" units : already self-explanatory, treated like metric
// for the purpose of `.ingr-qty-equiv` (no further conversion possible).
const PIECE_UNITS = new Set(['u', 'gousse', 'feuille']);
function isPieceUnit(u) { return PIECE_UNITS.has(u); }
function isEquivUnit(u) { return METRIC_UNITS.has(u) || PIECE_UNITS.has(u); }
function pluralizeUnit(amount, unit) {
  if (!unit) return unit;
  if (Math.ceil(amount) <= 1) return unit;
  if (INVARIANT_UNITS.has(unit)) return unit;
  if (unit.endsWith('s') || unit.endsWith('x')) return unit;
  return unit + 's';
}

window.Parser = { parseQuantity, formatAmount, formatAmountSmart, promoteUnit, promoteOnly, pluralizeUnit, isMetricUnit, METRIC_UNITS, isPieceUnit, PIECE_UNITS, isEquivUnit };
