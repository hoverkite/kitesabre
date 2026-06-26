// Global state
let port = null;
let reader = null;
let isReading = false;
const messageBuffer = [];

// UI elements
let connectBtn, openBtn, closeBtn, statusDiv, lastCommandDiv, dataLog, autoscroll, showRaw, commandInput;

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
        port = await navigator.serial.requestPort();
        updateStatus('Port selected. Click "Open Port" to connect.', 'info');
        connectBtn.disabled = true;
        openBtn.disabled = false;
        log('Serial port requested', 'success');
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
        
        updateStatus('Port closed', 'info');
        connectBtn.disabled = false;
        openBtn.disabled = true;
        closeBtn.disabled = true;
        commandInput.disabled = true;
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
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    log('Started reading from device', 'success');
    let incompleteMessage = '';
    let lastWasData = false;

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value) {
                lastWasData = true;
                const chunk = value;
                
                // Log raw bytes if checkbox is enabled
                if (showRaw.checked) {
                    const bytes = new TextEncoder().encode(chunk);
                    log(`Received: ${chunk.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}`, 'data', bytes);
                }

                // Process message boundaries (look for '#' prefix and 0x00 terminator)
                for (let i = 0; i < chunk.length; i++) {
                    const char = chunk[i];
                    
                    if (char === '#') {
                        // Start of a new message
                        if (incompleteMessage) {
                            // Log any incomplete message before starting new one
                            log(`Incomplete message ignored: ${incompleteMessage}`, 'error');
                        }
                        incompleteMessage = '#';
                        log('Message boundary: Start (#)', 'message-boundary');
                    } else if (char === '\0') {
                        // End of message
                        if (incompleteMessage.startsWith('#')) {
                            log(`Message boundary: End (0x00) - Full message: ${incompleteMessage}`, 'message-boundary');
                            incompleteMessage = '';
                        }
                    } else if (incompleteMessage.startsWith('#')) {
                        incompleteMessage += char;
                    }
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

    // Wire up event listeners
    connectBtn.addEventListener('click', requestSerialPort);
    openBtn.addEventListener('click', openPort);
    closeBtn.addEventListener('click', closePort);
    commandInput.addEventListener('keypress', handleEnter);
    document.getElementById('clearLogBtn')?.addEventListener('click', clearLog);
    document.getElementById('sendTextBtn')?.addEventListener('click', sendTextCommand);

    // Wire up quick command buttons
    document.querySelectorAll('.quick-cmd').forEach(btn => {
        btn.addEventListener('click', (e) => {
            sendCommand(e.target.getAttribute('data-cmd'));
        });
    });

    // Set initial state
    commandInput.disabled = true;

    // Check Web Serial API availability
    if (!navigator.serial) {
        updateStatus('Web Serial API not available in this browser', 'error');
        connectBtn.disabled = true;
        log('Web Serial API not available', 'error');
    }
}

export { sendCommand, sendTextCommand }
