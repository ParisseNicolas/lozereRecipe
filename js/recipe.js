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
  subtitle.textContent = ctx
    ? `${ctx} — ${portions} portion${portions > 1 ? 's' : ''}`
    : `${portions} portion${portions > 1 ? 's' : ''}`;
  root.appendChild(subtitle);

  // Ingredients
  const h2i = document.createElement('h2');
  h2i.textContent = 'Ingrédients';
  root.appendChild(h2i);

  const ingredientsSpec = data.ingredients || {};
  const ulIngr = document.createElement('ul');
  ulIngr.className = 'ingredients-list';
  for (const [ingrName, rawValue] of Object.entries(recipe.ingredients || {})) {
    const { amount, unit } = Parser.parseQuantity(rawValue);
    const scaled = amount * portions;

    // Try to convert into the preferred unit for display.
    const spec = ingredientsSpec[ingrName] || {};
    let displayParts = Shopping.aggregateIngredient(ingrName, { [unit]: scaled }, ingredientsSpec);

    const li = document.createElement('li');
    const labelStr = displayParts
      .map((p) => Parser.promoteUnit(p.amount, p.unit, data.unitScales))
      .map((p) => `${Parser.formatAmount(p.amount)} ${Parser.pluralizeUnit(p.amount, p.unit)}`.trim())
      .join(' + ');
    li.innerHTML = `<span class="ingr-name">${ingrName}</span> <span class="ingr-qty">${labelStr}</span>`;
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
