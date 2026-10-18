// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake box behind the transport. Timers and Date are mocked:
// the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DucoApp } from '../src/app.js';
import { ACTIONS, MINUTE, SECOND, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { HOST, NOW, SERIAL, fakeBox, settle } from './fixtures/fakeBox.js';

const CONFIG = { address: HOST };
const ALLOWED = { address: HOST, allow_commands: true };
const device = (node) => `ext:test-integration:duco:${SERIAL}-${node}`;
const feature = (node, role) => `${device(node)}:${role}`;

async function setup(
  t,
  { config = CONFIG, server = fakeBox(), store = memoryStore(), create = true, logs = [] } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config });
  const app = new DucoApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const d of [...gladys.fake.discoveredDevices]) {
      await gladys.fake.deviceCreated(d);
    }
    await settle();
  }
  const select = async (value, { node = 1, wait = 5 * SECOND } = {}) => {
    const d = gladys.fake.devices.find((x) => x.external_id === device(node));
    const target = d.features.find((f) => f.external_id === feature(node, 'ventilation'));
    const ack = gladys.fake.setValue(d, target, value);
    await settle();
    await advance(wait, 100);
    return ack;
  };
  return { gladys, app, server, store, advance, logs, select };
}

const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

const last = (gladys, node, role) => gladys.fake.lastState(feature(node, role));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const discovered = (gladys, node) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === device(node));
const roles = (d) => d.features.map((f) => f.external_id.slice(d.external_id.length + 1));
const posts = (server) => server.commands().map((r) => `${r.path} ${r.body}`);
const transportOf = (gladys, node) =>
  gladys.fake.transports.filter((x) => x.device_external_id === device(node)).at(-1)?.transport;

test('without an address, the status asks for it and nothing is requested', async (t) => {
  const server = fakeBox();
  const { gladys } = await setup(t, { config: {}, server });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /adresse IP/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /IP address/);
  assert.equal(server.requests.length, 0);
});

test('an invalid or HTTPS address is reported, never read', async (t) => {
  const server = fakeBox();
  const { gladys } = await setup(t, { config: { address: 'https://10.0.0.1' }, server });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).fr, /Adresse invalide : https:\/\/10\.0\.0\.1/);
});

test('one read: the board, the nodes, then the slower data; never the broad /info or /config', async (t) => {
  const server = fakeBox();
  await setup(t, { server });
  assert.deepEqual(server.paths(), [
    'GET /info?module=General&submodule=Board',
    'GET /info/nodes',
    'GET /action/nodes',
    'GET /config/nodes?parameter=Name',
    'GET /info?module=Ventilation',
    'GET /info?module=HeatRecovery',
  ]);
  assert.ok(server.requests.every((r) => r.host === HOST && r.port === 80));
  assert.ok(!server.paths().some((p) => /^GET \/(info|config)$/.test(p)));
});

test('one device per node: features by type and by what the node reports', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(gladys.fake.discoveredDevices.length, 3);
  const box = discovered(gladys, 1);
  assert.equal(box.name, 'Ventilation');
  assert.equal(box.model, 'Duco ENERGY');
  assert.deepEqual(box.params, [
    { name: 'node', value: '1' },
    { name: 'node_type', value: 'BOX' },
    { name: 'public_api', value: '2.7' },
  ]);
  assert.deepEqual(
    box.features.map((f) => [
      f.external_id.slice(box.external_id.length + 1),
      f.category,
      f.type,
      f.unit,
      f.read_only,
    ]),
    [
      ['ventilation', 'text', 'select', undefined, false],
      ['state', 'text', 'text', undefined, true],
      ['mode', 'text', 'text', undefined, true],
      ['flow', 'fan', 'percent', 'percent', true],
      ['time-remaining', 'duration', 'integer', 'seconds', true],
      ['humidity', 'humidity-sensor', 'decimal', 'percent', true],
      ['temperature', 'temperature-sensor', 'decimal', 'celsius', true],
      ['temperature-outdoor', 'temperature-sensor', 'decimal', 'celsius', true],
      ['temperature-supply', 'temperature-sensor', 'decimal', 'celsius', true],
      ['temperature-extract', 'temperature-sensor', 'decimal', 'celsius', true],
      ['temperature-exhaust', 'temperature-sensor', 'decimal', 'celsius', true],
      ['filter-remaining', 'duration', 'integer', 'days', true],
    ],
  );
  const select = box.features[0];
  assert.deepEqual(
    select.supported_options.map((o) => o.value),
    [
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
    ],
  );
  assert.equal(select.supported_options.at(-1).label, 'Absent');
  // A CO2 room sensor: no ventilation features, no select (as Home Assistant).
  const co2 = discovered(gladys, 2);
  assert.equal(co2.name, 'Salon');
  assert.deepEqual(roles(co2), ['co2', 'temperature']);
  const rh = discovered(gladys, 113);
  assert.equal(rh.name, 'Duco bsrh 113');
  assert.deepEqual(roles(rh), ['humidity', 'temperature']);
  for (const d of gladys.fake.discoveredDevices) {
    assert.ok(!d.features.some((f) => ['switch', 'binary'].includes(f.type) && !f.read_only));
  }
});

test('the states of the nodes, the badges and the status', async (t) => {
  const { gladys } = await setup(t);
  assert.equal(last(gladys, 1, 'ventilation'), 'AUTO');
  assert.equal(last(gladys, 1, 'state'), 'Automatique');
  assert.equal(last(gladys, 1, 'mode'), 'Automatique');
  assert.equal(last(gladys, 1, 'flow'), 35);
  assert.equal(last(gladys, 1, 'time-remaining'), 0);
  assert.equal(last(gladys, 1, 'humidity'), 45.5);
  assert.equal(last(gladys, 1, 'temperature'), 21.4);
  assert.equal(last(gladys, 1, 'temperature-outdoor'), 12.5);
  assert.equal(last(gladys, 1, 'temperature-supply'), 19);
  assert.equal(last(gladys, 1, 'temperature-extract'), 21.5);
  assert.equal(last(gladys, 1, 'temperature-exhaust'), 14);
  assert.equal(last(gladys, 1, 'filter-remaining'), 87);
  assert.equal(last(gladys, 2, 'co2'), 536);
  assert.equal(last(gladys, 2, 'temperature'), 19.8);
  assert.equal(last(gladys, 113, 'humidity'), 61.2);
  for (const node of [1, 2, 113]) {
    assert.equal(transportOf(gladys, node), DEVICE_TRANSPORTS.LOCAL);
  }
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).fr, /^Connecté\. Duco ENERGY : 3 nœuds\.$/);
});

test('a box without the optional modules: asked once, no box temperatures, nodes unaffected', async (t) => {
  const server = fakeBox({ noVentilationModule: true, noHeatRecovery: true });
  const { gladys, advance } = await setup(t, { server });
  assert.deepEqual(roles(discovered(gladys, 1)).slice(-2), ['humidity', 'temperature']);
  await advance(2 * MINUTE, 10 * SECOND);
  assert.equal(server.paths().filter((p) => p.includes('module=Ventilation')).length, 1);
  assert.equal(server.paths().filter((p) => p.includes('module=HeatRecovery')).length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a secondary read failing never blocks the nodes, and is tried again 5 min later', async (t) => {
  const server = fakeBox({ statuses: { '/action/nodes': 500 } });
  const { gladys, advance } = await setup(t, { server });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(last(gladys, 2, 'co2'), 536);
  // No select without the accepted states.
  assert.ok(!roles(discovered(gladys, 1)).includes('ventilation'));
  server.box.statuses = {};
  await advance(4 * MINUTE, 10 * SECOND);
  assert.equal(server.paths().filter((p) => p === 'GET /action/nodes').length, 1);
  await advance(MINUTE + 30 * SECOND, 10 * SECOND);
  assert.equal(server.paths().filter((p) => p === 'GET /action/nodes').length, 2);
  assert.ok(roles(discovered(gladys, 1)).includes('ventilation'));
});

test('polling every interval; the slow data every hour', async (t) => {
  const server = fakeBox();
  const { advance } = await setup(t, { server });
  await advance(5 * MINUTE, 10 * SECOND);
  // 1 + 10 reads of the nodes in 5 minutes at 30 s.
  assert.equal(server.paths().filter((p) => p === 'GET /info/nodes').length, 11);
  assert.equal(server.paths().filter((p) => p === 'GET /action/nodes').length, 1);
  await advance(56 * MINUTE, MINUTE);
  assert.equal(server.paths().filter((p) => p === 'GET /action/nodes').length, 2);
  // The board is read once while the box answers.
  assert.equal(server.paths().filter((p) => p.includes('submodule=Board')).length, 1);
});

test('commands are off by default: refused, nothing read or sent', async (t) => {
  const server = fakeBox();
  const { select } = await setup(t, { server });
  const before = server.requests.length;
  const ack = await select('MAN2');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Autoriser les commandes/);
  assert.equal(server.requests.length, before);
});

test('a ventilation mode: fresh read of the node, one POST, then spaced checks', async (t) => {
  const server = fakeBox();
  const { gladys, select, advance } = await setup(t, { config: ALLOWED, server });
  const before = server.requests.length;
  const ack = await select('MAN2', { wait: 0 });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.paths().slice(before), ['GET /info/nodes/1', 'POST /action/nodes/1']);
  assert.deepEqual(posts(server), [
    '/action/nodes/1 {"Action":"SetVentilationState","Val":"MAN2"}',
  ]);
  // Checks of the node 5 s and 20 s later.
  await advance(21 * SECOND, 100);
  assert.equal(server.paths().filter((p) => p === 'GET /info/nodes/1').length, 3);
  assert.equal(last(gladys, 1, 'ventilation'), 'MAN2');
  assert.equal(last(gladys, 1, 'state'), 'Manuel 2');
});

test('already in that state: nothing sent (the box counts its writes)', async (t) => {
  const server = fakeBox();
  const { select } = await setup(t, { config: ALLOWED, server });
  const ack = await select('AUTO');
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.commands().length, 0);
});

test('the value is strict, the other features are read only', async (t) => {
  const server = fakeBox();
  const { gladys, select } = await setup(t, { config: ALLOWED, server });
  for (const bad of ['man2', ' MAN2', 'MAN4', '', 'auto', 2, null]) {
    const ack = await select(bad, { wait: 0 });
    assert.equal(ack.success, false, String(bad));
  }
  const d = gladys.fake.devices.find((x) => x.external_id === device(1));
  const ack = await gladys.fake.setValue(
    d,
    d.features.find((f) => f.external_id === feature(1, 'flow')),
    50,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /lecture seule/);
  assert.equal(server.commands().length, 0);
});

test('a state the node does not accept is refused unsent', async (t) => {
  const server = fakeBox();
  server.box.actions.Nodes[0].Actions[0].Enum = ['AUTO', 'MAN1', 'MAN2', 'MAN3'];
  const { select } = await setup(t, { config: ALLOWED, server });
  const ack = await select('EMPT');
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'accepte pas/);
  assert.equal(server.commands().length, 0);
});

test('a sensor node is never commanded, even though the box advertises the action', async (t) => {
  const server = fakeBox();
  const { gladys } = await setup(t, { config: ALLOWED, server });
  const d = gladys.fake.devices.find((x) => x.external_id === device(2));
  // A forged feature of the CO2 sensor (no such feature is ever published).
  const ack = await gladys.fake.setValue(
    d,
    { ...d.features[0], external_id: feature(2, 'ventilation') },
    'MAN3',
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'accepte pas/);
  assert.equal(server.commands().length, 0);
});

test('the option turned off during the fresh read: not sent', async (t) => {
  const server = fakeBox({ delays: { '/info/nodes/1': 800 } });
  const { gladys, select } = await setup(t, { config: ALLOWED, server });
  const pending = select('MAN1', { wait: 1_000 });
  await gladys.fake.configUpdated(CONFIG);
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /Autoriser les commandes/);
  assert.equal(server.commands().length, 0);
});

test('the fresh read fails: refused, nothing sent', async (t) => {
  const server = fakeBox();
  const { select } = await setup(t, { config: ALLOWED, server });
  server.box.statuses['/info/nodes/1'] = 500;
  const ack = await select('MAN1');
  assert.equal(ack.success, false);
  assert.match(ack.error, /relu juste avant \(HTTP 500\)/);
  assert.equal(server.commands().length, 0);
});

test('a slow fresh read: refused as too slow, never sent after the deadline', async (t) => {
  const server = fakeBox({ delays: { '/info/nodes/1': 3_000 } });
  const { select } = await setup(t, { config: ALLOWED, server });
  const ack = await select('MAN1');
  assert.equal(ack.success, false);
  assert.match(ack.error, /non envoyée/);
  assert.equal(server.commands().length, 0);
});

test('a silent POST: "sent, without confirmation", then checks; the next one is sent anyway', async (t) => {
  const server = fakeBox({ delays: { POST: 10 * SECOND }, applies: false });
  const { select, advance } = await setup(t, { config: ALLOWED, server });
  const ack = await select('MAN3');
  assert.equal(ack.success, false);
  assert.match(ack.error, /envoyée, sans confirmation \(timeout\)/);
  assert.equal(server.commands().length, 1);
  await advance(21 * SECOND, 100);
  assert.equal(server.paths().filter((p) => p === 'GET /info/nodes/1').length, 3);
  // Still AUTO: a new MAN3 is sent.
  server.box.delays = {};
  const again = await select('MAN3');
  assert.equal(again.success, true, again.error);
  assert.equal(server.commands().length, 2);
  // The node moved to MAN3 (applied late): the guard lifts, a third MAN3 is "already so".
  server.node(1).Ventilation.State.Val = 'MAN3';
  const third = await select('MAN3');
  assert.equal(third.success, true, third.error);
  assert.equal(server.commands().length, 2);
});

test('a guard is not lifted by a read equal to the start state', async (t) => {
  const server = fakeBox({ statuses: { POST: 502 }, applies: false });
  const { select } = await setup(t, { config: ALLOWED, server });
  const ack = await select('CNT2');
  assert.match(ack.error, /sans confirmation \(HTTP 502\)/);
  server.box.statuses = {};
  // The node still shows AUTO (the start state): AUTO is sent, not "already so".
  const back = await select('AUTO');
  assert.equal(back.success, true, back.error);
  assert.equal(server.commands().length, 2);
});

test('the box refuses (Result FAILED or a 4xx): refused, no guard', async (t) => {
  const server = fakeBox({ result: { Code: 2, Result: 'FAILED' }, applies: false });
  const { select } = await setup(t, { config: ALLOWED, server });
  let ack = await select('MAN1');
  assert.equal(ack.success, false);
  assert.match(ack.error, /refusé la commande \(FAILED, code 2\)/);
  server.box.result = { Result: 'SUCCESS' };
  server.box.statuses.POST = 400;
  ack = await select('MAN1');
  assert.match(ack.error, /refusé la commande \(HTTP 400\)/);
});

test('nothing accepted the connection: "not sent"', async (t) => {
  // The fresh read answers, then the POST finds nobody.
  const server = fakeBox({ postDown: true });
  const { select } = await setup(t, { config: ALLOWED, server });
  const ack = await select('MAN1');
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'a pas pu être jointe \(unreachable\) : commande non envoyée/);
});

test('a 429 on the command: every path pauses, kept in /data and across a reconnection', async (t) => {
  const server = fakeBox({
    statuses: { POST: { status: 429, body: 'busy', headers: { 'retry-after': '600' } } },
  });
  const store = memoryStore();
  const { gladys, select, advance } = await setup(t, { config: ALLOWED, server, store });
  const ack = await select('MAN1');
  assert.match(ack.error, /refusé la commande \(HTTP 429\)/);
  assert.ok(store.data.pause.until > Date.now() + 590 * SECOND);
  assert.ok(store.data.pause.until <= Date.now() + 600 * SECOND);
  const reads = server.paths().filter((p) => p === 'GET /info/nodes').length;
  await gladys.connect();
  await settle();
  await advance(5 * MINUTE, 10 * SECOND);
  assert.equal(server.paths().filter((p) => p === 'GET /info/nodes').length, reads);
  const paused = await select('MAN2');
  assert.match(paused.error, /ralentir/);
  assert.match(message(gladys).fr, /HTTP 429/);
  await advance(6 * MINUTE, 10 * SECOND);
  assert.ok(server.paths().filter((p) => p === 'GET /info/nodes').length > reads);
});

test('one command at a time', async (t) => {
  const server = fakeBox({ delays: { POST: 1_000 } });
  const { gladys, select, advance } = await setup(t, { config: ALLOWED, server });
  const first = select('MAN1', { wait: 0 });
  await settle();
  const d = gladys.fake.devices.find((x) => x.external_id === device(1));
  const second = await gladys.fake.setValue(
    d,
    d.features.find((f) => f.external_id === feature(1, 'ventilation')),
    'MAN2',
  );
  assert.equal(second.success, false);
  assert.match(second.error, /encore en cours/);
  await advance(2 * SECOND, 100);
  const ack = await first;
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.commands().length, 1);
});

test('the ack never waits for a publication to Gladys', async (t) => {
  const server = fakeBox();
  const { gladys, select } = await setup(t, { config: ALLOWED, server });
  gladys.publishDiscoveredDevices = () => new Promise(() => {});
  gladys.publishChangedStates = () => new Promise(() => {});
  const ack = await select('MAN1', { wait: 1_000 });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.commands().length, 1);
});

test('the box stops answering: unreachable, spaced tries never under the interval', async (t) => {
  const server = fakeBox();
  const { gladys, advance } = await setup(t, { config: { ...CONFIG, poll_interval: 60 }, server });
  server.box.down = true;
  const before = server.requests.length;
  await advance(MINUTE, 10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /Pas de réponse de 192\.168\.1\.60/);
  assert.equal(last(gladys, 1, 'state'), 'Box injoignable');
  assert.equal(transportOf(gladys, 2), DEVICE_TRANSPORTS.UNREACHABLE);
  // Then 60 s (interval > 30 s backoff), 60 s, 2 min, 5 min...
  await advance(10 * MINUTE, 10 * SECOND);
  const tries = server.requests.slice(before).length;
  assert.ok(tries <= 6, `${tries} tries in 11 minutes`);
  server.box.down = false;
  const back = server.requests.length;
  await advance(5 * MINUTE, 10 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(last(gladys, 1, 'state'), 'Automatique');
  // The board is read again after the outage (another box may answer), once.
  assert.equal(
    server
      .paths()
      .slice(back)
      .filter((p) => p.includes('submodule=Board')).length,
    1,
  );
});

test('a board too old for the API: said so, read again every 30 minutes', async (t) => {
  const server = fakeBox();
  server.box.board.General.Board.PublicApiVersion = { Val: '2.0' };
  const { gladys, advance } = await setup(t, { server });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.match(message(gladys).en, /not supported/);
  await advance(29 * MINUTE, MINUTE);
  assert.equal(server.requests.length, 1);
  await advance(2 * MINUTE, MINUTE);
  assert.equal(server.requests.length, 2);
  server.box.statuses['/info?module=General&submodule=Board'] = 404;
  await advance(31 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /not supported/);
});

test('a node no longer reported: its state says so, badge unreachable, status names it', async (t) => {
  const server = fakeBox();
  const { gladys, advance } = await setup(t, { server });
  server.box.nodes = server.box.nodes.filter((n) => n.Node !== 2);
  await advance(30 * SECOND);
  assert.equal(transportOf(gladys, 2), DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(transportOf(gladys, 1), DEVICE_TRANSPORTS.LOCAL);
  assert.match(message(gladys).fr, /Plus annoncé par la box : Salon \(2\)/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a republished device never loses a feature', async (t) => {
  const server = fakeBox();
  const { gladys, advance } = await setup(t, { server });
  const before = roles(discovered(gladys, 2));
  // The sensor stops giving its temperature, and the box its accepted states.
  delete server.node(2).Sensor.Temp;
  server.box.actions = { Nodes: [] };
  await advance(61 * MINUTE, MINUTE);
  assert.deepEqual(roles(discovered(gladys, 2)), before);
  assert.ok(roles(discovered(gladys, 1)).includes('ventilation'));
  const select = discovered(gladys, 1).features.find((f) => f.type === 'select');
  assert.equal(select.supported_options.length, 17);
});

test('after a restart, the features of the created devices are kept', async (t) => {
  const server = fakeBox();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const first = createFakeGladys({ config: CONFIG });
  const app1 = new DucoApp({
    gladys: first,
    logger: recorder([]),
    transport: server.transport,
    now: () => Date.now(),
    store: memoryStore(),
  });
  registerHandlers(first, app1);
  await first.connect();
  await settle();
  const created = first.fake.discoveredDevices.map((d) => JSON.parse(JSON.stringify(d)));
  app1.stop();
  delete server.node(2).Sensor.Temp;
  const gladys = createFakeGladys({ config: CONFIG, devices: created });
  const app = new DucoApp({
    gladys,
    logger: recorder([]),
    transport: server.transport,
    now: () => Date.now(),
    store: memoryStore(),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  assert.deepEqual(roles(discovered(gladys, 2)), ['co2', 'temperature']);
});

test('a reconnection to Gladys resends status, devices and badges, without a new read', async (t) => {
  const server = fakeBox();
  const { gladys } = await setup(t, { server });
  const devices = gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  const transports = gladys.fake.transports.length;
  const requests = server.requests.length;
  await gladys.connect();
  await settle();
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, devices + 1);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.ok(gladys.fake.transports.length > transports);
  assert.equal(server.requests.length, requests);
});

test('another box at the same address: the old nodes are missing, commands refused', async (t) => {
  const server = fakeBox();
  const { gladys, select, advance } = await setup(t, { config: ALLOWED, server });
  server.box.down = true;
  await advance(30 * SECOND);
  server.box.down = false;
  server.box.board.General.Board.SerialBoardBox = { Val: 'RS9999999999' };
  await advance(MINUTE, 10 * SECOND);
  assert.equal(transportOf(gladys, 1), DEVICE_TRANSPORTS.UNREACHABLE);
  const ack = await select('MAN1');
  assert.equal(ack.success, false);
  assert.match(ack.error, /n'est pas lu/);
  assert.equal(server.commands().length, 0);
});

test('the test button reads now, at most every 10 s', async (t) => {
  const server = fakeBox();
  const { gladys, advance } = await setup(t, { server });
  const reads = () => server.paths().filter((p) => p === 'GET /info/nodes').length;
  const before = reads();
  let ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /3 nœuds/);
  assert.equal(reads(), before + 1);
  ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /less than 10 s/);
  assert.equal(reads(), before + 1);
  await advance(TIMINGS.testCooldown);
  await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(reads(), before + 2);
});

test('hostile answers: no prototype pollution, nothing logged of the answer', async (t) => {
  const server = fakeBox();
  server.box.bodies['/info/nodes'] =
    '{"Nodes":[{"Node":1,"__proto__":{"polluted":1},"General":{"Type":{"Val":"BOX"},"Name":{"Val":"<script>secret-answer"}},"Ventilation":{"State":{"Val":"AUTO"},"__proto__":{"Mode":{"Val":"MANU"}}}},{"Node":"2"},{"Node":0},null,7]}';
  const logs = [];
  const { gladys } = await setup(t, { server, logs });
  assert.equal({}.polluted, undefined);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(last(gladys, 1, 'mode'), undefined);
  assert.ok(!logs.some((l) => l.includes('secret-answer')));
});
