const SECTION_STATE_KEY = 'pommel.section-state.v1';

function readState() {
    try {
        const raw = localStorage.getItem(SECTION_STATE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeState(state) {
    localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
}

export function initializeSectionStatePersistence() {
    const sections = document.querySelectorAll('details[data-section-key]');
    if (!sections.length) {
        return;
    }

    const state = readState();

    sections.forEach((section) => {
        const key = section.getAttribute('data-section-key');
        if (!key) {
            return;
        }

        if (Object.prototype.hasOwnProperty.call(state, key)) {
            section.open = Boolean(state[key]);
        }

        section.addEventListener('toggle', () => {
            state[key] = section.open;
            writeState(state);
        });
    });
}
