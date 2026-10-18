// -----------------------------------------------------------------------------
// The Duco local API: the reads and the one command this integration uses,
// ported from python-duco-connectivity (MIT, 0.18.0). Requests to the box go
// one at a time (a small embedded board; Home Assistant holds a lock too),
// commands first in the queue. Reads are never retried here (the app spaces
// its new tries); a command is never retried at all (it may have reached the
// box: sending it twice is not ours to decide).
//
// The answers come from the network: only own fields of plain objects are
// read, each with its exact type. A missing or mistyped value is undefined,
// so that a command is refused rather than decided on a guess.
// -----------------------------------------------------------------------------

import {
  LIMITS,
  MIN_API_VERSION,
  PATHS,
  SET_VENTILATION_STATE,
  VENTILATION_MODES,
  VENTILATION_STATES,
} from '../constants.js';
import { BoxError, ERROR_KINDS, request as httpRequest } from './http.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;
/** `{ "Key": { "Val": x } }` -> x (own fields only). */
const val = (object, key) => own(own(object, key), 'Val');
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const integer = (value) => (Number.isInteger(value) ? value : undefined);

/** A short text from the box, without control characters. */
export function text(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean === '' ? undefined : clean.slice(0, LIMITS.textLength);
}

/** A node id: an integer of 1 to 65535. */
export const nodeIdOf = (value) =>
  Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined;

/** The serial number of the board as an id: 4 to 40 letters and digits, lower case. */
export function serialOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const serial = value.replace(/[\s:.-]/g, '').toLowerCase();
  return /^[a-z0-9]{4,40}$/.test(serial) ? serial : undefined;
}

/** "2.7" -> [2, 7]; undefined when not "major.minor[.patch]". */
export function apiVersionOf(value) {
  const match =
    typeof value === 'string' ? /^\s*(\d{1,3})\.(\d{1,3})(?:\.\d{1,5})?\s*$/.exec(value) : null;
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

export const apiSupported = (version) =>
  Array.isArray(version) &&
  (version[0] > MIN_API_VERSION[0] ||
    (version[0] === MIN_API_VERSION[0] && version[1] >= MIN_API_VERSION[1]));

/** A ventilation state of the list, else undefined ("-" means no state). */
export const stateOf = (value) =>
  typeof value === 'string' && VENTILATION_STATES.includes(value) ? value : undefined;

/** The node type ("BOX", "UCCO2"...): letters and digits, else "UNKNOWN". */
export const typeOf = (value) =>
  typeof value === 'string' && /^[A-Z0-9]{1,12}$/.test(value) ? value : 'UNKNOWN';

/** GET /info?module=General&submodule=Board -> the box. */
export function parseBoard(data) {
  if (!isObject(data)) {
    throw new BoxError(ERROR_KINDS.PROTOCOL, 'Not a JSON object');
  }
  const board = own(own(data, 'General'), 'Board');
  const version = val(board, 'PublicApiVersion');
  return {
    serial: serialOf(val(board, 'SerialBoardBox')),
    model: text(val(board, 'BoxName')),
    subModel: text(val(board, 'BoxSubTypeName')),
    apiVersion: text(version),
    supported: apiSupported(apiVersionOf(version)),
    software: text(val(board, 'SwVersion')),
  };
}

/** One node of /info/nodes or /info/nodes/{node}; undefined when it has no valid id. */
export function parseNode(item) {
  const id = nodeIdOf(own(item, 'Node'));
  if (id === undefined) {
    return undefined;
  }
  const general = own(item, 'General');
  const ventilation = own(item, 'Ventilation');
  const sensor = own(item, 'Sensor');
  const mode = val(ventilation, 'Mode');
  const rawState = val(ventilation, 'State');
  const remaining = integer(val(ventilation, 'TimeStateRemain'));
  return {
    id,
    type: typeOf(val(general, 'Type')),
    name: text(val(general, 'Name')),
    /** Whether the node has a Ventilation section at all. */
    ventilates: isObject(ventilation),
    state: stateOf(rawState),
    /** The state as the box wrote it, when it is not one we know (shown, never sent). */
    otherState:
      typeof rawState === 'string' && rawState !== '-' && !stateOf(rawState)
        ? text(rawState)?.slice(0, 12)
        : undefined,
    mode: typeof mode === 'string' && VENTILATION_MODES.includes(mode) ? mode : undefined,
    timeRemaining: remaining !== undefined && remaining >= 0 ? remaining : undefined,
    flow: number(val(ventilation, 'FlowLvlTgt')),
    co2: number(val(sensor, 'Co2')),
    humidity: number(val(sensor, 'Rh')),
    temperature: number(val(sensor, 'Temp')),
  };
}

/** GET /info/nodes -> the nodes, by id (the first of a duplicated id wins), 100 at most. */
export function parseNodes(data) {
  const list = own(data, 'Nodes');
  if (!Array.isArray(list)) {
    throw new BoxError(ERROR_KINDS.PROTOCOL, 'No node list');
  }
  const nodes = new Map();
  let skipped = 0;
  for (const item of list) {
    const node = parseNode(item);
    if (!node || nodes.has(node.id)) {
      skipped += 1;
    } else if (nodes.size >= LIMITS.nodes) {
      skipped += 1;
    } else {
      nodes.set(node.id, node);
    }
  }
  return { nodes, skipped };
}

/**
 * GET /action/nodes -> node id -> the ventilation states it accepts (the
 * enum of its SetVentilationState action, only the states we know, in our
 * order). A node without that action is absent.
 */
export function parseActions(data) {
  const list = own(data, 'Nodes');
  if (!Array.isArray(list)) {
    throw new BoxError(ERROR_KINDS.PROTOCOL, 'No node list');
  }
  const options = new Map();
  for (const item of list.slice(0, LIMITS.nodes * 2)) {
    const id = nodeIdOf(own(item, 'Node'));
    const actions = own(item, 'Actions');
    if (id === undefined || !Array.isArray(actions) || options.has(id)) {
      continue;
    }
    const action = actions.find(
      (a) => own(a, 'Action') === SET_VENTILATION_STATE && own(a, 'ValType') === 'Enum',
    );
    const values = own(action, 'Enum');
    if (!Array.isArray(values)) {
      continue;
    }
    const accepted = VENTILATION_STATES.filter((state) => values.includes(state));
    if (accepted.length > 0) {
      options.set(id, accepted);
    }
  }
  return options;
}

/** GET /config/nodes?parameter=Name -> node id -> name (empty names left out). */
export function parseNames(data) {
  const list = own(data, 'Nodes');
  if (!Array.isArray(list)) {
    throw new BoxError(ERROR_KINDS.PROTOCOL, 'No node list');
  }
  const names = new Map();
  for (const item of list.slice(0, LIMITS.nodes * 2)) {
    const id = nodeIdOf(own(item, 'Node'));
    const name = text(val(item, 'Name'));
    if (id !== undefined && name !== undefined && !names.has(id)) {
      names.set(id, name);
    }
  }
  return names;
}

/** Tenths of a degree (an integer) -> degrees, else undefined. */
const deciCelsius = (value) => (Number.isInteger(value) ? value / 10 : undefined);

/** GET /info?module=Ventilation -> the four air temperatures of the box, in °C. */
export function parseVentilation(data) {
  const sensor = own(own(data, 'Ventilation'), 'Sensor');
  return {
    outdoor: deciCelsius(val(sensor, 'TempOda')),
    supply: deciCelsius(val(sensor, 'TempSup')),
    extract: deciCelsius(val(sensor, 'TempEta')),
    exhaust: deciCelsius(val(sensor, 'TempEha')),
  };
}

/** GET /info?module=HeatRecovery -> the days left before the filter change. */
export function parseHeatRecovery(data) {
  const days = integer(val(own(own(data, 'HeatRecovery'), 'General'), 'TimeFilterRemain'));
  return { filterDays: days !== undefined && days >= 0 ? days : undefined };
}

/** The answer of a node action: `{ result: 'SUCCESS' | 'FAILED' | other, code }`. */
export function parseActionResult(data) {
  const result = own(data, 'Result');
  if (typeof result !== 'string') {
    throw new BoxError(ERROR_KINDS.PROTOCOL, 'No action result');
  }
  return { result: result.slice(0, 20), code: integer(own(data, 'Code')) };
}

/** Retry-After (seconds or an HTTP date) in ms, else undefined. */
export function retryAfterOf(header, now = Date.now()) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  if (/^\s*\d+\s*$/.test(value)) {
    return Number(value) * 1000;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** The reason of an error for a log or a message: its kind and status, never the answer. */
export function errorReason(err) {
  if (err?.kind === ERROR_KINDS.HTTP || err?.kind === ERROR_KINDS.RATE_LIMITED) {
    return `HTTP ${err.status}`;
  }
  return err?.kind ?? 'error';
}

/** The box says "this module does not exist here": HTTP 400 with {"Code":3,"Result":"FAILED"}. */
function unsupportedModule(response) {
  if (response.status !== 400) {
    return false;
  }
  try {
    const data = JSON.parse(response.body);
    return own(data, 'Code') === 3 && own(data, 'Result') === 'FAILED';
  } catch {
    return false;
  }
}

/** One request at a time; `first` jumps the queue (commands), never the request in flight. */
export class Gate {
  constructor() {
    this.queue = [];
    this.busy = false;
  }

  run(fn, { first = false } = {}) {
    return new Promise((resolve, reject) => {
      const job = { fn, resolve, reject };
      if (first) {
        this.queue.unshift(job);
      } else {
        this.queue.push(job);
      }
      this.next();
    });
  }

  next() {
    if (this.busy || this.queue.length === 0) {
      return;
    }
    this.busy = true;
    const { fn, resolve, reject } = this.queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        this.busy = false;
        this.next();
      });
  }
}

export class DucoClient {
  constructor({ transport = httpRequest, now = Date.now } = {}) {
    this.transport = transport;
    this.now = now;
    this.gate = new Gate();
  }

  /**
   * One exchange through the gate. `deadline` (commands): the request must
   * start before it, or it is refused unsent (LATE); its timeout is what is
   * left. Else `timeoutMs`.
   */
  exchange(
    { host, port },
    { method = 'GET', path, body, timeoutMs, deadline, first, minMs = 200 },
  ) {
    return this.gate.run(
      async () => {
        const timeout = deadline === undefined ? timeoutMs : deadline - this.now();
        if (timeout < minMs) {
          throw new BoxError(ERROR_KINDS.LATE, 'Too late to send');
        }
        return this.transport({ host, port, method, path, body, timeoutMs: timeout });
      },
      { first },
    );
  }

  /** A GET whose answer must be JSON (2xx). `optional`: a missing module resolves undefined. */
  async getJson(address, path, options = {}) {
    const response = await this.exchange(address, { path, ...options });
    if (options.optional && unsupportedModule(response)) {
      return undefined;
    }
    if (response.status === 404 && options.notFound) {
      throw new BoxError(options.notFound, 'HTTP 404', { status: 404 });
    }
    if (response.status < 200 || response.status > 299) {
      throw statusError(response, this.now());
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new BoxError(ERROR_KINDS.PROTOCOL, 'Not JSON');
    }
  }

  /** The box: its serial, model and API version. A board without /info (V1) is unsupported. */
  async board(address, options) {
    const board = parseBoard(
      await this.getJson(address, PATHS.board, { ...options, notFound: ERROR_KINDS.UNSUPPORTED }),
    );
    if (!board.supported) {
      throw new BoxError(ERROR_KINDS.UNSUPPORTED, `Public API ${board.apiVersion ?? 'unknown'}`);
    }
    return board;
  }

  async nodes(address, options) {
    return parseNodes(await this.getJson(address, PATHS.nodes, options));
  }

  /** One node, for a command (`deadline`, first in the queue) or a check after it. */
  async node(address, id, options) {
    const node = parseNode(await this.getJson(address, PATHS.node(id), options));
    if (!node || node.id !== id) {
      throw new BoxError(ERROR_KINDS.PROTOCOL, 'Another node answered');
    }
    return node;
  }

  async actions(address, options) {
    return parseActions(await this.getJson(address, PATHS.actions, options));
  }

  async names(address, options) {
    return parseNames(await this.getJson(address, PATHS.names, options));
  }

  /** undefined when the box has no such module. */
  async ventilation(address, options) {
    const data = await this.getJson(address, PATHS.ventilation, { ...options, optional: true });
    return data === undefined ? undefined : parseVentilation(data);
  }

  async heatRecovery(address, options) {
    const data = await this.getJson(address, PATHS.heatRecovery, { ...options, optional: true });
    return data === undefined ? undefined : parseHeatRecovery(data);
  }

  /**
   * POST /action/nodes/{node} SetVentilationState, never retried. Refused
   * unsent (LATE) when it cannot start before `startBy`; answered by `answerBy`.
   * Resolves the parsed result; a 2xx without a readable result is a
   * PROTOCOL error (it may have been applied).
   */
  async setVentilationState(address, id, state, { startBy, answerBy }) {
    if (!VENTILATION_STATES.includes(state) || nodeIdOf(id) === undefined) {
      throw Object.assign(new Error('Invalid command'), { notSent: true });
    }
    const response = await this.gate.run(
      async () => {
        if (this.now() > startBy) {
          throw new BoxError(ERROR_KINDS.LATE, 'Too late to send');
        }
        return this.transport({
          ...address,
          method: 'POST',
          path: PATHS.nodeAction(id),
          body: JSON.stringify({ Action: SET_VENTILATION_STATE, Val: state }),
          timeoutMs: Math.max(200, answerBy - this.now()),
        });
      },
      { first: true },
    );
    if (response.status < 200 || response.status > 299) {
      throw statusError(response, this.now());
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new BoxError(ERROR_KINDS.PROTOCOL, 'Not JSON');
    }
    return parseActionResult(data);
  }
}

/** The error of a non-2xx answer. */
function statusError(response, now) {
  if (response.status === 429) {
    return new BoxError(ERROR_KINDS.RATE_LIMITED, 'HTTP 429', {
      status: 429,
      retryAfter: retryAfterOf(response.headers?.['retry-after'], now),
    });
  }
  return new BoxError(ERROR_KINDS.HTTP, `HTTP ${response.status}`, { status: response.status });
}
