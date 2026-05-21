# v0.0.2 — Scan photo de recettes

Première version exploitant Gemini pour saisir une recette à partir d'une photo, avec garde-fous anti-doublon (Mistral) et tolérance aux quotas des deux fournisseurs.

## Nouveautés

- **Scan d'une recette par photo** (`recettes.html`) : prise de vue → extraction du nom, des ingrédients et des étapes par **Gemini 2.5 Flash**. Les ingrédients sont mappés sémantiquement au catalogue existant (« tomate cerise » → « cerise » si seul « cerise » est connu). Les ingrédients vraiment nouveaux passent par la modale de validation habituelle avant d'apparaître dans la recette.
- **Détection de quasi-doublons à l'enregistrement** d'une recette créée à la main ou scannée : un worker dédié interroge **Mistral** (`ministral-8b-2512`, fallback `mistral-small-latest`) ; en cas de similitude, une modale propose *Ajouter quand même / Annuler / Remplacer la recette existante*.
- **Portions du scan respectées** : l'éditeur reprend le nombre de personnes détecté sur la photo au lieu d'imposer 4.

## Fiabilité

- **Fallback de modèle Gemini** côté worker scan : 2.5 Flash, puis 2.5 Flash Lite si le premier sature.
- **Gestion fine des quotas Gemini (429)** :
  - quota journalier épuisé sur tous les modèles → *« Votre serviteur est en vacances aujourd'hui, revenez demain. »* (`worker.js:72`)
  - quota par minute → *« Votre serviteur est indisponible. Réessayez dans X s. »* avec le délai le plus court annoncé par Gemini.
- **Fallback de modèle Mistral** côté worker similarité, avec respect du `Retry-After` sur 429.
- **Retry avec backoff** côté client sur les 502/503/504 transitoires de Gemini (3 tentatives, 0 / 1.5 s / 4 s).
- **Sauvegarde tolérante** : si la recherche de doublons échoue (réseau / IA), l'utilisateur peut réessayer ou enregistrer quand même — plus de bypass silencieux.

## Sous le capot

- Nouveau module client `js/similar-recipe.js` + worker Cloudflare `worker-similarity.js` (Mistral).
- Logs de debug `[SCAN]` et `window.__lastScan` exposé pour rejouer une requête depuis la console.

## Périmètre

2 commits depuis `v0.0.1` : `a1256a3`, `744ab61`.
