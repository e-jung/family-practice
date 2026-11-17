// Pure settings policy; platform edges decide how to report invalid input.
export const schema = {
  voice: {
    globalDaily: 'positiveInteger', familyDaily: 'positiveInteger',
    ipHourly: 'positiveInteger', request: 'positiveInteger',
  },
  mailDaily: 'positiveInteger',
  notifications: { weekly: { day: 'day', hour: 'hour' }, review: { days: 'days', hour: 'hour' } },
  reviewBatch: 'positiveInteger',
};
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const defaults = freeze({
  "voice": {
    "globalDaily": 6000,
    "familyDaily": 4000,
    "ipHourly": 4000,
    "request": 300
  },
  "mailDaily": 500,
  "notifications": {
    "weekly": {
      "day": 0,
      "hour": 17
    },
    "review": {
      "days": [
        2,
        5
      ],
      "hour": 17
    }
  },
  "reviewBatch": 15
});
export function validate(value) {
  const errors = [];
  function visit(value, shape, path) {
    if (typeof shape === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: expected object`); return; }
      for (const key of Object.keys(value)) if (!Object.hasOwn(shape, key)) errors.push(`${path}.${key}: unknown setting`);
      for (const [key, child] of Object.entries(shape)) visit(value[key], child, `${path}.${key}`);
      return;
    }
    const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
    const valid = shape === 'days' ? Array.isArray(value) && value.length > 0 &&
      new Set(value).size === value.length && value.every(n => integer(n, 0, 6)) :
      integer(value, shape === 'positiveInteger' ? 1 : 0, shape === 'day' ? 6 : shape === 'hour' ? 23 : Number.MAX_SAFE_INTEGER);
    if (!valid) errors.push(`${path}: expected ${shape}`);
  }
  visit(value, schema, 'settings');
  return errors;
}
export function load(input) {
  let value;
  try { value = typeof input === 'string' ? JSON.parse(input) : input; }
  catch { return { value: defaults, errors: ['settings: invalid JSON'] }; }
  const errors = validate(value);
  return { value: errors.length ? defaults : freeze(structuredClone(value)), errors };
}
