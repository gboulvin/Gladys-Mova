# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.0] - 2026-11-14

First version. It was written without a MOVA robot at hand, from the Dreame
integration of the Gladys store and the Home Assistant integration
Tasshack/dreame-vacuum: the tests run against a fake MOVAhome cloud, never the
real one. Please report what you see with the **Diagnostic** action.

### Added

- Link a MOVAhome account (email or phone number, password, region) from the
  Actions box. The password is never stored: only the fingerprint the app sends
  itself, and the session token.
- The robot vacuums of the account as Gladys devices, through the MOVAhome
  cloud (transport badge: cloud), with their changes pushed in real time and a
  refresh every minute as a safety net.
- Per robot: state, cleaning (start, resume, stop), return to dock, pause,
  locate, cleaning mode, suction power, max suction, mop wetness, mop washing
  frequency, cleaning route, battery, error in plain words, last clean (area
  and duration), room to clean, several rooms in a chosen order, the shortcuts
  of the app, and the remaining life of each wear part.
- Four dashboard widgets: the robot with the map of the home and its path,
  quick clean buttons (shortcuts, rooms), one setting as buttons, and the
  maintenance of the parts.
- Four scene triggers: cleaning started, cleaning finished (with the area and
  the duration), robot fault (with its code and description), part to replace
  (at 10 % of its life).
- Three scene actions: clean rooms by their names, run a shortcut by its name,
  read the robot status (state, battery, fault) for the following actions.
- A **Diagnostic** action, to paste into a forum post or an issue: it carries
  no email, identifier nor room name.
- Everything in English, French, German and Spanish: configuration screen,
  feature names, room names, error messages, widgets, scene cards and the user
  documentation.

[Unreleased]: https://github.com/gboulvin/Gladys-Mova/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gboulvin/Gladys-Mova/releases/tag/v0.1.0
