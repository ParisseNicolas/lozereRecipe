// Cloudflare Worker — recipe-scanner.
// Deploy this code via the Cloudflare dashboard. The Gemini API key lives as a
// Worker Secret named GEMINI_API_KEY (do NOT commit it).
//
// Request body : { imageBase64, mimeType, knownIngredients?: string[] }
// Response : { recipe: { name, ingredients: [...], steps: [...] } }
//
// For each scanned ingredient, the model first tries to map it to one of the
// names in knownIngredients (semantic match: "tomate cerise" → "cerise" if the
// catalog only has "cerise"). Only when no good match exists does it return
// `isNew: true` together with the metadata needed to create the ingredient
// programmatically client-side (no user input required).

const MODEL = 'gemini-2.5-flash-lite';

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
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
    if (!r.ok) {
      return cors(json({ error: `Gemini ${r.status}: ${raw.slice(0, 500)}` }, 502));
    }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return cors(json({ error: `Gemini réponse non-JSON : ${raw.slice(0, 500)}` }, 502)); }

    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let recipe;
    try { recipe = JSON.parse(text); }
    catch { return cors(json({ error: `Recette non-JSON : ${text.slice(0, 500)}` }, 502)); }

    return cors(json({ recipe }));
  },
};

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
