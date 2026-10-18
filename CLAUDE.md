# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTP goes through `node:http`). It reads a Duco
ventilation box (Connectivity Board) over its local API (no cloud, no
account, no authentication) and shows each node on one Gladys device; the
ventilation mode can be changed behind an off-by-default option. Never
tested with a real Duco box, not affiliated with Duco.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js                  SDK bootstrap only
src/handlers.js           every SDK handler -> the app (shared with the tests)
src/app.js                DucoApp: polling, failures, 429 pause, devices, states, badges,
                          status, the test button, the command, guards
src/duco/client.js        reads and the command (python-duco-connectivity), parsing, the Gate
src/duco/http.js          the only network access (node:http, bounded), error kinds
src/devices.js            -> the Gladys devices and their states (pure), kept features
src/publisher.js          states within 300/min
src/store.js              /data/duco-state.json: the 429 pause (bounded to 6 h)
src/config.js             config_schema normalized (address, allow_commands, interval, language)
src/constants.js          paths, states, node types, feature roles, limits, timings
src/i18n.js               runtime texts, feature, state and mode names (en/fr)
test/fixtures/            the fake box behind the transport; Gladys is the SDK's fake
scripts/cover.mjs         cover.png generator
```

## Rules

- **External ids are forever**: device `duco:<serial>-<node>`, features
  `ventilation`, `state`, `mode`, `flow`, `time-remaining`, `co2`,
  `humidity`, `temperature`, `temperature-outdoor`, `temperature-supply`,
  `temperature-extract`, `temperature-exhaust`, `filter-remaining`. A
  republished device never loses a feature (`keepCreatedFeatures`).
- Manifest keys (`address`, `allow_commands`, `poll_interval`, `language`,
  the action `test_connection`) are frozen.
- **Never read the broad `/info` nor `/config`**: they hold the Wi-Fi keys.
- **The command**: never a switch, a writable binary or a writable fan (a
  "turn everything off" must not reach it); refused unless `allow_commands`
  (checked on arrival and again right before sending); decided on a fresh
  read only, refused when a value is missing; never sent after 3.5 s; a
  silence, a 5xx or a broken answer is "sent, without confirmation"; never
  retried; one at a time; the ack never waits for Gladys.
- **Answers are hostile**: own fields only, exact types, 256 KB at most;
  never log the text of an answer.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
