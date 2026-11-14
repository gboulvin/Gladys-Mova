// -----------------------------------------------------------------------------
// Scene triggers and scene actions (Gladys 5.1+, manifest `scene_triggers` and
// `scene_actions`).
//
// Triggers say that something HAPPENED to a robot: a clean started, a clean
// ended, a fault appeared, a wear part came to its end. They are computed from
// two snapshots of the robot properties (before and after a change), so one
// transition fires one event whatever brought the change — a push of the
// robot or the safety-net refresh. The values themselves (state, battery,
// wear) stay device features.
//
// Actions are the operations a device feature cannot carry, because they take
// a text: clean rooms by their names, run a shortcut by its name. A third one
// reads the robot for the following actions of the scene (a message).
//
// Published keys are forever: a renamed key is a removed key for every scene
// using it.
// -----------------------------------------------------------------------------

import { CONSUMABLES, MOVA_WARNING_CODES, PROP, VACUUM_CLEANER_STATE } from './constants.js';
import { gladysStateOf, hasTask } from './devices/vacuum.js';
import { LANGUAGES, describeError, texts } from './i18n.js';
import { namedRooms } from './mova/map.js';
import { tracksConsumable } from './mova/models.js';
import { ROOM_SEPARATOR, normalizeName, stateText } from './widgets.js';

export const SCENE_TRIGGER = {
  CLEANING_STARTED: 'cleaning_started',
  CLEANING_FINISHED: 'cleaning_finished',
  ROBOT_ERROR: 'robot_error',
  CONSUMABLE_WORN: 'consumable_worn',
};

export const SCENE_ACTION = {
  CLEAN_ROOMS: 'clean_rooms',
  RUN_SHORTCUT: 'run_shortcut',
  ROBOT_STATUS: 'robot_status',
};

// A wear part fires its trigger when its remaining life comes down to this
// (percent): the level the widgets show in red.
export const WORN_THRESHOLD = 10;

function toNumber(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number)
    ? null
    : number;
}

// The fault of a robot: its error code, 0 for none or a mere warning.
function faultOf(props) {
  const code = toNumber(props.get(PROP.ERROR));
  return code !== null && code > 0 && !MOVA_WARNING_CODES.has(code) ? code : 0;
}

/**
 * What the triggers watch of a robot, at one moment.
 * @param {object} robot the robot (`props`, `newNumbering`, `caps`)
 * @returns {object} `{ known, task, fault, area, minutes, wear }`; `known` is
 *   false while the robot has not said its state yet
 */
export function sceneSnapshot(robot) {
  const wear = {};
  for (const consumable of CONSUMABLES) {
    const left = toNumber(robot.props.get(consumable.prop));
    if (left !== null && tracksConsumable(robot.caps || null, consumable)) {
      wear[consumable.code] = left;
    }
  }
  return {
    known: gladysStateOf(robot.props, robot.newNumbering) !== null,
    task: hasTask(robot.props),
    fault: faultOf(robot.props),
    area: toNumber(robot.props.get(PROP.CLEANED_AREA)),
    minutes: toNumber(robot.props.get(PROP.CLEANING_TIME)),
    wear,
  };
}

/**
 * The events between two snapshots of a robot.
 * @param {object|null} before the previous sceneSnapshot(), null for none
 * @param {object} after the current one
 * @param {string} language `fr`, `en`, `de` or `es`, for the texts
 * @returns {Array<{ key: string, data: object }>} the events, without the
 *   robot (the caller adds `device`)
 */
export function sceneEvents(before, after, language) {
  // Nothing to compare with (start of the integration, robot just found):
  // what the robot is doing is not something that just happened.
  if (!before || !before.known || !after.known) {
    return [];
  }
  const t = texts(language);
  const events = [];
  if (!before.task && after.task) {
    events.push({ key: SCENE_TRIGGER.CLEANING_STARTED, data: {} });
  }
  if (before.task && !after.task) {
    events.push({
      key: SCENE_TRIGGER.CLEANING_FINISHED,
      data: { area: after.area ?? 0, duration: after.minutes ?? 0 },
    });
  }
  if (after.fault && after.fault !== before.fault) {
    events.push({
      key: SCENE_TRIGGER.ROBOT_ERROR,
      data: { code: after.fault, message: describeError(after.fault, language) },
    });
  }
  for (const [code, left] of Object.entries(after.wear)) {
    const was = before.wear[code];
    if (was !== undefined && was > WORN_THRESHOLD && left <= WORN_THRESHOLD) {
      events.push({
        key: SCENE_TRIGGER.CONSUMABLE_WORN,
        data: { part: t.consumables[code] || code, remaining: left },
      });
    }
  }
  return events;
}

/**
 * The rooms a text names: names separated by "," or "+", as Gladys shows the
 * rooms, in any of the four languages, whatever the case and the accents.
 * @param {Array} rooms the rooms of the robot
 * @param {string} text the names
 * @returns {{ ids: Array<number>, unknown: Array<string> }} the room ids in
 *   the order given, and the names matched to nothing
 */
export function resolveRooms(rooms, text) {
  const byName = new Map();
  for (const language of LANGUAGES) {
    for (const room of namedRooms(rooms || [], language)) {
      byName.set(normalizeName(room.name), room.id);
    }
  }
  const ids = [];
  const unknown = [];
  for (const name of String(text || '').split(ROOM_SEPARATOR)) {
    const key = normalizeName(name);
    if (!key) {
      continue;
    }
    if (!byName.has(key)) {
      unknown.push(name.trim());
    } else if (!ids.includes(byName.get(key))) {
      ids.push(byName.get(key));
    }
  }
  return { ids, unknown };
}

/**
 * The shortcut a text names.
 * @param {Array} shortcuts the shortcuts of the robot (`{ id, name }`)
 * @param {string} text its name, as the app shows it
 * @returns {object|null} the shortcut, null when none has that name
 */
export function resolveShortcut(shortcuts, text) {
  const key = normalizeName(text);
  return (
    (key && (shortcuts || []).find((shortcut) => normalizeName(shortcut.name) === key)) || null
  );
}

/**
 * The outputs of the "robot_status" action.
 * @param {object} view the robot, see MovaIntegration.viewOf()
 * @param {string} language `fr`, `en`, `de` or `es`
 * @returns {object} `{ state, battery, cleaning, docked, error }`
 */
export function statusOutputs(view, language) {
  const state = gladysStateOf(view.props, view.newNumbering);
  const fault = faultOf(view.props);
  return {
    state: stateText(view, language) || texts(language).unknownState,
    battery: toNumber(view.props.get(PROP.BATTERY)) ?? 0,
    cleaning: state === VACUUM_CLEANER_STATE.RUNNING,
    docked: state === VACUUM_CLEANER_STATE.DOCKED || state === VACUUM_CLEANER_STATE.CHARGING,
    error: fault ? describeError(fault, language) : '',
  };
}
