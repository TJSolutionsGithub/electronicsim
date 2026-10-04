import template from './template.js';
import '../styles.css';
import { initCircuitLab } from '../app.js';

// CircuitLab's canvas/controller is intentionally imperative: SVG pointer
// capture, native drag/drop and file APIs should be bound exactly once to a
// fresh shell. Rendering this shell through React Fast Refresh allowed React
// to replace the DOM without re-running initCircuitLab, leaving the old,
// static-looking markup behind. Mount it directly and let Vite perform a full
// page reload for source updates instead.
const root = document.getElementById('root');
root.innerHTML = template;
initCircuitLab();
window.dispatchEvent(new Event('circuitlab:ready'));
