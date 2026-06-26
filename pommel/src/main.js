import './style.css'
import { initializeSerialController } from './serial.js'
import { initializeSectionStatePersistence } from './sections.js'
import { initializeGamepadDiagnostics } from './gamepad.js'

// Initialize the serial controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeSectionStatePersistence()
  initializeGamepadDiagnostics()
  initializeSerialController()
})
