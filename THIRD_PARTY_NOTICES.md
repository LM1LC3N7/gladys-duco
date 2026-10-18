# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## python-duco-connectivity

<https://github.com/ronaldvdmeer/python-duco-connectivity> (package
`python-duco-connectivity`, the library of Home Assistant's Duco
integration), by Ronald van der Meer. MIT License (`LICENSE` of the
repository, version 0.18.0). Its notice:

```
MIT License

Copyright (c) 2026 Ronald van der Meer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported in `src/constants.js`, `src/duco/client.js` and `src/devices.js`: the
local API of the Duco Connectivity Board on port 80 over plain HTTP without
authentication; the routes `/info?module=General&submodule=Board`,
`/info/nodes`, `/info/nodes/{node}`, `/action/nodes`,
`/config/nodes?parameter=Name`, `/info?module=Ventilation`,
`/info?module=HeatRecovery` and `POST /action/nodes/{node}` with
`{"Action": "SetVentilationState", "Val": ...}`; the `{"Val": ...}` shape of
the values; the node fields (`General.Type`, `General.Name`,
`Ventilation.State`, `Mode`, `TimeStateRemain`, `FlowLvlTgt`, `Sensor.Co2`,
`Rh`, `Temp`); the box temperatures in tenths of a degree (`TempOda`,
`TempSup`, `TempEta`, `TempEha`) and `TimeFilterRemain`; the ventilation
states and modes (`AUTO`, `AUT1`-`AUT3`, `MAN1`-`MAN3` and their `x2`/`x3`
variants, `CNT1`-`CNT3`, `EMPT`); the action result (`Result`, `Code`); the
answer of a box without an optional module (HTTP 400,
`{"Code": 3, "Result": "FAILED"}`); the minimum Public API 2.1 and the 404 of
the older Communication board. From Home Assistant's Duco integration (which
uses the library): the node types that ventilate, measure CO2 or humidity,
the select limited to the box and the valves, and the node names read from
`/config/nodes`.

Changed: the broad `/info` and `/config` (which hold the Wi-Fi keys) are never
read; a missing or mistyped field is unknown and a command that needs it is
refused; the node is read again right before each command and the command
decided on that read only; only the known ventilation states the node
advertises are offered and sent; requests go one at a time, commands first;
reads are not retried at once (spaced new tries) and commands never; no
identify switch, no bypass temperature, no Wi-Fi signal or diagnostics.
