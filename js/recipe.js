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

  const fragment = buildRecipeContent(data, nom, portions, { interactive: true });
  root.appendChild(fragment);
}

// Build the recipe content (without page header / print button) as a DocumentFragment.
// `opts.interactive` enables click-to-show-conversions popovers (recipe page only).
// Used both by the recipe page and by the menu print dialog when including details.
function buildRecipeContent(data, nom, portions, opts) {
  opts = opts || {};
  const interactive = opts.interactive !== false;
  const frag = document.createDocumentFragment();
  const recipe = data.recipes && data.recipes[nom];
  if (!recipe) return frag;
  const recipeBase = Number(recipe.portions) > 0 ? Number(recipe.portions) : 1;

  // Ingredients section
  const ingrSection = document.createElement('section');
  ingrSection.className = 'recipe-block';
  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients';
  ingrSection.appendChild(h2i);

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

    li.innerHTML = `<span class="ingr-name">${ingrName}</span><span class="ingr-qtys"><span class="ingr-qty${interactive ? ' has-popover' : ''}"${interactive ? ' title="Voir les conversions"' : ''}>${labelStr}</span>${equivStr ? `<span class="ingr-qty-equiv">≈ ${equivStr}</span>` : ''}</span>`;
    if (interactive) {
      const qtyEl = li.querySelector('.ingr-qty');
      qtyEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Popover.showConversions(ingrName, spec, qtyEl, displayParts, data.unitScales);
      });
    }
    ulIngr.appendChild(li);
  }
  ingrSection.appendChild(ulIngr);
  frag.appendChild(ingrSection);

  // Steps
  const stepsSection = document.createElement('section');
  stepsSection.className = 'recipe-block';
  const h2s = document.createElement('h2');
  h2s.textContent = 'Préparation';
  stepsSection.appendChild(h2s);

  if (!recipe.steps || recipe.steps.length === 0) {
    const p = document.createElement('p');
    p.className = 'no-steps';
    p.textContent = 'Aucune étape de préparation renseignée pour cette recette.';
    stepsSection.appendChild(p);
    frag.appendChild(stepsSection);
    return frag;
  }

  const markerRe = /^\s*-{2,}\s*cuisson\s*-{2,}\s*$/i;
  const splitIdx = recipe.steps.findIndex((s) => markerRe.test(String(s)));
  const renderList = (parent, items) => {
    const ol = document.createElement('ol');
    ol.className = 'steps-list';
    for (const step of items) {
      const li = document.createElement('li');
      li.textContent = step;
      ol.appendChild(li);
    }
    parent.appendChild(ol);
  };

  if (splitIdx === -1) {
    renderList(stepsSection, recipe.steps);
    frag.appendChild(stepsSection);
  } else {
    // "Préparation" wrapper holds the h2; sub-blocks "Découpe" / "Cuisson" each
    // get their own .recipe-block so the sub-title stays with its list on print.
    frag.appendChild(stepsSection);
    const renderSubBlock = (title, items) => {
      if (!items || items.length === 0) return;
      const sub = document.createElement('section');
      sub.className = 'recipe-block recipe-subblock';
      const h3 = document.createElement('h3');
      h3.textContent = title;
      sub.appendChild(h3);
      renderList(sub, items);
      frag.appendChild(sub);
    };
    renderSubBlock('Découpe', recipe.steps.slice(0, splitIdx));
    renderSubBlock('Cuisson', recipe.steps.slice(splitIdx + 1));
  }
  return frag;
}

window.Recipe = { renderRecipe, buildRecipeContent };
