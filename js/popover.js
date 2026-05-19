// popover.js
// Show a small overlay listing all unit conversions known for an ingredient.

function formatRatio(n) {
  if (!isFinite(n)) return '?';
  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n));
  return n.toFixed(2).replace(/\.?0+$/, '');
}

// Build human-readable lines from a convert table.
// convert shape : { targetUnit: { sourceUnit: factor } }, where sourceAmount * factor = targetAmount.
// So 1 sourceUnit = factor targetUnit, equivalently 1 targetUnit = 1/factor sourceUnit.
function buildConversionLines(convert) {
  const lines = [];
  for (const [target, sources] of Object.entries(convert || {})) {
    const parts = [];
    for (const [src, factor] of Object.entries(sources || {})) {
      if (!factor) continue;
      parts.push(`${formatRatio(1 / factor)} ${src}`);
    }
    if (parts.length > 0) {
      lines.push(`1 ${target} ≈ ${parts.join(', ')}`);
    }
  }
  return lines;
}

let currentPopover = null;
let currentBackdrop = null;

function closePopover() {
  if (currentPopover) currentPopover.remove();
  if (currentBackdrop) currentBackdrop.remove();
  currentPopover = null;
  currentBackdrop = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.key === 'Escape') closePopover();
}

// Collect all units that appear in the convert table.
function collectUnits(convert) {
  const set = new Set();
  for (const [target, sources] of Object.entries(convert || {})) {
    set.add(target);
    for (const src of Object.keys(sources || {})) set.add(src);
  }
  return Array.from(set);
}

// Convert `amount` from `fromUnit` to `toUnit` using the convert table.
// Supports both directions and a one-hop chain via a common target unit.
function convertBetween(amount, fromUnit, toUnit, convert) {
  if (fromUnit === toUnit) return amount;
  if (!convert) return null;
  // Direct : convert[toUnit][fromUnit] = factor (fromUnit -> toUnit)
  if (convert[toUnit] && convert[toUnit][fromUnit] != null) {
    return amount * convert[toUnit][fromUnit];
  }
  // Inverse : convert[fromUnit][toUnit] means toUnit -> fromUnit, so reverse it.
  if (convert[fromUnit] && convert[fromUnit][toUnit] != null) {
    const f = convert[fromUnit][toUnit];
    if (f === 0) return null;
    return amount / f;
  }
  // One-hop through a target unit T : fromUnit -> T -> toUnit.
  for (const T of Object.keys(convert)) {
    if (convert[T][fromUnit] != null && convert[T][toUnit] != null) {
      const inT = amount * convert[T][fromUnit];
      const f = convert[T][toUnit];
      if (f === 0) continue;
      return inT / f;
    }
  }
  return null;
}

function buildEquivalentLines(parts, convert, unitScales) {
  if (!parts || parts.length === 0) return [];
  const units = collectUnits(convert);
  const lines = [];
  for (const p of parts) {
    const promotedSelf = unitScales ? Parser.promoteUnit(p.amount, p.unit, unitScales) : p;
    const others = [];
    for (const u of units) {
      if (u === p.unit) continue;
      const v = convertBetween(p.amount, p.unit, u, convert);
      if (v != null && isFinite(v) && v > 0) {
        const promoted = unitScales ? Parser.promoteUnit(v, u, unitScales) : { amount: v, unit: u };
        others.push(`${Parser.formatAmount(promoted.amount)} ${promoted.unit}`);
      }
    }
    if (others.length > 0) {
      lines.push(`${Parser.formatAmount(promotedSelf.amount)} ${promotedSelf.unit} ≈ ${others.join(', ')}`);
    }
  }
  return lines;
}

function showConversions(ingrName, spec, anchorEl, parts, unitScales) {
  closePopover();

  const convert = (spec && spec.convert) || null;
  const preferred = (spec && spec.preferred) || null;

  const backdrop = document.createElement('div');
  backdrop.className = 'popover-backdrop';
  backdrop.addEventListener('click', closePopover);

  const pop = document.createElement('div');
  pop.className = 'qty-popover';
  pop.addEventListener('click', (e) => e.stopPropagation());

  const title = document.createElement('div');
  title.className = 'popover-title';
  title.textContent = ingrName;
  pop.appendChild(title);

  if (preferred) {
    const sub = document.createElement('div');
    sub.className = 'popover-sub';
    sub.textContent = `Unité préférée : ${preferred}`;
    pop.appendChild(sub);
  }

  const lines = buildConversionLines(convert);
  if (lines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'popover-empty';
    empty.textContent = 'Aucune conversion connue pour cet ingrédient.';
    pop.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'popover-list';
    for (const l of lines) {
      const li = document.createElement('li');
      li.textContent = l;
      ul.appendChild(li);
    }
    pop.appendChild(ul);
  }

  const equivLines = buildEquivalentLines(parts, convert, unitScales);
  if (equivLines.length > 0) {
    const h = document.createElement('div');
    h.className = 'popover-section-title';
    h.textContent = 'Pour la quantité utilisée';
    pop.appendChild(h);
    const ul2 = document.createElement('ul');
    ul2.className = 'popover-list';
    for (const l of equivLines) {
      const li = document.createElement('li');
      li.textContent = l;
      ul2.appendChild(li);
    }
    pop.appendChild(ul2);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'popover-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closePopover);
  pop.appendChild(closeBtn);

  document.body.appendChild(backdrop);
  document.body.appendChild(pop);
  currentPopover = pop;
  currentBackdrop = backdrop;
  document.addEventListener('keydown', onKey);

  // Position below the anchor when possible.
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const top = window.scrollY + r.bottom + 6;
    let left = window.scrollX + r.left;
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    // Clamp into viewport horizontally after layout.
    requestAnimationFrame(() => {
      const pw = pop.offsetWidth;
      const maxLeft = window.scrollX + document.documentElement.clientWidth - pw - 8;
      if (left > maxLeft) pop.style.left = `${Math.max(8, maxLeft)}px`;
    });
  }
}

window.Popover = { showConversions, closePopover };
