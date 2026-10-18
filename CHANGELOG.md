# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Duco ventilation read over the local API of the Connectivity Board (no
  cloud, no account), by its IP address: one device per node (box, valves,
  room controls, sensors), keyed by the board serial and the node number.
- Ventilation state and mode (read), flow (%), time remaining, CO2,
  humidity and temperature when the node has them; outdoor, supply, extract
  and exhaust air temperatures and the days before the filter change on
  heat recovery boxes. Node names from the Duco app.
- The ventilation mode as a list (automatic, manual 1/2/3, permanent 1/2/3,
  away…) on the box and the valves, refused unless "Allow the commands" is
  on (off by default); each command reads the node first and is answered
  within Gladys' 5 s.
- Reads every 30 s (configurable); failures retried after 30 s to 5
  minutes; a 429 pauses every path, kept in `/data`; a secondary read failing
  never blocks the nodes.
- A node no longer reported by the box keeps its device, marked unreachable;
  the status names it. A republished device never loses a feature.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-duco/commits/main
