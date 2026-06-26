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

### Tasks
1. Create a minimal web app page with:
- Connect button (calls navigator.serial.requestPort()).
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
- Phone can connect to board serial from the Tailnet URL.
- At least one command/response round-trip succeeds.
- Unplug/replug recovery works without browser restart.

## Phase 2: Verify Web Gamepad on Android Chrome
### Deliverable
A gamepad diagnostics page in the same web app showing live axis/button state updates.

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
- Axis LeftStickY -> left offset
- Axis RightStickY -> right offset
- DPadLeft/Right -> scale -/+ 1
- DPadUp/Down -> max torque negative limit adjust by 10
- LeftTrigger / LeftTrigger2 -> left centre +/- 20
- RightTrigger / RightTrigger2 -> right centre +/- 20
- LeftThumb / RightThumb -> recenter left/right
- South -> battery report
- East -> remove target
- West / North -> spring constant -/+ 2
- Mode -> power off

### Adaptation for Kitesabre
1. Map legacy intent to current kitesabre command model.
- Primary continuous control path should use SetPositions { left, right }.
- Define how centre/scale/max torque/spring constants are represented in current firmware commands or local state.

2. Build a translation layer in web app.
- Read gamepad state.
- Apply deadzone, scaling, centre offsets.
- Emit command updates at fixed cadence (for example 50 Hz) with change detection.

3. Define unsupported or deferred actions explicitly.
- If firmware lacks a direct equivalent for a legacy command, log and document fallback behavior.

4. Add parity verification checklist.
- For each mapped control, verify expected physical or telemetry behavior against old hovercontrol behavior.

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

## Milestones
1. M1: Tailnet-hosted Web Serial smoke test complete.
2. M2: Gamepad diagnostics page complete with Stadia mapping table.
3. M3: Rust WASM codec integrated and passing test vectors.
4. M4: Legacy mapping parity pass complete.
5. M5: Field test session with no laptop required.

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
