/*
 * WebUSB serial wrapper for browsers where Web Serial is unavailable or unreliable.
 *
 * Adapted for pommel from:
 * - https://github.com/Jason2866/WebSerial_ESPTool (MIT)
 * - https://github.com/adafruit/Adafruit_WebSerial_ESPTool (MIT)
 */

const USB_VENDOR_FILTERS = [
    { vendorId: 0x303A }, // Espressif
    { vendorId: 0x0403 }, // FTDI
    { vendorId: 0x1A86 }, // CH340/CH34x
    { vendorId: 0x10C4 }, // CP210x
    { vendorId: 0x067B }, // PL2303
];

function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
}

function callLogger(logger, message) {
    if (!logger) return;
    if (typeof logger === 'function') {
        logger(message);
    } else if (typeof logger.log === 'function') {
        logger.log(message);
    }
}

export class WebUSBSerial {
    constructor(device, logger = null) {
        this.device = device;
        this.logger = logger;
        this.interfaceNumber = null;
        this.controlInterface = null;
        this.endpointIn = null;
        this.endpointOut = null;
        this.readableStream = null;
        this.writableStream = null;
        this.readLoopRunning = false;
        this.maxTransferSize = 64;
        this.isWebUSB = true;
    }

    static async requestPort(logger = null, forceNew = false) {
        if (!navigator.usb) {
            throw new Error('WebUSB not available in this browser');
        }

        let device;
        if (!forceNew && typeof navigator.usb.getDevices === 'function') {
            const authorized = await navigator.usb.getDevices();
            device = authorized.find((d) =>
                USB_VENDOR_FILTERS.some((f) => f.vendorId === d.vendorId),
            );
            if (device) {
                callLogger(logger, '[WebUSB] Reusing previously authorized device');
            }
        }

        if (!device) {
            device = await navigator.usb.requestDevice({ filters: USB_VENDOR_FILTERS });
        }

        return new WebUSBSerial(device, logger);
    }

    async open(options = {}) {
        if (!this.device) {
            throw new Error('No device selected');
        }

        const baudRate = options.baudRate || 115200;

        if (!this.device.opened) {
            await this.device.open();
        }

        if (!this.device.configuration) {
            await this.device.selectConfiguration(1);
        }

        const config = this.device.configuration;
        const candidates = [];

        for (const iface of config.interfaces) {
            for (let altIndex = 0; altIndex < iface.alternates.length; altIndex++) {
                const alt = iface.alternates[altIndex];
                const bulkIn = alt.endpoints.find((ep) => ep.type === 'bulk' && ep.direction === 'in');
                const bulkOut = alt.endpoints.find((ep) => ep.type === 'bulk' && ep.direction === 'out');

                if (bulkIn && bulkOut) {
                    const score = alt.interfaceClass === 0x0a ? 0 : (alt.interfaceClass === 0xff ? 1 : 2);
                    candidates.push({ iface, altIndex, alt, bulkIn, bulkOut, score });
                    break;
                }
            }
        }

        if (candidates.length === 0) {
            throw new Error('No compatible bulk USB interface found');
        }

        candidates.sort((a, b) => a.score - b.score);
        const candidate = candidates[0];

        await this.device.claimInterface(candidate.iface.interfaceNumber);
        try {
            await this.device.selectAlternateInterface(candidate.iface.interfaceNumber, candidate.altIndex);
        } catch (_) {
            // Some devices only expose a single alternate and reject this call.
        }

        this.interfaceNumber = candidate.iface.interfaceNumber;
        this.endpointIn = candidate.bulkIn.endpointNumber;
        this.endpointOut = candidate.bulkOut.endpointNumber;

        const controlIface = config.interfaces.find((i) =>
            i.alternates[0] && i.alternates[0].interfaceClass === 0x02,
        );
        this.controlInterface = controlIface ? controlIface.interfaceNumber : this.interfaceNumber;

        if (this.controlInterface !== this.interfaceNumber) {
            try {
                await this.device.claimInterface(this.controlInterface);
            } catch (_) {
                this.controlInterface = this.interfaceNumber;
            }
        }

        await this.initializeLineDiscipline(baudRate);
        this.createStreams();
    }

    async initializeLineDiscipline(baudRate) {
        const vid = this.device.vendorId;

        // CP210x commonly needs vendor-specific init on Android.
        if (vid === 0x10c4) {
            const baudrateBuffer = new ArrayBuffer(4);
            const baudrateView = new DataView(baudrateBuffer);
            baudrateView.setUint32(0, baudRate, true);

            await this.device.controlTransferOut({
                requestType: 'vendor',
                recipient: 'device',
                request: 0x00,
                value: 0x01,
                index: 0x00,
            });

            await this.device.controlTransferOut({
                requestType: 'vendor',
                recipient: 'device',
                request: 0x03,
                value: 0x0800,
                index: 0x00,
            });

            await this.device.controlTransferOut({
                requestType: 'vendor',
                recipient: 'device',
                request: 0x07,
                value: 0x03 | 0x0100 | 0x0200,
                index: 0x00,
            });

            await this.device.controlTransferOut({
                requestType: 'vendor',
                recipient: 'interface',
                request: 0x1E,
                value: 0,
                index: 0,
            }, baudrateBuffer);

            return;
        }

        const lineCoding = new Uint8Array([
            baudRate & 0xFF,
            (baudRate >> 8) & 0xFF,
            (baudRate >> 16) & 0xFF,
            (baudRate >> 24) & 0xFF,
            0x00,
            0x00,
            0x08,
        ]);

        try {
            await this.device.controlTransferOut({
                requestType: 'class',
                recipient: 'interface',
                request: 0x20,
                value: 0,
                index: this.controlInterface || 0,
            }, lineCoding);
        } catch (err) {
            callLogger(this.logger, `[WebUSB] Could not set line coding: ${err.message || err}`);
        }

        try {
            await this.device.controlTransferOut({
                requestType: 'class',
                recipient: 'interface',
                request: 0x22,
                value: 0x03,
                index: this.controlInterface || 0,
            });
        } catch (err) {
            callLogger(this.logger, `[WebUSB] Could not set control lines: ${err.message || err}`);
        }
    }

    createStreams() {
        this.readLoopRunning = true;

        this.readableStream = new ReadableStream({
            start: async (controller) => {
                while (this.readLoopRunning && this.device && this.device.opened) {
                    try {
                        const result = await this.device.transferIn(this.endpointIn, this.maxTransferSize);

                        if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
                            let packet = new Uint8Array(
                                result.data.buffer,
                                result.data.byteOffset,
                                result.data.byteLength,
                            );

                            // FTDI adapters prepend a 2-byte modem status header to each packet.
                            // Drop it so downstream consumers only see payload bytes.
                            if (this.device.vendorId === 0x0403 && packet.byteLength >= 2) {
                                packet = packet.subarray(2);
                            }

                            if (packet.byteLength > 0) {
                                controller.enqueue(packet);
                            }
                        } else if (result.status === 'stall') {
                            await this.device.clearHalt('in', this.endpointIn);
                        }
                    } catch (err) {
                        controller.error(err);
                        return;
                    }
                }

                controller.close();
            },
            cancel: () => {
                this.readLoopRunning = false;
            },
        });

        this.writableStream = new WritableStream({
            write: async (chunk) => {
                await this.device.transferOut(this.endpointOut, chunk);
            },
        });
    }

    get readable() {
        return this.readableStream;
    }

    get writable() {
        return this.writableStream;
    }

    getInfo() {
        if (!this.device) {
            return {};
        }
        return {
            usbVendorId: this.device.vendorId,
            usbProductId: this.device.productId,
        };
    }

    async close() {
        this.readLoopRunning = false;

        if (!this.device) {
            return;
        }

        try {
            if (this.interfaceNumber !== null) {
                await this.device.releaseInterface(this.interfaceNumber);
            }
        } catch (_) {
            // Ignore release failures during unplug/teardown.
        }

        try {
            if (this.controlInterface !== null && this.controlInterface !== this.interfaceNumber) {
                await this.device.releaseInterface(this.controlInterface);
            }
        } catch (_) {
            // Ignore release failures during unplug/teardown.
        }

        if (this.device.opened) {
            await this.device.close();
        }
    }
}

export async function requestSerialPort(logger = null, forceNew = false) {
    const hasSerial = 'serial' in navigator;
    const hasUSB = 'usb' in navigator;

    if (isAndroid() && hasUSB) {
        return WebUSBSerial.requestPort(logger, forceNew);
    }

    if (hasSerial) {
        return navigator.serial.requestPort();
    }

    if (hasUSB) {
        return WebUSBSerial.requestPort(logger, forceNew);
    }

    throw new Error('Neither Web Serial API nor WebUSB is supported in this browser');
}
