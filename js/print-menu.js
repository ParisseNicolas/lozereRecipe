// print-menu.js
// Custom print flow for the menu page: lets the user choose which day(s) to
// print, and optionally include the full recipe details for each meal.
// Builds a dedicated DOM container (#print-menu-output) shown only during
// print thanks to body.print-menu-selection in styles.css.

(function () {
  let modalEl = null;
  let backdropEl = null;

  function close() {
    if (modalEl) modalEl.remove();
    if (backdropEl) backdropEl.remove();
    modalEl = null;
    backdropEl = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open(data) {
    close();
    const days = App.listDays(data.meals);
    const portions = App.effectivePortions(data, Store.loadPortionsByDay());

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', close);

    const modal = document.createElement('div');
    modal.className = 'modal print-menu-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('h3');
    title.textContent = 'Imprimer le menu';
    modal.appendChild(title);

    const intro = document.createElement('p');
    intro.style.margin = '0';
    intro.style.fontSize = '0.9rem';
    intro.textContent = 'Sélectionne les jours à imprimer.';
    modal.appendChild(intro);

    const daysBox = document.createElement('div');
    daysBox.className = 'pm-days';
    const dayCheckboxes = {};
    for (const day of days) {
      const row = document.createElement('label');
      row.className = 'pm-day-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.value = day;
      dayCheckboxes[day] = cb;
      row.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = day;
      row.appendChild(span);
      daysBox.appendChild(row);
    }
    modal.appendChild(daysBox);

    const toggleAll = document.createElement('button');
    toggleAll.type = 'button';
    toggleAll.className = 'pm-toggle-all';
    toggleAll.textContent = 'Tout cocher / décocher';
    toggleAll.addEventListener('click', () => {
      const allOn = Object.values(dayCheckboxes).every((c) => c.checked);
      for (const c of Object.values(dayCheckboxes)) c.checked = !allOn;
    });
    modal.appendChild(toggleAll);

    const detailsLabel = document.createElement('label');
    const detailsCb = document.createElement('input');
    detailsCb.type = 'checkbox';
    detailsLabel.appendChild(detailsCb);
    const detailsText = document.createElement('span');
    detailsText.textContent = 'Inclure le détail des plats (ingrédients + étapes)';
    detailsLabel.appendChild(detailsText);
    modal.appendChild(detailsLabel);

    const actions = document.createElement('div');
    actions.className = 'pm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Annuler';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);

    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.textContent = '🖨 Imprimer';
    printBtn.addEventListener('click', () => {
      const selected = days.filter((d) => dayCheckboxes[d].checked);
      if (selected.length === 0) {
        alert('Sélectionne au moins un jour.');
        return;
      }
      const includeDetails = detailsCb.checked;
      buildAndPrint(data, selected, portions, includeDetails);
      close();
    });
    actions.appendChild(printBtn);
    modal.appendChild(actions);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    modalEl = modal;
    backdropEl = backdrop;
    document.addEventListener('keydown', onKey);
  }

  function buildAndPrint(data, selectedDays, portions, includeDetails) {
    // Group meals by day -> { day: { midi, soir } }
    const byDay = {};
    for (const meal of data.meals) {
      const d = App.dayOf(meal.name);
      const slot = /soir/i.test(meal.name) ? 'soir' : 'midi';
      if (!byDay[d]) byDay[d] = {};
      byDay[d][slot] = meal;
    }

    let container = document.getElementById('print-menu-output');
    if (!container) {
      container = document.createElement('div');
      container.id = 'print-menu-output';
      document.querySelector('main').appendChild(container);
    }
    container.innerHTML = '';

    const heading = document.createElement('h1');
    heading.textContent = 'Menu de la semaine';
    container.appendChild(heading);

    for (const day of selectedDays) {
      const block = document.createElement('section');
      block.className = 'print-day-block';
      const h2 = document.createElement('h2');
      const dayPortions = portions[day];
      h2.textContent = `${day} — ${dayPortions} personne${dayPortions > 1 ? 's' : ''}`;
      block.appendChild(h2);

      for (const slot of ['midi', 'soir']) {
        const meal = byDay[day] && byDay[day][slot];
        if (!meal) continue;
        const mealEl = document.createElement('div');
        mealEl.className = 'print-meal';
        const h3 = document.createElement('h3');
        h3.textContent = slot === 'midi' ? 'Midi' : 'Soir';
        mealEl.appendChild(h3);
        if (!meal.recipes || meal.recipes.length === 0) {
          const p = document.createElement('p');
          p.textContent = '(restes)';
          mealEl.appendChild(p);
        } else {
          const ul = document.createElement('ul');
          for (const r of meal.recipes) {
            const li = document.createElement('li');
            li.textContent = r;
            ul.appendChild(li);
          }
          mealEl.appendChild(ul);

          if (includeDetails && window.Recipe && Recipe.buildRecipeContent) {
            for (const recipeName of meal.recipes) {
              const recipeWrapper = document.createElement('div');
              recipeWrapper.className = 'print-recipe';
              const rTitle = document.createElement('h2');
              rTitle.textContent = recipeName;
              recipeWrapper.appendChild(rTitle);
              const recipeBase = data.recipes && data.recipes[recipeName] && Number(data.recipes[recipeName].portions) > 0
                ? Number(data.recipes[recipeName].portions)
                : 1;
              const sub = document.createElement('p');
              sub.className = 'recipe-subtitle';
              sub.textContent = `${dayPortions} portion${dayPortions > 1 ? 's' : ''}`
                + (recipeBase > 1 ? ` (recette de base pour ${recipeBase} personnes)` : '');
              recipeWrapper.appendChild(sub);
              const frag = Recipe.buildRecipeContent(data, recipeName, dayPortions, { interactive: false });
              recipeWrapper.appendChild(frag);
              mealEl.appendChild(recipeWrapper);
            }
          }
        }
        block.appendChild(mealEl);
      }
      container.appendChild(block);
    }

    document.body.classList.add('print-menu-selection');
    const cleanup = () => {
      document.body.classList.remove('print-menu-selection');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Slight delay so the layout settles before opening the print dialog.
    setTimeout(() => window.print(), 50);
  }

  window.PrintMenu = { open };
})();
