import { DEADZONE_STORAGE_KEY, DEFAULT_DEADZONE, clamp, normalizeAxis } from './gamepad.js';
import { isSerialWritable, sendBinaryCommand } from './serial.js';

const PHASE4_STATE_KEY = 'pommel.phase4.state.v1';
const DEFAULT_STATE = {
    enabled: false,
    scale: 1,
    hz: 50,
    leftOffset: 0,
    rightOffset: 0,
};

function readState() {
    try {
        const raw = localStorage.getItem(PHASE4_STATE_KEY);
        if (!raw) {
            return { ...DEFAULT_STATE };
        }

        const parsed = JSON.parse(raw);
        return {
            enabled: Boolean(parsed.enabled),
            scale: clamp(Number(parsed.scale ?? DEFAULT_STATE.scale), 0, 3),
            hz: clamp(Number(parsed.hz ?? DEFAULT_STATE.hz), 5, 100),
            leftOffset: Number(parsed.leftOffset ?? 0),
            rightOffset: Number(parsed.rightOffset ?? 0),
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

export function initializePhase4TrivialMapping() {
    const enabledInput = document.getElementById('phase4Enabled');
    const scaleInput = document.getElementById('phase4Scale');
    const hzInput = document.getElementById('phase4Hz');
    const statusEl = document.getElementById('phase4Status');
    const leftOffsetEl = document.getElementById('phase4LeftOffset');
    const rightOffsetEl = document.getElementById('phase4RightOffset');
    const leftSentEl = document.getElementById('phase4LeftSent');
    const rightSentEl = document.getElementById('phase4RightSent');

    if (!enabledInput || !scaleInput || !hzInput || !statusEl || !leftOffsetEl || !rightOffsetEl || !leftSentEl || !rightSentEl) {
        return;
    }

    const state = readState();
    enabledInput.checked = state.enabled;
    scaleInput.value = state.scale.toFixed(2);
    hzInput.value = String(Math.round(state.hz));
    leftOffsetEl.textContent = round3(state.leftOffset).toFixed(3);
    rightOffsetEl.textContent = round3(state.rightOffset).toFixed(3);
    leftSentEl.textContent = '0.000';
    rightSentEl.textContent = '0.000';

    let lastSentLeft = null;
    let lastSentRight = null;
    let lastSentAt = 0;
    let rafId = null;

    function updateStatus(text, type) {
        statusEl.textContent = text;
        statusEl.className = `status ${type}`;
    }

    function persist() {
        writeState(state);
    }

    function parseScale() {
        const parsed = Number.parseFloat(scaleInput.value);
        if (!Number.isFinite(parsed)) {
            scaleInput.value = state.scale.toFixed(2);
            return;
        }
        state.scale = clamp(parsed, 0, 3);
        scaleInput.value = state.scale.toFixed(2);
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

        const deadzone = readDeadzone();
        state.leftOffset = round3(normalizeAxis(Number(gamepad.axes[1] ?? 0), deadzone));
        state.rightOffset = round3(normalizeAxis(Number(gamepad.axes[3] ?? 0), deadzone));
        leftOffsetEl.textContent = state.leftOffset.toFixed(3);
        rightOffsetEl.textContent = state.rightOffset.toFixed(3);

        const left = round3(state.leftOffset * state.scale);
        const right = round3(state.rightOffset * state.scale);

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
                updateStatus(`Streaming SetPositions from ${gamepad.id}`, 'success');
            } else {
                updateStatus('Gamepad ready; serial port is not open', 'error');
            }
        } else {
            updateStatus(`Gamepad connected: ${gamepad.id}`, 'success');
        }

        persist();
        rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);

    return () => {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
    };
}
