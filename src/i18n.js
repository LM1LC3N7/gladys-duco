// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature, state and mode names, the
// status of the integration, the answers of the button and the command errors.
// -----------------------------------------------------------------------------

import { FEATURES } from './constants.js';

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h", in both languages. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const BOX_NAME = both('Duco ventilation', 'Ventilation Duco');
export const NODE_NAME = (type, id) => both(`Duco ${type} ${id}`, `Duco ${type} ${id}`);

export const FEATURE_NAMES = {
  [FEATURES.STATE]: both('Ventilation state', 'État de la ventilation'),
  [FEATURES.MODE]: both('Ventilation mode (read)', 'Mode de ventilation (lu)'),
  [FEATURES.FLOW]: both('Flow', 'Débit'),
  [FEATURES.TIME_REMAINING]: both('Time remaining', 'Temps restant'),
  [FEATURES.CO2]: both('CO2', 'CO2'),
  [FEATURES.HUMIDITY]: both('Humidity', 'Humidité'),
  [FEATURES.TEMPERATURE]: both('Temperature', 'Température'),
  [FEATURES.TEMP_OUTDOOR]: both('Outdoor air temperature', "Température de l'air extérieur"),
  [FEATURES.TEMP_SUPPLY]: both('Supply air temperature', "Température de l'air soufflé"),
  [FEATURES.TEMP_EXTRACT]: both('Extract air temperature', "Température de l'air extrait"),
  [FEATURES.TEMP_EXHAUST]: both('Exhaust air temperature', "Température de l'air rejeté"),
  [FEATURES.FILTER]: both('Filter change in', 'Changement du filtre dans'),
  [FEATURES.VENTILATION]: both('Ventilation mode', 'Mode de ventilation'),
};

/** The ventilation states (the options of the select and the state text). */
export const STATE_NAMES = {
  AUTO: both('Automatic', 'Automatique'),
  AUT1: both('Automatic 1', 'Automatique 1'),
  AUT2: both('Automatic 2', 'Automatique 2'),
  AUT3: both('Automatic 3', 'Automatique 3'),
  MAN1: both('Manual 1', 'Manuel 1'),
  MAN2: both('Manual 2', 'Manuel 2'),
  MAN3: both('Manual 3', 'Manuel 3'),
  MAN1x2: both('Manual 1 (double time)', 'Manuel 1 (durée double)'),
  MAN2x2: both('Manual 2 (double time)', 'Manuel 2 (durée double)'),
  MAN3x2: both('Manual 3 (double time)', 'Manuel 3 (durée double)'),
  MAN1x3: both('Manual 1 (triple time)', 'Manuel 1 (durée triple)'),
  MAN2x3: both('Manual 2 (triple time)', 'Manuel 2 (durée triple)'),
  MAN3x3: both('Manual 3 (triple time)', 'Manuel 3 (durée triple)'),
  CNT1: both('Permanent 1', 'Permanent 1'),
  CNT2: both('Permanent 2', 'Permanent 2'),
  CNT3: both('Permanent 3', 'Permanent 3'),
  EMPT: both('Away', 'Absent'),
};

export const MODE_NAMES = {
  AUTO: both('Automatic', 'Automatique'),
  MANU: both('Manual', 'Manuel'),
  OVRL: both('Overruled', 'Forcé'),
  EXTN: both('External', 'Externe'),
  COOL: both('Cooling', 'Rafraîchissement'),
  DSBL: both('Disabled', 'Désactivé'),
};

export const STATE_TEXTS = {
  unknown: (code) =>
    code
      ? both(`Unknown state (${code})`, `État inconnu (${code})`)
      : both('Unknown state', 'État inconnu'),
  offline: both('Box unreachable', 'Box injoignable'),
  paused: both('Paused (HTTP 429)', 'En pause (HTTP 429)'),
  missing: both('Node no longer reported by the box', 'Nœud absent de la box'),
};

/** The integration status, the button and the logs a user may read. */
export const T = {
  noAddress: both(
    'Enter the IP address of your Duco box (Connectivity Board), then save.',
    "Saisissez l'adresse IP de votre box Duco (Connectivity Board), puis enregistrez.",
  ),
  invalid: (typed) =>
    both(
      `Invalid address: ${typed} (an IPv4 address or a host name; the box speaks plain HTTP).`,
      `Adresse invalide : ${typed} (une adresse IPv4 ou un nom d'hôte ; la box parle en HTTP simple).`,
    ),
  connecting: both('Reading the box…', 'Lecture de la box…'),
  connected: (summary) => both(`Connected. ${summary.en}`, `Connecté. ${summary.fr}`),
  unreachable: (address, wait) =>
    both(
      `No answer from ${address} (next try in ${wait.en}). Check the address and that the box is on the network.`,
      `Pas de réponse de ${address} (nouvel essai dans ${wait.fr}). Vérifiez l'adresse et que la box est sur le réseau.`,
    ),
  unsupported: (wait) =>
    both(
      `This Duco board is not supported: it needs the Connectivity Board with Public API 2.1 or later (next try in ${wait.en}).`,
      `Cette carte Duco n'est pas prise en charge : il faut la Connectivity Board avec l'API publique 2.1 ou plus récente (nouvel essai dans ${wait.fr}).`,
    ),
  rateLimited: (wait) =>
    both(
      `The box asks to slow down (HTTP 429): pause of ${wait.en}.`,
      `La box demande de ralentir (HTTP 429) : pause de ${wait.fr}.`,
    ),
  noId: both(
    'The box answered without a serial number: its nodes cannot be added.',
    'La box a répondu sans numéro de série : ses nœuds ne peuvent pas être ajoutés.',
  ),
  missing: (names) =>
    both(`Not reported by the box any more: ${names}.`, `Plus annoncé par la box : ${names}.`),
  summary: (model, count) =>
    both(
      `Duco ${model ?? 'box'}: ${count} node${count === 1 ? '' : 's'}.`,
      `Duco ${model ?? 'box'} : ${count} nœud${count === 1 ? '' : 's'}.`,
    ),
  test: {
    cooldown: both('Tested less than 10 s ago.', 'Testé il y a moins de 10 s.'),
  },
};

/** The errors a command answers to Gladys. */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  disabled: both(
    'Commands are disabled: turn on "Allow the commands" in the configuration of the integration.',
    "Les commandes sont désactivées : activez « Autoriser les commandes » dans la configuration de l'intégration.",
  ),
  unknownNode: both(
    'This node is not read by the integration (box not answering, or another box): not sent.',
    "Ce nœud n'est pas lu par l'intégration (box sans réponse, ou autre box) : non envoyée.",
  ),
  badValue: both(
    'Unknown ventilation mode: not sent.',
    'Mode de ventilation inconnu : non envoyé.',
  ),
  notOffered: both(
    'This node does not accept this ventilation mode: not sent.',
    "Ce nœud n'accepte pas ce mode de ventilation : non envoyé.",
  ),
  optionsUnknown: both(
    'The modes this node accepts are not known yet (the box did not give them): not sent.',
    'Les modes acceptés par ce nœud ne sont pas encore connus (la box ne les a pas donnés) : non envoyé.',
  ),
  paused: (wait) =>
    both(
      `The box asked to slow down: commands paused for ${wait.en}.`,
      `La box a demandé de ralentir : commandes en pause pendant ${wait.fr}.`,
    ),
  stillRunning: both(
    'Another command to the box is still running: not sent.',
    'Une autre commande vers la box est encore en cours : non envoyée.',
  ),
  tooSlow: both(
    'The box answered too slowly to send the command in time: not sent.',
    'La box a répondu trop lentement pour envoyer la commande à temps : non envoyée.',
  ),
  unknownState: (reason) =>
    both(
      `The state of the node could not be read just before (${reason}): command not sent.`,
      `L'état du nœud n'a pas pu être relu juste avant (${reason}) : commande non envoyée.`,
    ),
  noVentilation: both(
    'The node did not give its ventilation state: not sent.',
    "Le nœud n'a pas donné son état de ventilation : non envoyée.",
  ),
  notSent: (reason) =>
    both(
      `The box could not be reached (${reason}): command not sent.`,
      `La box n'a pas pu être jointe (${reason}) : commande non envoyée.`,
    ),
  refused: (reason) =>
    both(`The box refused the command (${reason}).`, `La box a refusé la commande (${reason}).`),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the state of the ventilation in a few seconds.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez l'état de la ventilation dans quelques secondes.`,
    ),
};
