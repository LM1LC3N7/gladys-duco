// -----------------------------------------------------------------------------
// Duco local API constants, manifest keys, limits and timings.
//
// The Duco Connectivity Board answers a plain HTTP API on port 80, without
// authentication (Duco Public API 2.x), as python-duco-connectivity (MIT,
// 0.18.0, the library of Home Assistant's Duco integration) reads it:
//   GET  /info?module=General&submodule=Board   identity, API version
//   GET  /info/nodes, /info/nodes/{node}        state and sensors of the nodes
//   GET  /action/nodes                          what each node accepts
//   GET  /config/nodes?parameter=Name           the names given to the nodes
//   GET  /info?module=Ventilation               box temperatures (some boxes)
//   GET  /info?module=HeatRecovery              filter time (some boxes)
//   POST /action/nodes/{node}                   {"Action":"SetVentilationState","Val":"MAN1"}
// The broad /info and /config are never read: they hold the Wi-Fi keys.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 80;

export const PATHS = {
  board: '/info?module=General&submodule=Board',
  nodes: '/info/nodes',
  node: (id) => `/info/nodes/${id}`,
  actions: '/action/nodes',
  names: '/config/nodes?parameter=Name',
  ventilation: '/info?module=Ventilation',
  heatRecovery: '/info?module=HeatRecovery',
  nodeAction: (id) => `/action/nodes/${id}`,
};

/** The oldest Public API the integration reads (Home Assistant's minimum: older boards lack /info). */
export const MIN_API_VERSION = [2, 1];

/** The node action that sets a ventilation state. */
export const SET_VENTILATION_STATE = 'SetVentilationState';

/**
 * The ventilation states of the Duco API (python-duco-connectivity's
 * VentilationState, spec values and the timed MAN variants seen on real
 * boxes), in display order. Only these are ever sent: an unknown value the
 * box advertises is not offered.
 */
export const VENTILATION_STATES = [
  'AUTO',
  'AUT1',
  'AUT2',
  'AUT3',
  'MAN1',
  'MAN2',
  'MAN3',
  'MAN1x2',
  'MAN2x2',
  'MAN3x2',
  'MAN1x3',
  'MAN2x3',
  'MAN3x3',
  'CNT1',
  'CNT2',
  'CNT3',
  'EMPT',
];

/** The ventilation modes (VentilationMode): read only. */
export const VENTILATION_MODES = ['AUTO', 'MANU', 'OVRL', 'EXTN', 'COOL', 'DSBL'];

/** Continuous states: no end time (Home Assistant's _CONTINUOUS_VENTILATION_STATES). */
export const CONTINUOUS_STATES = new Set(['CNT1', 'CNT2', 'CNT3']);

/** The box itself (Home Assistant's BOX_NODE_ID). */
export const BOX_NODE_ID = 1;

/** The node types that ventilate (Home Assistant's VENTILATION_CAPABLE_NODE_TYPES). */
export const VENTILATION_TYPES = new Set([
  'BOX',
  'VLV',
  'VLVRH',
  'VLVVOC',
  'VLVCO2',
  'VLVCO2RH',
  'EAV',
  'EAVRH',
  'EAVVOC',
  'EAVCO2',
]);

/** The node types that measure CO2 or humidity (Home Assistant's sensor descriptions). */
export const CO2_TYPES = new Set(['BSCO2', 'UCCO2', 'VLVCO2', 'VLVCO2RH']);
export const HUMIDITY_TYPES = new Set(['BSRH', 'UCRH', 'VLVRH', 'VLVCO2RH']);

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  STATE: 'state',
  MODE: 'mode',
  FLOW: 'flow',
  TIME_REMAINING: 'time-remaining',
  CO2: 'co2',
  HUMIDITY: 'humidity',
  TEMPERATURE: 'temperature',
  TEMP_OUTDOOR: 'temperature-outdoor',
  TEMP_SUPPLY: 'temperature-supply',
  TEMP_EXTRACT: 'temperature-extract',
  TEMP_EXHAUST: 'temperature-exhaust',
  FILTER: 'filter-remaining',
  VENTILATION: 'ventilation',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = {
  min: 10,
  max: 600,
  default: 30,
};

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** A box with five nodes answers /info/nodes in about 2 KB. */
  responseBytes: 256 * 1024,
  /** Nodes read from one box (more are ignored, and said so in the logs). */
  nodes: 100,
  /** Longest text kept from an answer (names, versions). */
  textLength: 60,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One read of the polling (python-duco-connectivity: 10 s; some boxes take 2 to 4 s). */
  readTimeout: 10 * SECOND,
  /** Failed reads: 30 s, 1, 2, then 5 minutes, never shorter than the interval. */
  backoff: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** A board too old for the API: read again every 30 minutes (never a dead integration). */
  unsupportedRetry: 30 * MINUTE,
  /** 429 (the box's write budget): Retry-After bounded to 1 min .. 6 h, 5 min without. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** Names and accepted states change rarely: read again every hour. */
  slowRefresh: HOUR,
  /** ... and again 5 minutes after a failure, or when a new node appears. */
  slowRetry: 5 * MINUTE,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button reads the box at most this often. */
  testCooldown: 10 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): the fresh read and the command
   * must leave by 3.5 s after the click, or the command is refused unsent;
   * the answer is awaited until 4.3 s, after which the command is "sent,
   * without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** The fresh read of a command: 2.5 s at most, and 0.3 s left to send after it. */
  commandReadMax: 2_500,
  commandMinRead: 300,
  commandMinSend: 300,
  /** Reads of the node after a command, spaced: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A sent command keeps its guard until the node shows what it asked, or 90 s. */
  guard: 90 * SECOND,
};
