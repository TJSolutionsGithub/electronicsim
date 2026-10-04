import { COMPONENT_TYPES } from './componentDefs.js';
import { parseResistance } from './analogSolver.js';

const ref = (componentId, pinId) => `${componentId}.${pinId}`;

const UNSUPPORTED_ACTIVE_TYPES = new Set([
  'logic-and', 'logic-or', 'logic-not', 'logic-nand', 'logic-nor', 'logic-xor', 'logic-xnor',
  'logic-buffer', 'schmitt-trigger', 'logic-input', 'clock-generator', 'd-flip-flop',
  'tri-state-buffer', 'jk-flip-flop', 'sr-latch', 'binary-counter', 'mux-2to1',
  'demux-1to2', 'decoder-2to4', 'encoder-4to2', 'shift-register', 'timer-555',
  'seven-segment', 'hall-sensor', 'temperature-sensor', 'ultrasonic-sensor',
  'rotary-encoder', 'servo', 'lcd-16x2', 'arduino-uno', 'scr', 'triac', 'optocoupler'
]);

const SOURCE_TYPES = new Set(['battery', 'dc-source', 'ac-source', 'current-source', 'function-generator', 'vcc']);
const LOAD_TYPES = new Set(['lamp', 'motor', 'buzzer', 'speaker', 'solenoid']);

class UnionFind {
  constructor(values = []) { this.parent = new Map(values.map(value => [value, value])); }
  find(value) {
    if (!this.parent.has(value)) this.parent.set(value, value);
    const parent = this.parent.get(value);
    if (parent !== value) this.parent.set(value, this.find(parent));
    return this.parent.get(value);
  }
  union(first, second) {
    const a = this.find(first), b = this.find(second);
    if (a !== b) this.parent.set(b, a);
  }
}

const numberFrom = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};

function parseScaled(value, fallback = 0) {
  const source = String(value ?? '').trim(), amount = numberFrom(source, fallback);
  if (/G/i.test(source)) return amount * 1e9;
  if (/meg/i.test(source) || /M(?![hH][zZ])/u.test(source)) return amount * 1e6;
  if (/k/i.test(source)) return amount * 1e3;
  if (/µ|u/u.test(source)) return amount * 1e-6;
  if (/n/i.test(source)) return amount * 1e-9;
  if (/p/i.test(source)) return amount * 1e-12;
  if (/m(?!eg)/.test(source)) return amount * 1e-3;
  return amount;
}

function parseRatio(value) {
  const [primary, secondary] = String(value || '1:1').split(':').map(part => Math.abs(numberFrom(part, 1)) || 1);
  return secondary / primary;
}

function loadResistance(component) {
  if (component.type === 'lamp') {
    const voltage = Math.max(0.1, numberFrom(component.voltage, 12));
    return voltage * voltage / Math.max(0.01, numberFrom(component.power, 5));
  }
  if (component.type === 'motor') {
    const voltage = Math.max(0.1, numberFrom(component.voltage, 6));
    return voltage * voltage / 3;
  }
  if (component.type === 'buzzer') return 120;
  if (component.type === 'speaker') return Math.max(0.1, parseResistance(component.impedance, 8));
  if (component.type === 'solenoid') return Math.max(1, numberFrom(component.voltage, 12) * 2);
  return 1e12;
}

function safeName(value) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9_]/g, '_');
  return cleaned || 'X';
}

function spiceNumber(value, fallback = 0) {
  const amount = Number(value);
  return (Number.isFinite(amount) ? amount : fallback).toExponential(12);
}

function topologyFor(state) {
  const references = state.components.flatMap(component => (COMPONENT_TYPES[component.type]?.pins || []).map(pin => ref(component.id, pin.id)));
  const union = new UnionFind(references);
  state.wires.forEach(wire => union.union(wire.from, wire.to));

  const grounds = state.components.filter(component => component.type === 'ground').map(component => ref(component.id, '1'));
  grounds.slice(1).forEach(reference => union.union(grounds[0], reference));
  const vccNets = new Map();
  state.components.filter(component => component.type === 'vcc').forEach(component => {
    const net = String(component.net || 'VCC');
    if (vccNets.has(net)) union.union(vccNets.get(net), ref(component.id, '1'));
    else vccNets.set(net, ref(component.id, '1'));
  });

  const groundRoot = grounds.length ? union.find(grounds[0]) : null;
  const roots = [...new Set(references.map(reference => union.find(reference)))];
  const nodeByRoot = new Map();
  let nodeIndex = 0;
  roots.forEach(root => nodeByRoot.set(root, root === groundRoot ? '0' : `n${++nodeIndex}`));
  const referenceToNode = new Map(references.map(reference => [reference, nodeByRoot.get(union.find(reference))]));
  const node = (component, pin) => referenceToNode.get(ref(component.id, pin)) || '0';
  return { references, union, roots, nodeByRoot, referenceToNode, node };
}

/**
 * Convert the visual editor's exact wire/pin graph into an ngspice netlist.
 * The operating-point adapter uses each AC source's configured RMS value as a
 * DC equivalent so existing DC meters retain their expected RMS-style reading.
 * AC and transient netlists use the real source definitions.
 */
export function buildSpiceNetlist(state, { analysis = 'op', fallbackResult = null } = {}) {
  const topology = topologyFor(state);
  // Keep the raw-file title ASCII-only. EEcircuit-engine's binary reader uses
  // character offsets, while ngspice writes UTF-8 bytes; a multibyte title
  // would shift the binary payload and prevent the run promise from resolving.
  const title = String(state.name || 'untitled').replace(/[^\x20-\x7e]/g, '_');
  const lines = [`CircuitLab Studio - ${title}`, '* Generated from the visual pin/wire graph. Do not edit.', '.options noacct'];
  const sourceNames = new Map(), currentElementNames = new Map(), resistorElements = new Map();
  const supportedComponents = new Set(), warnings = [];
  const unsupportedComponents = state.components.filter(component => UNSUPPORTED_ACTIVE_TYPES.has(component.type)).map(component => component.id);
  const usedVoltageConstraints = new Set();
  let elementIndex = 0;
  const elementName = (prefix, component) => `${prefix}${safeName(component.id)}_${++elementIndex}`;
  const node = (component, pin) => topology.node(component, pin);

  function addResistor(component, firstPin, secondPin, resistance, role = '') {
    const first = node(component, firstPin), second = node(component, secondPin);
    if (first === second) return null;
    const name = elementName('R', component), value = Math.max(1e-9, Number(resistance) || 1e12);
    lines.push(`${name} ${first} ${second} ${spiceNumber(value)}`);
    if (role || component.id) resistorElements.set(component.id, { name: name.toLowerCase(), first, second, resistance: value, role });
    supportedComponents.add(component.id);
    return name;
  }

  function addVoltage(component, firstPin, secondPin, voltage, prefix = 'V') {
    const first = node(component, firstPin), second = node(component, secondPin), value = Number(voltage) || 0;
    if (first === second) {
      warnings.push(`${component.id}: voltage source terminals share one node`);
      return null;
    }
    const signature = `${first}|${second}|${value.toPrecision(12)}`;
    const reverseSignature = `${second}|${first}|${(-value).toPrecision(12)}`;
    if (usedVoltageConstraints.has(signature) || usedVoltageConstraints.has(reverseSignature)) {
      supportedComponents.add(component.id);
      return null;
    }
    usedVoltageConstraints.add(signature);
    const name = elementName(prefix, component);
    lines.push(`${name} ${first} ${second} DC ${spiceNumber(value)}`);
    sourceNames.set(component.id, name.toLowerCase());
    supportedComponents.add(component.id);
    return name;
  }

  function addRaw(component, line, { sourceName = null } = {}) {
    lines.push(line);
    if (sourceName) sourceNames.set(component.id, sourceName.toLowerCase());
    supportedComponents.add(component.id);
  }

  state.components.forEach(component => {
    const id = safeName(component.id);
    switch (component.type) {
      case 'resistor': addResistor(component, '1', '2', parseResistance(component.value, 1000)); break;
      case 'thermistor': addResistor(component, '1', '2', parseResistance(component.resistance, 10000)); break;
      case 'photoresistor': addResistor(component, '1', '2', parseResistance(component.resistance, 10000)); break;
      case 'potentiometer': {
        const total = Math.max(1e-6, parseResistance(component.value, 10000));
        const position = Math.max(0, Math.min(100, numberFrom(component.position, 50))) / 100;
        addResistor(component, '1', 'W', Math.max(1e-6, total * position));
        addResistor(component, 'W', '2', Math.max(1e-6, total * (1 - position)));
        break;
      }
      case 'capacitor':
      case 'polarized-capacitor': {
        const name = elementName('C', component);
        addRaw(component, `${name} ${node(component, '1')} ${node(component, '2')} ${spiceNumber(Math.max(1e-15, parseScaled(component.value, 1e-7)))}`);
        break;
      }
      case 'inductor': {
        const name = elementName('L', component);
        addRaw(component, `${name} ${node(component, '1')} ${node(component, '2')} ${spiceNumber(Math.max(1e-12, parseScaled(component.value, 1e-2)))}`);
        break;
      }
      case 'fuse': addResistor(component, '1', '2', 1e-3); break;
      case 'terminal-block': addResistor(component, '1', '2', 1e-3); break;
      case 'crystal': addResistor(component, '1', '2', 1e9); break;
      case 'varistor': addResistor(component, '1', '2', 1e9); break;
      case 'switch-spst': if (component.closed) addResistor(component, '1', '2', parseResistance(component.contactResistance, 0.05)); else supportedComponents.add(component.id); break;
      case 'pushbutton': if (component.normallyClosed ? !component.closed : component.closed) addResistor(component, '1', '2', 0.01); else supportedComponents.add(component.id); break;
      case 'switch-spdt': addResistor(component, 'COM', component.position === 'B' ? 'B' : 'A', 0.01); break;
      case 'relay': {
        addResistor(component, 'A1', 'A2', 400);
        if (fallbackResult?.energizedRelays?.has(component.id) || component.energized) addResistor(component, 'COM', 'NO', 0.02);
        break;
      }
      case 'relay-spdt': {
        addResistor(component, 'A1', 'A2', 400);
        addResistor(component, 'COM', fallbackResult?.energizedRelays?.has(component.id) || component.energized ? 'NO' : 'NC', 0.02);
        break;
      }
      case 'battery': {
        const positive = node(component, '+'), negative = node(component, '-');
        const internalResistance = Math.max(0, parseResistance(component.internalResistance, 0));
        const sourceName = elementName('V', component);
        if (internalResistance > 0) {
          const internal = `nbat_${id.toLowerCase()}`;
          lines.push(`${sourceName} ${internal} ${negative} DC ${spiceNumber(numberFrom(component.voltage, 9))}`);
          const resistanceName = elementName('R', component);
          lines.push(`${resistanceName} ${internal} ${positive} ${spiceNumber(internalResistance)}`);
          resistorElements.set(component.id, { name: resistanceName.toLowerCase(), first: internal, second: positive, resistance: internalResistance, role: 'source-internal' });
        } else lines.push(`${sourceName} ${positive} ${negative} DC ${spiceNumber(numberFrom(component.voltage, 9))}`);
        sourceNames.set(component.id, sourceName.toLowerCase()); supportedComponents.add(component.id);
        break;
      }
      case 'dc-source': addVoltage(component, '+', '-', numberFrom(component.voltage, 5)); break;
      case 'ac-source': {
        const name = elementName('V', component), volts = Math.max(0, numberFrom(component.voltage, 12));
        const frequency = Math.max(1e-9, numberFrom(component.frequency, 60)), phase = numberFrom(component.phase, 0);
        const definition = analysis === 'tran'
          ? `SIN(0 ${spiceNumber(volts * Math.SQRT2)} ${spiceNumber(frequency)} 0 0 ${spiceNumber(phase)})`
          : analysis === 'ac' ? `DC 0 AC ${spiceNumber(volts)} ${spiceNumber(phase)}` : `DC ${spiceNumber(volts)}`;
        addRaw(component, `${name} ${node(component, '1')} ${node(component, '2')} ${definition}`, { sourceName: name });
        break;
      }
      case 'current-source': {
        const name = elementName('I', component);
        addRaw(component, `${name} ${node(component, '1')} ${node(component, '2')} DC ${spiceNumber(parseScaled(component.current, 0.01))}`);
        break;
      }
      case 'function-generator': {
        if (!component.enabled) { supportedComponents.add(component.id); break; }
        const name = elementName('V', component), amplitude = numberFrom(component.amplitude, 5) / 2;
        const offset = numberFrom(component.offset, 0), frequency = Math.max(1e-9, numberFrom(component.frequency, 1000));
        let definition = `DC ${spiceNumber(offset + amplitude)}`;
        if (analysis === 'tran') {
          if (component.waveform === 'Square') definition = `PULSE(${spiceNumber(offset - amplitude)} ${spiceNumber(offset + amplitude)} 0 1n 1n ${spiceNumber(0.5 / frequency)} ${spiceNumber(1 / frequency)})`;
          else definition = `SIN(${spiceNumber(offset)} ${spiceNumber(amplitude)} ${spiceNumber(frequency)})`;
        } else if (analysis === 'ac') definition = `DC ${spiceNumber(offset)} AC ${spiceNumber(amplitude)}`;
        addRaw(component, `${name} ${node(component, 'OUT')} ${node(component, 'GND')} ${definition}`, { sourceName: name });
        break;
      }
      case 'ground': supportedComponents.add(component.id); break;
      case 'vcc': addVoltage(component, '1', '__ground__', numberFrom(component.voltage, 5)); break;
      case 'lamp':
      case 'motor':
      case 'buzzer':
      case 'speaker':
      case 'solenoid': addResistor(component, '1', '2', loadResistance(component), 'load'); break;
      case 'diode': {
        const name = elementName('D', component);
        addRaw(component, `${name} ${node(component, '1')} ${node(component, '2')} DDEFAULT`);
        break;
      }
      case 'zener': {
        const name = elementName('D', component);
        addRaw(component, `${name} ${node(component, '1')} ${node(component, '2')} DZENER`);
        break;
      }
      case 'led': {
        const name = elementName('D', component);
        addRaw(component, `${name} ${node(component, 'A')} ${node(component, 'K')} DLED`);
        break;
      }
      case 'transistor-npn': addRaw(component, `${elementName('Q', component)} ${node(component, 'C')} ${node(component, 'B')} ${node(component, 'E')} QNPN`); break;
      case 'transistor-pnp': addRaw(component, `${elementName('Q', component)} ${node(component, 'C')} ${node(component, 'B')} ${node(component, 'E')} QPNP`); break;
      case 'nmos': addRaw(component, `${elementName('M', component)} ${node(component, 'D')} ${node(component, 'G')} ${node(component, 'S')} ${node(component, 'S')} MNMOS L=2u W=100u`); break;
      case 'pmos': addRaw(component, `${elementName('M', component)} ${node(component, 'D')} ${node(component, 'G')} ${node(component, 'S')} ${node(component, 'S')} MPMOS L=2u W=100u`); break;
      case 'opamp': {
        const name = elementName('B', component);
        addRaw(component, `${name} ${node(component, 'OUT')} ${node(component, 'V-')} V=limit(1e5*(V(${node(component, '+')})-V(${node(component, '-')})),0,V(${node(component, 'V+')},${node(component, 'V-')}))`);
        break;
      }
      case 'comparator': {
        const name = elementName('B', component);
        addRaw(component, `${name} ${node(component, 'OUT')} ${node(component, 'GND')} V=if(V(${node(component, '+')})>V(${node(component, '-')}),V(${node(component, 'VCC')},${node(component, 'GND')}),0)`);
        break;
      }
      case 'transformer': {
        const name = elementName('E', component);
        addRaw(component, `${name} ${node(component, 'S1')} ${node(component, 'S2')} ${node(component, 'P1')} ${node(component, 'P2')} ${spiceNumber(parseRatio(component.ratio))}`);
        break;
      }
      case 'voltage-regulator': {
        const name = elementName('B', component), output = Math.max(0, numberFrom(component.outputVoltage, 5));
        addRaw(component, `${name} ${node(component, 'OUT')} ${node(component, 'GND')} V=limit(V(${node(component, 'IN')},${node(component, 'GND')}),0,${spiceNumber(output)})`);
        break;
      }
      case 'bridge-rectifier': {
        [['AC1', '+'], ['AC2', '+'], ['-', 'AC1'], ['-', 'AC2']].forEach(([anode, cathode]) => {
          lines.push(`${elementName('D', component)} ${node(component, anode)} ${node(component, cathode)} DDEFAULT`);
        });
        supportedComponents.add(component.id);
        break;
      }
      case 'rgb-led': ['R', 'G', 'B'].forEach(pin => lines.push(`${elementName('D', component)} ${node(component, pin)} ${node(component, 'COM')} DLED`)); supportedComponents.add(component.id); break;
      case 'ammeter': {
        const name = elementName('VAM', component);
        addRaw(component, `${name} ${node(component, '+')} ${node(component, '-')} 0`, { sourceName: name });
        currentElementNames.set(component.id, name.toLowerCase());
        break;
      }
      case 'wattmeter': {
        const name = elementName('VWM', component);
        addRaw(component, `${name} ${node(component, 'I+')} ${node(component, 'I-')} 0`, { sourceName: name });
        currentElementNames.set(component.id, name.toLowerCase());
        if (node(component, 'V+') !== node(component, 'V-')) lines.push(`${elementName('RVM', component)} ${node(component, 'V+')} ${node(component, 'V-')} 1e7`);
        break;
      }
      case 'voltmeter': addResistor(component, '+', '-', parseResistance(component.impedance, 10e6), 'voltmeter'); break;
      case 'oscilloscope': ['CH1', 'CH2'].forEach(pin => {
        if (node(component, pin) !== node(component, 'GND')) lines.push(`${elementName('RSCOPE', component)} ${node(component, pin)} ${node(component, 'GND')} 1e7`);
      }); supportedComponents.add(component.id); break;
      case 'logic-analyzer': ['D0', 'D1', 'D2', 'D3'].forEach(pin => {
        if (node(component, pin) !== node(component, 'GND')) lines.push(`${elementName('RLOGIC', component)} ${node(component, pin)} ${node(component, 'GND')} 1e7`);
      }); supportedComponents.add(component.id); break;
      case 'frequency-counter': if (node(component, 'IN') !== node(component, 'GND')) lines.push(`${elementName('RFC', component)} ${node(component, 'IN')} ${node(component, 'GND')} 1e6`); supportedComponents.add(component.id); break;
      case 'ohmmeter':
      case 'test-point':
      case 'connector-4': supportedComponents.add(component.id); break;
      case 'stepper-motor': addResistor(component, 'A1', 'A2', 4, 'coil-a'); addResistor(component, 'B1', 'B2', 4, 'coil-b'); break;
      default: break;
    }
  });

  // Every otherwise-floating island receives a 1 TΩ path to SPICE ground. It
  // establishes only a numerical reference and does not collapse independent
  // visual-editor circuits into one electrical node.
  [...new Set(topology.referenceToNode.values())].filter(name => name !== '0').forEach((name, index) => lines.push(`RREF${index + 1} ${name} 0 1e12`));
  lines.push('.model DDEFAULT D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 Tt=20n)');
  lines.push('.model DLED D(Is=1e-20 N=2 Rs=8 Eg=2.0)');
  lines.push(`.model DZENER D(Is=1e-10 N=1.5 Rs=2 Bv=${spiceNumber(Math.max(0.1, ...state.components.filter(component => component.type === 'zener').map(component => numberFrom(component.voltage, 5.1))))} Ibv=1m)`);
  lines.push('.model QNPN NPN(Is=1e-14 Bf=200 Vaf=100 Cje=10p Cjc=5p Tf=.3n)');
  lines.push('.model QPNP PNP(Is=1e-14 Bf=150 Vaf=80 Cje=12p Cjc=6p Tf=.5n)');
  lines.push('.model MNMOS NMOS(Level=1 Vto=2.1 Kp=.05 Lambda=.02)');
  lines.push('.model MPMOS PMOS(Level=1 Vto=-2.1 Kp=.025 Lambda=.02)');

  if (analysis === 'tran') {
    const fastestFrequency = Math.max(1, ...state.components.filter(component => ['ac-source', 'function-generator'].includes(component.type)).map(component => Math.max(1, numberFrom(component.frequency, 1))));
    const step = 1 / fastestFrequency / 100, stop = 5 / fastestFrequency;
    lines.push(`.tran ${spiceNumber(step)} ${spiceNumber(stop)}`);
  } else if (analysis === 'ac') lines.push('.ac dec 40 1 100Meg');
  else lines.push('.op');
  lines.push('.end');

  const eligible = unsupportedComponents.length === 0 && state.components.some(component => SOURCE_TYPES.has(component.type));
  return {
    netlist: `${lines.join('\n')}\n`, analysis, eligible, unsupportedComponents, supportedComponents,
    warnings, sourceNames, currentElementNames, resistorElements,
    referenceToNode: topology.referenceToNode
  };
}

function formatCurrent(amps) {
  if (!Number.isFinite(amps) || Math.abs(amps) < 1e-12) return '0.000 A';
  const magnitude = Math.abs(amps), sign = amps < 0 ? '-' : '';
  if (magnitude < 0.001) return `${sign}${(magnitude * 1e6).toFixed(1)} µA`;
  if (magnitude < 1) return `${sign}${(magnitude * 1000).toFixed(1)} mA`;
  return `${sign}${magnitude.toFixed(3)} A`;
}

function formatVoltage(volts) {
  if (!Number.isFinite(volts) || Math.abs(volts) < 1e-9) return '0.00 V';
  return `${volts.toFixed(Math.abs(volts) < 1 ? 3 : 2)} V`;
}

function resultLookup(rawResult) {
  const byName = new Map((rawResult?.data || []).map(series => [String(series.name).toLowerCase(), series.values || []]));
  const last = name => {
    if (name === '0') return 0;
    const values = byName.get(String(name).toLowerCase()) || [];
    const value = values[values.length - 1];
    return typeof value === 'object' ? Number(value.real) || 0 : Number(value) || 0;
  };
  return { byName, last, voltage: nodeName => last(`v(${nodeName})`), current: elementName => last(`i(${elementName})`) };
}

/** Merge ngspice operating-point values into the synchronous evaluator result. */
export function mergeSpiceResult(state, fallbackResult, rawResult, adapter) {
  const lookup = resultLookup(rawResult), measurements = new Map(fallbackResult.measurements);
  const nodeVoltages = new Map(fallbackResult.nodeVoltages), branchCurrents = new Map(fallbackResult.branchCurrents);
  const sourceCurrents = new Map(fallbackResult.sourceCurrents), signalStates = new Map(fallbackResult.signalStates);
  const poweredComponents = new Set(fallbackResult.poweredComponents);
  const voltageAtRef = reference => lookup.voltage(adapter.referenceToNode.get(reference) || '0');
  const voltageBetween = (component, positive, negative) => voltageAtRef(ref(component.id, positive)) - voltageAtRef(ref(component.id, negative));

  adapter.referenceToNode.forEach((nodeName, reference) => nodeVoltages.set(reference, lookup.voltage(nodeName)));
  adapter.sourceNames.forEach((name, componentId) => sourceCurrents.set(componentId, lookup.current(name)));
  adapter.resistorElements.forEach((element, componentId) => {
    const current = (lookup.voltage(element.first) - lookup.voltage(element.second)) / element.resistance;
    branchCurrents.set(componentId, current);
  });

  state.components.forEach(component => {
    if (component.type === 'voltmeter') measurements.set(component.id, formatVoltage(voltageBetween(component, '+', '-')));
    if (component.type === 'ammeter') {
      const current = lookup.current(adapter.currentElementNames.get(component.id));
      branchCurrents.set(component.id, current); measurements.set(component.id, formatCurrent(current));
    }
    if (component.type === 'wattmeter') {
      const current = lookup.current(adapter.currentElementNames.get(component.id));
      const voltage = voltageBetween(component, 'V+', 'V-');
      branchCurrents.set(component.id, current); measurements.set(component.id, `${(voltage * current).toFixed(2)} W`);
    }
    if (component.type === 'oscilloscope') signalStates.set(component.id, ['CH1', 'CH2'].map(pin => voltageBetween(component, pin, 'GND') > 1));
    if (component.type === 'logic-analyzer') signalStates.set(component.id, ['D0', 'D1', 'D2', 'D3'].map(pin => voltageBetween(component, pin, 'GND') > 1));
    if (component.type === 'rgb-led') signalStates.set(component.id, ['R', 'G', 'B'].map(pin => voltageBetween(component, pin, 'COM') > 1.2));
    if (component.type === 'led') {
      if (voltageBetween(component, 'A', 'K') > 1.2) poweredComponents.add(component.id);
      else poweredComponents.delete(component.id);
    }
    if (LOAD_TYPES.has(component.type)) {
      if (Math.abs(voltageBetween(component, '1', '2')) > 0.25) poweredComponents.add(component.id);
      else poweredComponents.delete(component.id);
    }
  });

  return {
    ...fallbackResult, poweredComponents, measurements, nodeVoltages, branchCurrents, sourceCurrents, signalStates,
    solver: 'ngspice-wasm',
    spice: {
      analysis: adapter.analysis,
      engine: 'ngspice WebAssembly',
      variables: rawResult.variableNames || [],
      points: rawResult.numPoints || 0,
      netlist: adapter.netlist,
      warnings: adapter.warnings,
      unsupportedComponents: adapter.unsupportedComponents
    }
  };
}

let simulation = null;
let simulationPromise = null;
let runQueue = Promise.resolve();

async function getSimulation(onStatus = () => {}) {
  if (simulation) return simulation;
  if (!simulationPromise) {
    onStatus({ phase: 'loading', message: 'Downloading ngspice WebAssembly' });
    simulationPromise = import('eecircuit-engine').then(async ({ Simulation }) => {
      onStatus({ phase: 'initializing', message: 'Initializing ngspice' });
      const instance = new Simulation();
      await instance.start();
      simulation = instance;
      return instance;
    }).catch(error => {
      simulationPromise = null;
      throw error;
    });
  }
  return simulationPromise;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]);
}

/**
 * Lazily run an ngspice analysis in the browser. Calls are serialized because
 * one Emscripten ngspice instance owns the virtual input/output files.
 */
export function runSpiceAnalysis(state, fallbackResult, { analysis = 'op', onStatus = () => {}, timeout = 20000 } = {}) {
  const adapter = buildSpiceNetlist(state, { analysis, fallbackResult });
  if (!adapter.eligible) {
    const reason = adapter.unsupportedComponents.length ? 'unsupported-components' : 'no-analog-source';
    onStatus({ phase: 'fallback', reason, unsupportedComponents: adapter.unsupportedComponents });
    return Promise.resolve({
      ...fallbackResult,
      solver: 'node-mna-fallback',
      spice: { analysis, engine: 'ngspice WebAssembly', reason, netlist: adapter.netlist, unsupportedComponents: adapter.unsupportedComponents, warnings: adapter.warnings }
    });
  }

  const operation = async () => {
    const engine = await getSimulation(onStatus);
    onStatus({ phase: 'running', message: `ngspice ${analysis} analysis` });
    engine.setNetList(adapter.netlist);
    const rawResult = await withTimeout(engine.runSim(), timeout, 'ngspice did not finish before the timeout');
    const fatalErrors = (engine.getError?.() || []).filter(message => /(^|\s)(fatal|error|singular|timestep too small)(:|\s)/i.test(message));
    if (fatalErrors.length) throw new Error(fatalErrors.join(' ').slice(0, 500));
    const merged = mergeSpiceResult(state, fallbackResult, rawResult, adapter);
    onStatus({ phase: 'ready', message: `ngspice solved ${rawResult.numPoints || 0} point${rawResult.numPoints === 1 ? '' : 's'}` });
    return merged;
  };
  const queued = runQueue.then(operation, operation);
  runQueue = queued.catch(() => {});
  return queued.catch(error => {
    onStatus({ phase: 'error', message: error?.message || String(error) });
    return {
      ...fallbackResult,
      solver: 'node-mna-fallback',
      spice: { analysis, engine: 'ngspice WebAssembly', reason: 'engine-error', error: error?.message || String(error), netlist: adapter.netlist, unsupportedComponents: [], warnings: adapter.warnings }
    };
  });
}

export const runSpiceOperatingPoint = (state, fallbackResult, options = {}) => runSpiceAnalysis(state, fallbackResult, { ...options, analysis: 'op' });
