import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES } from '../src/constants.js';
import {
  DEFINITIONS,
  ROLES,
  deviceStates,
  keepCreatedFeatures,
  parseFeatureId,
  rolesOf,
} from '../src/devices.js';

const ids = {
  device: 'ext:x:duco:abcd1234-1',
  feature: (role) => `ext:x:duco:abcd1234-1:${role}`,
};

test('feature ids: a strict pattern and a fixed role list', () => {
  assert.deepEqual(parseFeatureId('ext:x:duco:abcd1234-1:ventilation'), {
    serial: 'abcd1234',
    id: 1,
    role: 'ventilation',
  });
  for (const bad of [
    'ext:x:duco:abcd1234-1:__proto__',
    'ext:x:duco:abcd1234-1:constructor',
    'ext:x:duco:abcd1234-0:state',
    'ext:x:duco:abcd1234-99999:state',
    'ext:x:duco:ABCD1234-1:state',
    'ext:x:duco:abcd1234-1:ventilation:x',
    42,
    undefined,
  ]) {
    assert.equal(parseFeatureId(bad), undefined, String(bad));
  }
});

test('units are those the core lists for each category', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of server/utils/constants.js (Gladys core), for our categories.
  const allowed = {
    'co2-sensor': ['ppm'],
    'humidity-sensor': ['percent'],
    'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
    fan: ['percent'],
    duration: ['seconds', 'days', 'minutes', 'hours'],
    text: [undefined],
  };
  for (const [role, definition] of Object.entries(DEFINITIONS)) {
    assert.ok(allowed[definition.category]?.includes(definition.unit), role);
  }
  // The only writable feature is the select: never a switch, never a writable binary or fan.
  assert.deepEqual(
    ROLES.filter((role) => !DEFINITIONS[role].read_only),
    [FEATURES.VENTILATION],
  );
});

test('roles by type, by values seen, and the select only with options on a ventilating type', () => {
  assert.deepEqual(rolesOf({ type: 'BOX' }, { options: ['AUTO'] }), [
    'ventilation',
    'state',
    'mode',
    'flow',
    'time-remaining',
  ]);
  assert.deepEqual(rolesOf({ type: 'BOX' }), ['state', 'mode', 'flow', 'time-remaining']);
  assert.deepEqual(rolesOf({ type: 'UCCO2' }, { options: ['AUTO'] }), ['co2']);
  assert.deepEqual(rolesOf({ type: 'UNKNOWN' }, { seen: new Set(['temperature']) }), [
    'temperature',
  ]);
});

test('a created feature the new build lacks is kept, a select keeps its options', () => {
  const built = { features: [{ external_id: 'a', type: 'select' }] };
  const created = {
    features: [
      { external_id: 'a', type: 'select', supported_options: [{ value: 'AUTO', label: 'Auto' }] },
      {
        external_id: 'b',
        type: 'decimal',
        category: 'temperature-sensor',
        id: 'uuid',
        last_value: 3,
      },
    ],
  };
  const merged = keepCreatedFeatures(built, created);
  assert.deepEqual(merged.features, [
    { external_id: 'a', type: 'select', supported_options: [{ value: 'AUTO', label: 'Auto' }] },
    { external_id: 'b', type: 'decimal', category: 'temperature-sensor' },
  ]);
});

test('states: bounds respected, unknown state shown, offline changes only the state text', () => {
  const node = {
    id: 1,
    type: 'BOX',
    ventilates: true,
    state: undefined,
    otherState: 'ZZZ9',
    mode: 'MANU',
    flow: 140,
    timeRemaining: 900,
    co2: -5,
    humidity: 45.55,
    temperature: 120,
  };
  const states = deviceStates(ids, node, {
    language: 'en',
    options: ['AUTO'],
    box: { outdoor: 12.5 },
  });
  assert.deepEqual(
    states.map((s) => [s.device_feature_external_id.split(':').at(-1), s.state ?? s.text]),
    [
      ['state', 'Unknown state (ZZZ9)'],
      ['mode', 'Manual'],
      ['time-remaining', 900],
      ['humidity', 45.6],
      ['temperature-outdoor', 12.5],
    ],
  );
  assert.deepEqual(deviceStates(ids, {}, { status: 'offline', language: 'fr' }), [
    { device_feature_external_id: ids.feature('state'), text: 'Box injoignable' },
  ]);
});
