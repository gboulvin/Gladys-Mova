// -----------------------------------------------------------------------------
// Entry point of the Gladys MOVA external integration.
//
//   - controls the robot vacuums of a MOVAHOME app account, through the
//     MOVAhome cloud (the robots offer no local API);
//   - links the account once, from the email (or phone number) and password,
//     in the Actions box of the Configuration screen; only a fingerprint of
//     the password is kept, to reopen the session silently afterwards;
//   - publishes the robots as discovered devices (state, run mode, suction,
//     dock, battery, error, rooms, app shortcuts, consumables);
//   - publishes every change the robot pushes in real time, a refresh every
//     minute only as a safety net; forwards the user commands to the robot;
//   - serves four dashboard widgets: the robot with its map, quick cleaning
//     buttons, one setting as buttons, and the wear of its parts;
//   - extends the scene editor: four triggers (clean started, clean finished,
//     fault, worn part) and three actions (clean rooms by name, run a shortcut
//     by name, read the robot).
//
// The Gladys supervisor provides GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR: `new GladysIntegration()` reads them.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';

import { didOf } from './src/devices/convertDevice.js';
import { runDiagnostic } from './src/diagnostic.js';
import { MovaIntegration } from './src/integration.js';
import { SCENE_ACTION } from './src/scenes.js';
import { WIDGET } from './src/widgets.js';

const gladys = new GladysIntegration();
const mova = new MovaIntegration({ gladys, logger });

// --- Discovery: the user opened the Discovery screen -------------------------
// Scan requests are not acknowledged: a failure only shows in the logs.
gladys.onScanRequest(async () => {
  logger.info('Scan requested: reading the robots of the account');
  try {
    await mova.discover();
  } catch (err) {
    logger.error(`Scan failed: ${err.message}`);
  }
});

// --- Devices ----------------------------------------------------------------
// A fallback: the integration refreshes the robots itself every minute (Gladys
// 5.2.0 may never poll them, GladysAssistant/Gladys#3198).
gladys.onPoll((device) => mova.poll(device));
gladys.onSetValue((device, feature, value) => {
  // The feature code only: the external id carries the robot id.
  const code = String(feature && feature.external_id)
    .split(':')
    .pop();
  logger.info(`Command ${code} = ${value}`);
  return mova.setValue(device, feature, value);
});
gladys.onDeviceCreated((device) => mova.onDeviceCreated(device));

// --- Configuration screen ------------------------------------------------------
// The credentials travel with the action, right above its button: nothing to
// save first, and the password never lands in the configuration.
gladys.onAction('mova_link', (fields) => mova.link(fields));
gladys.onAction('mova_unlink', () => mova.unlink());
gladys.onAction('mova_diagnostic', (fields) =>
  runDiagnostic(mova, { did: didOf(gladys, fields && fields.device) }),
);
gladys.onConfigUpdated((config) => mova.onConfigUpdated(config));

// --- Dashboard widgets (Gladys 5.1+) ---------------------------------------------
for (const key of Object.values(WIDGET)) {
  gladys.onWidgetGet(key, (request) => mova.widgetContent(key, request));
}
// The buttons carry the robot id: the same handler serves every widget.
for (const key of [WIDGET.ROBOT, WIDGET.QUICK_CLEAN, WIDGET.ROBOT_SETTING]) {
  gladys.onWidgetAction(key, (actionKey, params) => mova.widgetAction(actionKey, params));
}
gladys.onWidgetGetImage((imageKey) => mova.widgetImage(imageKey));

// --- Scene actions (Gladys 5.1+) -------------------------------------------------
// One handler per key of the manifest `scene_actions`. The scene TRIGGERS need
// none: the integration fires them itself (publishSceneEvent) when a robot
// starts or ends a clean, reports a fault or wears a part out.
for (const key of Object.values(SCENE_ACTION)) {
  gladys.onSceneAction(key, (fields) => mova.sceneAction(key, fields));
}

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', () => {
  mova.onConnected().catch((err) => logger.error(`Start failed: ${err.message}`));
});
gladys.on('disconnected', () => {
  logger.warn('WebSocket disconnected from Gladys: the SDK reconnects');
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}: shutting down`);
  mova.stopAll();
});

logger.info('Starting the MOVA integration');
gladys.connect().catch((err) => {
  logger.error(`Initial connection failed: ${err.message}`);
  process.exit(1);
});
