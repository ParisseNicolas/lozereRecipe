// menu.js
// Render the weekly menu on index.html with one row per day.

function renderMenu(data) {
  const tbody = document.querySelector('#menu-table tbody');
  tbody.innerHTML = '';

  const saved = Store.loadPortionsByDay();
  const portions = App.effectivePortions(data, saved);
  const days = App.listDays(data.meals);

  // Group meals by day -> { day: { midi: meal, soir: meal } }
  const byDay = {};
  for (const meal of data.meals) {
    const d = App.dayOf(meal.name);
    const slot = /soir/i.test(meal.name) ? 'soir' : 'midi';
    if (!byDay[d]) byDay[d] = {};
    byDay[d][slot] = meal;
  }

  for (const day of days) {
    const tr = document.createElement('tr');

    const tdDay = document.createElement('td');
    tdDay.textContent = day;
    tdDay.className = 'day-cell';
    tr.appendChild(tdDay);

    for (const slot of ['midi', 'soir']) {
      const td = document.createElement('td');
      const meal = byDay[day] && byDay[day][slot];
      if (meal && meal.recipes && meal.recipes.length > 0) {
        const dayPortions = portions[day];
        for (const recipeName of meal.recipes) {
          const link = document.createElement('a');
          link.href = `recette.html?nom=${encodeURIComponent(recipeName)}&portions=${dayPortions}&jour=${encodeURIComponent(day)}&moment=${slot}`;
          link.textContent = recipeName;
          link.className = 'recipe-link';
          td.appendChild(link);
        }
      } else if (meal) {
        const span = document.createElement('span');
        span.textContent = '(restes)';
        span.className = 'leftover';
        td.appendChild(span);
      }
      tr.appendChild(td);
    }

    const tdPortions = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = portions[day];
    input.dataset.day = day;
    input.className = 'portions-input';
    input.addEventListener('change', (e) => {
      const v = Number(e.target.value) || 0;
      Store.setDayPortions(day, v);
    });
    tdPortions.appendChild(input);
    tr.appendChild(tdPortions);

    tbody.appendChild(tr);
  }
}

window.Menu = { renderMenu };
