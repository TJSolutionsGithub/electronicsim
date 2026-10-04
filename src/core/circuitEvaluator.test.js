import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitState, serializeCircuit } from './circuitState.js';
import { evaluateCircuit } from './circuitEvaluator.js';

const component = (id, type, values = {}) => ({ id, type, x: 100, y: 100, rotation: 0, ...values });
const wire = (id, from, to) => ({ id, from, to, kind: 'signal', points: [], manual: false });
const stateOf = (components, wires) => createCircuitState({ version: 2, name: 'test', components, wires });

function twoBranchSpdt(position = 'A') {
  return stateOf([
    component('BT1', 'battery'), component('S1', 'switch-spdt', { position }),
    component('R1', 'resistor'), component('LEDA', 'led'), component('R2', 'resistor'), component('LEDB', 'led')
  ], [
    wire('W1', 'BT1.+', 'S1.COM'), wire('W2', 'S1.A', 'R1.1'), wire('W3', 'R1.2', 'LEDA.A'), wire('W4', 'LEDA.K', 'BT1.-'),
    wire('W5', 'S1.B', 'R2.1'), wire('W6', 'R2.2', 'LEDB.A'), wire('W7', 'LEDB.K', 'BT1.-')
  ]);
}

test('SPDT connects COM to exactly the selected A or B branch', () => {
  const state = twoBranchSpdt('A');
  let result = evaluateCircuit(state);
  assert.deepEqual([...result.poweredComponents], ['LEDA']);
  state.components.find(component => component.id === 'S1').position = 'B';
  result = evaluateCircuit(state);
  assert.deepEqual([...result.poweredComponents], ['LEDB']);
});

test('SPST and pushbutton honor their real conductive states', () => {
  for (const [type, openValues, closedValues] of [
    ['switch-spst', { closed: false }, { closed: true }],
    ['pushbutton', { closed: false, normallyClosed: false }, { closed: true, normallyClosed: false }],
    ['pushbutton', { closed: true, normallyClosed: true }, { closed: false, normallyClosed: true }]
  ]) {
    const state = stateOf([component('BT1', 'battery'), component('SW1', type, openValues), component('LED1', 'led')], [
      wire('W1', 'BT1.+', 'SW1.1'), wire('W2', 'SW1.2', 'LED1.A'), wire('W3', 'LED1.K', 'BT1.-')
    ]);
    assert.equal(evaluateCircuit(state).poweredComponents.has('LED1'), false, `${type} open`);
    Object.assign(state.components.find(item => item.id === 'SW1'), closedValues);
    assert.equal(evaluateCircuit(state).poweredComponents.has('LED1'), true, `${type} closed`);
  }
});

test('relay contact follows coil power', () => {
  const state = stateOf([
    component('V1', 'dc-source'), component('S1', 'switch-spst', { closed: false }), component('K1', 'relay'),
    component('BT1', 'battery'), component('LP1', 'lamp')
  ], [
    wire('W1', 'V1.+', 'S1.1'), wire('W2', 'S1.2', 'K1.A1'), wire('W3', 'K1.A2', 'V1.-'),
    wire('W4', 'BT1.+', 'K1.COM'), wire('W5', 'K1.NO', 'LP1.1'), wire('W6', 'LP1.2', 'BT1.-')
  ]);
  assert.equal(evaluateCircuit(state).poweredComponents.has('LP1'), false);
  state.components.find(item => item.id === 'S1').closed = true;
  const result = evaluateCircuit(state);
  assert.equal(result.energizedRelays.has('K1'), true);
  assert.equal(result.poweredComponents.has('LP1'), true);
});

test('diode conducts forward and blocks reverse', () => {
  const make = reversed => stateOf([component('BT1', 'battery'), component('D1', 'diode'), component('LP1', 'lamp')], [
    wire('W1', 'BT1.+', reversed ? 'D1.2' : 'D1.1'),
    wire('W2', reversed ? 'D1.1' : 'D1.2', 'LP1.1'), wire('W3', 'LP1.2', 'BT1.-')
  ]);
  assert.equal(evaluateCircuit(make(false)).poweredComponents.has('LP1'), true);
  assert.equal(evaluateCircuit(make(true)).poweredComponents.has('LP1'), false);
});

test('NPN, PNP and NMOS controls gate their load path', () => {
  const cases = [
    { type: 'transistor-npn', pins: ['C', 'E'], control: 'B', positiveControl: true },
    { type: 'transistor-pnp', pins: ['E', 'C'], control: 'B', positiveControl: false },
    { type: 'nmos', pins: ['D', 'S'], control: 'G', positiveControl: true }
  ];
  for (const item of cases) {
    const components = [component('BT1', 'battery'), component('Q1', item.type), component('LP1', 'lamp'), component('R1', 'resistor')];
    const wires = [
      wire('W1', 'BT1.+', item.type === 'transistor-pnp' ? `Q1.${item.pins[0]}` : 'LP1.1'),
      wire('W2', item.type === 'transistor-pnp' ? `Q1.${item.pins[1]}` : 'LP1.2', item.type === 'transistor-pnp' ? 'LP1.1' : `Q1.${item.pins[0]}`),
      wire('W3', item.type === 'transistor-pnp' ? 'LP1.2' : `Q1.${item.pins[1]}`, 'BT1.-'),
      wire('W4', item.positiveControl ? 'BT1.+' : 'BT1.-', 'R1.1'), wire('W5', 'R1.2', `Q1.${item.control}`)
    ];
    const state = stateOf(components, wires);
    assert.equal(evaluateCircuit(state).poweredComponents.has('LP1'), true, `${item.type} on`);
    state.wires = state.wires.filter(entry => !['W4', 'W5'].includes(entry.id));
    assert.equal(evaluateCircuit(state).poweredComponents.has('LP1'), false, `${item.type} off`);
  }
});

test('powered op-amp and transformer create derived output paths', () => {
  const opamp = stateOf([component('V1', 'dc-source'), component('U1', 'opamp'), component('R1', 'resistor'), component('LED1', 'led')], [
    wire('W1', 'V1.+', 'U1.V+'), wire('W2', 'V1.-', 'U1.V-'), wire('W3', 'V1.+', 'U1.+'), wire('W4', 'V1.-', 'U1.-'),
    wire('W5', 'U1.OUT', 'R1.1'), wire('W6', 'R1.2', 'LED1.A'), wire('W7', 'LED1.K', 'V1.-')
  ]);
  assert.equal(evaluateCircuit(opamp).poweredComponents.has('LED1'), true);

  const transformer = stateOf([component('VS1', 'ac-source'), component('T1', 'transformer'), component('LP1', 'lamp')], [
    wire('W1', 'VS1.1', 'T1.P1'), wire('W2', 'VS1.2', 'T1.P2'), wire('W3', 'T1.S1', 'LP1.1'), wire('W4', 'LP1.2', 'T1.S2')
  ]);
  assert.equal(evaluateCircuit(transformer).poweredComponents.has('LP1'), true);
});

test('transient simulation fields are excluded from saved circuit files', () => {
  const state = twoBranchSpdt('A');
  state.components[0]._simOn = true;
  state.components[1]._simEnergized = true;
  const saved = serializeCircuit(state);
  assert.equal(saved.includes('_simOn'), false);
  assert.equal(saved.includes('_simEnergized'), false);
});

test('all seven logic gates produce the expected truth tables', () => {
  const truthTables = {
    'logic-and': [false, false, false, true],
    'logic-or': [false, true, true, true],
    'logic-nand': [true, true, true, false],
    'logic-nor': [true, false, false, false],
    'logic-xor': [false, true, true, false],
    'logic-xnor': [true, false, false, true]
  };
  for (const [type, expected] of Object.entries(truthTables)) {
    for (let bits = 0; bits < 4; bits += 1) {
      const state = stateOf([
        component('VCC1', 'vcc'), component('GND1', 'ground'), component('A1', 'logic-input', { high: Boolean(bits & 2) }),
        component('B1', 'logic-input', { high: Boolean(bits & 1) }), component('U1', type), component('LED1', 'led')
      ], [
        wire('W1', 'VCC1.1', 'U1.VCC'), wire('W2', 'GND1.1', 'U1.GND'), wire('W3', 'A1.OUT', 'U1.A'),
        wire('W4', 'B1.OUT', 'U1.B'), wire('W5', 'U1.Y', 'LED1.A'), wire('W6', 'LED1.K', 'GND1.1')
      ]);
      assert.equal(evaluateCircuit(state).poweredComponents.has('LED1'), expected[bits], `${type}/${bits.toString(2).padStart(2, '0')}`);
    }
  }

  for (const [high, expected] of [[false, true], [true, false]]) {
    const state = stateOf([
      component('VCC1', 'vcc'), component('GND1', 'ground'), component('A1', 'logic-input', { high }),
      component('U1', 'logic-not'), component('LED1', 'led')
    ], [wire('W1', 'VCC1.1', 'U1.VCC'), wire('W2', 'GND1.1', 'U1.GND'), wire('W3', 'A1.OUT', 'U1.A'), wire('W4', 'U1.Y', 'LED1.A'), wire('W5', 'LED1.K', 'GND1.1')]);
    assert.equal(evaluateCircuit(state).poweredComponents.has('LED1'), expected, `logic-not/${high}`);
  }
});

test('digital ICs and analyzers expose per-pin simulation state', () => {
  const state = stateOf([
    component('VCC1', 'vcc'), component('GND1', 'ground'), component('D1', 'logic-input', { high: true }),
    component('CLK1', 'clock-generator', { enabled: true, high: true }), component('U1', 'd-flip-flop', { q: false }),
    component('LA1', 'logic-analyzer'), component('DS1', 'seven-segment')
  ], [
    wire('W1', 'VCC1.1', 'U1.VCC'), wire('W2', 'GND1.1', 'U1.GND'), wire('W3', 'D1.OUT', 'U1.D'), wire('W4', 'CLK1.OUT', 'U1.CLK'),
    wire('W5', 'U1.Q', 'LA1.D0'), wire('W6', 'U1.QN', 'LA1.D1'), wire('W7', 'D1.OUT', 'LA1.D2'), wire('W8', 'LA1.GND', 'GND1.1'),
    wire('W9', 'D1.OUT', 'DS1.A'), wire('W10', 'D1.OUT', 'DS1.G'), wire('W11', 'DS1.COM', 'GND1.1'), wire('W12', 'D1.GND', 'GND1.1')
  ]);
  const result = evaluateCircuit(state);
  assert.equal(result.digitalStates.get('U1'), true);
  assert.deepEqual(result.signalStates.get('LA1'), [true, false, true, false]);
  assert.deepEqual([...result.segmentStates.get('DS1')], ['A', 'G']);
});

test('bench instruments report voltage, current and scope channel activity', () => {
  const state = stateOf([
    component('BT1', 'battery', { voltage: 9 }), component('AM1', 'ammeter'), component('R1', 'resistor', { value: '330 Ω' }),
    component('LP1', 'lamp'), component('VM1', 'voltmeter'), component('OSC1', 'oscilloscope')
  ], [
    wire('W1', 'BT1.+', 'AM1.+'), wire('W2', 'AM1.-', 'R1.1'), wire('W3', 'R1.2', 'LP1.1'), wire('W4', 'LP1.2', 'BT1.-'),
    wire('W5', 'VM1.+', 'BT1.+'), wire('W6', 'VM1.-', 'BT1.-'), wire('W7', 'OSC1.CH1', 'BT1.+'), wire('W8', 'OSC1.GND', 'BT1.-')
  ]);
  const result = evaluateCircuit(state);
  // The loaded battery includes its configured 0.5 Ω internal resistance.
  assert.equal(result.measurements.get('VM1'), '8.99 V');
  // Current includes the 330 Ω resistor, 28.8 Ω lamp resistance, meter burden
  // and battery internal resistance.
  assert.equal(result.measurements.get('AM1'), '25.0 mA');
  assert.deepEqual(result.signalStates.get('OSC1'), [true, false]);
  assert.equal(result.poweredComponents.has('LP1'), true);
});

test('multiplexer, decoder and register blocks expose deterministic digital outputs', () => {
  const state = stateOf([
    component('VCC1', 'vcc'), component('GND1', 'ground'), component('HI', 'logic-input', { high: true }),
    component('MUX1', 'mux-2to1', { enabled: true }), component('DEC1', 'decoder-2to4', { enabled: true }),
    component('CNT1', 'binary-counter', { value: 10 })
  ], [
    wire('W1', 'VCC1.1', 'MUX1.VCC'), wire('W2', 'GND1.1', 'MUX1.GND'), wire('W3', 'HI.OUT', 'MUX1.B'), wire('W4', 'HI.OUT', 'MUX1.S'),
    wire('W5', 'VCC1.1', 'DEC1.VCC'), wire('W6', 'GND1.1', 'DEC1.GND'), wire('W7', 'HI.OUT', 'DEC1.A'),
    wire('W8', 'VCC1.1', 'CNT1.VCC'), wire('W9', 'GND1.1', 'CNT1.GND')
  ]);
  const result = evaluateCircuit(state);
  assert.equal(result.positiveNodes.has('MUX1.Y'), true);
  assert.equal(result.positiveNodes.has('DEC1.Y1'), true);
  assert.equal(result.positiveNodes.has('DEC1.Y0'), false);
  assert.equal(result.positiveNodes.has('CNT1.Q1'), true);
  assert.equal(result.positiveNodes.has('CNT1.Q3'), true);
  assert.equal(result.positiveNodes.has('CNT1.Q0'), false);
});

test('function generator, frequency counter and ohmmeter provide instrument readings', () => {
  const state = stateOf([
    component('FG1', 'function-generator', { enabled: true, frequency: 25000, amplitude: 3.3 }),
    component('FC1', 'frequency-counter'), component('OM1', 'ohmmeter'), component('R1', 'resistor', { value: '4.7 kΩ' })
  ], [
    wire('W1', 'FG1.OUT', 'FC1.IN'), wire('W2', 'FG1.GND', 'FC1.GND'),
    wire('W3', 'OM1.+', 'R1.1'), wire('W4', 'OM1.-', 'R1.2')
  ]);
  const result = evaluateCircuit(state);
  assert.equal(result.measurements.get('FC1'), '25.000 kHz');
  assert.equal(result.measurements.get('OM1'), '4.70 kΩ');
  assert.equal(result.highOutputComponents.has('FG1'), true);
});

test('voltmeter reads its exact local nodes in an unequal voltage divider', () => {
  const state = stateOf([
    component('V1', 'dc-source', { voltage: 12 }), component('R1', 'resistor', { value: '1 kΩ' }),
    component('R2', 'resistor', { value: '2 kΩ' }), component('VMIN', 'voltmeter'),
    component('VMMID', 'voltmeter'), component('VMR1', 'voltmeter')
  ], [
    wire('W1', 'V1.+', 'R1.1'), wire('W2', 'R1.2', 'R2.1'), wire('W3', 'R2.2', 'V1.-'),
    wire('W4', 'VMIN.+', 'V1.+'), wire('W5', 'VMIN.-', 'V1.-'),
    wire('W6', 'VMMID.+', 'R2.1'), wire('W7', 'VMMID.-', 'V1.-'),
    wire('W8', 'VMR1.+', 'V1.+'), wire('W9', 'VMR1.-', 'R1.2')
  ]);
  const result = evaluateCircuit(state);
  assert.equal(result.measurements.get('VMIN'), '12.00 V');
  assert.equal(result.measurements.get('VMMID'), '8.00 V');
  assert.equal(result.measurements.get('VMR1'), '4.00 V');
});

test('moving tester probes recomputes voltage instead of retaining a global source value', () => {
  const state = stateOf([
    component('V1', 'dc-source', { voltage: 15 }), component('R1', 'resistor', { value: '2 kΩ' }),
    component('R2', 'resistor', { value: '1 kΩ' }), component('VM1', 'voltmeter')
  ], [
    wire('W1', 'V1.+', 'R1.1'), wire('W2', 'R1.2', 'R2.1'), wire('W3', 'R2.2', 'V1.-'),
    wire('WP', 'VM1.+', 'V1.+'), wire('WN', 'VM1.-', 'V1.-')
  ]);
  assert.equal(evaluateCircuit(state).measurements.get('VM1'), '15.00 V');
  state.wires.find(item => item.id === 'WP').to = 'R2.1';
  assert.equal(evaluateCircuit(state).measurements.get('VM1'), '5.00 V');
  state.wires.find(item => item.id === 'WP').to = 'V1.-';
  state.wires.find(item => item.id === 'WN').to = 'V1.+';
  assert.equal(evaluateCircuit(state).measurements.get('VM1'), '-15.00 V');
});

test('transformer and regulator expose distinct input and reduced output voltages', () => {
  const transformer = stateOf([
    component('VS1', 'ac-source', { voltage: 120 }), component('T1', 'transformer', { ratio: '10:1' }),
    component('VMP', 'voltmeter'), component('VMS', 'voltmeter')
  ], [
    wire('W1', 'VS1.1', 'T1.P1'), wire('W2', 'VS1.2', 'T1.P2'),
    wire('W3', 'VMP.+', 'T1.P1'), wire('W4', 'VMP.-', 'T1.P2'),
    wire('W5', 'VMS.+', 'T1.S1'), wire('W6', 'VMS.-', 'T1.S2')
  ]);
  let result = evaluateCircuit(transformer);
  assert.equal(result.measurements.get('VMP'), '120.00 V');
  assert.equal(result.measurements.get('VMS'), '12.00 V');

  const regulator = stateOf([
    component('V1', 'dc-source', { voltage: 12 }), component('REG1', 'voltage-regulator', { outputVoltage: 5 }),
    component('VMI', 'voltmeter'), component('VMO', 'voltmeter')
  ], [
    wire('W1', 'V1.+', 'REG1.IN'), wire('W2', 'V1.-', 'REG1.GND'),
    wire('W3', 'VMI.+', 'REG1.IN'), wire('W4', 'VMI.-', 'REG1.GND'),
    wire('W5', 'VMO.+', 'REG1.OUT'), wire('W6', 'VMO.-', 'REG1.GND')
  ]);
  result = evaluateCircuit(regulator);
  assert.equal(result.measurements.get('VMI'), '12.00 V');
  assert.equal(result.measurements.get('VMO'), '5.00 V');
});

test('floating sources retain differential voltage and ammeter uses branch current', () => {
  const floating = stateOf([component('BT1', 'battery', { voltage: 9 }), component('VM1', 'voltmeter')], [
    wire('W1', 'VM1.+', 'BT1.+'), wire('W2', 'VM1.-', 'BT1.-')
  ]);
  assert.equal(evaluateCircuit(floating).measurements.get('VM1'), '9.00 V');

  const current = stateOf([
    component('V1', 'dc-source', { voltage: 12 }), component('AM1', 'ammeter'), component('R1', 'resistor', { value: '120 Ω' })
  ], [wire('W1', 'V1.+', 'AM1.+'), wire('W2', 'AM1.-', 'R1.1'), wire('W3', 'R1.2', 'V1.-')]);
  assert.equal(evaluateCircuit(current).measurements.get('AM1'), '99.9 mA');
});

test('independent sources keep their own local values instead of sharing a global maximum', () => {
  const state = stateOf([
    component('V5', 'dc-source', { voltage: 5 }), component('V12', 'dc-source', { voltage: 12 }),
    component('VM5', 'voltmeter'), component('VM12', 'voltmeter'), component('VMOPEN', 'voltmeter')
  ], [
    wire('W1', 'VM5.+', 'V5.+'), wire('W2', 'VM5.-', 'V5.-'),
    wire('W3', 'VM12.+', 'V12.+'), wire('W4', 'VM12.-', 'V12.-')
  ]);
  const result = evaluateCircuit(state);
  assert.equal(result.measurements.get('VM5'), '5.00 V');
  assert.equal(result.measurements.get('VM12'), '12.00 V');
  assert.equal(result.measurements.get('VMOPEN'), '0.00 V');
});
