// -----------------------------------------------------------------------------
// The parsing of the answers (pure) and the real transport against a
// loopback server (127.0.0.1 only: never the network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  DucoClient,
  Gate,
  apiSupported,
  apiVersionOf,
  parseActions,
  parseBoard,
  parseHeatRecovery,
  parseNames,
  parseNode,
  parseNodes,
  parseVentilation,
  retryAfterOf,
  serialOf,
} from '../src/duco/client.js';
import { ERROR_KINDS, request } from '../src/duco/http.js';
import { actions, board, heatRecovery, names, nodes, ventilation } from './fixtures/fakeBox.js';

test('the board: serial as an id, API version 2.1 or later', () => {
  const b = parseBoard(board());
  assert.equal(b.serial, 'rs2205004573');
  assert.equal(b.model, 'ENERGY');
  assert.equal(b.apiVersion, '2.7');
  assert.equal(b.supported, true);
  assert.equal(parseBoard(board({ PublicApiVersion: { Val: '2.0' } })).supported, false);
  assert.equal(parseBoard(board({ PublicApiVersion: undefined })).supported, false);
  assert.equal(parseBoard({}).serial, undefined);
  assert.throws(() => parseBoard([]), { kind: ERROR_KINDS.PROTOCOL });
  assert.deepEqual(apiVersionOf('3.0.1'), [3, 0]);
  assert.equal(apiVersionOf('2'), undefined);
  assert.equal(apiSupported([3, 0]), true);
  assert.equal(apiSupported([2, 1]), true);
  assert.equal(apiSupported([1, 9]), false);
  for (const bad of ['', '-', 'abc', 'a/b', 'x'.repeat(41), 42, null]) {
    assert.equal(serialOf(bad), undefined, String(bad));
  }
});

test('the nodes: own fields with their exact type, a missing value stays unknown', () => {
  const { nodes: list, skipped } = parseNodes({ Nodes: nodes() });
  assert.equal(skipped, 0);
  assert.deepEqual(list.get(1), {
    id: 1,
    type: 'BOX',
    name: undefined,
    ventilates: true,
    state: 'AUTO',
    otherState: undefined,
    mode: 'AUTO',
    timeRemaining: 0,
    flow: 35,
    co2: undefined,
    humidity: 45.5,
    temperature: 21.4,
  });
  assert.equal(list.get(2).co2, 536);
  assert.equal(list.get(2).mode, undefined, '"-" is no mode');
  const odd = parseNode({
    Node: 5,
    General: { Type: { Val: 'box' } },
    Ventilation: { State: { Val: 'ZZZ9' }, FlowLvlTgt: { Val: '50' } },
    Sensor: { Co2: { Val: null }, Rh: 50 },
  });
  assert.equal(odd.type, 'UNKNOWN');
  assert.equal(odd.state, undefined);
  assert.equal(odd.otherState, 'ZZZ9');
  assert.equal(odd.flow, undefined);
  assert.equal(odd.co2, undefined);
  assert.equal(odd.humidity, undefined);
  assert.equal(parseNode({ Node: 0 }), undefined);
  assert.equal(parseNode({ Node: '1' }), undefined);
  assert.throws(() => parseNodes({}), { kind: ERROR_KINDS.PROTOCOL });
  assert.throws(() => parseNodes('x'), { kind: ERROR_KINDS.PROTOCOL });
});

test('100 nodes at most, duplicates and junk skipped', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ Node: i + 1 }));
  const { nodes: list, skipped } = parseNodes({ Nodes: [...many, { Node: 1 }, null, 'x'] });
  assert.equal(list.size, 100);
  assert.equal(skipped, 23);
});

test('a prototype in the answer pollutes nothing and is never read', () => {
  const data = JSON.parse(
    '{"Nodes":[{"Node":1,"__proto__":{"General":{"Type":{"Val":"BOX"}}},"Ventilation":{"State":{"__proto__":{"Val":"MAN1"}}}}]}',
  );
  const node = parseNodes(data).nodes.get(1);
  assert.equal(node.type, 'UNKNOWN');
  assert.equal(node.state, undefined);
  assert.equal({}.Val, undefined);
  assert.equal({}.General, undefined);
});

test('accepted states: only the SetVentilationState enum, known states, our order', () => {
  const options = parseActions(actions([1]));
  assert.equal(options.get(1).length, 17);
  assert.equal(options.get(1)[0], 'AUTO');
  const odd = parseActions({
    Nodes: [
      {
        Node: 3,
        Actions: [{ Action: 'SetVentilationState', ValType: 'Enum', Enum: ['CNT1', 'XX', 'AUTO'] }],
      },
      { Node: 4, Actions: [{ Action: 'SetIdentify', ValType: 'Boolean' }] },
      { Node: 5, Actions: [{ Action: 'SetVentilationState', ValType: 'Enum', Enum: ['XX'] }] },
    ],
  });
  assert.deepEqual(odd.get(3), ['AUTO', 'CNT1']);
  assert.equal(odd.has(4), false);
  assert.equal(odd.has(5), false);
});

test('names, box temperatures (tenths of a degree), filter days', () => {
  assert.deepEqual(
    [...parseNames(names())],
    [
      [1, 'Ventilation'],
      [2, 'Salon'],
    ],
  );
  assert.deepEqual(parseVentilation(ventilation()), {
    outdoor: 12.5,
    supply: 19,
    extract: 21.5,
    exhaust: 14,
  });
  assert.deepEqual(parseVentilation({}), {
    outdoor: undefined,
    supply: undefined,
    extract: undefined,
    exhaust: undefined,
  });
  assert.deepEqual(parseHeatRecovery(heatRecovery()), { filterDays: 87 });
  assert.deepEqual(
    parseHeatRecovery({ HeatRecovery: { General: { TimeFilterRemain: { Val: -1 } } } }),
    {
      filterDays: undefined,
    },
  );
});

test('Retry-After: seconds or a date', () => {
  assert.equal(retryAfterOf('120'), 120_000);
  assert.equal(retryAfterOf(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000), 30_000);
  assert.equal(retryAfterOf('soon'), undefined);
  assert.equal(retryAfterOf(undefined), undefined);
});

test('the gate: one request at a time, commands first in the queue', async () => {
  const gate = new Gate();
  const order = [];
  let release;
  const first = gate.run(() =>
    new Promise((resolve) => (release = resolve)).then(() => order.push('poll 1')),
  );
  const second = gate.run(async () => order.push('poll 2'));
  const command = gate.run(async () => order.push('command'), { first: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  release();
  await Promise.all([first, second, command]);
  assert.deepEqual(order, ['poll 1', 'command', 'poll 2']);
});

test('a command that cannot start before its deadline is refused unsent', async () => {
  let calls = 0;
  const client = new DucoClient({
    transport: async () => {
      calls += 1;
      return { status: 200, headers: {}, body: '{"Result":"SUCCESS"}' };
    },
    now: () => 10_000,
  });
  await assert.rejects(
    client.setVentilationState({ host: 'x', port: 80 }, 1, 'MAN1', {
      startBy: 9_999,
      answerBy: 20_000,
    }),
    { kind: ERROR_KINDS.LATE },
  );
  await assert.rejects(
    client.setVentilationState({ host: 'x', port: 80 }, 1, 'man1', {
      startBy: 20_000,
      answerBy: 20_000,
    }),
    { notSent: true },
  );
  assert.equal(calls, 0);
});

test('an optional module the box lacks: 400 with code 3 resolves undefined', async () => {
  const client = new DucoClient({
    transport: async () => ({ status: 400, headers: {}, body: '{"Code":3,"Result":"FAILED"}' }),
  });
  assert.equal(await client.ventilation({ host: 'x', port: 80 }, { timeoutMs: 1000 }), undefined);
  await assert.rejects(client.nodes({ host: 'x', port: 80 }, { timeoutMs: 1000 }), {
    kind: ERROR_KINDS.HTTP,
    status: 400,
  });
});

/** A loopback server answering `handler(req, res)`. */
async function loopback(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { host: '127.0.0.1', port: server.address().port };
}

test('the real transport: JSON body posted, answer read', async (t) => {
  let received;
  const address = await loopback(t, (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received = { method: req.method, url: req.url, body, type: req.headers['content-type'] };
      res.end('{"Result":"SUCCESS"}');
    });
  });
  const client = new DucoClient();
  const result = await client.setVentilationState(address, 1, 'CNT2', {
    startBy: Date.now() + 1000,
    answerBy: Date.now() + 2000,
  });
  assert.deepEqual(result, { result: 'SUCCESS', code: undefined });
  assert.deepEqual(received, {
    method: 'POST',
    url: '/action/nodes/1',
    body: '{"Action":"SetVentilationState","Val":"CNT2"}',
    type: 'application/json',
  });
});

test('the real transport: an answer over the limit is cut', async (t) => {
  const address = await loopback(t, (_req, res) => {
    res.write('{"Nodes":[');
    res.end('0,'.repeat(200_000) + '0]}');
  });
  await assert.rejects(request({ ...address, path: '/info/nodes', timeoutMs: 2000 }), {
    kind: ERROR_KINDS.PROTOCOL,
  });
});

test('the real transport: connected then silent is a timeout (it may have been received)', async (t) => {
  const address = await loopback(t, () => {});
  await assert.rejects(request({ ...address, path: '/info/nodes', timeoutMs: 200 }), {
    kind: ERROR_KINDS.TIMEOUT,
  });
});

test('the real transport: nothing listening is unreachable (nothing was sent)', async () => {
  // A port just closed on loopback.
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const closed = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(request({ host: '127.0.0.1', port: closed, path: '/', timeoutMs: 1000 }), {
    kind: ERROR_KINDS.UNREACHABLE,
  });
});
