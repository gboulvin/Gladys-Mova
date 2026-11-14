# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the robot vacuums of a
**MOVAhome** account: a Node.js service (Node 22+, ESM, no build step) that runs
in its own sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Its only other runtime dependency is `mqtt` (the real-time channel of the
robots).

It started from the official JavaScript template
(`GladysAssistant/integration-template-js`: scaffolding, workflows, release
scripts) and is **derived from the Dreame integration of the Gladys store**
(`guim31/gladys-dreame`, Apache-2.0: device model, cloud and MQTT clients, map,
widgets, translations, tests). MOVA is a brand of the Dreame group; the MOVAhome
cloud is a copy of the Dreamehome one. When the Dreame integration fixes a
protocol bug, the fix most likely applies here too.

## Status: never run against a real robot

Nobody has run this against the live MOVAhome cloud or a real MOVA robot yet. A
coding session has **neither a Gladys instance nor a robot**, and its network
cannot reach the cloud (port 13267 is not proxied). The test suite, the lint and
the store validator are the only checks available: say so, rather than
concluding that "it works". Real feedback comes from users, through the
**Diagnostic** action (no email, id, MAC, token nor room name in it).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/scenes.test.js           # one file
node --test --test-name-pattern "fault"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it (Markdown too)
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing. Prettier also checks the Markdown: run `npm run format` after editing
this file, the README or the docs.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/integration.js                MovaIntegration: account, discovery, polling, commands,
                                  publication, widgets, scene events and actions
src/constants.js                  MOVA_CLOUD (hosts, app identity, tenant), MIoT ids, enums,
                                  feature codes
src/mova/cloud.js                 MOVAhome cloud client (login, device list, MIoT RPC, files)
src/mova/mqtt.js                  real-time channel, one MQTT client per robot
src/mova/map.js, render.js        map decoding (AES, rooms, path) and PNG drawing
src/mova/models.js                model table lookups (src/data/models.json)
src/mova/mopping.js, rooms.js, settings.js, shortcuts.js
src/devices/vacuum.js             features, states and commands of a robot
src/devices/convertDevice.js      robot -> Gladys discovered device, external ids
src/widgets.js                    the four dashboard widgets (manifest `widgets`)
src/scenes.js                     scene triggers and actions (manifest `scene_triggers`,
                                  `scene_actions`)
src/i18n.js, src/messages.js      texts in fr, en, de, es
src/session.js, src/store.js      session in off-schema config keys, robots in /data
src/diagnostic.js                 the Diagnostic action
gladys-assistant-integration.json manifest
docs/{en,fr,de,es}.md             user documentation (the store publishes en and fr)
test/                             node --test: fake MOVAhome cloud + MQTT broker
                                  (helpers/fakeMova.js), fake Gladys host for the e2e
tools/extract-models.py           regenerates src/data/models.json from Tasshack/dreame-vacuum
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Protocol

- Cloud `<region>.iot.mova-tech.com:13267`, regions `eu`, `us`, `cn`, `sg`, `kr`.
  Same protocol as Dreamehome, hence the `dreame-...` API paths and `Dreame-Auth`
  / `Dreame-Rlc` headers: **do not rename them**. What differs is in `MOVA_CLOUD`
  (`src/constants.js`): host suffix, user agent `Mova_Smarthome/...`, tenant
  `000002`. Source: the `mova` account type of Tasshack/dreame-vacuum v2.0.0b25
  (MIT), its obfuscated strings in clear.
- Tasshack v2.0.1+ moved to the newer app identity (OAuth client `mova_app`,
  header `dreame-psd: new`, signed bodies, hand-written TLS handshake). Not
  implemented here. If users report a refused login with good credentials, that
  is the first lead: read `protocol.py` of the latest release.
- Real time over MQTT (one client per robot, TLS not verified, as the app),
  a 60 s refresh as a safety net run by an **internal timer** (`startPolling()`),
  `onPoll` only as a fallback; only changes are published.
- The robots are MIoT devices: properties `siid.piid`, actions `siid.aiid`. A
  model key is the last segment of the model id (`mova.vacuum.r2416` -> `r2416`),
  shared with the Dreame twin: the model table needs no MOVA-specific entries.
  `mova.vacuum.*` models are always treated as fifth generation (`gen5`), as
  Home Assistant does.

## Rules

- **External ids and keys are forever.** Device and feature external ids
  (`ext:<selector>:vacuum:<did>:<code>`, `FEATURE_CODES`), manifest
  `config_schema` / `actions` keys, widget keys (`WIDGET`), scene keys
  (`SCENE_TRIGGER`, `SCENE_ACTION`) and their field, variable and output keys:
  renaming one orphans the devices, dashboards and scenes of every user.
- **The container rootfs is read-only.** Write only under `/data`. Never log
  the did, the uid, the email, a token nor a password hash: log lines name the
  robot. The Diagnostic stays free of them and of room names.
- **The password is never stored**: only `md5(password + salt)` (what the app
  sends) and the refresh token, in off-schema config keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag, by
  hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading: the Release workflow moves
  the section, and it becomes the notes of the GitHub Release.
- **Four languages everywhere**: English, French, German (informal "du", never
  "Sie"/"Ihr") and Spanish (formal "usted") — manifest texts, `TEXTS` in
  `src/i18n.js`, `src/messages.js`, widget and action messages, and the four
  `docs/*.md`, kept in sync. `test/i18n.test.js` refuses a missing language, an
  empty or too long text and a polite German form. Logs and the Diagnostic stay
  in English.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language. `gladys_version` is `>=5.1.0` (widgets, scene triggers and actions).
  `transports` is `["cloud"]`: the robots have no local API. `test/manifest.test.js`
  ties the manifest to the code (actions, widgets, scene keys, regions,
  languages): change both sides together.
- **Scenes.** A trigger fires once per transition, from the difference of two
  snapshots (`sceneEvents()`); its `data` only carries keys declared in the
  manifest (`fields` + `variables`), flat scalars. A scene action never fails
  for a name that matches nothing: it answers `started: false`. Never fire an
  event as a direct consequence of a received action.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in
  English. Tests never touch the network (the fakes listen on localhost).

## Traps already paid for (inherited from the Dreame integration)

- Prettier unquotes `'2.1'` keys of an object literal, and `4.10` becomes `4.1`:
  use `[key, value]` pairs for `siid.piid` keys.
- The model table must list **every** known model, or an old model without an
  IV passes for a recent one (wrong state numbering above 18).
- The `data/` rule of the template's `.gitignore` also excluded `src/data/`: it
  is anchored as `/data/` here, in `.prettierignore` and `.dockerignore` too.
- Gladys only polls a device with `should_poll: true` **and** a `poll_frequency`
  of its fixed list; both are frozen when the device is created. Do not change
  the published values.
- `min` and `max` are NOT NULL for every feature, `text` ones included (0/0).
- Feature names are frozen at creation. A feature alone of its type shows the
  generic label of the type on the dashboard.
- Gladys accepts 300 states per minute and re-evaluates the scenes at each one:
  publish changes only.
- A `device` integration is not told the user's language (a widget is): hence
  the `language` config field, used for names, error texts, scene variables and
  outputs.
- Action forms: a `secret` field cannot be typed in and no `default` is applied
  (GladysAssistant/Gladys#3154, #3155): the password is a `string`, the region
  is optional with the default applied in code.
- Widgets: 8 components at most, 2 of them texts, 4 buttons; a button whose
  action key is already used is dropped (numbered keys); no select nor slider by
  design; the `primary` style is invisible in dark mode (tick icon instead).
- Under Node 24, `mkdirSync(..., { recursive: true })` on a `/proc` path never
  returns.

## Publishing

- The image is `ghcr.io/gboulvin/gladys-mova`, built by the Release workflow,
  which also bumps the manifest and `package.json`, rolls the changelog, tags
  `vX.Y.Z` and creates the GitHub Release. A fix pushed to `main` without a
  Release reaches no installation.
- The store indexes the repository once it carries the GitHub topic
  `gladys-assistant-integration`; without it, users install from the "Install
  from GitHub" card with the repository URL.
- The repository is public: no secret, no private address, here or in tests.
