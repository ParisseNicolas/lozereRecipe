// yaml-validator.js
// Validate a raw YAML string against RepasSchema.
//
// Output : {
//   data: <parsed object|null>,
//   issues: [{ severity: 'error'|'warning', line: <1-based|null>, path: 'recipes.taboulé.ingredients', message, suggestion }],
//   parseError: <YAMLException|null>,
// }
//
// Errors block import. Warnings do not.

(function () {
  // Try to parse YAML. On syntax error, return the YAMLException with mark info.
  function tryParse(text) {
    try {
      return { data: jsyaml.load(text), error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  // Best-effort line lookup : find the first line where a key appears at any
  // indentation. Used for semantic errors when js-yaml doesn't give us a line.
  function findLine(rawText, key) {
    if (!rawText || !key) return null;
    const lines = rawText.split(/\r?\n/);
    // Escape regex special chars in the key
    const safe = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^\\s*' + safe + '\\s*:', '');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) return i + 1;
    }
    return null;
  }

  // Find a line for a nested key under a parent (e.g. an ingredient name inside
  // a specific recipe). Falls back to the parent's line.
  function findNestedLine(rawText, parentKey, childKey) {
    if (!rawText) return null;
    const parentLine = findLine(rawText, parentKey);
    if (parentLine == null) return findLine(rawText, childKey);
    const lines = rawText.split(/\r?\n/);
    const safe = String(childKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^\\s*' + safe + '\\s*:', '');
    for (let i = parentLine; i < lines.length; i++) {
      if (re.test(lines[i])) return i + 1;
    }
    return parentLine;
  }

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  // Validate a single item against an `item` rule { required, optional, types }.
  function validateItem(item, rule, path, rawText, anchorKey, issues) {
    if (!isPlainObject(item)) {
      issues.push({
        severity: 'error',
        line: findLine(rawText, anchorKey),
        path,
        message: `« ${path} » devrait être un objet (clé: valeur).`,
        suggestion: `Vérifie l'indentation et qu'il y a bien des sous-champs.`,
      });
      return;
    }

    for (const req of rule.required || []) {
      if (!(req in item)) {
        issues.push({
          severity: 'error',
          line: findLine(rawText, anchorKey),
          path: `${path}.${req}`,
          message: `Champ requis manquant : « ${req} » dans ${path}.`,
          suggestion: `Ajoute « ${req}: <valeur> » sous ${path}.`,
        });
      }
    }

    const known = new Set([...(rule.required || []), ...(rule.optional || [])]);
    for (const key of Object.keys(item)) {
      if (!known.has(key)) {
        issues.push({
          severity: 'warning',
          line: findNestedLine(rawText, anchorKey, key),
          path: `${path}.${key}`,
          message: `Champ inconnu « ${key} » dans ${path}.`,
          suggestion: `Si c'est volontaire, ignore. Sinon vérifie la frappe.`,
        });
      }
    }

    for (const [field, expected] of Object.entries(rule.types || {})) {
      if (!(field in item)) continue;
      const actual = typeOf(item[field]);
      if (expected === 'object' && !isPlainObject(item[field])) {
        issues.push({
          severity: 'error',
          line: findNestedLine(rawText, anchorKey, field),
          path: `${path}.${field}`,
          message: `« ${field} » devrait être un objet, trouvé : ${actual}.`,
          suggestion: `Utilise « ${field}: » suivi de sous-champs indentés.`,
        });
      } else if (expected === 'array' && actual !== 'array') {
        issues.push({
          severity: 'error',
          line: findNestedLine(rawText, anchorKey, field),
          path: `${path}.${field}`,
          message: `« ${field} » devrait être une liste, trouvé : ${actual}.`,
          suggestion: `Utilise des tirets « - élément » sous ${field}.`,
        });
      } else if (expected === 'string' && actual !== 'string' && actual !== 'number') {
        issues.push({
          severity: 'warning',
          line: findNestedLine(rawText, anchorKey, field),
          path: `${path}.${field}`,
          message: `« ${field} » devrait être une chaîne, trouvé : ${actual}.`,
          suggestion: `Mets la valeur entre guillemets si besoin.`,
        });
      } else if (expected === 'number' && actual !== 'number') {
        issues.push({
          severity: 'warning',
          line: findNestedLine(rawText, anchorKey, field),
          path: `${path}.${field}`,
          message: `« ${field} » devrait être un nombre, trouvé : ${actual}.`,
          suggestion: `Retire les guillemets autour de la valeur.`,
        });
      }
    }
  }

  // Top-level validation : presence of required sections, types, and items.
  function validateStructure(data, rawText, schema, issues) {
    if (!isPlainObject(data)) {
      issues.push({
        severity: 'error',
        line: 1,
        path: '<root>',
        message: 'Le document YAML doit être un objet à la racine.',
        suggestion: 'Vérifie que le fichier commence par des clés (recipes:, meals:, ...).',
      });
      return;
    }

    for (const req of schema.topLevel.required) {
      if (!(req in data)) {
        issues.push({
          severity: 'error',
          line: null,
          path: req,
          message: `Section requise manquante : « ${req} ».`,
          suggestion: `Ajoute une section « ${req}: » à la racine du fichier.`,
        });
      }
    }

    const knownTop = new Set([...schema.topLevel.required, ...schema.topLevel.optional]);
    for (const k of Object.keys(data)) {
      if (!knownTop.has(k)) {
        issues.push({
          severity: 'warning',
          line: findLine(rawText, k),
          path: k,
          message: `Section inconnue à la racine : « ${k} ».`,
          suggestion: `Si c'est volontaire, ignore. Sinon retire ou renomme.`,
        });
      }
    }

    // Per-section walk
    for (const [section, rule] of Object.entries(schema)) {
      if (section === 'topLevel') continue;
      if (!(section in data)) continue;
      const value = data[section];

      if (rule.type === 'map') {
        if (!isPlainObject(value)) {
          issues.push({
            severity: 'error',
            line: findLine(rawText, section),
            path: section,
            message: `« ${section} » doit être un objet (clé: valeur).`,
            suggestion: `Vérifie l'indentation.`,
          });
          continue;
        }
        for (const [name, item] of Object.entries(value)) {
          validateItem(item, rule.item, `${section}.${name}`, rawText, name, issues);
        }
      } else if (rule.type === 'list') {
        if (!Array.isArray(value)) {
          issues.push({
            severity: 'error',
            line: findLine(rawText, section),
            path: section,
            message: `« ${section} » doit être une liste.`,
            suggestion: `Utilise des tirets « - » pour chaque entrée.`,
          });
          continue;
        }
        value.forEach((item, idx) => {
          const anchor = isPlainObject(item) && item.name ? item.name : section;
          validateItem(item, rule.item, `${section}[${idx}]`, rawText, anchor, issues);
        });
      }
    }
  }

  // Cross-reference validation : ingredient refs in recipes, recipe refs in
  // meals, units used vs known unitScales / ingredient convert maps.
  function validateReferences(data, rawText, issues) {
    if (!isPlainObject(data)) return;

    const ingredientNames = new Set(Object.keys(data.ingredients || {}));
    const recipeNames = new Set(Object.keys(data.recipes || {}));
    const knownUnits = new Set(Object.keys(data.unitScales || {}));
    // Also accept countable units the parser already knows about
    ['u', 'gousse', 'feuille', 'cs', 'cc', 'petit peu'].forEach((u) => knownUnits.add(u));

    // Recipes -> ingredients
    for (const [rname, recipe] of Object.entries(data.recipes || {})) {
      if (!isPlainObject(recipe) || !isPlainObject(recipe.ingredients)) continue;
      for (const [ingName, qty] of Object.entries(recipe.ingredients)) {
        if (!ingredientNames.has(ingName)) {
          issues.push({
            severity: 'error',
            line: findNestedLine(rawText, rname, ingName),
            path: `recipes.${rname}.ingredients.${ingName}`,
            message: `Ingrédient inconnu « ${ingName} » dans la recette « ${rname} ».`,
            suggestion: `Ajoute « ${ingName}: ` + `\n    type: ... » dans la section ingredients, ou corrige le nom.`,
          });
          continue;
        }
        // Check the unit used
        const parsed = parseQty(qty);
        if (parsed.unit && parsed.unit !== 'u') {
          const ing = data.ingredients[ingName];
          const ingUnits = collectIngredientUnits(ing);
          if (!knownUnits.has(parsed.unit) && !ingUnits.has(parsed.unit)) {
            issues.push({
              severity: 'warning',
              line: findNestedLine(rawText, rname, ingName),
              path: `recipes.${rname}.ingredients.${ingName}`,
              message: `Unité « ${parsed.unit} » non déclarée pour « ${ingName} ».`,
              suggestion: `Ajoute la conversion dans ingredients.${ingName}.convert ou utilise une unité connue (${[...knownUnits].slice(0, 6).join(', ')}…).`,
            });
          }
        }
      }
    }

    // Meals -> recipes
    if (Array.isArray(data.meals)) {
      data.meals.forEach((meal, idx) => {
        if (!isPlainObject(meal)) return;
        if (!Array.isArray(meal.recipes)) return;
        for (const rname of meal.recipes) {
          if (!recipeNames.has(rname)) {
            issues.push({
              severity: 'error',
              line: findNestedLine(rawText, meal.name || `meals[${idx}]`, rname) || findLine(rawText, meal.name),
              path: `meals[${idx}].recipes`,
              message: `Recette inconnue « ${rname} » dans le repas « ${meal.name || idx} ».`,
              suggestion: `Ajoute la recette dans la section recipes, ou corrige le nom.`,
            });
          }
        }
      });
    }

    // ingredientPresets referenced by ingredients (optional, soft check)
    const presetNames = new Set(Object.keys(data.ingredientPresets || {}));
    for (const [iname, ing] of Object.entries(data.ingredients || {})) {
      if (!isPlainObject(ing)) continue;
      if (ing.preset && !presetNames.has(ing.preset)) {
        issues.push({
          severity: 'warning',
          line: findNestedLine(rawText, iname, 'preset'),
          path: `ingredients.${iname}.preset`,
          message: `Preset inconnu « ${ing.preset} » dans ${iname}.`,
          suggestion: `Vérifie l'orthographe ou ajoute-le dans ingredientPresets.`,
        });
      }
    }
  }

  function parseQty(value) {
    if (window.Parser && Parser.parseQuantity) return Parser.parseQuantity(value);
    return { amount: 0, unit: 'u' };
  }

  function collectIngredientUnits(ing) {
    const out = new Set();
    if (!isPlainObject(ing)) return out;
    if (ing.preferred) out.add(String(ing.preferred));
    if (ing.purchase) out.add(String(ing.purchase));
    if (isPlainObject(ing.convert)) {
      for (const [base, sub] of Object.entries(ing.convert)) {
        out.add(base);
        if (isPlainObject(sub)) Object.keys(sub).forEach((u) => out.add(u));
      }
    }
    return out;
  }

  // Public entry point
  function validate(rawText, schema) {
    const issues = [];
    const { data, error } = tryParse(rawText);

    if (error) {
      const line = error.mark && typeof error.mark.line === 'number' ? error.mark.line + 1 : null;
      issues.push({
        severity: 'error',
        line,
        path: '<syntax>',
        message: 'Erreur de syntaxe YAML : ' + (error.reason || error.message),
        suggestion: error.mark && error.mark.snippet ? 'Contexte :\n' + error.mark.snippet : 'Vérifie l\'indentation et les caractères spéciaux.',
      });
      return { data: null, issues, parseError: error };
    }

    validateStructure(data, rawText, schema || window.RepasSchema, issues);
    validateReferences(data, rawText, issues);

    return { data, issues, parseError: null };
  }

  function hasErrors(issues) {
    return issues.some((i) => i.severity === 'error');
  }

  window.YamlValidator = { validate, hasErrors };
})();
