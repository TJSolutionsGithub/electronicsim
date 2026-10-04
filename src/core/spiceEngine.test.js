import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitState } from './circuitState.js';
import { evaluateCircuit } from './circuitEvaluator.js';
import { buildSpiceNetlist, runSpiceOperatingPoint } from './spiceEngine.js';

const component = (id, type, values = {}) => ({ id, type, x: 100, y: 100, rotation: 0, ...values });
const wire = (id, from, to) => ({ id, from, to, kind: 'signal', points: [], manual: false });
const stateOf = (components, wires) => createCircuitState({ version: 2, name: 'spice-test', components, wires });

function dividerState() {
  return stateOf([
    component('V1', 'dc-source', { voltage: 12 }),
    component('R1', 'resistor', { value: '1 kΩ' }),
    component('R2', 'resistor', { value: '2 kΩ' }),
    component('VMIN', 'voltmeter'), component('VMMID', 'voltmeter'), component('GND1', 'ground')
  ], [
    wire('W1', 'V1.+', 'R1.1'), wire('W2', 'R1.2', 'R2.1'), wire('W3', 'R2.2', 'V1.-'), wire('W4', 'V1.-', 'GND1.1'),
    wire('W5', 'VMIN.+', 'V1.+'), wire('W6', 'VMIN.-', 'V1.-'),
    wire('W7', 'VMMID.+', 'R2.1'), wire('W8', 'VMMID.-', 'V1.-')
  ]);
}

test('SPICE adapter preserves exact visual wire-node topology', () => {
  const state = dividerState(), adapter = buildSpiceNetlist(state, { fallbackResult: evaluateCircuit(state) });
  assert.equal(adapter.eligible, true);
  assert.equal(adapter.referenceToNode.get('V1.+'), adapter.referenceToNode.get('R1.1'));
  assert.equal(adapter.referenceToNode.get('R1.2'), adapter.referenceToNode.get('R2.1'));
  assert.equal(adapter.referenceToNode.get('V1.-'), '0');
  assert.notEqual(adapter.referenceToNode.get('V1.+'), adapter.referenceToNode.get('R1.2'));
  assert.match(adapter.netlist, /\.op\n\.end/);
  assert.match(adapter.netlist, /DC 1\.200000000000e\+1/);
  assert.match(adapter.netlist, /1\.000000000000e\+3/);
  assert.match(adapter.netlist, /2\.000000000000e\+3/);
});

test('SPICE adapter keeps independent floating source islands separate', () => {
  const state = stateOf([
    component('V5', 'dc-source', { voltage: 5 }), component('V12', 'dc-source', { voltage: 12 }),
    component('VM5', 'voltmeter'), component('VM12', 'voltmeter')
  ], [
    wire('W1', 'VM5.+', 'V5.+'), wire('W2', 'VM5.-', 'V5.-'),
    wire('W3', 'VM12.+', 'V12.+'), wire('W4', 'VM12.-', 'V12.-')
  ]);
  const adapter = buildSpiceNetlist(state, { fallbackResult: evaluateCircuit(state) });
  assert.notEqual(adapter.referenceToNode.get('V5.+'), adapter.referenceToNode.get('V12.+'));
  assert.notEqual(adapter.referenceToNode.get('V5.-'), adapter.referenceToNode.get('V12.-'));
  assert.equal((adapter.netlist.match(/^RREF/gm) || []).length, 4);
});

test('digital circuits explicitly select the existing node-MNA fallback', () => {
  const state = stateOf([component('DIN1', 'logic-input'), component('U1', 'logic-and')], []);
  const adapter = buildSpiceNetlist(state, { fallbackResult: evaluateCircuit(state) });
  assert.equal(adapter.eligible, false);
  assert.deepEqual(adapter.unsupportedComponents, ['DIN1', 'U1']);
});

test('AC and transient netlists use native SPICE analysis directives', () => {
  const state = stateOf([component('VS1', 'ac-source', { voltage: 10, frequency: 1000, phase: 30 })], []);
  const transient = buildSpiceNetlist(state, { analysis: 'tran' });
  const ac = buildSpiceNetlist(state, { analysis: 'ac' });
  assert.match(transient.netlist, /SIN\(0 1\.414213562373e\+1 1\.000000000000e\+3/);
  assert.match(transient.netlist, /\.tran /);
  assert.match(ac.netlist, / AC 1\.000000000000e\+1 3\.000000000000e\+1/);
  assert.match(ac.netlist, /\.ac dec 40 1 100Meg/);
});

test('ngspice WebAssembly solves divider meters and transformer ratio', async () => {
  const divider = dividerState(), dividerFallback = evaluateCircuit(divider);
  const divided = await runSpiceOperatingPoint(divider, dividerFallback, { timeout: 30000 });
  assert.equal(divided.solver, 'ngspice-wasm');
  assert.equal(divided.measurements.get('VMIN'), '12.00 V');
  // The 10 MΩ meter input loads the 2 kΩ lower resistor by a tiny amount.
  assert.equal(divided.measurements.get('VMMID'), '8.00 V');
  assert.equal(divided.spice.points, 1);

  const transformer = stateOf([
    component('VS1', 'ac-source', { voltage: 120 }), component('T1', 'transformer', { ratio: '10:1' }),
    component('VMP', 'voltmeter'), component('VMS', 'voltmeter')
  ], [
    wire('W1', 'VS1.1', 'T1.P1'), wire('W2', 'VS1.2', 'T1.P2'),
    wire('W3', 'VMP.+', 'T1.P1'), wire('W4', 'VMP.-', 'T1.P2'),
    wire('W5', 'VMS.+', 'T1.S1'), wire('W6', 'VMS.-', 'T1.S2')
  ]);
  const transformed = await runSpiceOperatingPoint(transformer, evaluateCircuit(transformer), { timeout: 30000 });
  assert.equal(transformed.solver, 'ngspice-wasm');
  assert.equal(transformed.measurements.get('VMP'), '120.00 V');
  assert.equal(transformed.measurements.get('VMS'), '12.00 V');
});
