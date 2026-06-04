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
    const portionsByDay = Store.loadPortionsByDay();

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
      buildAndPrint(data, selected, portionsByDay, includeDetails);
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

  // Self-contained CSS for the print iframe. Kept minimal and inlined so the
  // iframe doc is fully standalone — this avoids Android Chrome's "Files" print
  // tool dropping content that the parent page's @media print rules silently
  // hid or collapsed.
  const PRINT_IFRAME_CSS = `
    @page { margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: black; }
    body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 11pt; line-height: 1.4; padding: 0; }
    h1 { font-size: 18pt; margin: 0 0 6mm; }
    h2 { font-size: 13pt; margin: 4mm 0 2mm; }
    h3 { font-size: 11pt; margin: 3mm 0 1.5mm; }
    p { margin: 0 0 2mm; }
    ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
    li { margin: 0.5mm 0; }
    .print-day-block { margin-bottom: 6mm; }
    .print-day-block + .print-day-block { break-before: page; page-break-before: always; }
    .print-day-block > h2 { border-bottom: 1px solid #888; padding-bottom: 1mm; }
    .print-meal { margin-bottom: 4mm; }
    .print-meal > h3 { font-weight: 600; break-after: avoid; page-break-after: avoid; }
    .print-meal > ul { break-after: avoid; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid; }
    .print-meal > .print-recipe:first-of-type { break-before: avoid; page-break-before: avoid; }
    .print-recipe { margin-top: 4mm; padding-top: 2mm; border-top: 1px dashed #bbb; break-inside: avoid; page-break-inside: avoid; }
    .print-recipe > h2:first-child { margin-top: 0; }
    .recipe-subtitle { font-size: 10pt; color: #555; margin: 0 0 2mm; font-style: italic; }
    .recipe-block { margin-bottom: 3mm; break-inside: avoid; page-break-inside: avoid; }
    .recipe-prep { break-inside: avoid; page-break-inside: avoid; }
    .recipe-block h2 { font-size: 12pt; margin: 3mm 0 1.5mm; }
    .recipe-block h3 { font-size: 11pt; margin: 2mm 0 1mm; }
    .ingredients-list { list-style: none; padding: 0; margin: 0 0 3mm; }
    .ingredients-list li { display: flex; justify-content: space-between; gap: 1rem; padding: 1mm 0; border-bottom: 1px dotted #ccc; }
    .ingredients-list li:last-child { border-bottom: none; }
    .ingr-name { font-weight: 500; }
    .ingr-qtys { text-align: right; }
    .ingr-qty-equiv { font-size: 9pt; color: #777; margin-left: 0.4rem; }
    .steps-list { padding-left: 6mm; margin: 0 0 3mm; }
    .steps-list li { margin: 1mm 0; padding: 0; }
    .no-steps { font-style: italic; color: #777; }
  `;

  function buildPrintContent(data, selectedDays, portionsByDay, includeDetails) {
    // Group meals by day -> { day: { midi, soir } }
    const byDay = {};
    for (const meal of data.meals) {
      const d = App.dayOf(meal.name);
      const slot = App.slotOf(meal.name);
      if (!byDay[d]) byDay[d] = {};
      byDay[d][slot] = meal;
    }

    const container = document.createElement('div');
    container.id = 'print-menu-output';

    const heading = document.createElement('h1');
    heading.textContent = 'Menu de la semaine';
    container.appendChild(heading);

    for (const day of selectedDays) {
      const block = document.createElement('section');
      block.className = 'print-day-block';
      const h2 = document.createElement('h2');
      h2.textContent = day;
      block.appendChild(h2);

      for (const slot of ['midi', 'soir']) {
        const meal = byDay[day] && byDay[day][slot];
        if (!meal) continue;
        const fallback = Number(meal.portions) || 0;
        const slotPortions = Store.getSlotPortions(portionsByDay, day, slot, fallback);
        const mealEl = document.createElement('div');
        mealEl.className = 'print-meal';
        const h3 = document.createElement('h3');
        const slotLabel = slot === 'midi' ? 'Midi' : 'Soir';
        h3.textContent = `${slotLabel} — ${slotPortions} personne${slotPortions > 1 ? 's' : ''}`;
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
              sub.textContent = `${slotPortions} portion${slotPortions > 1 ? 's' : ''}`
                + (recipeBase > 1 ? ` (recette de base pour ${recipeBase} personnes)` : '');
              recipeWrapper.appendChild(sub);
              try {
                const frag = Recipe.buildRecipeContent(data, recipeName, slotPortions, { interactive: false });
                recipeWrapper.appendChild(frag);
                // When the recipe has a Préparation wrapper (split into
                // Découpe/Cuisson), make its h2 self-contained so that if the
                // whole block bascule sur une nouvelle page, the reader still
                // sees the recipe name + portions at the top of that page.
                const prepH2 = recipeWrapper.querySelector('.recipe-prep .recipe-block > h2');
                if (prepH2) {
                  prepH2.textContent = `Préparation — ${recipeName} (${slotPortions} personne${slotPortions > 1 ? 's' : ''})`;
                }
              } catch (err) {
                const errP = document.createElement('p');
                errP.textContent = '(Erreur lors de la génération du détail de la recette : ' + (err && err.message ? err.message : err) + ')';
                recipeWrapper.appendChild(errP);
              }
              mealEl.appendChild(recipeWrapper);
            }
          }
        }
        block.appendChild(mealEl);
      }
      container.appendChild(block);
    }

    return container;
  }

  function buildAndPrint(data, selectedDays, portionsByDay, includeDetails) {
    const container = buildPrintContent(data, selectedDays, portionsByDay, includeDetails);

    // Print via a dedicated same-origin iframe with its own minimal stylesheet.
    // This bypasses the parent page's @media print rules entirely and works
    // reliably with Android Chrome's "Files" / "Save as PDF" print tool, which
    // was silently dropping the recipe detail sections under the original
    // approach.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Menu de la semaine</title></head><body></body></html>');
    doc.close();

    const style = doc.createElement('style');
    style.textContent = PRINT_IFRAME_CSS;
    doc.head.appendChild(style);

    // Deep-import the constructed DOM into the iframe document.
    doc.body.appendChild(doc.importNode(container, true));

    let printed = false;
    const cleanup = () => {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      try {
        const win = iframe.contentWindow;
        win.focus();
        win.print();
      } catch (err) {
        console.warn('Iframe print failed, falling back to window.print()', err);
        window.print();
      }
      // Keep the iframe around long enough for the print pipeline to finish
      // reading from it (Android in particular needs a generous delay).
      setTimeout(cleanup, 3000);
    };

    // Double rAF + small delay so the iframe has applied styles and laid out
    // its content before we trigger the print dialog.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(triggerPrint, 150);
      });
    });
  }

  window.PrintMenu = { open };
})();
