import { requestSerialPort as requestAnySerialPort } from './webusb-serial.js';
import { createStreamDecoder, encodeBinaryCommand, initializeCodec } from './codec.js';

// Global state
let port = null;
let reader = null;
let isReading = false;
let streamDecoder = null;

// UI elements
let connectBtn;
let openBtn;
let closeBtn;
let statusDiv;
let lastCommandDiv;
let dataLog;
let autoscroll;
let showRaw;
let commandInput;
let binaryCommandInput;
let sendBinaryBtn;

// Log utilities
function log(message, type = 'data', raw = null) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    let displayText = `[${timestamp}] ${message}`;
    if (raw && showRaw.checked) {
        displayText += ` (0x${Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join(' ')})`;
    }

    entry.textContent = displayText;
    dataLog.appendChild(entry);

    if (autoscroll.checked) {
        dataLog.scrollTop = dataLog.scrollHeight;
    }
}

function clearLog() {
    dataLog.innerHTML = '';
}

function updateStatus(text, type = 'info') {
    statusDiv.textContent = text;
    statusDiv.className = `status ${type}`;
}

function updateCommandStatus(text, type = 'info') {
    lastCommandDiv.textContent = text;
    lastCommandDiv.className = `status ${type}`;
}

// Web Serial API
async function requestSerialPort() {
    try {
        port = await requestAnySerialPort((msg) => log(msg, 'info'));
        const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
        if (info.usbVendorId) {
            log(
                `Selected USB device VID:0x${info.usbVendorId.toString(16).padStart(4, '0')} PID:0x${(info.usbProductId || 0).toString(16).padStart(4, '0')}`,
                'info',
            );
        }
        updateStatus('Port selected. Opening...', 'info');
        connectBtn.disabled = true;
        openBtn.disabled = false;
        log('Port selected; opening automatically', 'success');

        await openPort();
    } catch (err) {
        updateStatus(`Error: ${err.message}`, 'error');
        log(`Request failed: ${err.message}`, 'error');
    }
}

async function openPort() {
    if (!port) {
        updateStatus('No port selected', 'error');
        return;
    }

    try {
        await port.open({ baudRate: 115200 });
        updateStatus('Port opened successfully', 'success');
        openBtn.disabled = true;
        closeBtn.disabled = false;
        commandInput.disabled = false;
        binaryCommandInput.disabled = false;
        sendBinaryBtn.disabled = false;
        log('Port opened at 115200 baud', 'success');
        startReading();
    } catch (err) {
        updateStatus(`Error opening port: ${err.message}`, 'error');
        log(`Open failed: ${err.message}`, 'error');
    }
}

async function closePort() {
    if (!port) return;

    try {
        isReading = false;
        if (reader) {
            await reader.cancel();
            reader = null;
        }
        await port.close();
        port = null;
        if (streamDecoder) {
            streamDecoder.reset();
        }

        updateStatus('Port closed', 'info');
        connectBtn.disabled = false;
        openBtn.disabled = true;
        closeBtn.disabled = true;
        commandInput.disabled = true;
        binaryCommandInput.disabled = true;
        sendBinaryBtn.disabled = true;
        log('Port closed', 'success');
    } catch (err) {
        updateStatus(`Error closing port: ${err.message}`, 'error');
        log(`Close failed: ${err.message}`, 'error');
    }
}

// Reading loop
async function startReading() {
    if (!port || !port.readable) return;

    isReading = true;
    reader = port.readable.getReader();

    log('Started reading from device', 'success');

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (!value || value.length === 0) {
                continue;
            }

            const chunk = value;

            if (showRaw.checked) {
                log(`Received ${chunk.length} byte(s)`, 'data', chunk);
            }

            if (!streamDecoder) {
                log('Codec not initialized; skipping decode', 'error');
                continue;
            }

            const decoded = streamDecoder.decode_stream(chunk);
            for (const event of decoded.events) {
                if (event.kind === 'report') {
                    log(`Decoded report: ${JSON.stringify(event.report)}`, 'success');
                } else if (event.kind === 'text') {
                    log(event.text, 'data');
                } else if (event.kind === 'decode_error') {
                    log(event.error, 'error');
                }
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            updateStatus(`Reading error: ${err.message}`, 'error');
            log(`Read error: ${err.message}`, 'error');
        }
    } finally {
        isReading = false;
        updateStatus('Reading stopped', 'info');
    }
}

// Command sending
async function sendTextCommand() {
    const text = commandInput.value.trim();
    if (text) {
        await sendCommand(text);
        commandInput.value = '';
    }
}

async function sendBinaryCommandFromInput() {
    const raw = binaryCommandInput.value.trim();
    if (!raw) {
        updateCommandStatus('Binary command input is empty', 'error');
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        updateCommandStatus(`Invalid JSON: ${err.message}`, 'error');
        return;
    }

    await sendBinaryCommand(parsed);
}

async function sendBinaryCommand(commandJson, options = {}) {
    const { silent = false } = options;

    if (!port || !port.writable) {
        if (!silent) {
            updateStatus('Port not open', 'error');
        }
        return;
    }

    try {
        const framed = await encodeBinaryCommand(commandJson);
        const writer = port.writable.getWriter();
        await writer.write(framed);
        writer.releaseLock();

        if (!silent) {
            updateCommandStatus('Sent binary command', 'success');
            log(`Sent binary command: ${JSON.stringify(commandJson)}`, 'command-echo', framed);
        }
    } catch (err) {
        if (!silent) {
            updateCommandStatus(`Binary send failed: ${err.message}`, 'error');
            log(`Binary send failed: ${err.message}`, 'error');
        }
    }
}

async function sendCommand(command) {
    if (!port || !port.writable) {
        updateStatus('Port not open', 'error');
        return;
    }

    try {
        const writer = port.writable.getWriter();
        const data = new TextEncoder().encode(command);
        await writer.write(data);
        writer.releaseLock();

        updateCommandStatus(`Sent: "${command}"`, 'success');
        log(`Sent command: "${command}"`, 'command-echo', data);
    } catch (err) {
        updateCommandStatus(`Error: ${err.message}`, 'error');
        log(`Send failed: ${err.message}`, 'error');
    }
}

// Handle enter key in command input
function handleEnter(e) {
    if (e.key === 'Enter') {
        sendTextCommand();
    }
}

// Initialize UI
export function initializeSerialController() {
    connectBtn = document.getElementById('connectBtn');
    openBtn = document.getElementById('openBtn');
    closeBtn = document.getElementById('closeBtn');
    statusDiv = document.getElementById('connectionStatus');
    lastCommandDiv = document.getElementById('lastCommandSent');
    dataLog = document.getElementById('dataLog');
    autoscroll = document.getElementById('autoscroll');
    showRaw = document.getElementById('showRaw');
    commandInput = document.getElementById('commandInput');
    binaryCommandInput = document.getElementById('binaryCommandInput');
    sendBinaryBtn = document.getElementById('sendBinaryBtn');

    // Wire up event listeners
    connectBtn.addEventListener('click', requestSerialPort);
    openBtn.addEventListener('click', openPort);
    closeBtn.addEventListener('click', closePort);
    commandInput.addEventListener('keypress', handleEnter);
    binaryCommandInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendBinaryCommandFromInput();
        }
    });
    document.getElementById('clearLogBtn')?.addEventListener('click', clearLog);
    document.getElementById('sendTextBtn')?.addEventListener('click', sendTextCommand);
    sendBinaryBtn?.addEventListener('click', sendBinaryCommandFromInput);

    // Wire up quick command buttons
    document.querySelectorAll('.quick-cmd').forEach(btn => {
        btn.addEventListener('click', (e) => {
            sendCommand(e.target.getAttribute('data-cmd'));
        });
    });

    // Set initial state
    commandInput.disabled = true;
    binaryCommandInput.disabled = true;
    sendBinaryBtn.disabled = true;

    initializeCodec()
        .then(async () => {
            streamDecoder = await createStreamDecoder();
            log('WASM codec initialized', 'success');
        })
        .catch((err) => {
            log(`WASM codec init failed: ${err.message}`, 'error');
        });

    // Check browser API availability (desktop Web Serial, Android WebUSB fallback)
    if (!navigator.serial && !navigator.usb) {
        updateStatus('Neither Web Serial nor WebUSB is available in this browser', 'error');
        connectBtn.disabled = true;
        log('Web Serial/WebUSB APIs not available', 'error');
    } else if (!navigator.serial && navigator.usb) {
        log('Web Serial unavailable; using WebUSB fallback', 'info');
    }
}

function isSerialWritable() {
    return Boolean(port && port.writable);
}

export { sendBinaryCommand, sendCommand, sendTextCommand, isSerialWritable }
