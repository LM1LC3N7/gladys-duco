# TODO — Duco v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #275, lot 8) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-18): local API read of one Duco box
      (Connectivity Board, Public API ≥ 2.1), one device per node, ventilation
      state/mode (read), flow, time remaining, CO2, humidity, temperature,
      box air temperatures and filter days when present, node names, the
      ventilation mode select behind `allow_commands` (off), polling and
      backoff, 429 pause persisted, test button, docs en/fr, cover. Tested
      against made-up answers only.
- [ ] **Milestone 2 — real box**: run against a real Duco box (see "To
      check"), turn the answers (anonymized, without the Lan section) into
      fixtures.
- [ ] **Milestone 3 — more**: zones (`/info/zones`, a zone name per node as a
      param, or one device per zone if users ask), IAQ indexes (`IaqCo2`,
      `IaqRh`), Wi-Fi signal and diagnostics (only through narrow selectors,
      never the broad `/info`), node identification (a button, never a
      switch), bypass temperature target (behind the option), several boxes.

## To check on a real box

- `SerialBoardBox`: present and stable on every board (it keys every device)?
  Some boards may write `-`: the status then says "no serial number" and no
  device is created.
- `/info/nodes`: the units (`FlowLvlTgt` in % in `/info` but 0–255 in
  `/config`?, `Temp` in °C, `Rh` in %, `Co2` in ppm), the node `Temp` of a
  BOX (air or board temperature?).
- The meaning of `AUT1`–`AUT3` (named "Automatic 1/2/3" here) and of the
  `MANnx2`/`MANnx3` variants (named "double/triple time"), and the labels
  Duco uses in its own app.
- `POST /action/nodes/{node}`: the answer (`{"Result":"SUCCESS"}`?), the
  delay before `/info/nodes/{node}` shows the new state, what the box does
  with a state its node does not accept.
- The write budget (`General.PublicApi.WriteReqCntRemain`, about 200): how
  it refills, and that an exhausted budget answers 429 (python-duco-connectivity's
  `DucoWriteLimitError`).
- Latency: python-duco-connectivity measured 2 to 4.5 s on some requests of
  an ENERGY box. Commands refuse when the node cannot be read and the command
  sent within 3.5 s: check how often that happens.
- `/info?module=Ventilation` and `HeatRecovery` on FOCUS and SILENT_CONNECT
  (expected: 400 code 3, asked once).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-duco:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the
  four agree.
- **Own client on `node:http`, no Python**: python-duco-connectivity 0.18.0
  (MIT, the library of Home Assistant's Duco integration) ported to the
  ~400 lines this integration needs; no npm client exists. Credited in
  README, docs and `THIRD_PARTY_NOTICES.md` (full MIT notice), shipped in the
  image with `LICENSE` (the standard Apache-2.0 text without any name).
  Runtime dependency: the SDK only. Reference cloned read only in
  `_ref/python-duco-connectivity` (tag v0.18.0, d7b4b68); Home Assistant's
  `homeassistant/components/duco` read for the entities.
- **One box per integration**, typed by the user (IPv4 or host name, optional
  port; HTTPS refused: the box speaks plain HTTP). No mDNS discovery in v1.
- **One device per node** (the brief allowed zone or node): nodes carry the
  values (state, flow, sensors) and the command; zones are only names and
  groups of nodes (TODO milestone 3). Device id `duco:<serial>-<node>`: the
  board serial (`SerialBoardBox`, from the Board submodule, which holds no
  secret) and the node number; never the IP, never a name. The MAC was not
  used: it lives in the Lan submodule next to the Wi-Fi access point key.
- **Never the broad `/info` nor `/config`**: they hold `WifiApKey` and
  `WifiClientKey`. The box temperatures and the filter come from the narrow
  `module=Ventilation` and `module=HeatRecovery` reads; a 400 code 3 marks the
  module as absent until a restart.
- **Requests one at a time** (a `Gate`; Home Assistant holds a lock too),
  commands and their fresh read jump the queue but never cut the request in
  flight.
- **Polling**: `/info/nodes` every 30 s (10 s – 10 min); the board once, and
  again after any failure (another box may answer at the address: its nodes
  become new devices, the old ones "missing"); `/action/nodes` and names
  every hour, 5 min after a failure, and at once (at most every 5 min) when a
  new node appears; optional modules at each read. A secondary failure never
  blocks the nodes (lot 6 lesson). Failures: 30 s, 1, 2, 5 min, never shorter
  than the interval; an unsupported board (404 or API < 2.1, as Home
  Assistant) every 30 min.
- **429**: the box answers 429 when its write budget is spent; handled as
  every 429 (wave 2 lesson): `Retry-After` bounded to 1 min – 6 h, 5 min
  without; every path (polling, button, commands); persisted in `/data`,
  bounded to 6 h at a restart; a reconnection to Gladys never clears it.
- **Features and units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`): CO2
  `co2-sensor/integer` ppm; humidity `humidity-sensor/decimal` %; temperatures
  `temperature-sensor/decimal` °C; flow `fan/percent` % **read only** (as
  gladys-elegoo; the box's target flow level); time remaining
  `duration/integer` s; filter `duration/integer` days; state and mode
  `text/text`. Roles by node type (Home Assistant's lists: the box and valves
  ventilate, CO2 and RH types) plus any value the node was seen to report
  (node temperature: Home Assistant does not show it, the brief asks "if
  available"). IAQ indexes left out (disabled by default in Home Assistant).
- **No lost feature** (lot 6 lesson): the features of the created device
  (`gladys.devices`, kept up to date by the SDK) that a new build lacks are
  republished as they are, a select keeps its created options; the roles a
  node reported once are remembered while the integration runs.
- **The command**: the ventilation mode, a `text/select` (lot 6 lesson: never
  a switch nor a writable binary; no writable fan either, "turn everything
  off" must not reach it), behind `allow_commands` (off by default, only
  `true` allows). Only on the box and valve node types (as Home Assistant: the
  box advertises SetVentilationState broadly), with the options the node
  advertises in `/action/nodes`, kept to the 17 known states (an unknown
  value is never offered nor sent). Value checked strictly (exact string of
  the list: no number, no trim, no case change).
- **Command rules** (lot 6 and waves 2/3 lessons): the option checked on
  arrival and again right before sending; the node read again
  (`/info/nodes/{node}`, 2.5 s at most) and the command decided on that read
  only; refused when the node gives no ventilation state, when its accepted
  states are not known, when it is not the box read now (other serial,
  unreachable), during a pause. Not sent when already in that state (unless a
  guard holds): the box counts its writes. Sent within 3.5 s of the click or
  refused unsent; answered by 4.3 s. Outcomes: `{"Result":"SUCCESS"}` →
  success; `FAILED` → "refused by the box" (code shown); nothing accepted the
  connection → "not sent"; connected then silent, a 5xx or a broken answer →
  **"sent, without confirmation"**, guard set; another 4xx → refused; 429 →
  pause. Reads of the node 5 s and 20 s after every command (spaced; skipped
  during a pause). One command at a time (no emergency stop to let through:
  ventilation only). The ack never waits for Gladys: the fresh read is
  published in the background.
- **Guards** (waves 2/3 lessons): after a command that may have been applied,
  a guard per node keeps the start state and the wanted one; while it holds
  (until a read shows a move then the wanted state, or 90 s), the command is
  always sent, never answered "already so". A read equal to the start state
  never lifts it; an unknown state never lifts it.
- **Hostile answers**: 256 KB at most (five nodes are about 2 KB); only own
  fields of plain objects, each with its exact type (`Object.hasOwn`); 100
  nodes at most; the config takes only its known keys; feature ids matched by
  a strict pattern and a fixed role list (`__proto__`, `constructor`
  refused). Logs carry error kinds and HTTP statuses only.
- **Box unreachable**: state text "Box unreachable", badges unreachable, the
  other values keep their last one. **Node no longer reported**: state text,
  badge unreachable, named in the status (still "Connected": a sensor removed
  by the installer is not an outage).
- **Reconnection to Gladys** (`connected`): republishes status, Discovery,
  states (published-state memory forgotten) and badges, as the core keeps
  them in memory (lot 6 lesson); never clears the pause nor the client; a new
  address or interval restarts the polling.
- **Trusted network**: the API has no authentication: said in the manifest,
  the docs (fr/en) and the README.
- **gladys_version >= 5.1.0** (as the sibling local modules); **categories
  `climate`, `environment`**, transport `local`.
- **Not checked here (PIPELINE step 1, main session)**: duplicates in the
  store, the core and the forum were checked when the batch was reserved
  (post #275). No Docker on this PC: the image was not built locally. The
  store validator runs at publication (main session).
