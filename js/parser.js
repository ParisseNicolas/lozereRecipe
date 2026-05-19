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
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

window.Parser = { parseQuantity, formatAmount };
