// similar-recipe.js
// Detect a semantically similar recipe before saving, via a Cloudflare Worker
// that calls Gemini. If the AI flags a near-duplicate, present a 3-button modal
// (add anyway / cancel / replace existing).

(function () {
  const WORKER_URL = 'https://recipe-similarity.nicolas-parisse-93.workers.dev/';

  // Build a payload entry from a recipe object: only the ingredient names + steps.
  // Quantities are intentionally dropped — the AI compares semantically.
  function summarize(name, recipe) {
    const ingredients = Object.keys(recipe.ingredients || {});
    const steps = (recipe.steps || []).map((s) => String(s));
    return { name, ingredients, steps };
  }

  // Returns the matched existing recipe name, or null.
  // `candidate` is the in-memory recipe being saved: { name, recipe }.
  // `allRecipes` is the merged catalog map (data.recipes).
  async function findMatch(candidate, allRecipes) {
    if (!candidate || !candidate.name || !candidate.recipe) return null;
    const existing = [];
    for (const [n, r] of Object.entries(allRecipes || {})) {
      if (window.App && App.eqCI ? App.eqCI(n, candidate.name) : n === candidate.name) continue;
      existing.push(summarize(n, r));
    }
    if (existing.length === 0) return null;

    const body = {
      candidate: summarize(candidate.name, candidate.recipe),
      existing,
    };

    // Gemini sature ponctuellement (502/503/504). Retry avec backoff.
    // 429 est géré côté worker (fallback de modèle) → on ne retry pas ici.
    const delays = [0, 1200, 3000];
    let lastErr = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* leave json null */ }
        if (res.ok) {
          if (json && (typeof json.match === 'string' || json.match === null)) {
            return json.match;
          }
          // 200 OK avec corps vide / shape inattendue : transitoire, on retry.
          lastErr = new Error('Réponse vide ou inattendue du service de similarité.');
          continue;
        }
        if (res.status === 429) {
          const secs = Number(json && json.retryAfterSeconds) || 60;
          const err = new Error('Quota du serviteur dépassé.');
          err.retryAfterSeconds = secs;
          err.noRetry = true;
          throw err;
        }
        const transient = res.status === 502 || res.status === 503 || res.status === 504;
        lastErr = new Error((json && json.error) || `Erreur ${res.status}`);
        if (!transient) { lastErr.noRetry = true; throw lastErr; }
      } catch (e) {
        lastErr = e;
        if (e && e.noRetry) break;
      }
    }
    throw lastErr || new Error('Échec de la détection de doublon.');
  }

  // Shows a modal describing the existing recipe and asking what to do.
  // Resolves with one of: 'add' | 'cancel' | 'replace'.
  // `previewCtx` (optional): { ingredientsSpec, unitScales } enables click-to-preview on the card.
  function confirm(candidateName, matchedName, matchedRecipe, previewCtx) {
    return new Promise((resolve) => {
      document.querySelectorAll('.similar-recipe-backdrop, .similar-recipe-modal').forEach((n) => n.remove());

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop similar-recipe-backdrop';

      const modal = document.createElement('div');
      modal.className = 'modal similar-recipe-modal';

      const h = document.createElement('h2');
      h.className = 'similar-recipe-title';
      h.textContent = 'Une recette similaire existe déjà';
      modal.appendChild(h);

      const intro = document.createElement('p');
      intro.className = 'similar-recipe-intro';
      intro.textContent = `« ${candidateName} » ressemble à la recette existante suivante :`;
      modal.appendChild(intro);

      const card = document.createElement('div');
      card.className = 'similar-recipe-card';
      const canPreview = !!(previewCtx && window.Preview && typeof window.Preview.open === 'function');
      if (canPreview) {
        card.classList.add('similar-recipe-card--clickable');
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.title = 'Cliquer pour prévisualiser la recette';
        const openPreview = () => {
          const portions = Number(matchedRecipe && matchedRecipe.portions) > 0 ? Number(matchedRecipe.portions) : 1;
          window.Preview.open(matchedName, matchedRecipe, previewCtx.ingredientsSpec || {}, previewCtx.unitScales || {}, portions);
        };
        card.addEventListener('click', openPreview);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreview(); }
        });
      }

      const cardTitle = document.createElement('h3');
      cardTitle.className = 'similar-recipe-card-title';
      cardTitle.textContent = matchedName;
      card.appendChild(cardTitle);

      const ul = document.createElement('ul');
      ul.className = 'similar-recipe-ingredients';
      const ings = (matchedRecipe && matchedRecipe.ingredients) || {};
      const names = Object.keys(ings);
      if (names.length === 0) {
        const li = document.createElement('li');
        li.className = 'similar-recipe-empty';
        li.textContent = '(aucun ingrédient)';
        ul.appendChild(li);
      } else {
        for (const n of names) {
          const li = document.createElement('li');
          li.textContent = `${n} — ${ings[n]}`;
          ul.appendChild(li);
        }
      }
      card.appendChild(ul);
      modal.appendChild(card);

      const actions = document.createElement('div');
      actions.className = 'similar-recipe-actions';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-secondary';
      addBtn.textContent = 'Ajouter quand même';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary';
      cancelBtn.textContent = 'Annuler';

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'btn-primary';
      replaceBtn.textContent = "Remplacer l'existante";

      actions.appendChild(cancelBtn);
      actions.appendChild(addBtn);
      actions.appendChild(replaceBtn);
      modal.appendChild(actions);

      function close(result) {
        backdrop.remove();
        modal.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close('cancel');
      }

      backdrop.addEventListener('click', () => close('cancel'));
      cancelBtn.addEventListener('click', () => close('cancel'));
      addBtn.addEventListener('click', () => close('add'));
      replaceBtn.addEventListener('click', () => close('replace'));

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onKey);
    });
  }

  // Lightweight overlay used while the AI call is in flight. Reuses the
  // .scan-overlay styles already in styles.css for consistency.
  function showOverlay(label) {
    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = `<div class="scan-overlay__box"><div class="scan-spinner"></div><p>${label}</p></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  // Styled yes/no modal — used as a replacement for window.confirm when the
  // similarity check fails (network/AI down) and we need to ask the user
  // whether to save anyway. Resolves to true (confirm) or false (cancel).
  function attachCountdown(modal, seconds, { onExpire = null } = {}) {
    const total = Math.ceil(Number(seconds) || 0);
    if (!(total > 0)) return () => {};
    const line = document.createElement('p');
    line.className = 'similar-recipe-countdown';
    let remaining = total;
    const render = () => {
      line.textContent = `Réessaie dans ${remaining} s.`;
    };
    render();
    modal.appendChild(line);
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        render();
      } else {
        clearInterval(id);
        if (typeof onExpire === 'function') onExpire(line);
        else line.textContent = 'Tu peux réessayer.';
      }
    }, 1000);
    return () => clearInterval(id);
  }

  function ask(message, { confirmLabel = 'Oui', cancelLabel = 'Non', countdownSeconds = null, retryLabel = null } = {}) {
    return new Promise((resolve) => {
      document.querySelectorAll('.similar-recipe-backdrop, .similar-recipe-modal').forEach((n) => n.remove());

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop similar-recipe-backdrop';

      const modal = document.createElement('div');
      modal.className = 'modal similar-recipe-modal';

      const h = document.createElement('h2');
      h.className = 'similar-recipe-title';
      h.textContent = 'Votre serviteur AI est indisponible';
      modal.appendChild(h);

      const intro = document.createElement('p');
      intro.className = 'similar-recipe-intro';
      intro.textContent = message;
      modal.appendChild(intro);

      const actions = document.createElement('div');
      actions.className = 'similar-recipe-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary';
      cancelBtn.textContent = cancelLabel;

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn-primary';
      okBtn.textContent = confirmLabel;

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);

      const onExpire = retryLabel
        ? (line) => {
            line.remove();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-primary similar-recipe-retry';
            btn.textContent = retryLabel;
            btn.addEventListener('click', () => close('retry'));
            actions.insertBefore(btn, okBtn);
          }
        : null;
      const stopCountdown = attachCountdown(modal, countdownSeconds, { onExpire });

      modal.appendChild(actions);

      function close(result) {
        stopCountdown();
        backdrop.remove();
        modal.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') close('cancel');
      }

      backdrop.addEventListener('click', () => close('cancel'));
      cancelBtn.addEventListener('click', () => close('cancel'));
      okBtn.addEventListener('click', () => close('confirm'));

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onKey);
    });
  }

  // Single-button info modal — replacement for window.alert. Resolves when
  // the user closes it (button, Escape, or backdrop click).
  function notify(message, { title = 'Information', okLabel = 'OK', countdownSeconds = null, retryLabel = null } = {}) {
    return new Promise((resolve) => {
      document.querySelectorAll('.similar-recipe-backdrop, .similar-recipe-modal').forEach((n) => n.remove());

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop similar-recipe-backdrop';

      const modal = document.createElement('div');
      modal.className = 'modal similar-recipe-modal';

      const h = document.createElement('h2');
      h.className = 'similar-recipe-title';
      h.textContent = title;
      modal.appendChild(h);

      const intro = document.createElement('p');
      intro.className = 'similar-recipe-intro';
      intro.textContent = message;
      modal.appendChild(intro);

      const actions = document.createElement('div');
      actions.className = 'similar-recipe-actions';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn-primary';
      okBtn.textContent = okLabel;

      actions.appendChild(okBtn);

      const onExpire = retryLabel
        ? (line) => {
            line.remove();
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-primary similar-recipe-retry';
            btn.textContent = retryLabel;
            btn.addEventListener('click', () => close('retry'));
            actions.insertBefore(btn, okBtn);
          }
        : null;
      const stopCountdown = attachCountdown(modal, countdownSeconds, { onExpire });

      modal.appendChild(actions);

      function close(result) {
        stopCountdown();
        backdrop.remove();
        modal.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Enter') close();
      }

      backdrop.addEventListener('click', () => close());
      okBtn.addEventListener('click', () => close());

      document.body.appendChild(backdrop);
      document.body.appendChild(modal);
      document.addEventListener('keydown', onKey);
    });
  }

  window.Similar = { findMatch, confirm, ask, notify, showOverlay };
})();
