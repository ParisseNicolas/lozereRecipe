// scan-recipe.js
// Take a photo (camera on mobile, file picker on desktop) of a recipe and
// extract a structured recipe via the Cloudflare Worker that calls Gemini.
// The resulting recipe is stashed in sessionStorage and consumed by edit.js
// when navigating to editer-recette.html?scan=1.

const WORKER_URL = 'https://recipe-scanner.nicolas-parisse-93.workers.dev/';
const DRAFT_KEY = 'recipe:scan-draft';
const MAX_EDGE = 1600; // resize before upload to keep payloads small.
const JPEG_QUALITY = 0.85;

function attachButton(btn) {
  if (!btn) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.style.display = 'none';
  document.body.appendChild(input);

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    await runScan(file);
  });
}

async function runScan(file) {
  const overlay = showOverlay('Analyse de la recette en cours…');
  try {
    const { base64, mimeType } = await fileToCompressedBase64(file);
    const { knownIngredients, knownTypes } = await loadKnownData();
    const body = JSON.stringify({ imageBase64: base64, mimeType, knownIngredients, knownTypes });

    // === SCAN DEBUG LOGS ===
    console.log('[SCAN] worker URL:', WORKER_URL);
    console.log('[SCAN] mimeType:', mimeType);
    console.log('[SCAN] base64 length:', base64.length, '(≈', Math.round(base64.length * 0.75 / 1024), 'KB image)');
    console.log('[SCAN] body size (chars):', body.length);
    console.log('[SCAN] knownIngredients (' + knownIngredients.length + ') :', knownIngredients);
    console.log('[SCAN] knownTypes (' + knownTypes.length + ') :', knownTypes);
    console.log('[SCAN] dataUrl (copie-colle pour rejouer la requête) :');
    console.log('data:' + mimeType + ';base64,' + base64);
    console.log('[SCAN] base64 (sans header) :');
    console.log(base64);
    window.__lastScan = { base64, mimeType, knownIngredients, knownTypes, body };
    console.log('[SCAN] window.__lastScan posé (accès direct dans la console)');
    // === FIN LOGS ===

    // Gemini renvoie ponctuellement 502/503/504 sous charge. Retry avec backoff.
    // 429 est géré côté worker (fallback de modèle) → on ne retry pas ici.
    const delays = [0, 1500, 4000];
    let json = null;
    let lastErr = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        console.log('[SCAN] tentative', i + 1, '/', delays.length);
        const tStart = Date.now();
        const res = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const ms = Date.now() - tStart;
        const data = await res.json().catch(() => ({}));
        console.log('[SCAN] réponse status =', res.status, '(', ms, 'ms )');
        console.log('[SCAN] réponse JSON :', data);
        if (res.ok) {
          console.log('[SCAN] recipe extraite :', JSON.stringify(data && data.recipe, null, 2));
          if (data && data.quota) {
            const q = data.quota;
            if (q.used && q.limit) {
              console.log(`[SCAN] usage ${q.used.rpm}/${q.limit.rpm} RPM, ${q.used.rpd}/${q.limit.rpd} RPD`);
            }
            console.log('[SCAN] quota Gemini (headers) :', q.headers);
            window.__lastScanQuota = q;
          }
          json = data;
          lastErr = null;
          break;
        }
        if (res.status === 429) {
          const quota = (data && data.quota) || {};
          const secs = Number(quota.retryAfterSeconds) || Number(data.retryAfterSeconds) || 60;
          console.warn('[SCAN] quota dépassé', quota.quotaMetric || '', '— retry dans', secs, 's');
          window.__lastScanQuota = quota;
          const err = new Error(data.error || 'Quota du serviteur dépassé.');
          err.retryAfterSeconds = secs;
          err.noRetry = true;
          throw err;
        }
        const transient = res.status === 502 || res.status === 503 || res.status === 504;
        console.warn('[SCAN] erreur', res.status, 'transient =', transient, 'payload =', data);
        lastErr = new Error(data.error || `Erreur ${res.status}`);
        if (!transient) { lastErr.noRetry = true; throw lastErr; }
      } catch (e) {
        console.warn('[SCAN] catch tentative', i + 1, ':', e);
        lastErr = e;
        if (e && e.noRetry) break;
      }
    }
    if (lastErr) {
      console.error('[SCAN] échec final :', lastErr);
      throw lastErr;
    }

    const recipe = json && json.recipe;
    if (!recipe || !Array.isArray(recipe.ingredients)) {
      throw new Error('Réponse invalide du service de scan.');
    }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(recipe));
    window.location.href = 'editer-recette.html?from=recettes&scan=1';
  } catch (err) {
    overlay.remove();
    const msg = 'Impossible de scanner la recette : ' + (err.message || err);
    const countdownSeconds = Number(err && err.retryAfterSeconds) || null;
    if (window.Similar && typeof Similar.notify === 'function') {
      const result = await Similar.notify(msg, { title: 'Scan impossible', countdownSeconds, retryLabel: countdownSeconds ? 'Réessayer' : null });
      if (result === 'retry') {
        await runScan(file);
      }
    } else {
      alert(msg);
    }
  }
}

async function loadKnownData() {
  try {
    if (window.App && typeof App.loadData === 'function') {
      const data = await App.loadData();
      const ingredients = Object.keys((data && data.ingredients) || {}).sort((a, b) => a.localeCompare(b, 'fr'));
      const typeSet = new Set();
      for (const spec of Object.values((data && data.ingredients) || {})) {
        if (spec && spec.type) typeSet.add(spec.type);
      }
      const types = Array.from(typeSet).sort((a, b) => a.localeCompare(b, 'fr'));
      return { knownIngredients: ingredients, knownTypes: types };
    }
  } catch (e) {
    console.warn('loadKnownData failed', e);
  }
  return { knownIngredients: [], knownTypes: [] };
}

function fileToCompressedBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const { width, height } = fitInto(img.width, img.height, MAX_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        URL.revokeObjectURL(url);
        resolve({ base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' });
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    img.src = url;
  });
}

function fitInto(w, h, maxEdge) {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const r = maxEdge / longest;
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

function showOverlay(label) {
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `<div class="scan-overlay__box"><div class="scan-spinner"></div><p>${label}</p></div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function consumeDraft() {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  try { return JSON.parse(raw); }
  catch { return null; }
}

window.Scan = { attachButton, consumeDraft };
