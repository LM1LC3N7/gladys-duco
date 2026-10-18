// -----------------------------------------------------------------------------
// The integration: the Duco box typed in the configuration (its IP address),
// one read of its nodes every poll interval, the Gladys devices (one per
// node) and their states, the transport badges, the "Test the connection"
// button, and the one command (the ventilation mode of a node), refused
// unless the configuration allows it. index.js only wires the SDK handlers.
//
// The command follows the rules learnt on the previous modules:
//   - decided on a fresh read of the node only, never on the state kept in
//     memory, and refused when the value it needs is missing;
//   - the "Allow the commands" option is checked on arrival and again right
//     before sending;
//   - sent within 3.5 s of the click or refused unsent; answered by 4.3 s;
//   - a command that may have reached the box (silence, a 5xx, a broken
//     answer) is never answered "not sent": "sent, without confirmation",
//     then spaced reads of the node;
//   - the ack never waits for a publication to Gladys;
//   - one command at a time; never retried.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { addressKey, normalizeConfig } from './config.js';
import { SECOND, TIMINGS, VENTILATION_STATES, VENTILATION_TYPES } from './constants.js';
import {
  COMMAND_ROLES,
  buildDevice,
  deviceStates,
  nodeIds,
  nodeKey,
  parseDeviceId,
  parseFeatureId,
  reportedRoles,
  rolesOf,
} from './devices.js';
import { ERRORS, T, age, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';
import { DucoClient, errorReason } from './duco/client.js';
import { ERROR_KINDS } from './duco/http.js';

const both = (en, fr) => ({ en, fr });
const join = (a, b) => both(`${a.en} ${b.en}`, `${a.fr} ${b.fr}`);

/** The box as nothing was read yet. */
const freshBox = (address) => ({
  address,
  /** The last board read: { serial, model, apiVersion... }. */
  board: undefined,
  /** Whether the board was read since the box last answered (another box may answer later). */
  verified: false,
  online: undefined,
  failures: 0,
  wait: undefined,
  error: undefined,
  /** node id -> node, from the last read of /info/nodes. */
  nodes: new Map(),
  /** node id -> the ventilation states it accepts (action discovery). */
  options: new Map(),
  /** node id -> the name given in the Duco app. */
  names: new Map(),
  /** Box-level readings: temperatures, filter. */
  readings: {},
  /** Optional modules: undefined (not asked yet), true, false (the box has none). */
  modules: { ventilation: undefined, heatRecovery: undefined },
  slowAt: -Infinity,
  /** Every node id read since the start (a new one asks for the slow data at once). */
  nodeIds: new Set(),
  timer: undefined,
  running: undefined,
  followUps: new Set(),
});

export class DucoApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'duco' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new DucoClient({ transport, now });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    this.box = undefined;
    /** nodeKey -> the roles a node was seen to report (a feature never disappears). */
    this.seen = new Map();
    this.generation = 0;
    this.started = false;
    this.pausedUntil = 0;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastTestAt = -Infinity;
    /** The command in flight (one at a time for the box). */
    this.inFlight = undefined;
    /** nodeKey -> { from, expected, moved, until }: a command sent, not seen yet. */
    this.guards = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.box?.running;
    this.config = normalizeConfig(raw);
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    // A 429 pause survives a restart and a new configuration.
    if (this.memory.pause) {
      this.pausedUntil = Math.max(this.pausedUntil, this.memory.pause.until);
    }
    this.box = this.config.address ? freshBox(this.config.address) : undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.publisher.start();
    if (!this.box) {
      // The devices already created are shown unreachable.
      await this.publishAll();
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    if (this.box) {
      this.clearTimer();
      for (const handle of this.box.followUps) {
        this.timers.clearTimeout(handle);
      }
      this.box.followUps.clear();
    }
    this.publisher.stop();
  }

  clearTimer() {
    if (this.box?.timer) {
      this.timers.clearTimeout(this.box.timer);
      this.box.timer = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The 429 pause stays.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    this.config = normalizeConfig(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.publishAll();
  }

  needsRestart(raw) {
    const next = normalizeConfig(raw);
    return (
      next.pollInterval !== this.config.pollInterval ||
      JSON.stringify(next.address ?? null) !== JSON.stringify(this.config.address ?? null) ||
      next.invalid !== this.config.invalid
    );
  }

  /** A new address or interval restarts; the option and the language apply at once. */
  async configUpdated(raw = {}) {
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (this.config.allowCommands !== previous.allowCommands) {
      this.logger.info(`Duco commands ${this.config.allowCommands ? 'allowed' : 'disabled'}`);
    }
    if (this.config.language !== previous.language) {
      await this.publishAll();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  get paused() {
    return this.now() < this.pausedUntil;
  }

  /** The next read: after the pause (never sooner than the interval), after a backoff, else the interval. */
  schedule() {
    const box = this.box;
    this.clearTimer();
    const wait = this.paused
      ? Math.max(this.pausedUntil - this.now(), this.interval)
      : box.online === false
        ? box.wait
        : this.interval;
    const generation = this.generation;
    box.timer = this.timers.setTimeout(
      () => {
        box.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch(() => this.logger.error('Duco refresh failed'));
        }
      },
      Math.max(0, wait ?? this.interval),
    );
  }

  /** One read at a time: a tick during a read joins it. */
  tick() {
    const box = this.box;
    if (!box) {
      return Promise.resolve();
    }
    if (!box.running) {
      box.running = this.run(box).finally(() => {
        box.running = undefined;
      });
    }
    return box.running;
  }

  async run(box) {
    const generation = this.generation;
    if (this.paused) {
      await this.updateStatus();
      this.schedule();
      return;
    }
    const timeoutMs = TIMINGS.readTimeout;
    try {
      if (!box.verified) {
        const board = await this.client.board(box.address, { timeoutMs });
        if (generation !== this.generation) {
          return;
        }
        if (box.board?.serial && board.serial !== box.board.serial) {
          // Another box answers at this address: what was read of the first one is dropped.
          this.logger.warn('Duco: another box answers at this address');
          Object.assign(box, { nodes: new Map(), options: new Map(), names: new Map() });
          Object.assign(box, { readings: {}, slowAt: -Infinity, nodeIds: new Set() });
          box.modules = { ventilation: undefined, heatRecovery: undefined };
        }
        box.board = board;
        box.verified = true;
      }
      const { nodes, skipped } = await this.client.nodes(box.address, { timeoutMs });
      if (generation !== this.generation) {
        return;
      }
      if (skipped > 0) {
        this.logger.warn(`Duco: ${skipped} node(s) ignored (invalid, duplicated or over 100)`);
      }
      box.nodes = nodes;
      box.online = true;
      box.failures = 0;
      box.wait = undefined;
      box.error = box.board.serial ? undefined : 'no_id';
      for (const node of nodes.values()) {
        this.observe(box.board.serial, node);
      }
      await this.readSecondary(box, generation);
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(box, err);
    }
    if (generation !== this.generation) {
      return;
    }
    await this.publishAll();
    if (generation === this.generation) {
      this.schedule();
    }
  }

  /**
   * The slower data, each on its own: a failure never blocks the nodes (the
   * main data). Accepted states and names every hour (and at once when a new
   * node appears); temperatures and filter at each read, when the box has them.
   */
  async readSecondary(box, generation) {
    const timeoutMs = TIMINGS.readTimeout;
    // A node never read before: its accepted states and name are read at
    // once, but never more often than every 5 minutes (a node that comes and
    // goes does not make every read a slow one).
    const newNode = [...box.nodes.keys()].some((id) => !box.nodeIds.has(id));
    box.nodeIds = new Set([...box.nodeIds, ...box.nodes.keys()]);
    const since = this.now() - box.slowAt;
    const steps = [];
    if (since >= TIMINGS.slowRefresh || (newNode && since >= TIMINGS.slowRetry)) {
      box.slowAt = this.now();
      steps.push([
        'actions',
        async () => {
          box.options = await this.client.actions(box.address, { timeoutMs });
        },
      ]);
      steps.push([
        'names',
        async () => {
          box.names = await this.client.names(box.address, { timeoutMs });
        },
      ]);
    }
    for (const module of ['ventilation', 'heatRecovery']) {
      if (box.modules[module] === false) {
        continue;
      }
      steps.push([
        module,
        async () => {
          const reading = await this.client[module](box.address, { timeoutMs });
          box.modules[module] = reading !== undefined;
          Object.assign(box.readings, reading ?? {});
        },
      ]);
    }
    for (const [name, step] of steps) {
      if (generation !== this.generation || this.paused) {
        return;
      }
      try {
        await step();
      } catch (err) {
        this.logger.warn(`Duco: reading ${name} failed (${errorReason(err)})`);
        if (err.kind === ERROR_KINDS.RATE_LIMITED) {
          await this.pause(err);
          return;
        }
        if (name === 'actions' || name === 'names') {
          // Tried again in 5 minutes, not at every read.
          box.slowAt = this.now() - TIMINGS.slowRefresh + TIMINGS.slowRetry;
        }
      }
    }
  }

  async failed(box, err) {
    const reason = errorReason(err);
    box.verified = false;
    if (err.kind === ERROR_KINDS.RATE_LIMITED) {
      await this.pause(err);
      this.logger.warn(`Duco ${addressKey(box.address)}: ${reason}, pause`);
      return;
    }
    // Never read again sooner than the interval.
    const wait =
      err.kind === ERROR_KINDS.UNSUPPORTED
        ? Math.max(this.interval, TIMINGS.unsupportedRetry)
        : Math.max(
            this.interval,
            TIMINGS.backoff[Math.min(box.failures, TIMINGS.backoff.length - 1)],
          );
    box.failures += 1;
    box.online = false;
    box.wait = wait;
    box.error = err.kind === ERROR_KINDS.UNSUPPORTED ? 'unsupported' : reason;
    this.logger.warn(
      `Duco ${addressKey(box.address)}: ${reason}; next try in ${Math.round(wait / 1000)} s`,
    );
  }

  /** A 429: every path waits (polling, button, commands), kept in /data. */
  async pause(err) {
    const wait = Math.min(
      TIMINGS.rateLimitMax,
      Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
    );
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.pause = { until: this.pausedUntil };
    await this.saveMemory();
  }

  pauseMessage() {
    return this.paused ? T.rateLimited(age(this.pausedUntil - this.now())) : undefined;
  }

  withInvalid(message) {
    return this.config.invalid ? join(message, T.invalid(this.config.invalid)) : message;
  }

  // --- What the box gives ------------------------------------------------------

  get serial() {
    return this.box?.board?.serial;
  }

  /** Whether the nodes of the last read are current (the box answers, its board checked). */
  get live() {
    return Boolean(this.box?.online === true && this.box.verified && this.serial);
  }

  /** The node as last read, with the name given in the Duco app. */
  nodeOf(id) {
    const node = this.box?.nodes.get(id);
    if (!node) {
      return undefined;
    }
    const name = this.box.names.get(id);
    return name ? { ...node, name } : node;
  }

  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d?.external_id === externalId);
  }

  /** Our created devices: [{ device, serial, id }]. */
  ourDevices() {
    const list = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseDeviceId(device?.external_id);
      if (parsed && nodeIds(this.gladys, parsed.serial, parsed.id).device === device.external_id) {
        list.push({ device, ...parsed });
      }
    }
    return list;
  }

  /**
   * How a created device stands: 'online', 'offline' (the box does not
   * answer, or nothing read yet with an error) or 'missing' (the box answers
   * without it). undefined while a first read is under way.
   */
  standing({ serial, id }) {
    if (this.live) {
      return serial === this.serial && this.box.nodes.has(id) ? 'online' : 'missing';
    }
    if (!this.box || this.box.online === false || this.paused) {
      return 'offline';
    }
    return undefined;
  }

  // --- Gladys ----------------------------------------------------------------

  async publishAll() {
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The roles a node gets: by type, by the values seen once, and the select. */
  rolesFor(node) {
    const key = nodeKey(this.serial, node.id);
    const seen = this.seen.get(key) ?? new Set();
    for (const role of reportedRoles(node, this.box.readings)) {
      seen.add(role);
    }
    this.seen.set(key, seen);
    return rolesOf(node, { seen, options: this.box.options.get(node.id) });
  }

  async publishDevices() {
    if (!this.serial || !this.box || this.box.nodes.size === 0) {
      return;
    }
    const devices = [...this.box.nodes.keys()].map((id) => {
      const node = this.nodeOf(id);
      const ids = nodeIds(this.gladys, this.serial, id);
      return buildDevice(this.gladys, this.serial, node, {
        roles: this.rolesFor(node),
        options: this.box.options.get(id),
        board: this.box.board,
        language: this.config.language,
        created: this.createdDevice(ids.device),
      });
    });
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    for (const entry of this.ourDevices()) {
      const status = this.standing(entry);
      if (status === undefined) {
        continue;
      }
      const ids = nodeIds(this.gladys, entry.serial, entry.id);
      const states = deviceStates(ids, status === 'online' ? this.nodeOf(entry.id) : {}, {
        status,
        box: this.box?.readings,
        options: this.box?.options.get(entry.id),
        language: this.config.language,
      });
      for (const { device_feature_external_id: id, ...value } of states) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  async publishBadge() {
    const entries = [];
    for (const entry of this.ourDevices()) {
      const status = this.standing(entry);
      if (status === undefined) {
        continue;
      }
      entries.push({
        external_id: entry.device.external_id,
        transport: status === 'online' ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      });
    }
    const json = JSON.stringify(entries);
    if (entries.length === 0 || json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  /** The connection status of the configuration screen. */
  async updateStatus() {
    const [connected, message] = this.status();
    await this.setStatus(connected, message);
  }

  status() {
    const box = this.box;
    if (!box) {
      return [false, this.withInvalid(T.noAddress)];
    }
    const pause = this.pauseMessage();
    if (pause) {
      return [box.nodes.size > 0, pause];
    }
    if (box.online === false) {
      return box.error === 'unsupported'
        ? [false, T.unsupported(age(box.wait ?? TIMINGS.unsupportedRetry))]
        : [false, T.unreachable(addressKey(box.address), age(box.wait ?? this.interval))];
    }
    if (box.online === undefined) {
      return [false, T.connecting];
    }
    if (box.error === 'no_id') {
      return [false, T.noId];
    }
    let summary = T.summary(box.board?.model, box.nodes.size);
    const missing = this.ourDevices().filter((e) => this.standing(e) === 'missing');
    if (missing.length > 0) {
      const names = missing
        .map(({ device, id }) =>
          typeof device.name === 'string' && device.name !== ''
            ? `${device.name.slice(0, 60)} (${id})`
            : String(id),
        )
        .join(', ');
      summary = join(summary, T.missing(names));
    }
    return [true, T.connected(summary)];
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the devices of the last read, sent again. */
  async scan() {
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Configuration button --------------------------------------------------

  async testConnection() {
    if (!this.box) {
      return this.withInvalid(T.noAddress);
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = JSON.parse(this.lastStatus ?? '[false,null]')[1];
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    this.lastTestAt = this.now();
    // A read now (a read in progress is joined).
    await this.tick();
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? T.connecting;
  }

  // --- The command -------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const target = parseFeatureId(feature?.external_id);
    if (!target || !COMMAND_ROLES.includes(target.role)) {
      throw this.refusal(ERRORS.readOnly);
    }
    // Strictly one of the states we know: never a number, never trimmed or re-cased.
    if (typeof value !== 'string' || !VENTILATION_STATES.includes(value)) {
      throw this.refusal(ERRORS.badValue);
    }
    if (!this.config.allowCommands) {
      throw this.refusal(ERRORS.disabled);
    }
    if (this.inFlight) {
      throw this.refusal(ERRORS.stillRunning);
    }
    const promise = this.command(target, value, received);
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      if (this.inFlight === promise) {
        this.inFlight = undefined;
      }
    }
  }

  /** The checks before sending, on the latest configuration. */
  checkBeforeSend(generation, { serial, id }) {
    if (!this.config.allowCommands) {
      throw this.refusal(ERRORS.disabled);
    }
    if (generation !== this.generation || !this.live || serial !== this.serial) {
      throw this.refusal(ERRORS.unknownNode);
    }
    const paused = this.pauseMessage();
    if (paused) {
      throw this.refusal(ERRORS.paused(age(this.pausedUntil - this.now())));
    }
    const options = this.box.options.get(id);
    if (!options) {
      throw this.refusal(ERRORS.optionsUnknown);
    }
    return options;
  }

  async command(target, wanted, received) {
    const generation = this.generation;
    const { id } = target;
    const sendBy = received + TIMINGS.commandSendBy;
    const options = this.checkBeforeSend(generation, target);
    if (!options.includes(wanted)) {
      throw this.refusal(ERRORS.notOffered);
    }
    const box = this.box;
    const readBy = Math.min(this.now() + TIMINGS.commandReadMax, sendBy - TIMINGS.commandMinSend);
    if (readBy - this.now() < TIMINGS.commandMinRead) {
      throw this.refusal(ERRORS.tooSlow);
    }

    // The state just before acting, never the one in memory.
    let fresh;
    try {
      fresh = await this.client.node(box.address, id, {
        deadline: readBy,
        first: true,
        minMs: TIMINGS.commandMinRead,
      });
    } catch (err) {
      if (err.kind === ERROR_KINDS.LATE) {
        throw this.refusal(ERRORS.tooSlow);
      }
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
      }
      throw this.refusal(ERRORS.unknownState(errorReason(err)));
    }
    if (generation !== this.generation || this.box !== box) {
      throw this.refusal(ERRORS.unknownNode);
    }
    box.nodes.set(id, fresh);
    this.observe(target.serial, fresh);
    // Shown in the background: the ack never waits for Gladys.
    this.publishAll().catch((err) => this.logger.warn(`Publishing failed: ${err.message}`));

    // Only the box and the valves (the box advertises the action on sensors too).
    if (!VENTILATION_TYPES.has(fresh.type)) {
      throw this.refusal(ERRORS.notOffered);
    }
    if (!fresh.ventilates || (fresh.state === undefined && fresh.otherState === undefined)) {
      throw this.refusal(ERRORS.noVentilation);
    }
    const key = nodeKey(target.serial, id);
    if (fresh.state === wanted && !this.guardActive(key)) {
      // Already so: nothing sent (the box counts its writes).
      return;
    }
    // The option may have been turned off during the read: checked again.
    this.checkBeforeSend(generation, target);
    if (this.now() > sendBy) {
      throw this.refusal(ERRORS.tooSlow);
    }
    this.logger.info(`Duco node ${id}: ${wanted}`);
    const plan = { from: fresh.state ?? fresh.otherState, expected: wanted };
    let result;
    try {
      result = await this.client.setVentilationState(box.address, id, wanted, {
        startBy: sendBy,
        answerBy: received + TIMINGS.commandAnswerBy,
      });
    } catch (err) {
      const reason = errorReason(err);
      this.logger.warn(`Duco node ${id}: ${wanted} failed (${reason})`);
      if (err.kind === ERROR_KINDS.LATE) {
        throw this.refusal(ERRORS.tooSlow);
      }
      if (err.kind === ERROR_KINDS.UNREACHABLE || err.notSent) {
        // Nothing accepted the connection, or the error came before the transport.
        throw this.refusal(ERRORS.notSent(reason));
      }
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
        this.updateStatus().catch(() => {});
        throw this.refusal(ERRORS.refused(reason));
      }
      if (err.kind === ERROR_KINDS.HTTP && err.status < 500) {
        this.followUp(id);
        throw this.refusal(ERRORS.refused(reason));
      }
      // A 5xx, a silence, a broken answer or any other error after the
      // transport started: it may have reached the box.
      this.guard(key, plan);
      this.followUp(id);
      throw this.refusal(ERRORS.sentUnconfirmed(reason));
    }
    if (result.result === 'FAILED') {
      this.followUp(id);
      throw this.refusal(
        ERRORS.refused(result.code === undefined ? 'FAILED' : `FAILED, code ${result.code}`),
      );
    }
    this.guard(key, plan);
    this.followUp(id);
    if (result.result !== 'SUCCESS') {
      throw this.refusal(ERRORS.sentUnconfirmed(result.result));
    }
  }

  /** Spaced reads of the node after a command: its effect, then a check. */
  followUp(id) {
    const box = this.box;
    const generation = this.generation;
    for (const delay of TIMINGS.followUps) {
      const handle = this.timers.setTimeout(() => {
        box.followUps.delete(handle);
        if (generation === this.generation) {
          this.refreshNode(box, id).catch(() => this.logger.error('Duco refresh failed'));
        }
      }, delay);
      box.followUps.add(handle);
    }
  }

  /** One node read again (after a command); a failure only logs: the polling goes on. */
  async refreshNode(box, id) {
    if (this.paused || !this.live || this.box !== box) {
      return;
    }
    const generation = this.generation;
    try {
      const node = await this.client.node(box.address, id, { timeoutMs: TIMINGS.readTimeout });
      if (generation !== this.generation || !this.live) {
        return;
      }
      box.nodes.set(id, node);
      this.observe(this.serial, node);
    } catch (err) {
      this.logger.warn(`Duco node ${id}: check after the command failed (${errorReason(err)})`);
      if (err.kind === ERROR_KINDS.RATE_LIMITED) {
        await this.pause(err);
      }
    }
    await this.publishAll();
  }

  // --- Guards ----------------------------------------------------------------------

  /**
   * After a command, until the node shows it: a new command is always sent,
   * never answered "already so" on a state that may not show the previous
   * one yet. The start state is kept: a read equal to it lifts nothing until
   * a move was seen.
   */
  guard(key, plan) {
    this.guards.set(key, { ...plan, moved: false, until: this.now() + TIMINGS.guard });
  }

  guardActive(key) {
    const guard = this.guards.get(key);
    if (guard && this.now() >= guard.until) {
      this.guards.delete(key);
      return false;
    }
    return Boolean(guard);
  }

  /** A read of a node, through its guard: never lifted on an unknown value. */
  observe(serial, node) {
    const key = nodeKey(serial, node.id);
    if (!this.guardActive(key)) {
      return;
    }
    const value = node.state ?? node.otherState;
    if (value === undefined) {
      return;
    }
    const guard = this.guards.get(key);
    if (value !== guard.from) {
      guard.moved = true;
    }
    if (guard.moved && value === guard.expected) {
      this.guards.delete(key);
    }
  }
}
