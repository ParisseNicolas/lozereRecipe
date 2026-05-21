// Cloudflare Worker — recipe-scanner.
// Deploy this code via le dashboard Cloudflare. Secret requis : GEMINI_API_KEY.
//
// Deux modèles, par ordre de préférence : Gemini 2.5 Flash (meilleur),
// puis Gemini 2.5 Flash Lite en fallback. On appelle directement Gemini ;
// quand il renvoie 429, le corps d'erreur contient :
//   - quotaId : GenerateRequestsPerDayPerProjectPerModel-FreeTier (RPD)
//               GenerateRequestsPerMinutePerProjectPerModel-FreeTier (RPM)
//   - quotaValue : la limite atteinte
//   - retryDelay : le temps à attendre, format "XXs"
// On classe le 429 en "rpd" ou "rpm" selon le quotaId, on bascule sur le
// modèle suivant, et si tous les modèles sont KO on choisit le message :
//   - "vacances"    → tous les modèles en RPD.
//   - "indisponible" → au moins un modèle en RPM (on prend le retryDelay min).
//
// Request body : { imageBase64, mimeType, knownIngredients?: string[], knownTypes?: string[] }
// Response succès : { recipe, model, quota: { headers, quotaId?, ... } }
// Response 429    : { error, quota: { retryAfterSeconds, attempts: [...] } }

const MODELS = [
  { id: 'gemini-2.5-flash' },
  { id: 'gemini-2.5-flash-lite' },
];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST') return cors(json({ error: 'POST only' }, 405));

    let body;
    try { body = await request.json(); }
    catch { return cors(json({ error: 'Invalid JSON' }, 400)); }

    const { imageBase64, mimeType, knownIngredients, knownTypes } = body || {};
    if (!imageBase64 || !mimeType) return cors(json({ error: 'imageBase64 et mimeType requis.' }, 400));

    const known = Array.isArray(knownIngredients) ? knownIngredients.filter(Boolean) : [];
    const types = Array.isArray(knownTypes) ? knownTypes.filter(Boolean) : [];
    const prompt = buildPrompt(known, types);

    const attempts = [];

    for (const model of MODELS) {
      const result = await callGemini(env, model.id, prompt, mimeType, imageBase64);

      if (result.ok) {
        return cors(json({
          recipe: result.recipe,
          model: model.id,
          quota: { headers: result.headers },
        }));
      }

      if (result.status === 429) {
        // On garde la trace pour décider du message global si tous les modèles tombent.
        attempts.push({ model: model.id, kind: result.kind, retryAfterSeconds: result.retryAfterSeconds, quotaId: result.quotaId });
        continue; // tentative du modèle suivant
      }

      // Erreur non-429 → on remonte tel quel, pas la peine d'essayer les autres modèles.
      return cors(json({
        error: result.error,
        model: model.id,
        quota: { headers: result.headers },
      }, result.status || 502));
    }

    // Tous les modèles ont renvoyé 429.
    const allRpd = attempts.every((a) => a.kind === 'rpd');
    if (allRpd) {
      return cors(json({
        error: 'Votre serviteur est en vacances aujourd\'hui, revenez demain.',
        quota: { retryAfterSeconds: secondsUntilUtcMidnight(), attempts },
      }, 429));
    }

    // Sinon (au moins un RPM) → on attend selon le plus court retryDelay annoncé
    // parmi les attempts RPM uniquement. Les retryDelay des attempts RPD sont
    // trompeurs (Gemini renvoie un petit délai alors qu'il faut attendre minuit UTC).
    const rpmDelays = attempts.filter((a) => a.kind === 'rpm').map((a) => a.retryAfterSeconds || 60);
    const retryAfter = Math.max(1, Math.min(...rpmDelays));
    return cors(json({
      error: `Votre serviteur est indisponible. Réessayez dans ${retryAfter} s.`,
      quota: { retryAfterSeconds: retryAfter, attempts },
    }, 429));
  },
};

async function callGemini(env, modelId, prompt, mimeType, imageBase64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${env.GEMINI_API_KEY}`;
  const payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const raw = await r.text();
  const headers = extractQuotaHeaders(r.headers);

  if (r.status === 429) {
    const info = parseQuotaError(raw);
    return {
      ok: false,
      status: 429,
      kind: classifyQuota(info.quotaId),
      retryAfterSeconds: info.retryAfterSeconds || null,
      quotaId: info.quotaId || null,
      quotaValue: info.quotaValue || null,
      headers,
    };
  }

  if (!r.ok) {
    return { ok: false, status: r.status, error: `Gemini ${r.status}: ${raw.slice(0, 500)}`, headers };
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { ok: false, status: 502, error: `Gemini réponse non-JSON : ${raw.slice(0, 500)}`, headers }; }

  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let recipe;
  try { recipe = JSON.parse(text); }
  catch { return { ok: false, status: 502, error: `Recette non-JSON : ${text.slice(0, 500)}`, headers }; }

  return { ok: true, recipe, headers };
}

// Distingue un 429 "RPD" (quota journalier épuisé) d'un 429 "RPM" (quota minute).
// quotaId attendu :
//   - GenerateRequestsPerDayPerProjectPerModel-FreeTier         → 'rpd'
//   - GenerateRequestsPerMinutePerProjectPerModel-FreeTier      → 'rpm'
// Fallback prudent : si le libellé ne matche pas, on considère 'rpm' (plus court).
function classifyQuota(quotaId) {
  const id = String(quotaId || '').toLowerCase();
  if (id.includes('perday')) return 'rpd';
  if (id.includes('perminute')) return 'rpm';
  return 'rpm';
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

// Capture les headers utiles pour le quota / rate-limit. Google n'expose quasi
// rien sur succès — on ramasse tout ce qui est x-goog-*, retry-after, etc.,
// pour pouvoir inspecter ce qui est réellement disponible côté client.
function extractQuotaHeaders(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) {
    const key = k.toLowerCase();
    if (
      key.startsWith('x-goog-') ||
      key.startsWith('x-ratelimit') ||
      key === 'retry-after' ||
      key === 'x-request-id'
    ) {
      out[key] = v;
    }
  }
  return out;
}

// Parse le corps d'erreur 429 de Google pour quotaMetric/quotaValue/retryDelay.
// Format type : { error: { details: [ { '@type': '.../QuotaFailure',
//   violations: [{ quotaMetric, quotaId, quotaValue }] },
//   { '@type': '.../RetryInfo', retryDelay: '27s' } ] } }
function parseQuotaError(raw) {
  const out = {};
  try {
    const body = JSON.parse(raw);
    const details = body?.error?.details || [];
    for (const d of details) {
      const type = d['@type'] || '';
      if (type.includes('QuotaFailure')) {
        const v = (d.violations || [])[0];
        if (v) {
          out.quotaMetric = v.quotaMetric;
          out.quotaId = v.quotaId;
          out.quotaValue = v.quotaValue;
        }
      } else if (type.includes('RetryInfo') && d.retryDelay) {
        const m = String(d.retryDelay).match(/^(\d+(?:\.\d+)?)s$/);
        if (m) out.retryAfterSeconds = Number(m[1]);
      }
    }
  } catch { /* ignore */ }
  return out;
}

function buildPrompt(known, types) {
  const knownList = known.length
    ? `Voici la liste des ingrédients déjà connus dans le catalogue (utilise-les en priorité, en faisant un mapping sémantique si possible — par ex. "tomate cerise" → "cerise" si "cerise" est dans la liste, "blanc de poulet" → "poulet" si "poulet" est dans la liste) :\n${known.map((n) => `- ${n}`).join('\n')}\n`
    : '';

  const typesList = (types && types.length)
    ? `Voici la liste des catégories/rayons existants (utilise-les EN PRIORITÉ pour le champ "type" des ingrédients nouveaux, en faisant un mapping sémantique — par ex. si l'ingrédient est une herbe et que "Fruits et légumes" existe, utilise "Fruits et légumes"). Si AUCUNE catégorie existante ne convient, tu peux en proposer une nouvelle :\n${types.map((t) => `- ${t}`).join('\n')}\n`
    : '';

  return `Tu es un assistant qui extrait une recette de cuisine depuis une photo. Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de texte autour).

${knownList}${typesList}
Pour chaque ingrédient détecté :
1. Essaie d'abord de le faire correspondre à un nom du catalogue ci-dessus (mapping sémantique permissif). Si tu trouves une correspondance, utilise EXACTEMENT le nom du catalogue et n'ajoute PAS de champ "isNew".
2. Si aucune correspondance raisonnable n'existe, marque-le comme nouveau avec "isNew": true et fournis TOUS les champs nécessaires pour le créer (voir ci-dessous).

Format JSON attendu :
{
  "name": "Nom de la recette",
  "ingredients": [
    { "name": "<nom du catalogue ou nouveau nom>", "quantity": <nombre pour 1 personne>, "unit": "<unité>" },
    { "name": "huile d'olive", "quantity": 10, "unit": "ml", "isNew": true, "type": "<catégorie>", "preferred": "ml", "purchase": "L", "convertFactor": 1000 },
    { "name": "carotte", "quantity": 1, "unit": "u", "isNew": true, "type": "<catégorie>", "preferred": "u", "purchase": "u", "metricFactor": 80, "metricUnit": "g" },
    { "name": "poivre", "quantity": 1, "unit": "pincée", "isNew": true, "type": "<catégorie>", "preferred": "pincée", "purchase": "g", "convertFactor": 3.33 }
  ],
  "steps": ["Étape 1...", "Étape 2...", "--- cuisson ---", "Étape de cuisson 1...", "Étape de cuisson 2..."]
}

Règles importantes :
- Quantités : RAMÈNE TOUTES LES QUANTITÉS À 1 PERSONNE (divise par le nombre de personnes indiqué dans la recette).
- Unités : utilise des unités standards en français.
  * Unités CÔTÉ RECETTE (preferred / unit) : g, kg, ml, cl, L, cs (cuillère à soupe), cc (cuillère à café), u (unité/pièce), pincée, gousse, sachet, botte, tranche, feuille, brin.
  * Unités CÔTÉ ACHAT (purchase) : kg, g, L, ml, u, sachet, botte, bouteille, boîte, pot. JAMAIS pincée, cc, cs, gousse, brin, feuille, tranche (ce sont des unités de recette, pas d'achat).
- Étapes : sépare les étapes de découpe/préparation des étapes de cuisson par une ligne "--- cuisson ---" si pertinent.
- Pour les ingrédients nouveaux ("isNew": true), fournis :
  * "type" : catégorie/rayon. Utilise EN PRIORITÉ une catégorie de la liste fournie ci-dessus (mapping sémantique permissif — par ex. une herbe ou une épice se range dans la catégorie existante la plus proche, même si le nom ne correspond pas exactement). Ne propose une nouvelle catégorie QUE si aucune de la liste ne peut raisonnablement convenir.
  * "preferred" : unité utilisée DANS LA RECETTE (ex: pincée pour le poivre, ml pour l'huile, g pour la farine, u pour un œuf).
  * "purchase" : unité D'ACHAT typique en magasin (ex: g ou sachet pour le poivre, L pour l'huile, kg pour la farine, u pour les œufs). NE JAMAIS utiliser pincée/cc/cs/gousse/brin/feuille/tranche en purchase.
  * Exemples corrects : poivre → preferred="pincée", purchase="g" (avec convertFactor=3.33, car 1 g ≈ 3.33 pincées) ; sel → preferred="g", purchase="kg" ; ail → preferred="gousse", purchase="u" (avec metricFactor=5, metricUnit="g") ; persil → preferred="brin", purchase="botte" (avec convertFactor=30) ; basilic → preferred="feuille", purchase="botte" (avec convertFactor=40).
  * "convertFactor" : utilise-le DÈS QUE preferred ≠ purchase ET que la conversion n'est pas automatique (g↔kg, ml↔cl↔L sont auto). Donne le facteur tel que 1 purchase = X preferred (ex: 1 g = 3.33 pincées → convertFactor: 3.33 ; 1 sachet = 250 g → convertFactor: 250 ; 1 botte de persil = 30 brins → convertFactor: 30). Peu importe que purchase soit métrique ou non — si pref est une unité non-standard (pincée, brin, feuille, gousse, etc.) et purchase est différent, c'est convertFactor qu'il faut.
  * "metricFactor" + "metricUnit" : utilise-les UNIQUEMENT si NI preferred NI purchase n'est métrique (g, kg, mg, ml, cl, L) NI une pièce (u). Donne combien pèse ou fait 1 preferred en g ou ml (ex: 1 gousse d'ail ≈ 5 g → metricFactor: 5, metricUnit: "g" avec preferred="gousse" et purchase="u"). Si purchase est déjà métrique, utilise convertFactor à la place.
- Pour les ingrédients connus (pas de "isNew"), n'ajoute PAS les champs type/preferred/purchase/etc.

Réponds maintenant uniquement avec le JSON de la recette extraite de l'image.`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
