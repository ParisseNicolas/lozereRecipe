// recipe.js
// Render the recipe detail page : recette.html?nom=<recipe>&portions=<n>&jour=<day>&moment=<midi|soir>

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    nom: params.get('nom'),
    portions: Number(params.get('portions')) || 1,
    jour: params.get('jour') || '',
    moment: params.get('moment') || '',
  };
}

function renderRecipe(data) {
  const { nom, portions, jour, moment } = getQueryParams();
  const root = document.getElementById('recipe-root');
  root.innerHTML = '';

  if (!nom) {
    root.innerHTML = '<p>Aucune recette spécifiée.</p>';
    return;
  }

  const recipe = data.recipes && data.recipes[nom];
  if (!recipe) {
    root.innerHTML = `<p>Recette « ${nom} » introuvable.</p>`;
    return;
  }

  // Header
  const title = document.createElement('h1');
  title.textContent = nom;
  root.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'recipe-subtitle';
  const ctx = [jour, moment].filter(Boolean).join(' ');
  const recipeBase = Number(recipe.portions) > 0 ? Number(recipe.portions) : 1;
  const baseSuffix = recipeBase > 1 ? ` (recette de base pour ${recipeBase} personnes)` : '';
  subtitle.textContent = ctx
    ? `${ctx} — ${portions} portion${portions > 1 ? 's' : ''}${baseSuffix}`
    : `${portions} portion${portions > 1 ? 's' : ''}${baseSuffix}`;
  root.appendChild(subtitle);

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'print-btn no-print';
  printBtn.textContent = '🖨 Imprimer';
  printBtn.addEventListener('click', () => window.print());
  root.appendChild(printBtn);

  // Ingredients
  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients';
  root.appendChild(h2i);

  const ingredientsSpec = data.ingredients || {};
  const ulIngr = document.createElement('ul');
  ulIngr.className = 'ingredients-list';
  for (const [ingrName, rawValue] of Object.entries(recipe.ingredients || {})) {
    const { amount, unit } = Parser.parseQuantity(rawValue);
    const scaled = (amount * portions) / recipeBase;

    // Try to convert into the preferred unit for display.
    const spec = ingredientsSpec[ingrName] || {};
    // Smart unit switch: when the recipe is scaled high enough that the total
    // in the purchase unit is >= 1, prefer the purchase unit (e.g. "10 baguettes"
    // instead of "2.3 kg de pain"). Falls back to `preferred` otherwise.
    let displayTarget;
    if (spec.purchase && spec.preferred && spec.purchase !== spec.preferred) {
      const inPurchase = Shopping.convertAmount(scaled, unit, spec.purchase, spec.convert);
      if (inPurchase != null && isFinite(inPurchase) && inPurchase >= 1) {
        displayTarget = spec.purchase;
      }
    }
    let displayParts = Shopping.aggregateIngredient(ingrName, { [unit]: scaled }, ingredientsSpec, displayTarget);

    const li = document.createElement('li');
    const labelStr = displayParts
      .map((p) => Parser.promoteUnit(p.amount, p.unit, data.unitScales))
      .map((p) => `${Parser.formatAmount(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
      .join(' + ');

    // Equivalent in a metric unit (mass/volume), shown next to the recipe qty.
    const metricTarget = Shopping.pickMetricTarget(spec);
    const convert = spec.convert || null;
    let equivStr = '';
    if (metricTarget) {
      const parts = [];
      for (const p of displayParts) {
        if (p.unit === metricTarget) { parts.push(p); continue; }
        const v = Shopping.convertAmount(p.amount, p.unit, metricTarget, convert);
        if (v != null && isFinite(v) && v > 0) parts.push({ amount: v, unit: metricTarget });
      }
      if (parts.length > 0) {
        const promoted = parts
          .map((p) => Parser.promoteOnly(p.amount, p.unit, data.unitScales))
          .map((p) => `${Parser.formatAmountSmart(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
          .join(' + ');
        if (promoted !== labelStr) equivStr = promoted;
      }
    }

    li.innerHTML = `<span class="ingr-name">${ingrName}</span><span class="ingr-qtys"><span class="ingr-qty has-popover" title="Voir les conversions">${labelStr}</span>${equivStr ? `<span class="ingr-qty-equiv">≈ ${equivStr}</span>` : ''}</span>`;
    const qtyEl = li.querySelector('.ingr-qty');
    qtyEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      Popover.showConversions(ingrName, spec, qtyEl, displayParts, data.unitScales);
    });
    ulIngr.appendChild(li);
  }
  root.appendChild(ulIngr);

  // Steps
  const h2s = document.createElement('h2');
  h2s.textContent = 'Préparation';
  root.appendChild(h2s);

  if (!recipe.steps || recipe.steps.length === 0) {
    const p = document.createElement('p');
    p.className = 'no-steps';
    p.textContent = 'Aucune étape de préparation renseignée pour cette recette.';
    root.appendChild(p);
  } else {
    const markerRe = /^\s*-{2,}\s*cuisson\s*-{2,}\s*$/i;
    const splitIdx = recipe.steps.findIndex((s) => markerRe.test(String(s)));
    const renderList = (items) => {
      const ol = document.createElement('ol');
      ol.className = 'steps-list';
      for (const step of items) {
        const li = document.createElement('li');
        li.textContent = step;
        ol.appendChild(li);
      }
      root.appendChild(ol);
    };
    const renderBlock = (title, items) => {
      if (!items || items.length === 0) return;
      const h3 = document.createElement('h3');
      h3.textContent = title;
      root.appendChild(h3);
      renderList(items);
    };
    if (splitIdx === -1) {
      renderList(recipe.steps);
    } else {
      renderBlock('Découpe', recipe.steps.slice(0, splitIdx));
      renderBlock('Cuisson', recipe.steps.slice(splitIdx + 1));
    }
  }
}

window.Recipe = { renderRecipe };
