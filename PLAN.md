# Kitesabre Browser Controller (./pommel) Plan

## Goal
Build a phone-first controller workflow for field use:
- Android Chrome runs a web app from hoverkite.github.io (or a Tailnet URL for local dev).
- The web app reads a Bluetooth gamepad with the Gamepad API.
- The web app sends and receives Kitesabre serial messages over Web Serial.
- A Rust-to-WASM message layer handles serial message framing and decoding.
- Legacy hovercontrol button semantics are preserved where they still make sense.

## Non-goals (for this plan)
- Native Android app.
- BLE transport in the first pass.
- Rebuilding MQTT or Homie integration from hovercontrol.

## Phase 0: Preconditions
1. Confirm secure origin for Web Serial.
- Web Serial requires a secure context.
- Host the test app over HTTPS on Tailnet (for example with Tailscale Serve/Funnel). - it might be possible to get away with a self-signed certificate, and manually dismissing the warning in the browser for local dev.

2. Confirm USB mode on target board.
- Use the same ESP32 USB serial path that already worked from Android Chrome.
- Record expected USB VID/PID and baud assumptions.

3. Define target protocol contract.
- For binary commands from browser to device:
  - Prefix byte: '#'
  - Payload: postcard + COBS encoded Command
  - Terminator: 0x00
- For text commands from browser to device:
  - Existing single-byte commands remain available where needed.
- For reports from device to browser:
  - '#' + COBS report + 0x00 + '\n' as currently parsed in kitesabre-control.

## Phase 1: Verify Web Serial via Tailnet-hosted web app
### Deliverable
A minimal web page served on Tailnet that can open serial, send ping/input, and display incoming text/binary decode status.

### Status (2026-06-26)
- Implemented in `./pommel` as a Vite app.
- Android device selection works via WebUSB fallback (desktop still uses Web Serial).
- Connect now auto-opens the selected port (Open Port remains available as a manual retry path).
- Incoming stream is visible; binary telemetry flood observed after ESP32 reset (expected for current firmware).

### Tasks
1. Create a minimal web app page with:
- Connect button (uses unified picker: Web Serial on desktop, WebUSB fallback on Android).
- Open/close port controls.
- Text input and send button for raw test commands.
- Read loop that logs incoming bytes and message boundaries.

2. Host it on Tailnet over HTTPS.
- Verify phone can load the page on cellular and Wi-Fi.
- Verify Chrome shows serial permission prompt.

3. Serial smoke tests.
- Connect to board.
- Send plain-text commands currently understood by firmware (for example p, ?, arrow equivalents).
- Confirm readable responses and stable reconnect behavior.

### Acceptance criteria
- [x] Phone can connect to board serial from the Tailnet URL.
- [x] At least one command/response round-trip succeeds.
- [x] Unplug/replug recovery works without browser restart.

## Phase 2: Verify Web Gamepad on Android Chrome
### Deliverable
A gamepad diagnostics page in the same web app showing live axis/button state updates.

### Status (2026-06-26)
- Implemented in `./pommel` on the homepage as a dedicated "Gamepad Diagnostics (Phase 2)" section.
- Existing homepage sections are now collapsible (`<details>`), with open/closed state persisted in localStorage across refreshes.
- Gamepad diagnostics now poll via `requestAnimationFrame`, display live left/right stick Y values (raw + deadzone-normalized), and show an observed Stadia button mapping table.
- On Android Chrome, system-reserved buttons (for example menu/assistant/home/capture) may not be surfaced via Gamepad API; do not depend on them for critical control actions.
- Observed mapping on current Android Chrome setup: `...` reports on index 8, hamburger/menu reports on index 9, assistant reports on index 17, and dedicated capture is currently not observed.

### Tasks
1. Implement Gamepad API polling.
- Poll in requestAnimationFrame.
- Show connected gamepad id/index.
- Display live values for both stick Y axes and key buttons.

2. Validate Stadia controller mapping on Android Chrome.
- Capture observed button index map for D-pad, face buttons, triggers, thumb buttons, mode/home.
- Capture axis map for left/right stick vertical axes.

3. Add deadzone and normalization helper.
- Configurable deadzone (start with 0.08).
- Clamp and round for stable downstream command generation.

### Acceptance criteria
- Controller can connect and disconnect without stale state.
- Axis and button values update at interactive rates (>30 Hz perceived).
- A mapping table for this exact phone/browser/controller combo is committed in the app docs or source.

## Phase 3: Ship Rust message codec to browser (WASM)
### Deliverable
A Rust WASM package used by the web app to encode outgoing commands and decode incoming reports.

### Tasks
1. Add a browser-facing Rust crate (for example kitesabre-webcodec).
- Use wasm-bindgen for JS bindings.
- Depend on kitesabre-messages for Command/Report types.

2. Implement JS-callable encode/decode API.
- encode_command(command_json) -> Uint8Array framed for serial write.
- decode_stream(chunk: Uint8Array) -> decoded report events + leftover buffer state.
- Keep framing compatible with existing firmware and kitesabre-control parser behavior.

3. Add shared test vectors.
- Rust unit tests for command/report round-trip.
- Browser integration tests comparing JS-observed bytes to Rust expected output.

4. Integrate into web app read/write path.
- Outgoing control loop uses Rust encoder.
- Incoming serial bytes pass through Rust decoder before UI rendering.

### Acceptance criteria
- Browser can send valid binary commands accepted by firmware.
- Browser can decode at least Time and Command reports without parse errors over 5 minutes of streaming.
- Codec behavior matches existing crate expectations (postcard + COBS framing).

## Phase 4: Replicate hovercontrol mapping semantics
Reference legacy implementation: ../hoverkite/hovercontrol/src/controller.rs

### Legacy mapping to preserve
- [x] [trivial] Axis LeftStickY -> left offset
- [x] [trivial] Axis RightStickY -> right offset
- [x] [browser state] DPadLeft/Right -> scale -/+ 1
- [x] [browser state] LeftTrigger / LeftTrigger2 -> left centre +/- 20
- [x] [browser state] RightTrigger / RightTrigger2 -> right centre +/- 20
- [x] [browser state] LeftThumb / RightThumb -> recenter left/right
- [ ] [rust-side] DPadUp/Down -> max torque negative limit adjust by 10
- [ ] [rust-side] East -> remove target
- [ ] [rust-side] West / North -> spring constant -/+ 2
- [ ] [rust-side] Mode -> power off
- [ ] [new board-side code] South -> battery report

### Rewrite track (SolidJS + TypeScript)
- [ ] Port `./pommel` UI to SolidJS + TypeScript, keeping the current serial/gamepad behavior intact.
- [ ] Keep translation/calibration logic in testable modules; avoid over-constraining component internals.
- [ ] Add a small Playwright suite with end-to-end coverage for control streaming and calibration commit/release flow.
- [ ] Keep Playwright scope intentionally narrow (critical behavior only) so rewrite shape can stay flexible.
- [ ] Preserve a manual hardware smoke-test checklist for real-device validation after rewrite milestones.

### In-flight naming cleanup
- Browser code currently uses `phase4` identifiers in file names, DOM ids, CSS selectors, and localStorage keys.
- We are actively renaming these to neutral `control mapping` names so behavior no longer depends on this plan's phase numbering.
- Until that lands, treat `phase4` names in the codebase as temporary technical names only.

### Adaptation for Kitesabre
#### Easy
1. Define unsupported or deferred actions explicitly.
- If firmware lacks a direct equivalent for a legacy command, log and document fallback behavior.

2. Add parity verification checklist.
- For each mapped control, verify expected physical or telemetry behavior against old hovercontrol behavior.

3. Keep browser-owned state persistent across refreshes.
- Store offsets, scale, center adjustments, and other local mapping state in localStorage so controls survive reloads.

#### Hard
1. Map legacy intent to current kitesabre command model.
- Primary continuous control path should use SetPositions { left, right }.
- Define how centre/scale/max torque/spring constants are represented in current firmware commands or local state.

2. Build a translation layer in web app.
- Read gamepad state.
- Apply deadzone, scaling, centre offsets.
- Emit command updates at fixed cadence (for example 50 Hz) with change detection.

3. Implement battery reporting for South. (implementation plan is pure slop. Read the data sheet and check for pre-existing crates, or implement your own)
- Read the board battery rail on the ESP32, most likely through an ADC input and a resistor divider or existing measurement circuit.
- Calibrate raw ADC readings into volts, then surface them as a new report in the firmware message path.
- Keep the legacy ASCII battery command as a fallback if that is still useful for manual testing.
- If the board does not already expose a battery sense circuit, this needs board-specific hardware work before software can report it reliably.

### Acceptance criteria
- Continuous dual-stick control works with equivalent feel to hovercontrol baseline.
- All legacy button intents are either implemented or explicitly marked deferred with rationale.
- Mapping constants (deadzone, scale step, centre step, update rate) are configurable.

## Phase 5: Field hardening
1. Reliability guardrails.
- Heartbeat and command timeout to fail safe (release/neutral) on disconnect.
- Clear UI state for serial disconnected, gamepad disconnected, and stale telemetry.

2. Operator UX.
- One-screen layout for phone use outdoors.
- Large touch targets for connect/reset/recenter.
- Visible arming state and emergency stop action.

3. Logging and debug capture.
- Persist logs in SQLite stored in OPFS, using wa-sqlite (https://github.com/rhashimoto/wa-sqlite).
- Store structured events (for example timestamps, source, level, payload) to support post-run analysis.
- Add a UI button to download the SQLite database file for debugging.
- Add a UI button to clear logs, guarded by a confirmation dialog.

### Acceptance criteria
- Safe neutral behavior occurs within defined timeout after disconnect.
- Operator can recover from transient disconnects in under 10 seconds.
- Logs survive page reloads via OPFS-backed SQLite storage.
- Operator can download the SQLite log database from the UI.
- Operator can clear logs only after explicit confirmation.

## Phase 6: Bump Rust dependencies for BLE work
### Deliverable
Workspace Rust dependencies are updated to versions compatible with the chosen `esp-hal` BLE example and the embedded firmware still builds cleanly for the target board.

### Why this is separate
- BLE enablement may require coordinated version bumps across `esp-hal`, `esp-backtrace`, `esp-println`, embassy-related crates, and transitive dependencies.
- That upgrade can create unrelated compile breakage or API churn, so it should be planned and validated independently from the transport design work.

### Tasks
1. Inventory the current embedded Rust dependency set.
- Record the current versions and feature flags used by the firmware crates.
- Compare them with the dependency set expected by the `esp-hal` BLE example.

2. Perform the version bump as a dedicated change.
- Update embedded Rust dependencies in small, reviewable steps.
- Resolve feature-flag conflicts and API changes introduced by the upgrade.
- Keep non-embedded workspace crates pinned unless they are directly affected.

3. Revalidate the firmware baseline after the upgrade.
- Confirm the existing non-BLE firmware still builds and flashes.
- Re-run the current serial transport smoke path before layering BLE on top.
- Capture any new constraints or follow-up cleanup discovered during the upgrade.

### Acceptance criteria
- The firmware dependency graph is on versions compatible with the intended BLE stack.
- Existing serial-based behavior still compiles and passes its current smoke checks after the upgrade.
- Any remaining upgrade fallout is documented before Phase 6 implementation continues.

## Phase 7: Add Web Bluetooth transport
### Deliverable
Phone and desktop browsers can connect to Kitesabre over Web Bluetooth using a custom BLE GATT service, with the existing command/report codec reused above the transport layer.

### Why this is a separate phase
- Web Bluetooth is not a drop-in replacement for WebUSB or Web Serial.
- Browsers expose BLE GATT, not classic Bluetooth SPP, so the device needs a dedicated BLE protocol surface.
- The browser app should keep one transport-independent command/report layer, with WebUSB/Web Serial and BLE implemented as interchangeable links.

### Tasks
1. Define the BLE transport contract.
- Choose a custom primary service UUID and characteristic layout.
- Split traffic into at least one write characteristic for commands and one notify characteristic for reports.
- Keep the current `#` + postcard + COBS + `0x00` framing for consistency across serial and BLE transports.
- Add a property test that asserts encoded command/report payloads always fit within the chosen BLE MTU budget.
- For text reports, truncate to the BLE payload budget rather than introducing multi-packet text reassembly.

2. Add firmware BLE support on the ESP32.
- Start from the `esp-hal` BLE peripheral example (`examples/ble/bas_peripheral/src/main.rs`) and validate that the same stack fits the current async firmware architecture and memory budget.
- Advertise the Kitesabre service and expose the chosen characteristics.
- Bridge incoming GATT writes into the existing command handling path.
- Bridge outgoing reports and telemetry into notifications with backpressure and disconnect handling.

3. Add a browser BLE transport adapter.
- Implement a `requestBluetoothDevice` flow with filters for the Kitesabre service UUID.
- Open the GATT server, subscribe to notifications, and expose the same read/write interface used by the current serial transport.
- Surface transport selection in the UI so operators can choose between Web Serial/WebUSB and Web Bluetooth.

4. Reuse and harden the codec boundary.
- Keep `kitesabre-webcodec` transport-agnostic so it can sit above both serial and BLE links.
- Add transport tests that feed chunked BLE notifications through the decoder and verify the same decoded report stream as serial.
- Verify reconnect behavior, stale-device cleanup, and fail-safe neutral behavior on BLE disconnect.

5. Validate browser and device compatibility.
- Confirm Android Chrome support on the target phone.
- Confirm whether desktop Chrome is useful for development, even if field use stays phone-first.
- Record pairing, permission, and reconnect behavior differences relative to WebUSB.

### Acceptance criteria
- A supported browser can discover and pair with Kitesabre over Web Bluetooth.
- The browser can send the same control commands over BLE as over serial, with no protocol-specific application logic above the transport adapter.
- Incoming reports decode correctly during at least 5 minutes of continuous telemetry.
- Disconnect or out-of-range events trigger the same neutral/fail-safe behavior as cable disconnects.
- The plan explicitly documents any remaining BLE-specific limitations, such as throughput or browser support gaps.

## Milestones
1. M1: Tailnet-hosted Web Serial smoke test complete.
2. M2: Gamepad diagnostics page complete with Stadia mapping table.
3. M3: Rust WASM codec integrated and passing test vectors.
4. M4: Legacy mapping parity pass complete.
5. M5: Field test session with no laptop required.
6. M6: Embedded Rust dependency baseline updated for BLE support.
7. M7: Optional Web Bluetooth transport reaches parity with the browser serial transport.

## Suggested implementation order (first week)
1. Day 1: Phase 1 minimal app and serial connect/send/receive.
2. Day 2: Phase 2 gamepad diagnostics and mapping capture.
3. Day 3-4: Phase 3 Rust WASM codec and integration.
4. Day 5: Phase 4 mapping parity and initial field test.

## Open questions to resolve during implementation
1. Which current firmware commands exist for torque/spring/recenter/power-off equivalents?
2. What update frequency gives best control feel without saturating serial?
3. Should command authority require an explicit arm action before motion commands?
4. Is HTTPS over Tailnet consistently available in your field setup, or do you need a local fallback host?
5. Which ESP32 BLE stack is the best fit for the current firmware architecture and flash/RAM budget?
6. Is BLE throughput and latency good enough for the intended control update rate, or should BLE be limited to setup/telemetry while WebUSB remains preferred for active control?
7. What BLE MTU budget should the codec property test target once the chosen stack and characteristic configuration are wired up?
