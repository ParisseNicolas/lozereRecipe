// Cloudflare Worker — recipe-similarity (Mistral La Plateforme).
// Deploy this code via the Cloudflare dashboard. The API key lives as a Worker
// Secret named MISTRAL_API_KEY (do NOT commit it).
//
// Request body : { candidate: { name, ingredients: [...names], steps: [...] },
//                  existing:  [ { name, ingredients: [...names], steps: [...] }, ... ] }
// Response : { match: "<existing recipe name>" | null }

// ministral-8b (Ministral 3, déc. 2025) est largement suffisant pour la compa
// sémantique. mistral-small sert de filet de secours si le 8b est rate-limité.
const MODELS = ['ministral-8b-2512', 'mistral-small-latest'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST') return cors(json({ error: 'POST only' }, 405));

    let body;
    try { body = await request.json(); }
    catch { return cors(json({ error: 'Invalid JSON' }, 400)); }

    const { candidate, existing } = body || {};
    if (!candidate || !candidate.name || !Array.isArray(existing)) {
      return cors(json({ error: 'candidate{name,ingredients,steps} et existing[] requis.' }, 400));
    }
    if (existing.length === 0) return cors(json({ match: null }));

    const prompt = buildPrompt(candidate, existing);

    let raw = null;
    let lastQuotaInfo = null;
    for (const model of MODELS) {
      const r = await callMistral(model, prompt, env.MISTRAL_API_KEY);
      if (r.ok) { raw = r.raw; break; }
      if (r.status === 429) { lastQuotaInfo = r; continue; }
      return cors(json({ error: `Mistral ${r.status}: ${r.raw.slice(0, 500)}` }, 502));
    }
    if (raw === null) {
      const retry = (lastQuotaInfo && lastQuotaInfo.retryAfter) || 60;
      return cors(json({
        error: 'Quota du serviteur dépassé.',
        retryAfterSeconds: retry,
      }, 429));
    }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return cors(json({ error: `Mistral réponse non-JSON : ${raw.slice(0, 500)}` }, 502)); }

    const text = parsed?.choices?.[0]?.message?.content || '';
    let result;
    try { result = JSON.parse(text); }
    catch { return cors(json({ error: `Réponse non-JSON : ${text.slice(0, 500)}` }, 502)); }

    // Coerce: only accept a string match that exists in the existing list.
    const names = new Set(existing.map((r) => r && r.name).filter(Boolean));
    let match = null;
    if (result && typeof result.match === 'string' && names.has(result.match)) {
      match = result.match;
    }

    return cors(json({ match }));
  },
};

async function callMistral(model, prompt, apiKey) {
  const url = 'https://api.mistral.ai/v1/chat/completions';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });
  const raw = await r.text();
  // Mistral renvoie un Retry-After (secondes) sur 429.
  const retryAfter = r.status === 429 ? Number(r.headers.get('Retry-After')) || null : null;
  return { status: r.status, ok: r.ok, raw, retryAfter };
}

function buildPrompt(candidate, existing) {
  const fmt = (r) => {
    const ings = (r.ingredients || []).join(', ');
    const steps = (r.steps || []).join(' | ');
    return `- "${r.name}"\n    ingrédients : ${ings}\n    étapes : ${steps}`;
  };
  return `Tu es un assistant qui compare des recettes de cuisine. Réponds UNIQUEMENT en JSON valide (pas de markdown, pas de texte autour).

Considère deux recettes comme similaires si la liste d'ingrédients principaux ET la technique de cuisson sont essentiellement les mêmes, même si les quantités, le nom ou des détails mineurs (sel, poivre, garniture) diffèrent. Une simple variation de garniture ou d'épices ne suffit PAS à les rendre différentes. À l'inverse, deux plats avec le même ingrédient principal mais une technique de cuisson radicalement différente (ex. carottes râpées vs. carottes rôties) ne sont PAS similaires.

Recette CANDIDATE (à comparer) :
- "${candidate.name}"
    ingrédients : ${(candidate.ingredients || []).join(', ')}
    étapes : ${(candidate.steps || []).join(' | ')}

Recettes EXISTANTES :
${existing.map(fmt).join('\n')}

Retourne le nom EXACT (tel qu'il apparaît ci-dessus) d'UNE SEULE recette existante qui ressemble à la candidate, ou null si aucune ne ressemble. Format JSON :
{ "match": "<nom exact d'une recette existante>" }
ou
{ "match": null }`;
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
