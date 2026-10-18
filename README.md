# gladys-duco

[Gladys Assistant](https://gladysassistant.com) external integration for
**Duco** ventilation (Belgium, Netherlands) through the local HTTP API of the
Duco Connectivity Board: one device per node with its ventilation state,
flow, CO2, humidity and temperatures, and the ventilation mode as a select
behind an off-by-default option. **Never tested with a real Duco box. Not
affiliated with Duco.** The local API has no authentication: keep the box on
a trusted network.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (DucoApp)
                                  ├─ src/duco/client.js  reads, the command, parsing, one request at a time
                                  ├─ src/duco/http.js    the only network access (node:http, bounded)
                                  ├─ src/devices.js      the devices and their states (pure)
                                  ├─ src/publisher.js    states within 300/min
                                  └─ src/store.js        /data/duco-state.json (429 pause)
```

- **Reads**: `GET /info?module=General&submodule=Board` (once, and again after
  an outage), `GET /info/nodes` every 30 s (configurable, 10 s – 10 min);
  `GET /action/nodes` and `GET /config/nodes?parameter=Name` every hour;
  `GET /info?module=Ventilation` and `?module=HeatRecovery` at each read
  when the box has them (5 s at most; a 400 code 3, or three 4xx/unreadable
  answers in a row, means it does not: never asked again until a restart;
  other failures retried after 5 min, then hourly). A secondary read failing never blocks the nodes. The
  broad `/info` and `/config` are never read (Wi-Fi keys). Failures retried
  after 30 s, 1, 2, 5 min, never under the interval.
- **Devices**: `ext:<selector>:duco:<serial>-<node>` (board serial and node
  number), never the IP address. Features by node type (as Home Assistant)
  and by the values the node was seen to report; a republished device never
  loses a feature (those of the created device are kept).
- **Command** (`allow_commands`, off by default): the ventilation mode, a
  `text/select` of the known states the node advertises, on the box and the
  valves only; never a switch nor a writable binary or fan. It holds the
  request queue from a fresh read of the node to the end of the POST,
  decides on that read only, checks the option again right before the
  transport, leaves within 3.5 s of the click or is refused unsent (also when
  still queued behind a slow read), and
  is answered by 4.3 s; a silence, a 5xx or a broken answer is "sent,
  without confirmation", followed by reads of the node 5 s and 20 s later.
  One at a time; never retried; not sent when already active. The ack never
  waits for a publication to Gladys.
- **Guards**: after a command, until a read shows it (or 90 s), the same
  state is sent again even when the node shows it; a read equal to the
  start state lifts nothing.
- **Hostile answers**: 256 KB at most, only own fields read with their exact
  type (no prototype pollution; a missing value refuses the command), 100
  nodes at most, no answer text in the logs.

## Credits

The local API, its routes and fields, the ventilation states and the action
are ported from
[python-duco-connectivity](https://github.com/ronaldvdmeer/python-duco-connectivity)
(Ronald van der Meer, MIT, 0.18.0); the node types and the entity choices
follow Home Assistant's Duco integration. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled on the sibling
integration [gladys-technove](https://github.com/LM1LC3N7/gladys-technove)
(local HTTP, commands behind an option).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the box is a fake behind the injected
transport, Gladys is the SDK's fake; `test/client.test.js` runs the real
transport against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the
Docker image).
