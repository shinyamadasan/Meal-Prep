import { ValidationError } from '../errors.js';

// Deliberately small vocabulary: canonical ingredient units plus unambiguous metric scaling.
// Discrete/culinary units can match themselves but never convert to each other.
const METRIC_BASE_UNIT_SCALE = 1000;
const UNIT_DEFINITIONS = Object.freeze({
  g: { dimension: 'mass', scale: 1 },
  kg: { dimension: 'mass', scale: METRIC_BASE_UNIT_SCALE },
  ml: { dimension: 'volume', scale: 1 },
  L: { dimension: 'volume', scale: METRIC_BASE_UNIT_SCALE },
  pcs: { dimension: 'count' },
  pieces: { dimension: 'count' },
  can: { dimension: 'count' },
  pack: { dimension: 'count' },
  bunches: { dimension: 'count' },
  cloves: { dimension: 'count' },
  stalks: { dimension: 'count' },
  tbsp: { dimension: 'culinary-volume' },
  tsp: { dimension: 'culinary-volume' }
});

export function convertQuantity(quantity, fromUnit, toUnit) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0.', { field: 'quantity' });
  }
  if (typeof fromUnit !== 'string' || !fromUnit.trim() || typeof toUnit !== 'string' || !toUnit.trim()) {
    throw new ValidationError('expectedUnit and stored unit must be non-blank strings.', { field: 'expectedUnit' });
  }

  const from = Object.hasOwn(UNIT_DEFINITIONS, fromUnit) ? UNIT_DEFINITIONS[fromUnit] : null;
  const to = Object.hasOwn(UNIT_DEFINITIONS, toUnit) ? UNIT_DEFINITIONS[toUnit] : null;
  if (!from || !to) {
    throw new ValidationError('unsupported_unit: only known canonical inventory units are supported.', { field: 'expectedUnit' });
  }
  if (fromUnit === toUnit) return quantity;

  const exactMetricPair = (fromUnit === 'g' && toUnit === 'kg') ||
    (fromUnit === 'kg' && toUnit === 'g') ||
    (fromUnit === 'ml' && toUnit === 'L') ||
    (fromUnit === 'L' && toUnit === 'ml');
  if (!exactMetricPair || from.dimension !== to.dimension) {
    throw new ValidationError('unit_mismatch: only identical units or exact g/kg and ml/L scaling are supported.', { field: 'expectedUnit' });
  }

  const converted = quantity * from.scale / to.scale;
  if (!Number.isFinite(converted) || converted <= 0) {
    throw new ValidationError('The requested quantity is outside the supported unit range.', { field: 'quantity' });
  }
  return converted;
}
