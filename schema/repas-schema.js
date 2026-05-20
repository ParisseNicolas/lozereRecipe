// repas-schema.js
// Declarative description of the repas.yml shape.
// Consumed by js/yaml-validator.js. Tolerant to unknown fields (warning, not error).
//
// A "rule" attached to a section can be either a function (custom check) or a
// shape descriptor : { required: [...], optional: [...], type: 'map'|'list',
// children: <rule> }. The validator walks the tree and calls custom checks at
// the right level.

const REPAS_SCHEMA = {
  topLevel: {
    required: ['recipes', 'meals', 'ingredients'],
    optional: ['unitScales', 'ingredientPresets'],
  },

  // Each section is described independently. The validator dispatches on key.
  unitScales: {
    type: 'map',          // unit name -> { upper, factor }
    item: {
      required: ['upper', 'factor'],
      optional: [],
      types: { upper: 'string', factor: 'number' },
    },
  },

  ingredientPresets: {
    type: 'map',
    item: {
      required: ['convert'],
      optional: ['desc'],
      types: { desc: 'string', convert: 'object' },
    },
  },

  recipes: {
    type: 'map',
    item: {
      required: ['ingredients'],
      optional: ['steps', 'portions', 'notes'],
      types: { ingredients: 'object', steps: 'array', portions: 'number', notes: 'string' },
    },
  },

  meals: {
    type: 'list',
    item: {
      required: ['name'],
      optional: ['portions', 'recipes'],
      types: { name: 'string', portions: 'number', recipes: 'array' },
    },
  },

  ingredients: {
    type: 'map',
    item: {
      required: ['type'],
      optional: ['preferred', 'purchase', 'convert', 'preset', 'aisle', 'notes'],
      types: { type: 'string', preferred: 'string', purchase: 'string', convert: 'object', preset: 'string', aisle: 'string', notes: 'string' },
    },
  },
};

window.RepasSchema = REPAS_SCHEMA;
