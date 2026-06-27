# Pommel

## Phase 1: Web Serial Testing Application

Pommel is a minimal web app for testing serial communication with Kitesabre firmware.

Connection transport behavior:
- Desktop browsers use Web Serial when available.
- Android Chrome uses a WebUSB fallback so USB serial adapters (for example M5Stack bridges) enumerate reliably.

## Attribution

The Android WebUSB fallback in this project is adapted from these MIT-licensed projects:
- Jason2866/WebSerial_ESPTool: https://github.com/Jason2866/WebSerial_ESPTool
- adafruit/Adafruit_WebSerial_ESPTool: https://github.com/adafruit/Adafruit_WebSerial_ESPTool

### Features

- **Connect Button**: Uses a unified port picker (`Web Serial` on desktop, `WebUSB` fallback on Android)
- **Open/Close Controls**: Manage the serial connection at 115200 baud
- **Text Input**: Send arbitrary text commands to the device
- **Quick Command Buttons**: Pre-configured buttons for common commands (ping, help, arrows)
- **Message Log**: Displays incoming data with message boundary detection and raw byte display
- **Auto-scroll**: Toggle auto-scrolling of the log

### Protocol Support

- **Text commands**: Single-byte commands like `p` (ping), `?` (help), `^` (up), `v` (down), etc.
- **Message boundaries**: Detects `#` prefix and `0x00` terminator for framed messages
- **Raw bytes**: Option to display raw hex values for debugging

### Running Locally

#### Option 1: Simple Python HTTP Server

```bash
cd kitesabre/pommel
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

**Note**: Web Serial API requires a secure context (HTTPS), so this only works for localhost.

#### Option 2: Using `http-server` (npm)

```bash
cd kitesabre/pommel
npx http-server -p 8000
```

### Hosting on Tailnet

For accessing from a phone on cellular or Wi-Fi, you need to host over HTTPS on your Tailnet.

#### Using Tailscale Serve (Recommended)

1. Install and configure Tailscale on your machine
2. Share the web directory:

```bash
cd kitesabre/pommel
tailscale serve file .
```

This will give you a Tailnet URL (something like `https://your-machine.your-domain.ts.net`).

Alternatively, use a more specific port and path setup:

```bash
# Setup a simple HTTPS server first (see below), then
tailscale serve https:8443 file .
```

#### Using a Local HTTPS Server

1. Generate a self-signed certificate:

```bash
openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365
```

2. Use Node.js with HTTPS:

```bash
cd kitesabre/pommel
npm install --save-dev node-static
node server.js
```

Create `server.js`:

```javascript
const https = require('https');
const fs = require('fs');
const static = require('node-static');

const file = new static.Server(__dirname);
const options = {
    key: fs.readFileSync('./key.pem'),
    cert: fs.readFileSync('./cert.pem')
};

https.createServer(options, (req, res) => {
    file.serve(req, res);
}).listen(8443);

console.log('HTTPS server running at https://localhost:8443');
```

3. Access via Tailnet:
   - Get your local IP: `ifconfig` (or `ipconfig` on Windows)
   - Make sure Tailscale is running
   - Access from phone: `https://your-machine.your-domain.ts.net`

### Testing Checklist (Phase 1 Acceptance Criteria)

- [ ] Phone can connect to board serial from the Tailnet URL
- [ ] At least one command/response round-trip succeeds
- [ ] Unplug/replug recovery works without browser restart

### Browser Compatibility

- **Chrome/Chromium**: Full support (recommended)
- **Edge**: Full support
- **Firefox**: Partial support (may require flags)
- **Safari**: No native support

### Devices Tested

- Android Chrome: Yes (target platform for Phase 1)
- macOS Safari: Not supported
- iOS Safari: Not supported

### Troubleshooting

**"Web Serial API not available"**
- Check browser compatibility (need Chrome/Edge with serial support enabled)
- Verify secure context (HTTPS or localhost)

**"Permission denied"**
- Check browser serial permissions
- Try disconnecting and reconnecting the device

**"Port not responding"**
- Verify device is connected and recognized by OS
- Check baud rate (115200 is hardcoded)
- Try power-cycling the device

**Message log shows garbled text**
- Check baud rate matches device firmware
- Try enabling "Show raw bytes" checkbox for debugging

### Next Steps (Phase 2+)

- Phase 2: Add Gamepad API support for controller input
- Phase 3: Integrate WASM codec for binary message encoding/decoding
- Phase 4: Full control loop implementation
