// -----------------------------------------------------------------------------
// A fake Duco box behind the transport the integration is given: answers
// shaped like python-duco-connectivity's test fixtures and documented paths
// (made up, never captured from a real box), and SetVentilationState, which
// changes the node like it is expected to. Records every request. No network.
// Delays use setTimeout, so the mocked clock drives them.
// -----------------------------------------------------------------------------

import { BoxError, ERROR_KINDS } from '../../src/duco/http.js';

export const HOST = '192.168.1.60';
export const SERIAL = 'rs2205004573';
export const NOW = Date.UTC(2026, 9, 18, 18, 0, 0);

const v = (Val) => ({ Val });

export const board = (over = {}) => ({
  General: {
    Board: {
      BoxName: v('ENERGY'),
      BoxSubTypeName: v('Eu'),
      SerialBoardBox: v('RS2205004573'),
      SerialBoardComm: v('PS2204001234'),
      SerialDucoBox: v('-'),
      SerialDucoComm: v('-'),
      Time: v(1_760_000_000),
      PublicApiVersion: v('2.7'),
      SwVersion: v('19800.4.3.0'),
      ...over,
    },
  },
});

/** The box (node 1), a CO2 room sensor (node 2) and a humidity box sensor (node 113). */
export const nodes = () => [
  {
    Node: 1,
    General: {
      Type: v('BOX'),
      SubType: v(1),
      NetworkType: v('VIRT'),
      Parent: v(0),
      Asso: v(0),
      Name: v(''),
      Identify: v(0),
    },
    Ventilation: {
      State: v('AUTO'),
      TimeStateRemain: v(0),
      TimeStateEnd: v(0),
      Mode: v('AUTO'),
      FlowLvlTgt: v(35),
    },
    Sensor: { Temp: v(21.4), Rh: v(45.5), IaqRh: v(83) },
  },
  {
    Node: 2,
    General: {
      Type: v('UCCO2'),
      SubType: v(0),
      NetworkType: v('RF'),
      Parent: v(1),
      Asso: v(1),
      Name: v(''),
      Identify: v(0),
    },
    Ventilation: {
      State: v('AUTO'),
      TimeStateRemain: v(0),
      TimeStateEnd: v(0),
      Mode: v('-'),
    },
    Sensor: { Temp: v(19.8), Co2: v(536), IaqCo2: v(100) },
  },
  {
    Node: 113,
    General: {
      Type: v('BSRH'),
      SubType: v(0),
      NetworkType: v('VIRT'),
      Parent: v(1),
      Asso: v(1),
      Name: v(''),
      Identify: v(0),
    },
    Ventilation: {
      State: v('AUTO'),
      TimeStateRemain: v(0),
      TimeStateEnd: v(0),
      Mode: v('-'),
    },
    Sensor: { Temp: v(21.5), Rh: v(61.2), IaqRh: v(81) },
  },
];

const ENUM = [
  'AUTO',
  'AUT1',
  'AUT2',
  'AUT3',
  'MAN1',
  'MAN2',
  'MAN3',
  'EMPT',
  'CNT1',
  'CNT2',
  'CNT3',
  'MAN1x2',
  'MAN2x2',
  'MAN3x2',
  'MAN1x3',
  'MAN2x3',
  'MAN3x3',
];

export const actions = (ids = [1, 2, 113]) => ({
  Nodes: ids.map((Node) => ({
    Node,
    Actions: [
      { Action: 'SetVentilationState', ValType: 'Enum', Enum: ENUM },
      { Action: 'SetIdentify', ValType: 'Boolean' },
    ],
  })),
});

export const names = () => ({
  Nodes: [
    { Node: 1, Name: v('Ventilation') },
    { Node: 2, Name: v('Salon') },
    { Node: 113, Name: v('') },
  ],
});

export const ventilation = () => ({
  Ventilation: {
    Sensor: { TempOda: v(125), TempSup: v(190), TempEta: v(215), TempEha: v(140) },
  },
});

export const heatRecovery = () => ({ HeatRecovery: { General: { TimeFilterRemain: v(87) } } });

const UNSUPPORTED = { status: 400, body: { Code: 3, Result: 'FAILED' } };

const answer = (status, body = '', headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The box. The test may set on `server.box`: `down` (nothing answers),
 * `silent` (connected, no answer), `delays` (path -> ms), `statuses`
 * (path -> HTTP status, or { status, body }), `bodies` (path -> raw body),
 * `applies` (false: a command changes nothing), `result` (the action answer),
 * `noVentilationModule` / `noHeatRecovery` (400 code 3).
 */
export function fakeBox(over = {}) {
  const server = {
    box: {
      board: board(),
      nodes: nodes(),
      actions: actions(),
      names: names(),
      ventilation: ventilation(),
      heatRecovery: heatRecovery(),
      delays: {},
      statuses: {},
      bodies: {},
      result: { Result: 'SUCCESS' },
      ...over,
    },
    /** { host, port, method, path, body, timeoutMs } */
    requests: [],
    paths: () => server.requests.map((r) => `${r.method} ${r.path}`),
    commands: () => server.requests.filter((r) => r.method === 'POST'),
    node: (id) => server.box.nodes.find((n) => n.Node === id),
    async transport({ host, port, method, path, body, timeoutMs }) {
      server.requests.push({ host, port, method, path, body, timeoutMs });
      const box = server.box;
      if (box.down || host !== HOST || (box.postDown && method === 'POST')) {
        throw new BoxError(ERROR_KINDS.UNREACHABLE, 'Unreachable: ECONNREFUSED');
      }
      const delay = box.delays[path] ?? (method === 'POST' ? box.delays.POST : box.delays.GET);
      if (box.silent || (delay ?? 0) >= timeoutMs) {
        await wait(timeoutMs);
        throw new BoxError(ERROR_KINDS.TIMEOUT, 'Connected but silent: timeout');
      }
      if (delay) {
        await wait(delay);
      }
      const forced = box.statuses[path] ?? (method === 'POST' ? box.statuses.POST : undefined);
      if (forced) {
        return typeof forced === 'object'
          ? answer(forced.status, forced.body ?? 'error', forced.headers)
          : answer(forced, 'error');
      }
      if (Object.hasOwn(box.bodies, path)) {
        return answer(200, box.bodies[path]);
      }
      if (method === 'POST') {
        const id = Number(/^\/action\/nodes\/(\d+)$/.exec(path)?.[1]);
        const node = server.node(id);
        if (!node) {
          return answer(404, 'not found');
        }
        const { Action, Val } = JSON.parse(body);
        if (Action === 'SetVentilationState' && box.applies !== false) {
          node.Ventilation.State.Val = Val;
          node.Ventilation.Mode.Val = Val === 'AUTO' ? 'AUTO' : 'MANU';
        }
        return answer(200, box.result);
      }
      switch (path) {
        case '/info?module=General&submodule=Board':
          return answer(200, box.board);
        case '/info/nodes':
          return answer(200, { Nodes: box.nodes });
        case '/action/nodes':
          return answer(200, box.actions);
        case '/config/nodes?parameter=Name':
          return answer(200, box.names);
        case '/info?module=Ventilation':
          return box.noVentilationModule
            ? answer(UNSUPPORTED.status, UNSUPPORTED.body)
            : answer(200, box.ventilation);
        case '/info?module=HeatRecovery':
          return box.noHeatRecovery
            ? answer(UNSUPPORTED.status, UNSUPPORTED.body)
            : answer(200, box.heatRecovery);
        default: {
          const id = Number(/^\/info\/nodes\/(\d+)$/.exec(path)?.[1]);
          const node = server.node(id);
          return node ? answer(200, node) : answer(404, 'not found');
        }
      }
    },
  };
  return server;
}

export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
