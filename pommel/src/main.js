import './style.css'
import { initializeSerialController } from './serial.js'

// Initialize the serial controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeSerialController()
})
