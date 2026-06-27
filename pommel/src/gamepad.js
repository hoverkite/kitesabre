const DEADZONE_STORAGE_KEY = 'pommel.gamepad.deadzone';
const DEFAULT_DEADZONE = 0.08;
export { DEADZONE_STORAGE_KEY, DEFAULT_DEADZONE };

import { emitTelemetry } from './telemetry.js';

const STADIA_MAPPING = [
    { index: 12, label: 'DPad Up' },
    { index: 13, label: 'DPad Down' },
    { index: 14, label: 'DPad Left' },
    { index: 15, label: 'DPad Right' },
    { index: 8, label: '... (Start)' },
    { index: 9, label: 'Hamburger / Menu' },
    { index: 0, label: 'South (A)' },
    { index: 1, label: 'East (B)' },
    { index: 2, label: 'West (X)' },
    { index: 3, label: 'North (Y)' },
    { index: 4, label: 'Left Bumper (L1)' },
    { index: 5, label: 'Right Bumper (R1)' },
    { index: 6, label: 'Left Trigger (L2)' },
    { index: 7, label: 'Right Trigger (R2)' },
    { index: 10, label: 'Left Thumb' },
    { index: 11, label: 'Right Thumb' },
    { index: 16, label: 'Mode/Home (often reserved)' },
    { index: 17, label: 'Assistant' },
    { index: 18, label: 'Capture (if exposed)' },
];

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function normalizeAxis(value, deadzone) {
    const clamped = clamp(value, -1, 1);
    const abs = Math.abs(clamped);

    if (abs <= deadzone) {
        return 0;
    }

    const sign = Math.sign(clamped);
    const scaled = (abs - deadzone) / (1 - deadzone);
    return Number((sign * scaled).toFixed(3));
}

function formatAxis(value) {
    const v = Number.isFinite(value) ? value : 0;
    return v.toFixed(3);
}

export function initializeGamepadDiagnostics() {
    const statusEl = document.getElementById('gamepadStatus');
    const leftRawEl = document.getElementById('leftStickYRaw');
    const leftNormEl = document.getElementById('leftStickYNorm');
    const rightRawEl = document.getElementById('rightStickYRaw');
    const rightNormEl = document.getElementById('rightStickYNorm');
    const buttonStateEl = document.getElementById('buttonState');
    const deadzoneInput = document.getElementById('deadzoneInput');
    const pollRateEl = document.getElementById('pollRate');

    if (!statusEl || !leftRawEl || !leftNormEl || !rightRawEl || !rightNormEl || !buttonStateEl || !deadzoneInput || !pollRateEl) {
        return;
    }

    const storedDeadzone = Number.parseFloat(localStorage.getItem(DEADZONE_STORAGE_KEY) ?? '');
    const initialDeadzone = Number.isFinite(storedDeadzone) ? clamp(storedDeadzone, 0, 0.5) : DEFAULT_DEADZONE;
    deadzoneInput.value = initialDeadzone.toFixed(2);

    let currentDeadzone = initialDeadzone;
    let rafId = null;
    let frameCount = 0;
    let rateStart = performance.now();
    let telemetryFrame = 0;

    function setStatus(text, type = 'info') {
        statusEl.textContent = text;
        statusEl.className = `status ${type}`;
    }

    function setDisconnectedState() {
        setStatus('No gamepad connected', 'info');
        leftRawEl.textContent = '0.000';
        leftNormEl.textContent = '0.000';
        rightRawEl.textContent = '0.000';
        rightNormEl.textContent = '0.000';
        buttonStateEl.innerHTML = '';
        emitTelemetry('gamepad', 'disconnected_state');
    }

    function renderButtons(gamepad) {
        const rows = STADIA_MAPPING.map(({ index, label }) => {
            const button = gamepad.buttons[index];
            const pressed = Boolean(button?.pressed);
            const value = Number(button?.value ?? 0).toFixed(3);
            return `
                <div class="button-row">
                    <span>${label} (btn ${index})</span>
                    <span class="${pressed ? 'pressed' : ''}">${pressed ? 'pressed' : 'released'} | v=${value}</span>
                </div>
            `;
        });

        buttonStateEl.innerHTML = rows.join('');
    }

    function renderFrame(gamepad) {
        const leftY = Number(gamepad.axes[1] ?? 0);
        const rightY = Number(gamepad.axes[3] ?? 0);
        const normalizedLeft = normalizeAxis(leftY, currentDeadzone);
        const normalizedRight = normalizeAxis(rightY, currentDeadzone);

        leftRawEl.textContent = formatAxis(leftY);
        rightRawEl.textContent = formatAxis(rightY);
        leftNormEl.textContent = formatAxis(normalizedLeft);
        rightNormEl.textContent = formatAxis(normalizedRight);
        renderButtons(gamepad);

        setStatus(`Connected: ${gamepad.id} (index ${gamepad.index})`, 'success');

        emitTelemetry('gamepad', 'frame', {
            frame: telemetryFrame++,
            id: gamepad.id,
            index: gamepad.index,
            connected: gamepad.connected,
            mapping: gamepad.mapping,
            timestamp: gamepad.timestamp,
            deadzone: currentDeadzone,
            axesRaw: Array.from(gamepad.axes ?? []).map((v) => Number(v ?? 0)),
            axesNormalized: {
                leftY: normalizedLeft,
                rightY: normalizedRight,
            },
            buttons: Array.from(gamepad.buttons ?? []).map((b, idx) => ({
                index: idx,
                pressed: Boolean(b?.pressed),
                touched: Boolean(b?.touched),
                value: Number(b?.value ?? 0),
            })),
        });
    }

    function updatePollRate() {
        frameCount += 1;
        const now = performance.now();
        const elapsed = now - rateStart;
        if (elapsed >= 500) {
            const hz = (frameCount * 1000) / elapsed;
            pollRateEl.textContent = `Polling: ${hz.toFixed(1)} Hz`;
            frameCount = 0;
            rateStart = now;
        }
    }

    function loop() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gamepad = Array.from(pads).find(Boolean);

        if (!gamepad) {
            setDisconnectedState();
            pollRateEl.textContent = 'Polling: 0 Hz';
            frameCount = 0;
            rateStart = performance.now();
            rafId = requestAnimationFrame(loop);
            return;
        }

        renderFrame(gamepad);
        updatePollRate();
        rafId = requestAnimationFrame(loop);
    }

    deadzoneInput.addEventListener('change', () => {
        const parsed = Number.parseFloat(deadzoneInput.value);
        if (!Number.isFinite(parsed)) {
            deadzoneInput.value = currentDeadzone.toFixed(2);
            return;
        }

        currentDeadzone = clamp(parsed, 0, 0.5);
        deadzoneInput.value = currentDeadzone.toFixed(2);
        localStorage.setItem(DEADZONE_STORAGE_KEY, String(currentDeadzone));
        emitTelemetry('gamepad', 'deadzone_changed', { deadzone: currentDeadzone });
    });

    window.addEventListener('gamepadconnected', (event) => {
        const gp = event.gamepad;
        setStatus(`Gamepad connected: ${gp.id} (index ${gp.index})`, 'success');
        emitTelemetry('gamepad', 'connected', {
            id: gp.id,
            index: gp.index,
            mapping: gp.mapping,
            axesLength: gp.axes.length,
            buttonsLength: gp.buttons.length,
        });
    });

    window.addEventListener('gamepaddisconnected', (event) => {
        const gp = event.gamepad;
        setStatus(`Gamepad disconnected: ${gp.id} (index ${gp.index})`, 'info');
        emitTelemetry('gamepad', 'disconnected', {
            id: gp.id,
            index: gp.index,
        });
    });

    setDisconnectedState();
    rafId = requestAnimationFrame(loop);

    return () => {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
    };
}
