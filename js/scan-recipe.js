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
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType, knownIngredients, knownTypes }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || `Erreur ${res.status}`);
    }
    const recipe = json.recipe;
    if (!recipe || !Array.isArray(recipe.ingredients)) {
      throw new Error('Réponse invalide du service de scan.');
    }
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(recipe));
    window.location.href = 'editer-recette.html?from=recettes&scan=1';
  } catch (err) {
    overlay.remove();
    alert('Impossible de scanner la recette : ' + (err.message || err));
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
