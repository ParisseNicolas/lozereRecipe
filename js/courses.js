// courses.js
// Render the shopping list grouped by category.

function renderCourses(data) {
  const root = document.getElementById('courses-root');
  root.innerHTML = '';

  const saved = Store.loadPortionsByDay();
  const portions = App.effectivePortions(data, saved);

  // Summary of portions per day at the top.
  const summary = document.createElement('div');
  summary.className = 'portions-summary';
  summary.innerHTML = '<strong>Personnes par jour :</strong> ';
  const days = App.listDays(data.meals);
  summary.innerHTML += days
    .map((d) => `${d} : ${portions[d]}`)
    .join(' &middot; ');
  root.appendChild(summary);

  const byCategory = Shopping.buildShoppingList(data, portions);
  const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b, 'fr'));

  if (categories.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Aucun ingrédient (le nombre de personnes est-il à 0 partout ?).';
    root.appendChild(p);
    return;
  }

  for (const cat of categories) {
    const section = document.createElement('section');
    section.className = 'category';

    const h2 = document.createElement('h2');
    h2.textContent = cat;
    section.appendChild(h2);

    const ul = document.createElement('ul');
    ul.className = 'shopping-list';
    for (const item of byCategory[cat]) {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'item-check';
      li.appendChild(cb);

      const label = document.createElement('label');
      const qtyStr = item.parts
        .map((p) => Parser.promoteUnit(p.amount, p.unit, data.unitScales))
        .map((p) => `${Parser.formatAmount(p.amount)} ${p.unit}`.trim())
        .join(' + ');
      label.innerHTML = `<span class="ingr-name">${item.name}</span> <span class="ingr-qty">${qtyStr}</span>`;
      li.appendChild(label);

      cb.addEventListener('change', () => {
        li.classList.toggle('checked', cb.checked);
      });
      ul.appendChild(li);
    }
    section.appendChild(ul);
    root.appendChild(section);
  }
}

window.Courses = { renderCourses };
