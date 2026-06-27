import './style.css'
import { initializeSerialController } from './serial.js'
import { initializeSectionStatePersistence } from './sections.js'
import { initializeGamepadDiagnostics } from './gamepad.js'
import { initializePhase4TrivialMapping } from './phase4.js'
import { initializeTelemetry } from './telemetry.js'

// Initialize the serial controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeTelemetry()
  initializeSectionStatePersistence()
  initializeGamepadDiagnostics()
  initializeSerialController()
  initializePhase4TrivialMapping()
})
