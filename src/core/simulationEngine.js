export class CircuitSimulationEngine {
  constructor(circuit) { this.circuit = structuredClone(circuit); this.status = 'stopped'; this.time = 0; this.listeners = new Set(); }
  subscribe(listener) { this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener); }
  emit() { const state = this.getState(); this.listeners.forEach(listener => listener(state)); }
  start() { this.status = 'running'; this.emit(); }
  pause() { this.status = 'paused'; this.emit(); }
  stop() { this.status = 'stopped'; this.time = 0; this.circuit.led.on = false; this.circuit.arduino.pins.D13 = false; this.emit(); }
  reset() { this.stop(); this.circuit.switch.closed = true; this.emit(); }
  step(dt = 1 / 60) {
    if (this.status !== 'running') return;
    this.time += dt;
    const phase = Math.floor(this.time * 2) % 2 === 0;
    const powered = this.circuit.switch.closed && phase;
    this.circuit.arduino.pins.D13 = powered;
    this.circuit.led.on = powered;
    this.emit();
  }
  getState() { return { status: this.status, time: this.time, led: { ...this.circuit.led }, arduino: { ...this.circuit.arduino }, meter: this.circuit.led.on ? 5.02 : 0 }; }
}
export const demoCircuit = { version: 1, name: 'main', components: [{ id: 'U1', type: 'arduino-uno', x: 150, y: 180 }, { id: 'R1', type: 'resistor', value: 220, x: 420, y: 250 }, { id: 'LED1', type: 'led', color: 'red', x: 560, y: 250 }, { id: 'GND1', type: 'ground', x: 660, y: 470 }], wires: [['U1.D13', 'R1.1'], ['R1.2', 'LED1.A'], ['LED1.K', 'GND1']], switch: { closed: true }, led: { on: false }, arduino: { pins: { D13: false } } };
export function createDemoEngine() { return new CircuitSimulationEngine(demoCircuit); }
