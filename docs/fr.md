# Duco pour Gladys

Affiche votre ventilation **Duco** (DucoBox Energy, Focus, Silent Connect…
équipée de la **Connectivity Board**) dans Gladys, par son **API locale** :
sans cloud, sans compte, directement sur votre réseau.

> **Module jamais testé avec une vraie box Duco.** Sans lien avec Duco. Il
> parle à l'API locale de la box comme la bibliothèque
> python-duco-connectivity (utilisée par Home Assistant).

> **Sécurité : l'API locale de la box n'a ni mot de passe ni chiffrement.**
> Toute machine de votre réseau peut la lire et changer la ventilation.
> Gardez la box sur un **réseau de confiance** (jamais exposée sur Internet,
> idéalement sur un réseau séparé pour les objets connectés).

## Ce que vous obtenez

Un appareil par **nœud** de la box : la box elle-même, les vannes de zone,
les commandes et les capteurs d'ambiance. Selon ce que le nœud mesure :

| Fonctionnalité            | Contenu                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Mode de ventilation       | Liste : automatique, manuel 1/2/3, permanent 1/2/3, absent… (commandes autorisées seulement) |
| État de la ventilation    | Texte : l'état actuel (« Automatique », « Manuel 2 »…)                                       |
| Mode de ventilation (lu)  | Texte : automatique, manuel, forcé, externe…                                                 |
| Débit                     | En %, le débit visé par la box ou la vanne                                                   |
| Temps restant             | En secondes, pour un mode temporaire (manuel)                                                |
| CO2                       | En ppm (capteurs CO2)                                                                        |
| Humidité                  | En % (capteurs d'humidité)                                                                   |
| Température               | En °C, quand le nœud la donne                                                                |
| Températures de l'air     | Extérieur, soufflé, extrait, rejeté, en °C (box à récupération de chaleur seulement)         |
| Changement du filtre dans | En jours (box à récupération de chaleur seulement)                                           |

Le mode de ventilation n'existe que sur la box et les vannes (comme dans
Home Assistant), et seulement avec les modes que le nœud annonce. Les noms
des nœuds sont ceux donnés dans l'application Duco.

Lecture toutes les 30 secondes par défaut (de 10 s à 10 min, réglable). Les
noms et les modes acceptés sont relus toutes les heures.

## Installation

1. Donnez à la box une **adresse IP fixe** dans votre box internet ou
   routeur.
2. Installez l'intégration depuis le store de Gladys.
3. Dans sa configuration, saisissez l'**adresse IP de la box Duco**.
4. Enregistrez, puis ajoutez les nœuds depuis l'onglet **Découverte**.

Le bouton **Tester la connexion** lit la box une fois (au plus toutes les
10 secondes). Il faut la Connectivity Board avec l'API publique 2.1 ou plus
récente ; l'ancienne Communication Board n'est pas prise en charge (l'écran
de configuration le dit).

## Commande (désactivée par défaut)

Le **mode de ventilation** refuse toute commande tant que l'option
**Autoriser les commandes** est désactivée. Activée, Gladys peut choisir un
des modes que le nœud accepte : automatique, manuel 1/2/3 (temporaire,
durée simple, double ou triple), permanent 1/2/3, absent…

C'est une **liste**, jamais un interrupteur : un « éteins tout » (depuis
Gladys, Google Home, Alexa ou HomeKit) ne la touche pas. Une scène peut la
changer, mais seulement par une action explicite, et seulement si les
commandes sont autorisées. Attention : le chat IA de Gladys (MCP) peut créer
et lancer une telle scène.

Le **débit** est en lecture seule. HomeKit peut le montrer comme un
ventilateur, mais toute commande envoyée sur le débit (allumer, éteindre,
changer la vitesse) est refusée : seul le mode de ventilation se commande.

À savoir sur les modes :

- **Absent** et **Permanent 1/2/3** durent jusqu'au prochain changement de
  mode. Il n'y a **pas de mode « arrêt »** : la ventilation ne s'éteint pas
  depuis Gladys.
- **Manuel** est temporisé (durée simple, double ou triple). **Rechoisir le
  mode temporisé déjà en cours ne relance pas sa minuterie** : rien n'est
  envoyé, pour ménager le quota d'écritures de la box. Pour la relancer,
  choisissez un autre mode puis revenez.
- Si le nœud est dans un état que la liste ne propose pas (un état inconnu,
  ou que le nœud n'annonce pas), la liste **garde sa dernière valeur** :
  regardez « État de la ventilation », qui affiche toujours l'état réel.
- Un mode proposé une fois reste dans la liste, même si le nœud ne l'annonce
  plus ; il est alors refusé sans être envoyé.

Avant chaque commande, l'intégration **relit le nœud** et décide sur cette
lecture seule ; aucune autre requête ne passe entre cette relecture et
l'envoi, et l'option est revérifiée juste avant l'envoi. Un mode déjà actif
n'est pas renvoyé (la box compte ses écritures). Une commande qui ne peut
pas partir dans les 3,5 secondes est refusée sans être envoyée, y compris
quand elle attend derrière une lecture lente (une box lente peut donc
refuser) ; Gladys reçoit la réponse dans ses 5 secondes. Si la box ne
confirme pas (silence, erreur 5xx), Gladys affiche « Commande envoyée, sans
confirmation » : vérifiez l'état, relu 5 puis 20 secondes plus tard. Une
commande à la fois.

## Erreurs et limites

- **Box injoignable** : « État de la ventilation » affiche « Box
  injoignable », les appareils passent en injoignable, les autres valeurs
  gardent leur dernière valeur. Nouvel essai après 30 s, 1, 2 puis
  5 minutes, jamais plus vite que l'intervalle.
- **Nœud retiré** de la box : son appareil reste, marqué injoignable, avec
  « Nœud absent de la box » ; l'écran de configuration le nomme.
- **429 (trop de requêtes)**, par exemple quand la box a épuisé son quota
  d'écritures : pause de 1 minute à 6 heures pour tout (lectures, bouton,
  commandes), jamais plus courte que l'intervalle, gardée dans `/data` après
  un redémarrage. Pendant la pause, « État de la ventilation » affiche « En
  pause (HTTP 429) ».
- **Températures de l'air et filtre** : si leur lecture échoue, nouvel essai
  5 minutes plus tard, puis toutes les heures ; après trois réponses
  d'erreur de suite (4xx ou réponse illisible), elles ne sont plus lues
  jusqu'au redémarrage de l'intégration. Les nœuds ne sont jamais bloqués.
- Les requêtes vers la box partent une à la fois ; l'intégration ne lit
  jamais les parties de l'API qui contiennent la clé Wi-Fi.
- Pas encore : zones, identification des nœuds, consigne de température du
  bypass, signal Wi-Fi, indices de qualité d'air.
- Les journaux ne contiennent jamais le texte des réponses de la box.

## Crédits

Portage de
[python-duco-connectivity](https://github.com/ronaldvdmeer/python-duco-connectivity)
(Ronald van der Meer, MIT, version 0.18.0), la bibliothèque de l'intégration
Duco de Home Assistant. Licence Apache-2.0.
