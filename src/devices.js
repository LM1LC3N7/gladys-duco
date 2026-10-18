// -----------------------------------------------------------------------------
// A node of the box -> one Gladys device and its states (pure).
//
// `ext:<selector>:duco:<serial>-<node>`: one device per node, keyed by the
// serial number of the board and the node number the box gives it, never by
// the IP address (it may change) nor a name. The feature roles (the last part
// of their external ids) are published forever: never rename them.
//
// Which features a node gets depends on its type (as Home Assistant's Duco
// integration) and on the values it was seen to report; a device published
// again never loses a feature: those of the device already created in Gladys
// are kept as they are (the core would mark it `structure_changed`, and
// "Update" would delete the missing feature and its history).
//
// No switch, no writable binary: a "turn everything off" (Google Home, Alexa,
// HomeKit, MCP, `switch.*` scenes) must never reach the ventilation. The one
// command is the ventilation mode, a `text/select` of the states the node
// accepts, refused unless the configuration allows the commands (src/app.js).
//
// Categories and units are those the core lists
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): ppm on `co2-sensor`, % on
// `humidity-sensor` and `fan`, °C on `temperature-sensor`, s and days on
// `duration`. The flow is the read-only `fan/percent` (the box's target flow
// level); there is no writable fan feature.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { CO2_TYPES, FEATURES, HUMIDITY_TYPES, VENTILATION_TYPES } from './constants.js';
import {
  BOX_NAME,
  FEATURE_NAMES,
  MODE_NAMES,
  NODE_NAME,
  STATE_NAMES,
  STATE_TEXTS,
  word,
} from './i18n.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
const temperature = sensor({
  category: C.TEMPERATURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: -50,
  max: 80,
});

/** The features, by role, in display order. */
export const DEFINITIONS = {
  [FEATURES.VENTILATION]: {
    category: C.TEXT,
    type: T.TEXT.SELECT,
    min: 0,
    max: 0,
    read_only: false,
    has_feedback: true,
    keep_history: false,
  },
  [FEATURES.STATE]: text,
  [FEATURES.MODE]: text,
  [FEATURES.FLOW]: sensor({
    category: C.FAN,
    type: T.FAN.PERCENT,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.TIME_REMAINING]: sensor({
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.SECONDS,
    min: 0,
    max: 7 * 24 * 3600,
    keep_history: false,
  }),
  [FEATURES.CO2]: sensor({
    category: C.CO2_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.PPM,
    min: 0,
    max: 10_000,
  }),
  [FEATURES.HUMIDITY]: sensor({
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURES.TEMPERATURE]: temperature,
  [FEATURES.TEMP_OUTDOOR]: temperature,
  [FEATURES.TEMP_SUPPLY]: temperature,
  [FEATURES.TEMP_EXTRACT]: temperature,
  [FEATURES.TEMP_EXHAUST]: temperature,
  [FEATURES.FILTER]: sensor({
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.DAYS,
    min: 0,
    max: 3650,
  }),
};

export const ROLES = Object.keys(DEFINITIONS);
export const COMMAND_ROLES = [FEATURES.VENTILATION];

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];

export const nodeKey = (serial, id) => `${serial}-${id}`;
export const nodeIds = (gladys, serial, id) => gladys.externalIds('duco', nodeKey(serial, id));

/** The serial, the node and the role of one of our feature external ids, else undefined. */
export function parseFeatureId(externalId) {
  if (typeof externalId !== 'string') {
    return undefined;
  }
  const match = /:duco:([a-z0-9]{4,40})-(\d{1,5}):([a-z-]+)$/.exec(externalId);
  if (!match || !ROLES.includes(match[3])) {
    return undefined;
  }
  const id = Number(match[2]);
  return id >= 1 && id <= 65535 ? { serial: match[1], id, role: match[3] } : undefined;
}

/** The serial and node of one of our device external ids, else undefined. */
export function parseDeviceId(externalId) {
  const match = /:duco:([a-z0-9]{4,40})-(\d{1,5})$/.exec(String(externalId ?? ''));
  return match ? { serial: match[1], id: Number(match[2]) } : undefined;
}

/**
 * The values a node reports now, by role (box-level values on the box node).
 * Undefined values are left out.
 */
export function reportedRoles(node, box = {}) {
  const roles = new Set();
  if (node.co2 !== undefined) roles.add(FEATURES.CO2);
  if (node.humidity !== undefined) roles.add(FEATURES.HUMIDITY);
  if (node.temperature !== undefined) roles.add(FEATURES.TEMPERATURE);
  if (node.type === 'BOX') {
    if (box.outdoor !== undefined) roles.add(FEATURES.TEMP_OUTDOOR);
    if (box.supply !== undefined) roles.add(FEATURES.TEMP_SUPPLY);
    if (box.extract !== undefined) roles.add(FEATURES.TEMP_EXTRACT);
    if (box.exhaust !== undefined) roles.add(FEATURES.TEMP_EXHAUST);
    if (box.filterDays !== undefined) roles.add(FEATURES.FILTER);
  }
  return roles;
}

/** The roles of a node: from its type, the values seen (`seen`), and the select when options are known. */
export function rolesOf(node, { seen = new Set(), options } = {}) {
  const roles = new Set(seen);
  if (VENTILATION_TYPES.has(node.type)) {
    roles.add(FEATURES.STATE);
    roles.add(FEATURES.MODE);
    roles.add(FEATURES.FLOW);
    roles.add(FEATURES.TIME_REMAINING);
    if (options?.length > 0) {
      roles.add(FEATURES.VENTILATION);
    }
  }
  if (CO2_TYPES.has(node.type)) roles.add(FEATURES.CO2);
  if (HUMIDITY_TYPES.has(node.type)) roles.add(FEATURES.HUMIDITY);
  return ROLES.filter((role) => roles.has(role));
}

export function ventilationOptions(options, language) {
  return options.map((state, index) => ({
    value: state,
    label: word(STATE_NAMES[state], language),
    sort_order: index,
  }));
}

export function deviceName(node, language) {
  if (node.name) {
    return node.name;
  }
  return node.type === 'BOX'
    ? word(BOX_NAME, language)
    : word(NODE_NAME(node.type.toLowerCase(), node.id), language);
}

/**
 * The Gladys device of one node. `created`: the device already created in
 * Gladys, whose features are kept when the new build lacks them.
 */
export function buildDevice(gladys, serial, node, { roles, options, board, language, created }) {
  const ids = nodeIds(gladys, serial, node.id);
  const params = [
    { name: 'node', value: String(node.id) },
    { name: 'node_type', value: node.type },
  ];
  if (node.type === 'BOX' && board?.apiVersion) {
    params.push({ name: 'public_api', value: board.apiVersion });
  }
  const built = {
    name: deviceName(node, language),
    external_id: ids.device,
    model: node.type === 'BOX' && board?.model ? `Duco ${board.model}` : `Duco ${node.type}`,
    should_poll: false,
    features: roles.map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
      ...(role === FEATURES.VENTILATION && options?.length > 0
        ? { supported_options: ventilationOptions(options, language) }
        : {}),
    })),
    params,
  };
  return keepCreatedFeatures(built, created);
}

/** The features of the created device that the new build lacks, kept as they are. */
export function keepCreatedFeatures(built, created) {
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  // A select kept without its options would show nothing: the created ones stay.
  const features = built.features.map((f) => {
    if (f.supported_options || f.type !== T.TEXT.SELECT) {
      return f;
    }
    const old = (created.features ?? []).find((c) => c?.external_id === f.external_id);
    return Array.isArray(old?.supported_options)
      ? { ...f, supported_options: old.supported_options }
      : f;
  });
  return { ...built, features: [...features, ...kept] };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The text of a ventilation state. */
export function stateText(node, language) {
  if (node.state) {
    return word(STATE_NAMES[node.state], language);
  }
  return word(STATE_TEXTS.unknown(node.otherState), language);
}

/**
 * The current values of one node's device. `status`: 'online', 'offline'
 * (box unreachable) or 'missing' (no longer reported by the box): then only
 * the state text changes, Gladys keeps the last value of the others.
 */
export function deviceStates(ids, node, { status = 'online', box = {}, options, language }) {
  if (status !== 'online') {
    const message = status === 'offline' ? STATE_TEXTS.offline : STATE_TEXTS.missing;
    return [
      { device_feature_external_id: ids.feature(FEATURES.STATE), text: word(message, language) },
    ];
  }
  const states = [];
  // A value outside the bounds of its feature is dropped (Gladys keeps the last one).
  const add = (role, state) => {
    const { min, max } = DEFINITIONS[role];
    if (state !== undefined && Number.isFinite(state) && state >= min && state <= max) {
      states.push({ role, state });
    }
  };
  if (node.ventilates) {
    states.push({ role: FEATURES.STATE, text: stateText(node, language) });
    if (node.mode) {
      states.push({ role: FEATURES.MODE, text: word(MODE_NAMES[node.mode], language) });
    }
    if (node.state && options?.includes(node.state)) {
      states.push({ role: FEATURES.VENTILATION, text: node.state });
    }
  }
  add(FEATURES.FLOW, node.flow === undefined ? undefined : Math.round(node.flow));
  add(FEATURES.TIME_REMAINING, node.timeRemaining);
  add(FEATURES.CO2, node.co2 === undefined ? undefined : Math.round(node.co2));
  add(FEATURES.HUMIDITY, node.humidity === undefined ? undefined : round(node.humidity, 1));
  add(
    FEATURES.TEMPERATURE,
    node.temperature === undefined ? undefined : round(node.temperature, 1),
  );
  if (node.type === 'BOX') {
    add(FEATURES.TEMP_OUTDOOR, box.outdoor);
    add(FEATURES.TEMP_SUPPLY, box.supply);
    add(FEATURES.TEMP_EXTRACT, box.extract);
    add(FEATURES.TEMP_EXHAUST, box.exhaust);
    add(FEATURES.FILTER, box.filterDays);
  }
  return states.map(({ role, ...value }) => ({
    device_feature_external_id: ids.feature(role),
    ...value,
  }));
}
