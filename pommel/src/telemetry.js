const TELEMETRY_ENDPOINT = '/telemetry';
const FLUSH_INTERVAL_MS = 500;
const MAX_BUFFERED_EVENTS = 5000;

let initialized = false;
let sequence = 0;
let flushTimer = null;
let flushing = false;
let queue = [];

function isGitHubPagesHost() {
    const hostname = String(window.location.hostname || '').toLowerCase();
    return hostname === 'github.io' || hostname.endsWith('.github.io');
}

const telemetryEnabled = !isGitHubPagesHost();

const sessionId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function detectLikelyMobile() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile;
    }

    const ua = String(navigator.userAgent || '');
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

function getClientInfo() {
    return {
        userAgent: String(navigator.userAgent || ''),
        platform: String(navigator.platform || ''),
        language: String(navigator.language || ''),
        isLikelyMobile: detectLikelyMobile(),
        maxTouchPoints: Number(navigator.maxTouchPoints || 0),
        viewport: {
            width: Number(window.innerWidth || 0),
            height: Number(window.innerHeight || 0),
        },
    };
}

const clientInfo = getClientInfo();

export function bytesToHex(bytes) {
    if (!bytes) {
        return '';
    }
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function scheduleFlush() {
    if (!telemetryEnabled) {
        return;
    }

    if (flushTimer !== null) {
        return;
    }

    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        flushTelemetry().catch(() => {
            // Best effort: telemetry should never break control flow.
        });
    }, FLUSH_INTERVAL_MS);
}

async function postEvents(events) {
    if (!telemetryEnabled) {
        return;
    }

    if (!events.length) {
        return;
    }

    await fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events }),
        keepalive: true,
    });
}

export async function flushTelemetry() {
    if (!telemetryEnabled) {
        return;
    }

    if (flushing || queue.length === 0) {
        return;
    }

    flushing = true;
    const batch = queue;
    queue = [];

    try {
        await postEvents(batch);
    } catch {
        // Put failed events back at the front and cap memory usage.
        queue = batch.concat(queue).slice(-MAX_BUFFERED_EVENTS);
    } finally {
        flushing = false;
    }
}

function flushOnPageHide() {
    if (!telemetryEnabled) {
        return;
    }

    if (!queue.length) {
        return;
    }

    const payload = JSON.stringify({ events: queue });
    queue = [];

    if (typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(TELEMETRY_ENDPOINT, blob);
        return;
    }

    fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: payload,
        keepalive: true,
    }).catch(() => {
        // Ignore: page is closing.
    });
}

export function emitTelemetry(category, type, payload = {}) {
    if (!telemetryEnabled) {
        return;
    }

    const event = {
        ts: new Date().toISOString(),
        sessionId,
        sequence: sequence++,
        category,
        type,
        payload,
        client: clientInfo,
    };

    queue.push(event);
    if (queue.length > MAX_BUFFERED_EVENTS) {
        queue = queue.slice(-MAX_BUFFERED_EVENTS);
    }

    scheduleFlush();
}

export function initializeTelemetry() {
    if (initialized) {
        return;
    }
    initialized = true;

    if (!telemetryEnabled) {
        return;
    }

    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushOnPageHide();
        }
    });
    window.addEventListener('pagehide', flushOnPageHide);

    emitTelemetry('session', 'start', {
        path: window.location.pathname,
        href: window.location.href,
    });
}
