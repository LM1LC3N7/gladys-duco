# Duco for Gladys

Shows your **Duco** ventilation (DucoBox Energy, Focus, Silent Connect…
fitted with the **Connectivity Board**) in Gladys through its **local API**:
no cloud, no account, straight on your network.

> **Never tested with a real Duco box.** Not affiliated with Duco. It talks
> to the local API of the box as the python-duco-connectivity library (used
> by Home Assistant) does.

> **Security: the local API of the box has no password and no encryption.**
> Any machine on your network can read it and change the ventilation. Keep
> the box on a **trusted network** (never exposed to the Internet, ideally on
> a separate network for connected devices).

## What you get

One device per **node** of the box: the box itself, zone valves, room
controls and sensors. Depending on what the node measures:

| Feature                 | Content                                                                       |
| ----------------------- | ----------------------------------------------------------------------------- |
| Ventilation mode        | List: automatic, manual 1/2/3, permanent 1/2/3, away… (commands allowed only) |
| Ventilation state       | Text: the current state ("Automatic", "Manual 2"…)                            |
| Ventilation mode (read) | Text: automatic, manual, overruled, external…                                 |
| Flow                    | In %, the flow level the box or the valve aims at                             |
| Time remaining          | In seconds, for a timed (manual) state                                        |
| CO2                     | In ppm (CO2 sensors)                                                          |
| Humidity                | In % (humidity sensors)                                                       |
| Temperature             | In °C, when the node gives one                                                |
| Air temperatures        | Outdoor, supply, extract, exhaust, in °C (heat recovery boxes only)           |
| Filter change in        | In days (heat recovery boxes only)                                            |

The ventilation mode exists on the box and the valves only (as in Home
Assistant), and only with the states the node advertises. The node names
are those given in the Duco app.

Read every 30 seconds by default (10 s to 10 min, configurable). Names and
accepted states are read again every hour.

## Installation

1. Give the box a **fixed IP address** in your router.
2. Install the integration from the Gladys store.
3. In its configuration, enter the **IP address of the Duco box**.
4. Save, then add the nodes from the **Discovery** tab.

The **Test the connection** button reads the box once (at most every 10
seconds). The Connectivity Board with Public API 2.1 or later is needed; the
older Communication Board is not supported (the configuration screen says
so).

## Command (off by default)

The **ventilation mode** refuses every command while **Allow the commands**
is off. On, Gladys may pick one of the states the node accepts: automatic,
manual 1/2/3 (timed, single, double or triple time), permanent 1/2/3, away…

It is a **list**, never a switch: a "turn everything off" (from Gladys,
Google Home, Alexa or HomeKit) never touches it. A scene can change it, but
only through an explicit action, and only while the commands are allowed.
Beware: the AI chat of Gladys (MCP) can create and run such a scene.

The **flow** is read only. HomeKit may show it as a fan, but any command
sent to the flow (on, off, speed) is refused: only the ventilation mode can
be commanded.

Good to know about the states:

- **Away** and **Permanent 1/2/3** last until the next change. There is
  **no "off" state**: the ventilation cannot be switched off from Gladys.
- **Manual** is timed (single, double or triple time). **Picking the timed
  state already running again does not restart its timer**: nothing is
  sent, to spare the write budget of the box. To restart it, pick another
  state, then come back.
- When the node is in a state the list does not offer (an unknown state, or
  one the node does not advertise), the list **keeps its last value**: look
  at "Ventilation state", which always shows the real state.
- A state offered once stays in the list, even when the node no longer
  advertises it; it is then refused unsent.

Before each command the integration **reads the node again** and decides on
that read only; no other request runs between that read and the sending,
and the option is checked again right before sending. A state already active
is not sent again (the box counts its writes). A command that cannot leave
within 3.5 seconds is refused unsent, also when it waits behind a slow read
(a slow box may therefore refuse); Gladys gets the answer within its 5
seconds. If the box does not confirm (silence, a 5xx error), Gladys shows
"Command sent, without confirmation": check the state, read again 5 then 20
seconds later. One command at a time.

## Errors and limits

- **Box unreachable**: "Ventilation state" shows "Box unreachable", the
  devices turn unreachable, the other values keep their last value. New try
  after 30 s, 1, 2 then 5 minutes, never faster than the interval.
- **Node removed** from the box: its device stays, marked unreachable, with
  "Node no longer reported by the box"; the configuration screen names it.
- **429 (too many requests)**, for example when the box used up its write
  budget: pause of 1 minute to 6 hours for everything (reads, button,
  commands), never shorter than the interval, kept in `/data` across a
  restart. During the pause, "Ventilation state" shows "Paused (HTTP 429)".
- **Air temperatures and filter**: when their read fails, new try 5 minutes
  later, then every hour; after three error answers in a row (4xx or an
  unreadable answer), they are not read again until the integration
  restarts. The nodes are never blocked.
- Requests to the box go one at a time; the integration never reads the
  parts of the API that hold the Wi-Fi key.
- Not yet: zones, node identification, bypass temperature target, Wi-Fi
  signal, air quality indexes.
- The logs never contain the text of the box's answers.

## Credits

Port of
[python-duco-connectivity](https://github.com/ronaldvdmeer/python-duco-connectivity)
(Ronald van der Meer, MIT, version 0.18.0), the library of Home Assistant's
Duco integration. Apache-2.0 license.
