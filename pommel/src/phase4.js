import { DEADZONE_STORAGE_KEY, DEFAULT_DEADZONE, clamp, normalizeAxis } from './gamepad.js';
import { isSerialWritable, sendBinaryCommand } from './serial.js';

const PHASE4_STATE_KEY = 'pommel.phase4.state.v1';
const SCALE_STEP = 0.2;
const CENTER_STEP = 0.2;
const CALIBRATION_BUTTON = 2; // West (X)
const RUMBLE_COOLDOWN_MS = 200;

const BUTTON_INDEX = {
    dpadLeft: 14,
    dpadRight: 15,
    leftTrigger: 4,
    leftTrigger2: 6,
    rightTrigger: 5,
    rightTrigger2: 7,
    leftThumb: 10,
    rightThumb: 11,
};

const DEFAULT_STATE = {
    enabled: true,
    scale: 0.8,
    hz: 50,
    leftCenter: 0.6,
    rightCenter: 0.2,
    leftOffset: 0,
    rightOffset: 0,
    leftMin: -0.4,
    leftMax: 1.4,
    rightMin: -1.2,
    rightMax: 1.2,
};

function parseNullableNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function readState() {
    try {
        const raw = localStorage.getItem(PHASE4_STATE_KEY);
        if (!raw) {
            return { ...DEFAULT_STATE };
        }

        const parsed = JSON.parse(raw);
        return {
            enabled: Boolean(parsed.enabled),
            scale: clamp(Number(parsed.scale ?? DEFAULT_STATE.scale), 0, 8),
            hz: clamp(Number(parsed.hz ?? DEFAULT_STATE.hz), 5, 100),
            leftCenter: Number(parsed.leftCenter ?? DEFAULT_STATE.leftCenter),
            rightCenter: Number(parsed.rightCenter ?? DEFAULT_STATE.rightCenter),
            leftOffset: Number(parsed.leftOffset ?? DEFAULT_STATE.leftOffset),
            rightOffset: Number(parsed.rightOffset ?? DEFAULT_STATE.rightOffset),
            leftMin: parseNullableNumber(parsed.leftMin ?? DEFAULT_STATE.leftMin),
            leftMax: parseNullableNumber(parsed.leftMax ?? DEFAULT_STATE.leftMax),
            rightMin: parseNullableNumber(parsed.rightMin ?? DEFAULT_STATE.rightMin),
            rightMax: parseNullableNumber(parsed.rightMax ?? DEFAULT_STATE.rightMax),
        };
    } catch {
        return { ...DEFAULT_STATE };
    }
}

function writeState(state) {
    localStorage.setItem(PHASE4_STATE_KEY, JSON.stringify(state));
}

function readDeadzone() {
    const stored = Number.parseFloat(localStorage.getItem(DEADZONE_STORAGE_KEY) ?? '');
    if (!Number.isFinite(stored)) {
        return DEFAULT_DEADZONE;
    }
    return clamp(stored, 0, 0.5);
}

function round3(value) {
    return Number(value.toFixed(3));
}

function clampToHardStops(value, min, max) {
    let out = value;
    let hit = false;

    if (min !== null && out < min) {
        out = min;
        hit = true;
    }

    if (max !== null && out > max) {
        out = max;
        hit = true;
    }

    return { value: round3(out), hit };
}

function formatLimit(value) {
    return value === null ? 'unset' : value.toFixed(3);
}

export function initializePhase4TrivialMapping() {
    const enabledInput = document.getElementById('phase4Enabled');
    const scaleInput = document.getElementById('phase4Scale');
    const scaleValueEl = document.getElementById('phase4ScaleValue');
    const hzInput = document.getElementById('phase4Hz');
    const copyStateBtn = document.getElementById('phase4CopyStateBtn');
    const statusEl = document.getElementById('phase4Status');
    const leftOffsetEl = document.getElementById('phase4LeftOffset');
    const rightOffsetEl = document.getElementById('phase4RightOffset');
    const leftCenterEl = document.getElementById('phase4LeftCenter');
    const rightCenterEl = document.getElementById('phase4RightCenter');
    const leftMinEl = document.getElementById('phase4LeftMin');
    const leftMaxEl = document.getElementById('phase4LeftMax');
    const rightMinEl = document.getElementById('phase4RightMin');
    const rightMaxEl = document.getElementById('phase4RightMax');
    const leftSentEl = document.getElementById('phase4LeftSent');
    const rightSentEl = document.getElementById('phase4RightSent');

    if (!enabledInput || !scaleInput || !scaleValueEl || !hzInput || !copyStateBtn || !statusEl || !leftOffsetEl || !rightOffsetEl || !leftCenterEl || !rightCenterEl || !leftMinEl || !leftMaxEl || !rightMinEl || !rightMaxEl || !leftSentEl || !rightSentEl) {
        return;
    }

    const state = readState();
    enabledInput.checked = state.enabled;
    scaleInput.value = state.scale.toFixed(2);
    scaleValueEl.textContent = `${state.scale.toFixed(2)}x`;
    hzInput.value = String(Math.round(state.hz));
    leftOffsetEl.textContent = round3(state.leftOffset).toFixed(3);
    rightOffsetEl.textContent = round3(state.rightOffset).toFixed(3);
    leftCenterEl.textContent = round3(state.leftCenter).toFixed(3);
    rightCenterEl.textContent = round3(state.rightCenter).toFixed(3);
    leftMinEl.textContent = formatLimit(state.leftMin);
    leftMaxEl.textContent = formatLimit(state.leftMax);
    rightMinEl.textContent = formatLimit(state.rightMin);
    rightMaxEl.textContent = formatLimit(state.rightMax);
    leftSentEl.textContent = '0.000';
    rightSentEl.textContent = '0.000';

    let lastSentLeft = null;
    let lastSentRight = null;
    let lastSentAt = 0;
    let rafId = null;
    let wasCalibrationButtonPressed = false;
    let calibration = null;
    let currentCalibrationLeft = null;
    let currentCalibrationRight = null;
    let lastRumbleAt = 0;
    let wasAtHardStop = false;
    let prevButtons = {
        dpadLeft: false,
        dpadRight: false,
        leftMinus: false,
        leftPlus: false,
        rightMinus: false,
        rightPlus: false,
        leftThumb: false,
        rightThumb: false,
    };

    function refreshLimitUI() {
        leftMinEl.textContent = formatLimit(state.leftMin);
        leftMaxEl.textContent = formatLimit(state.leftMax);
        rightMinEl.textContent = formatLimit(state.rightMin);
        rightMaxEl.textContent = formatLimit(state.rightMax);
    }

    function updateStatus(text, type) {
        statusEl.textContent = text;
        statusEl.className = `status ${type}`;
    }

    function persist() {
        writeState(state);
    }

    function refreshScaleUI() {
        scaleInput.value = state.scale.toFixed(2);
        scaleValueEl.textContent = `${state.scale.toFixed(2)}x`;
    }

    async function copyStateJson() {
        const exportState = {
            enabled: state.enabled,
            scale: state.scale,
            hz: state.hz,
            leftCenter: state.leftCenter,
            rightCenter: state.rightCenter,
            leftMin: state.leftMin,
            leftMax: state.leftMax,
            rightMin: state.rightMin,
            rightMax: state.rightMax,
        };
        const json = JSON.stringify(exportState, null, 2);

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(json);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = json;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (!copied) {
            throw new Error('Clipboard copy failed');
        }
    }

    function parseScale() {
        const parsed = Number.parseFloat(scaleInput.value);
        if (!Number.isFinite(parsed)) {
            refreshScaleUI();
            return;
        }
        state.scale = clamp(parsed, 0, 8);
        refreshScaleUI();
        persist();
    }

    function parseHz() {
        const parsed = Number.parseInt(hzInput.value, 10);
        if (!Number.isFinite(parsed)) {
            hzInput.value = String(Math.round(state.hz));
            return;
        }
        state.hz = clamp(parsed, 5, 100);
        hzInput.value = String(Math.round(state.hz));
        persist();
    }

    enabledInput.addEventListener('change', () => {
        state.enabled = enabledInput.checked;
        persist();
    });
    scaleInput.addEventListener('change', parseScale);
    hzInput.addEventListener('change', parseHz);
    copyStateBtn.addEventListener('click', async () => {
        try {
            await copyStateJson();
            updateStatus('Copied mapping state JSON to clipboard', 'success');
        } catch {
            updateStatus('Failed to copy mapping state JSON', 'error');
        }
    });

    function readButton(gamepad, index) {
        return Boolean(gamepad.buttons[index]?.pressed);
    }

    function applyBrowserStateButtons(gamepad, options = {}) {
        const {
            includeScaleAndThumb = true,
            allowTriggerPastLimits = false,
            leftBaseOffset = 0,
            rightBaseOffset = 0,
        } = options;
        const current = {
            dpadLeft: readButton(gamepad, BUTTON_INDEX.dpadLeft),
            dpadRight: readButton(gamepad, BUTTON_INDEX.dpadRight),
            leftMinus: readButton(gamepad, BUTTON_INDEX.leftTrigger),
            leftPlus: readButton(gamepad, BUTTON_INDEX.leftTrigger2),
            rightMinus: readButton(gamepad, BUTTON_INDEX.rightTrigger),
            rightPlus: readButton(gamepad, BUTTON_INDEX.rightTrigger2),
            leftThumb: readButton(gamepad, BUTTON_INDEX.leftThumb),
            rightThumb: readButton(gamepad, BUTTON_INDEX.rightThumb),
        };

        let changed = false;
        let rejectedLimitPress = false;

        function wouldExceedHardStop(nextCenter, baseOffset, min, max) {
            const next = round3(nextCenter + (baseOffset * state.scale));
            if (min !== null && next < min) {
                return true;
            }
            if (max !== null && next > max) {
                return true;
            }
            return false;
        }

        if (includeScaleAndThumb && current.dpadLeft && !prevButtons.dpadLeft) {
            state.scale = clamp(round3(state.scale - SCALE_STEP), 0, 8);
            refreshScaleUI();
            changed = true;
        }

        if (includeScaleAndThumb && current.dpadRight && !prevButtons.dpadRight) {
            state.scale = clamp(round3(state.scale + SCALE_STEP), 0, 8);
            refreshScaleUI();
            changed = true;
        }

        if (current.leftMinus && !prevButtons.leftMinus) {
            const next = round3(state.leftCenter + CENTER_STEP);
            if (!allowTriggerPastLimits && wouldExceedHardStop(next, leftBaseOffset, state.leftMin, state.leftMax)) {
                rejectedLimitPress = true;
            } else {
                state.leftCenter = next;
                changed = true;
            }
        }

        if (current.leftPlus && !prevButtons.leftPlus) {
            const next = round3(state.leftCenter - CENTER_STEP);
            if (!allowTriggerPastLimits && wouldExceedHardStop(next, leftBaseOffset, state.leftMin, state.leftMax)) {
                rejectedLimitPress = true;
            } else {
                state.leftCenter = next;
                changed = true;
            }
        }

        if (current.rightMinus && !prevButtons.rightMinus) {
            const next = round3(state.rightCenter - CENTER_STEP);
            if (!allowTriggerPastLimits && wouldExceedHardStop(next, rightBaseOffset, state.rightMin, state.rightMax)) {
                rejectedLimitPress = true;
            } else {
                state.rightCenter = next;
                changed = true;
            }
        }

        if (current.rightPlus && !prevButtons.rightPlus) {
            const next = round3(state.rightCenter + CENTER_STEP);
            if (!allowTriggerPastLimits && wouldExceedHardStop(next, rightBaseOffset, state.rightMin, state.rightMax)) {
                rejectedLimitPress = true;
            } else {
                state.rightCenter = next;
                changed = true;
            }
        }

        if (includeScaleAndThumb && current.leftThumb && !prevButtons.leftThumb) {
            state.leftCenter = 0;
            changed = true;
        }

        if (includeScaleAndThumb && current.rightThumb && !prevButtons.rightThumb) {
            state.rightCenter = 0;
            changed = true;
        }

        prevButtons = current;

        if (changed) {
            leftCenterEl.textContent = state.leftCenter.toFixed(3);
            rightCenterEl.textContent = state.rightCenter.toFixed(3);
            persist();
        }

        return { rejectedLimitPress };
    }

    function rumbleIfSupported(gamepad, strong = false) {
        const now = performance.now();
        if (now - lastRumbleAt < RUMBLE_COOLDOWN_MS) {
            return;
        }

        const actuator = gamepad?.vibrationActuator;
        if (!actuator || typeof actuator.playEffect !== 'function') {
            return;
        }

        lastRumbleAt = now;
        actuator.playEffect('dual-rumble', {
            duration: strong ? 70 : 35,
            weakMagnitude: strong ? 0.6 : 0.3,
            strongMagnitude: strong ? 0.7 : 0.35,
        }).catch(() => {
            // Ignore unsupported/failed vibration requests.
        });
    }

    function inferAndCommitHardStops(startLeft, startRight, endLeft, endRight) {
        let changed = false;

        if (endLeft > startLeft) {
            state.leftMax = endLeft;
            changed = true;
        } else if (endLeft < startLeft) {
            state.leftMin = endLeft;
            changed = true;
        }

        if (endRight > startRight) {
            state.rightMax = endRight;
            changed = true;
        } else if (endRight < startRight) {
            state.rightMin = endRight;
            changed = true;
        }

        if (changed) {
            refreshLimitUI();
            persist();
        }

        return changed;
    }

    async function tick(now) {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = Array.from(pads).find(Boolean);

        if (!state.enabled) {
            updateStatus('Disabled', 'info');
            rafId = requestAnimationFrame(tick);
            return;
        }

        if (!gamepad) {
            updateStatus('Enabled, waiting for gamepad', 'info');
            rafId = requestAnimationFrame(tick);
            return;
        }

        const calibrationButtonPressed = readButton(gamepad, CALIBRATION_BUTTON);

        if (calibrationButtonPressed && !wasCalibrationButtonPressed) {
            calibration = {
                startLeftCenter: state.leftCenter,
                startRightCenter: state.rightCenter,
                startLeftCommand: lastSentLeft ?? round3(state.leftCenter + (state.leftOffset * state.scale)),
                startRightCommand: lastSentRight ?? round3(state.rightCenter + (state.rightOffset * state.scale)),
            };
            currentCalibrationLeft = calibration.startLeftCommand;
            currentCalibrationRight = calibration.startRightCommand;
        }

        const deadzone = readDeadzone();
        const inCalibrationMode = Boolean(calibrationButtonPressed && calibration);

        if (!inCalibrationMode) {
            state.leftOffset = round3(-normalizeAxis(Number(gamepad.axes[1] ?? 0), deadzone));
            state.rightOffset = round3(normalizeAxis(Number(gamepad.axes[3] ?? 0), deadzone));
        }
        leftOffsetEl.textContent = state.leftOffset.toFixed(3);
        rightOffsetEl.textContent = state.rightOffset.toFixed(3);

        const baseLeftOffset = inCalibrationMode ? 0 : state.leftOffset;
        const baseRightOffset = inCalibrationMode ? 0 : state.rightOffset;

        const buttonResult = applyBrowserStateButtons(gamepad, {
            includeScaleAndThumb: !inCalibrationMode,
            allowTriggerPastLimits: inCalibrationMode,
            leftBaseOffset: baseLeftOffset,
            rightBaseOffset: baseRightOffset,
        });

        const unclampedLeft = round3(state.leftCenter + (baseLeftOffset * state.scale));
        const unclampedRight = round3(state.rightCenter + (baseRightOffset * state.scale));

        let left = unclampedLeft;
        let right = unclampedRight;
        let hitHardStop = false;

        if (inCalibrationMode) {
            // Calibration mode is allowed to move beyond current hard stops.
            currentCalibrationLeft = left;
            currentCalibrationRight = right;
        } else {
            const leftResult = clampToHardStops(unclampedLeft, state.leftMin, state.leftMax);
            const rightResult = clampToHardStops(unclampedRight, state.rightMin, state.rightMax);
            left = leftResult.value;
            right = rightResult.value;
            hitHardStop = leftResult.hit || rightResult.hit;
            if (buttonResult.rejectedLimitPress) {
                hitHardStop = true;
            }
        }

        const intervalMs = 1000 / Math.max(1, state.hz);
        const changed = left !== lastSentLeft || right !== lastSentRight;
        const due = now - lastSentAt >= intervalMs;

        if (changed && due) {
            if (isSerialWritable()) {
                await sendBinaryCommand({ SetPositions: { left, right } }, { silent: true });
                lastSentLeft = left;
                lastSentRight = right;
                lastSentAt = now;
                leftSentEl.textContent = left.toFixed(3);
                rightSentEl.textContent = right.toFixed(3);
                if (inCalibrationMode) {
                    updateStatus('Calibration active: release X to commit hard stop(s)', 'info');
                } else {
                    updateStatus(`Streaming SetPositions from ${gamepad.id}`, 'success');
                }
            } else {
                updateStatus('Gamepad ready; serial port is not open', 'error');
            }
        } else {
            if (inCalibrationMode) {
                updateStatus('Calibration active: release X to commit hard stop(s)', 'info');
            } else {
                updateStatus(`Gamepad connected: ${gamepad.id}`, 'success');
            }
        }

        if (!inCalibrationMode && hitHardStop && !wasAtHardStop) {
            rumbleIfSupported(gamepad, true);
        }
        wasAtHardStop = hitHardStop;

        if (!calibrationButtonPressed && wasCalibrationButtonPressed && calibration) {
            const endLeft = currentCalibrationLeft ?? left;
            const endRight = currentCalibrationRight ?? right;

            const changedAny = inferAndCommitHardStops(
                calibration.startLeftCommand,
                calibration.startRightCommand,
                endLeft,
                endRight,
            );

            // Return instantly to where calibration started.
            state.leftCenter = calibration.startLeftCenter;
            state.rightCenter = calibration.startRightCenter;
            leftCenterEl.textContent = state.leftCenter.toFixed(3);
            rightCenterEl.textContent = state.rightCenter.toFixed(3);
            persist();

            if (isSerialWritable()) {
                // Snap back immediately to the pre-calibration command point.
                await sendBinaryCommand({
                    SetPositions: {
                        left: calibration.startLeftCommand,
                        right: calibration.startRightCommand,
                    },
                }, { silent: true });
                lastSentLeft = calibration.startLeftCommand;
                lastSentRight = calibration.startRightCommand;
                lastSentAt = now;
                leftSentEl.textContent = calibration.startLeftCommand.toFixed(3);
                rightSentEl.textContent = calibration.startRightCommand.toFixed(3);
            }

            calibration = null;
            currentCalibrationLeft = null;
            currentCalibrationRight = null;

            if (changedAny) {
                rumbleIfSupported(gamepad, false);
                updateStatus('Calibration committed and returned to start', 'success');
            } else {
                updateStatus('Calibration released; no side moved, no limits changed', 'info');
            }
        }

        wasCalibrationButtonPressed = calibrationButtonPressed;

        rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    return () => {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
    };
}
