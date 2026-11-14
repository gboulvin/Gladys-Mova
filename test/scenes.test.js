// Scene triggers and scene actions: the transitions that fire an event (and
// the ones that must not), the names a scene author types, and the whole path
// against the fake MOVAhome cloud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as mqttLibrary from 'mqtt';

import { MovaCloud, hashPassword } from '../src/mova/cloud.js';
import { MovaIntegration } from '../src/integration.js';
import {
  SCENE_ACTION,
  SCENE_TRIGGER,
  resolveRooms,
  resolveShortcut,
  sceneEvents,
  sceneSnapshot,
  statusOutputs,
} from '../src/scenes.js';
import { CONFIG_KEYS } from '../src/session.js';
import { ACCOUNT, ROBOT, initialProperties, startFakeMova } from './helpers/fakeMova.js';
import { createFakeGladys, silentLogger } from './helpers/fakeGladys.js';
import { waitUntil } from './helpers/fakeGladysHost.js';

const manifest = JSON.parse(
  await (
    await import('node:fs/promises')
  ).readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const robotWith = (changes = []) => {
  const props = initialProperties();
  for (const [key, value] of changes) {
    props.set(key, value);
  }
  return { props, newNumbering: true, caps: null };
};
const CLEANING = [
  ['2.1', 1],
  ['4.1', 2],
  ['4.7', 1],
  ['3.2', 2],
];

test('nothing fires without a previous reading of the robot', () => {
  const cleaning = sceneSnapshot(robotWith(CLEANING));
  assert.deepEqual(sceneEvents(null, cleaning, 'en'), []);
  const unknown = sceneSnapshot({ props: new Map(), newNumbering: true, caps: null });
  assert.equal(unknown.known, false);
  assert.deepEqual(sceneEvents(unknown, cleaning, 'en'), []);
  assert.deepEqual(sceneEvents(cleaning, cleaning, 'en'), []);
});

test('a clean fires once when it starts and once when it ends', () => {
  const docked = sceneSnapshot(robotWith());
  const cleaning = sceneSnapshot(robotWith(CLEANING));
  assert.deepEqual(sceneEvents(docked, cleaning, 'en'), [
    { key: SCENE_TRIGGER.CLEANING_STARTED, data: {} },
  ]);
  // paused, resumed, sent back to recharge mid-task: the same task
  const paused = sceneSnapshot(
    robotWith([
      ['2.1', 3],
      ['4.1', 2],
      ['4.7', 7],
    ]),
  );
  assert.deepEqual(sceneEvents(cleaning, paused, 'en'), []);
  assert.deepEqual(sceneEvents(paused, cleaning, 'en'), []);
  const done = sceneSnapshot(
    robotWith([
      ['4.2', 42],
      ['4.3', 35],
    ]),
  );
  assert.deepEqual(sceneEvents(cleaning, done, 'en'), [
    { key: SCENE_TRIGGER.CLEANING_FINISHED, data: { area: 35, duration: 42 } },
  ]);
});

test('a fault fires with its description, a warning does not', () => {
  const docked = sceneSnapshot(robotWith());
  const fault = sceneSnapshot(robotWith([['2.2', 1]]));
  const [event] = sceneEvents(docked, fault, 'fr');
  assert.equal(event.key, SCENE_TRIGGER.ROBOT_ERROR);
  assert.equal(event.data.code, 1);
  assert.ok(event.data.message.length > 3);
  // the same fault, read again
  assert.deepEqual(sceneEvents(fault, fault, 'fr'), []);
  // 68 is a warning of the app, not a fault
  assert.deepEqual(sceneEvents(docked, sceneSnapshot(robotWith([['2.2', 68]])), 'fr'), []);
});

test('a wear part fires when it comes down to 10 %, once', () => {
  const before = sceneSnapshot(robotWith([['9.2', 11]]));
  const after = sceneSnapshot(robotWith([['9.2', 10]]));
  assert.deepEqual(sceneEvents(before, after, 'en'), [
    { key: SCENE_TRIGGER.CONSUMABLE_WORN, data: { part: 'Main brush', remaining: 10 } },
  ]);
  assert.deepEqual(sceneEvents(after, sceneSnapshot(robotWith([['9.2', 9]])), 'en'), []);
});

test('every event only carries keys the manifest declares', () => {
  const declared = Object.fromEntries(
    manifest.scene_triggers.map((trigger) => [
      trigger.key,
      new Set([...(trigger.fields || []), ...(trigger.variables || [])].map((f) => f.key)),
    ]),
  );
  assert.deepEqual(Object.keys(declared).sort(), Object.values(SCENE_TRIGGER).sort());
  const docked = sceneSnapshot(robotWith());
  const busy = sceneSnapshot(robotWith([...CLEANING, ['2.2', 1], ['9.2', 5]]));
  const events = [...sceneEvents(docked, busy, 'en'), ...sceneEvents(busy, docked, 'en')];
  assert.deepEqual(
    [...new Set(events.map((event) => event.key))].sort(),
    Object.values(SCENE_TRIGGER).sort(),
  );
  for (const event of events) {
    for (const key of Object.keys(event.data)) {
      assert.ok(declared[event.key].has(key), `${event.key}.${key}`);
    }
    // the caller adds the robot
    assert.ok(declared[event.key].has('device'));
  }
});

test('rooms and shortcuts are found by name, whatever the case and accents', () => {
  const rooms = [
    { id: 1, type: 1 },
    { id: 2, type: 4 },
    { id: 3, type: 0, index: 0, customName: 'Chambre de Léa' },
  ];
  assert.deepEqual(resolveRooms(rooms, 'cuisine, SALON + chambre de lea, Cuisine'), {
    ids: [2, 1, 3],
    unknown: [],
  });
  // the names of the other languages are understood too
  assert.deepEqual(resolveRooms(rooms, 'Kitchen').ids, [2]);
  assert.deepEqual(resolveRooms(rooms, 'Garage, Salon'), { ids: [1], unknown: ['Garage'] });
  assert.deepEqual(resolveRooms(rooms, '  '), { ids: [], unknown: [] });
  const shortcuts = [{ id: 32, name: 'Après le dîner' }];
  assert.equal(resolveShortcut(shortcuts, ' apres le diner ').id, 32);
  assert.equal(resolveShortcut(shortcuts, 'Autre'), null);
  assert.equal(resolveShortcut(shortcuts, ''), null);
});

test('the status outputs are the scalars the manifest declares', () => {
  const action = manifest.scene_actions.find((a) => a.key === SCENE_ACTION.ROBOT_STATUS);
  const outputs = statusOutputs(robotWith(), 'en');
  assert.deepEqual(Object.keys(outputs).sort(), action.outputs.map((o) => o.key).sort());
  for (const output of action.outputs) {
    assert.equal(typeof outputs[output.key], output.type, output.key);
  }
  assert.equal(outputs.battery, 100);
  assert.equal(outputs.docked, true);
  assert.equal(outputs.cleaning, false);
  assert.equal(outputs.error, '');
  assert.ok(statusOutputs(robotWith([['2.2', 1]]), 'en').error.length > 3);
  assert.equal(statusOutputs(robotWith(CLEANING), 'en').cleaning, true);
});

test('triggers and actions against the fake cloud', async (t) => {
  const fake = await startFakeMova();
  const gladys = createFakeGladys({
    config: {
      [CONFIG_KEYS.USERNAME]: ACCOUNT.username,
      [CONFIG_KEYS.REGION]: 'eu',
      [CONFIG_KEYS.PASSWORD_HASH]: hashPassword(ACCOUNT.password),
      [CONFIG_KEYS.REFRESH_TOKEN]: 'refresh-1',
    },
  });
  const mova = new MovaIntegration({
    gladys,
    logger: silentLogger,
    dataDir: mkdtempSync(path.join(tmpdir(), 'gladys-mova-')),
    mqtt: {
      connect: (url, options) => mqttLibrary.connect(url.replace('mqtts://', 'mqtt://'), options),
    },
    createCloud: (options) => new MovaCloud({ ...options, baseUrl: fake.base }),
    timings: { REFRESH_AFTER_COMMAND_MS: [] },
  });
  t.after(async () => {
    mova.stopAll();
    await fake.close();
  });
  await mova.onConnected();
  const [device] = gladys.discovered.at(-1);
  const robot = mova.robots.get(ROBOT.did);

  await t.test('a robot not added to Gladys fires nothing', async () => {
    await mova.refresh(robot);
    await waitUntil(() => robot.channel.connected, 'the real-time channel');
    await fake.change(CLEANING);
    await waitUntil(() => robot.props.get('2.1') === 1, 'the push');
    await fake.change([
      ['2.1', 13],
      ['4.1', 0],
      ['4.7', 0],
      ['3.2', 3],
    ]);
    await waitUntil(() => robot.props.get('2.1') === 13, 'the push');
    assert.deepEqual(gladys.sceneEvents, []);
  });

  await t.test('a created robot fires each transition once, with its device', async () => {
    gladys.devices.push(device);
    await mova.onDeviceCreated(device);
    await fake.change(CLEANING);
    await waitUntil(() => gladys.sceneEvents.length === 1, 'the start event');
    assert.deepEqual(gladys.sceneEvents[0], {
      key: SCENE_TRIGGER.CLEANING_STARTED,
      data: { device: device.external_id },
    });
    // a safety-net refresh reading the same values fires nothing more
    await mova.refresh(robot);
    assert.equal(gladys.sceneEvents.length, 1);
    await fake.change([
      ['2.1', 13],
      ['4.1', 0],
      ['4.7', 0],
      ['3.2', 3],
      ['4.2', 12],
      ['4.3', 9],
    ]);
    await waitUntil(() => gladys.sceneEvents.length === 2, 'the end event');
    assert.deepEqual(gladys.sceneEvents[1], {
      key: SCENE_TRIGGER.CLEANING_FINISHED,
      data: { device: device.external_id, area: 9, duration: 12 },
    });
  });

  await t.test('clean_rooms cleans the rooms named, in the order given', async () => {
    const outputs = await mova.sceneAction(SCENE_ACTION.CLEAN_ROOMS, {
      device: device.external_id,
      rooms: 'Cuisine, salon',
    });
    assert.deepEqual(outputs, { started: true, rooms: 2 });
    const command = fake.state.commands.at(-1);
    assert.equal(command.params.in[0].value, 18);
    assert.deepEqual(
      JSON.parse(command.params.in[1].value).selects.map((entry) => entry[0]),
      [2, 1],
    );
  });

  await t.test('a name matching nothing is an output, and sends nothing', async () => {
    const count = fake.state.commands.length;
    assert.deepEqual(
      await mova.sceneAction(SCENE_ACTION.CLEAN_ROOMS, {
        device: device.external_id,
        rooms: 'Cuisine, Garage',
      }),
      { started: false, rooms: 0 },
    );
    assert.deepEqual(
      await mova.sceneAction(SCENE_ACTION.RUN_SHORTCUT, {
        device: device.external_id,
        shortcut: 'Inconnu',
      }),
      { started: false },
    );
    assert.equal(fake.state.commands.length, count);
  });

  await t.test('run_shortcut runs the shortcut of that name', async () => {
    assert.deepEqual(
      await mova.sceneAction(SCENE_ACTION.RUN_SHORTCUT, {
        device: device.external_id,
        shortcut: 'cuisine seule',
      }),
      { started: true },
    );
    assert.deepEqual(fake.state.commands.at(-1).params.in, [
      { piid: 1, value: 25 },
      { piid: 10, value: '33' },
    ]);
  });

  await t.test('robot_status reads the robot, an unknown robot fails the action', async () => {
    const outputs = await mova.sceneAction(SCENE_ACTION.ROBOT_STATUS, {
      device: device.external_id,
    });
    assert.equal(typeof outputs.state, 'string');
    assert.equal(typeof outputs.battery, 'number');
    await assert.rejects(
      mova.sceneAction(SCENE_ACTION.ROBOT_STATUS, { device: 'ext:mova-test:vacuum:nope' }),
      /Unknown robot/,
    );
    await assert.rejects(mova.sceneAction('nope', { device: device.external_id }), /Unknown scene/);
  });
});
