import { COMPONENT_TYPES } from './componentDefs.js';
import { solveAnalogCircuit } from './analogSolver.js';

const PASSIVE_TWO_PIN = new Set([
  'resistor', 'inductor', 'fuse', 'capacitor', 'polarized-capacitor', 'crystal', 'varistor',
  'thermistor', 'photoresistor', 'microphone', 'terminal-block', 'ammeter',
  'lamp', 'motor', 'buzzer', 'speaker', 'solenoid'
]);
const OUTPUT_TYPES = new Set(['led', 'lamp', 'motor', 'buzzer', 'speaker', 'solenoid']);
const SOURCE_TYPES = new Set(['battery', 'dc-source', 'ac-source', 'current-source', 'function-generator']);
const LOGIC_GATE_TYPES = new Set([
  'logic-and', 'logic-or', 'logic-not', 'logic-nand', 'logic-nor', 'logic-xor', 'logic-xnor', 'logic-buffer', 'schmitt-trigger'
]);
const DIGITAL_SOURCE_TYPES = new Set(['logic-input', 'clock-generator']);
const SEGMENT_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];

const ref = (componentId, pinId) => `${componentId}.${pinId}`;
const splitRef = reference => {
  const dot = String(reference).lastIndexOf('.');
  return [reference.slice(0, dot), reference.slice(dot + 1)];
};

function addEdge(graph, from, to, bidirectional = true) {
  if (!graph.has(from)) graph.set(from, new Set());
  if (!graph.has(to)) graph.set(to, new Set());
  graph.get(from).add(to);
  if (bidirectional) graph.get(to).add(from);
}

function reverseGraph(graph) {
  const reversed = new Map([...graph.keys()].map(node => [node, new Set()]));
  graph.forEach((targets, from) => targets.forEach(to => {
    if (!reversed.has(to)) reversed.set(to, new Set());
    reversed.get(to).add(from);
  }));
  return reversed;
}

function reachable(graph, seeds) {
  const visited = new Set(), queue = [...seeds].filter(seed => graph.has(seed));
  queue.forEach(seed => visited.add(seed));
  while (queue.length) {
    const node = queue.shift();
    graph.get(node)?.forEach(next => { if (!visited.has(next)) { visited.add(next); queue.push(next); } });
  }
  return visited;
}

function pairPowered(positive, negative, first, second, directional = false) {
  if (directional) return positive.has(first) && negative.has(second);
  return (positive.has(first) && negative.has(second)) || (positive.has(second) && negative.has(first));
}

function switchConducts(component) {
  if (component.type === 'switch-spst') return Boolean(component.closed);
  if (component.type === 'pushbutton') return component.normallyClosed ? !component.closed : Boolean(component.closed);
  return false;
}

function gateOutput(type, a, b = false) {
  if (type === 'logic-and') return a && b;
  if (type === 'logic-or') return a || b;
  if (type === 'logic-not') return !a;
  if (type === 'logic-nand') return !(a && b);
  if (type === 'logic-nor') return !(a || b);
  if (type === 'logic-xor') return a !== b;
  if (type === 'logic-xnor') return a === b;
  if (type === 'logic-buffer' || type === 'schmitt-trigger') return a;
  return false;
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

function formatResistance(ohms) {
  if (!Number.isFinite(ohms)) return 'OL';
  if (ohms <= 0) return '0.0 Ω';
  if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`;
  if (ohms >= 1000) return `${(ohms / 1000).toFixed(2)} kΩ`;
  return `${ohms.toFixed(1)} Ω`;
}

function createBaseGraph(state, controls) {
  const graph = new Map();
  state.components.forEach(component => COMPONENT_TYPES[component.type].pins.forEach(pin => graph.set(ref(component.id, pin.id), new Set())));
  state.wires.forEach(wire => addEdge(graph, wire.from, wire.to));

  state.components.forEach(component => {
    const node = pin => ref(component.id, pin);
    if (PASSIVE_TWO_PIN.has(component.type)) {
      // Loads are deliberately not bridged here. Their two terminals are
      // sampled after propagation; bridging them would make every terminal
      // appear at both source polarities and hide the voltage across the load.
      if (!OUTPUT_TYPES.has(component.type)) {
        const [first, second] = component.type === 'ammeter' ? ['+', '-'] : ['1', '2'];
        addEdge(graph, node(first), node(second));
      }
      return;
    }
    switch (component.type) {
      case 'potentiometer':
        addEdge(graph, node('1'), node('W')); addEdge(graph, node('W'), node('2'));
        break;
      case 'transformer':
        // Windings conduct independently. Coupling is handled as a derived
        // source after primary excitation is detected.
        addEdge(graph, node('P1'), node('P2'));
        break;
      case 'diode':
        addEdge(graph, node('1'), node('2'), false);
        break;
      case 'zener':
        addEdge(graph, node('1'), node('2'), false);
        addEdge(graph, node('2'), node('1'), false);
        break;
      case 'switch-spst':
      case 'pushbutton':
        if (switchConducts(component)) addEdge(graph, node('1'), node('2'));
        break;
      case 'switch-spdt':
        addEdge(graph, node('COM'), node(component.position === 'B' ? 'B' : 'A'));
        break;
      case 'relay':
        if (controls.relays.has(component.id)) addEdge(graph, node('COM'), node('NO'));
        break;
      case 'relay-spdt':
        addEdge(graph, node('COM'), node(controls.relays.has(component.id) ? 'NO' : 'NC'));
        break;
      case 'transistor-npn':
        if (controls.transistors.has(component.id)) addEdge(graph, node('C'), node('E'));
        break;
      case 'transistor-pnp':
        if (controls.transistors.has(component.id)) addEdge(graph, node('E'), node('C'));
        break;
      case 'nmos':
        if (controls.transistors.has(component.id)) addEdge(graph, node('D'), node('S'));
        break;
      case 'pmos':
        if (controls.transistors.has(component.id)) addEdge(graph, node('S'), node('D'));
        break;
      case 'scr':
        if (controls.transistors.has(component.id)) addEdge(graph, node('A'), node('K'));
        break;
      case 'triac':
        if (controls.transistors.has(component.id)) addEdge(graph, node('MT1'), node('MT2'));
        break;
      case 'optocoupler':
        if (controls.transistors.has(component.id)) addEdge(graph, node('C'), node('E'));
        break;
      default:
        break;
    }
  });
  return graph;
}

function sourceSeeds(state, controls) {
  const positive = new Set(), negative = new Set();
  state.components.forEach(component => {
    const node = pin => ref(component.id, pin);
    if (SOURCE_TYPES.has(component.type)) {
      if (component.type === 'battery' || component.type === 'dc-source') { positive.add(node('+')); negative.add(node('-')); }
      else if (component.type === 'function-generator') { if (component.enabled) positive.add(node('OUT')); negative.add(node('GND')); }
      else { positive.add(node('1')); negative.add(node('2')); }
    }
    if (component.type === 'vcc') positive.add(node('1'));
    if (component.type === 'ground') negative.add(node('1'));
    if (component.type === 'arduino-uno') {
      positive.add(node('5V')); positive.add(node('D13')); positive.add(node('D12'));
      negative.add(node('GND'));
    }
    if (component.type === 'logic-input') {
      if (component.high) positive.add(node('OUT'));
      negative.add(node('GND'));
    }
    if (component.type === 'clock-generator') {
      if (component.enabled && component.high) positive.add(node('OUT'));
      negative.add(node('GND'));
    }
  });
  controls.opampOutputs.forEach(reference => positive.add(reference));
  controls.logicHighOutputs.forEach(reference => positive.add(reference));
  controls.transformerPositive.forEach(reference => positive.add(reference));
  controls.transformerNegative.forEach(reference => negative.add(reference));
  return { positive, negative };
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every(value => b.has(value));
}

/**
 * Evaluate the binary powered/unpowered state of the schematic. This is not a
 * SPICE solver; it is a deterministic connectivity evaluator used by the UI.
 * Crucially, stateful components are evaluated by their actual pin topology,
 * so an SPDT connects COM to exactly A or B, never both.
 */
export function evaluateCircuit(state) {
  let controls = {
    relays: new Set(state.components.filter(component => ['relay', 'relay-spdt'].includes(component.type) && component.energized).map(component => component.id)),
    transistors: new Set(), opampOutputs: new Set(), logicHighOutputs: new Set(),
    transformerPositive: new Set(), transformerNegative: new Set()
  };
  let graph, positive, negative;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    graph = createBaseGraph(state, controls);
    const seeds = sourceSeeds(state, controls);
    positive = reachable(graph, seeds.positive);
    negative = reachable(reverseGraph(graph), seeds.negative);
    const next = { relays: new Set(), transistors: new Set(), opampOutputs: new Set(), logicHighOutputs: new Set(), transformerPositive: new Set(), transformerNegative: new Set() };

    state.components.forEach(component => {
      const node = pin => ref(component.id, pin);
      if (['relay', 'relay-spdt'].includes(component.type) && (component.energized || pairPowered(positive, negative, node('A1'), node('A2')))) next.relays.add(component.id);
      if (component.type === 'transistor-npn' && positive.has(node('B')) && negative.has(node('E'))) next.transistors.add(component.id);
      if (component.type === 'transistor-pnp' && positive.has(node('E')) && negative.has(node('B'))) next.transistors.add(component.id);
      if (component.type === 'nmos' && positive.has(node('G')) && negative.has(node('S'))) next.transistors.add(component.id);
      if (component.type === 'pmos' && positive.has(node('S')) && negative.has(node('G'))) next.transistors.add(component.id);
      if (component.type === 'scr' && positive.has(node('G')) && negative.has(node('K'))) next.transistors.add(component.id);
      if (component.type === 'triac' && positive.has(node('G'))) next.transistors.add(component.id);
      if (component.type === 'optocoupler' && pairPowered(positive, negative, node('A'), node('K'), true)) next.transistors.add(component.id);
      if (component.type === 'opamp' && positive.has(node('V+')) && negative.has(node('V-')) && positive.has(node('+')) && negative.has(node('-'))) next.opampOutputs.add(node('OUT'));
      if (LOGIC_GATE_TYPES.has(component.type) && positive.has(node('VCC')) && negative.has(node('GND'))) {
        const high = gateOutput(component.type, positive.has(node('A')), positive.has(node('B')));
        if (high) next.logicHighOutputs.add(node('Y'));
      }
      if (component.type === 'comparator' && positive.has(node('VCC')) && negative.has(node('GND')) && positive.has(node('+')) && !positive.has(node('-'))) next.logicHighOutputs.add(node('OUT'));
      if (component.type === 'd-flip-flop' && positive.has(node('VCC')) && negative.has(node('GND'))) {
        const q = positive.has(node('SET')) || (positive.has(node('CLK')) ? positive.has(node('D')) : Boolean(component.q));
        next.logicHighOutputs.add(node(q ? 'Q' : 'QN'));
      }
      const digitallyPowered = positive.has(node('VCC')) && negative.has(node('GND'));
      if (component.type === 'tri-state-buffer' && digitallyPowered && component.enabled && positive.has(node('A'))) next.logicHighOutputs.add(node('Y'));
      if (component.type === 'jk-flip-flop' && digitallyPowered) {
        const j = positive.has(node('J')), k = positive.has(node('K'));
        const q = positive.has(node('CLR')) ? false : (j && !k ? true : !j && k ? false : j && k ? !Boolean(component.q) : Boolean(component.q));
        next.logicHighOutputs.add(node(q ? 'Q' : 'QN'));
      }
      if (component.type === 'sr-latch' && digitallyPowered) {
        const q = positive.has(node('R')) ? false : positive.has(node('S')) ? true : Boolean(component.q);
        next.logicHighOutputs.add(node(q ? 'Q' : 'QN'));
      }
      if (component.type === 'mux-2to1' && digitallyPowered && component.enabled) {
        const high = positive.has(node(positive.has(node('S')) ? 'B' : 'A'));
        if (high) next.logicHighOutputs.add(node('Y'));
      }
      if (component.type === 'demux-1to2' && digitallyPowered && positive.has(node('D'))) next.logicHighOutputs.add(node(positive.has(node('S')) ? 'Y1' : 'Y0'));
      if (component.type === 'decoder-2to4' && digitallyPowered && component.enabled) {
        const value = (positive.has(node('B')) ? 2 : 0) + (positive.has(node('A')) ? 1 : 0);
        next.logicHighOutputs.add(node(`Y${value}`));
      }
      if (component.type === 'encoder-4to2' && digitallyPowered) {
        let value = 0;
        for (let bit = 0; bit < 4; bit += 1) if (positive.has(node(`D${bit}`))) value = bit;
        if (value & 1) next.logicHighOutputs.add(node('Q0'));
        if (value & 2) next.logicHighOutputs.add(node('Q1'));
      }
      if (['binary-counter', 'shift-register'].includes(component.type) && digitallyPowered) {
        const value = Math.max(0, Math.min(15, Number(component.value) || 0));
        for (let bit = 0; bit < 4; bit += 1) if (value & (1 << bit)) next.logicHighOutputs.add(node(`Q${bit}`));
      }
      if (component.type === 'timer-555' && digitallyPowered && Number(component.frequency) > 0) next.logicHighOutputs.add(node('OUT'));
      if (component.type === 'voltage-regulator' && positive.has(node('IN')) && negative.has(node('GND'))) next.logicHighOutputs.add(node('OUT'));
      if (component.type === 'hall-sensor' && positive.has(node('VCC')) && negative.has(node('GND')) && component.magneticField) next.logicHighOutputs.add(node('OUT'));
      if (component.type === 'temperature-sensor' && positive.has(node('VCC')) && negative.has(node('GND'))) next.logicHighOutputs.add(node('DATA'));
      if (component.type === 'ultrasonic-sensor' && positive.has(node('VCC')) && negative.has(node('GND')) && positive.has(node('TRIG'))) next.logicHighOutputs.add(node('ECHO'));
      if (component.type === 'transformer' && pairPowered(positive, negative, node('P1'), node('P2'))) {
        next.transformerPositive.add(node('S1')); next.transformerNegative.add(node('S2'));
      }
    });

    const stable = sameSet(controls.relays, next.relays) && sameSet(controls.transistors, next.transistors) && sameSet(controls.opampOutputs, next.opampOutputs) && sameSet(controls.logicHighOutputs, next.logicHighOutputs) && sameSet(controls.transformerPositive, next.transformerPositive) && sameSet(controls.transformerNegative, next.transformerNegative);
    controls = next;
    if (stable) break;
  }

  // Rebuild once using the final control states.
  graph = createBaseGraph(state, controls);
  const seeds = sourceSeeds(state, controls);
  positive = reachable(graph, seeds.positive);
  negative = reachable(reverseGraph(graph), seeds.negative);
  const analog = solveAnalogCircuit(state, { ...controls, positiveNodes: positive, negativeNodes: negative });

  const poweredComponents = new Set();
  state.components.forEach(component => {
    const node = pin => ref(component.id, pin);
    let powered = false;
    if (component.type === 'led') powered = pairPowered(positive, negative, node('A'), node('K'), true);
    if (['lamp', 'motor', 'buzzer', 'speaker', 'solenoid'].includes(component.type)) powered = pairPowered(positive, negative, node('1'), node('2'));
    if (component.type === 'servo' || component.type === 'lcd-16x2') powered = positive.has(node('VCC')) && negative.has(node('GND'));
    if (component.type === 'stepper-motor') powered = pairPowered(positive, negative, node('A1'), node('A2')) || pairPowered(positive, negative, node('B1'), node('B2'));
    if (component.type === 'rgb-led') powered = negative.has(node('COM')) && ['R', 'G', 'B'].some(pin => positive.has(node(pin)));
    if (powered) poweredComponents.add(component.id);
  });

  const highOutputComponents = new Set();
  controls.logicHighOutputs.forEach(reference => highOutputComponents.add(splitRef(reference)[0]));
  state.components.forEach(component => {
    if (component.type === 'logic-input' && component.high) highOutputComponents.add(component.id);
    if (component.type === 'clock-generator' && component.enabled && component.high) highOutputComponents.add(component.id);
    if (component.type === 'function-generator' && component.enabled) highOutputComponents.add(component.id);
  });

  const measurements = new Map(), signalStates = new Map(), segmentStates = new Map(), digitalStates = new Map();
  const frequency = Math.max(0, ...state.components.filter(component => ['clock-generator', 'function-generator', 'ac-source', 'timer-555'].includes(component.type)).map(component => Number(component.frequency) || 0));
  state.components.forEach(component => {
    const node = pin => ref(component.id, pin);
    if (component.type === 'voltmeter') measurements.set(component.id, formatVoltage(analog.voltageBetween(node('+'), node('-'))));
    if (component.type === 'ammeter') measurements.set(component.id, formatCurrent(analog.componentCurrents.get(component.id) || 0));
    if (component.type === 'ohmmeter') measurements.set(component.id, formatResistance(analog.equivalentResistances.get(component.id)));
    if (component.type === 'frequency-counter') {
      const referencedVoltage = analog.voltageBetween(node('IN'), node('GND'));
      const active = analog.isConnected(node('IN'), node('GND')) && Math.abs(referencedVoltage) > 0.5;
      measurements.set(component.id, active ? `${frequency >= 1e6 ? `${(frequency / 1e6).toFixed(3)} MHz` : frequency >= 1000 ? `${(frequency / 1000).toFixed(3)} kHz` : `${frequency.toFixed(1)} Hz`}` : '0.0 Hz');
    }
    if (component.type === 'wattmeter') {
      const volts = analog.voltageBetween(node('V+'), node('V-')), amps = analog.componentCurrents.get(component.id) || 0;
      measurements.set(component.id, `${(volts * amps).toFixed(2)} W`);
    }
    if (component.type === 'oscilloscope') signalStates.set(component.id, ['CH1', 'CH2'].map(pin => analog.isConnected(node(pin), node('GND')) && analog.voltageBetween(node(pin), node('GND')) > 1));
    if (component.type === 'logic-analyzer') signalStates.set(component.id, ['D0', 'D1', 'D2', 'D3'].map(pin => analog.isConnected(node(pin), node('GND')) && analog.voltageBetween(node(pin), node('GND')) > 1));
    if (component.type === 'rgb-led') signalStates.set(component.id, ['R', 'G', 'B'].map(pin => analog.isConnected(node(pin), node('COM')) && analog.voltageBetween(node(pin), node('COM')) > 1));
    if (component.type === 'seven-segment') segmentStates.set(component.id, new Set(SEGMENT_IDS.filter(pin => analog.isConnected(node(pin), node('COM')) && analog.voltageBetween(node(pin), node('COM')) > 1)));
    if (component.type === 'd-flip-flop') digitalStates.set(component.id, analog.isConnected(node('Q'), node('GND')) && analog.voltageBetween(node('Q'), node('GND')) > 1);
  });

  const activeWires = new Set();
  state.wires.forEach(wire => {
    const [fromId] = splitRef(wire.from), [toId] = splitRef(wire.to);
    const touchesPoweredLoad = poweredComponents.has(fromId) || poweredComponents.has(toId);
    const carriesKnownPotential = positive.has(wire.from) || positive.has(wire.to) || negative.has(wire.from) || negative.has(wire.to);
    if (touchesPoweredLoad || carriesKnownPotential) activeWires.add(wire.id);
  });

  return {
    poweredComponents,
    activeWires,
    energizedRelays: controls.relays,
    conductingSemiconductors: controls.transistors,
    highOutputComponents,
    measurements,
    signalStates,
    segmentStates,
    digitalStates,
    nodeVoltages: analog.nodeVoltages,
    branchCurrents: analog.componentCurrents,
    sourceCurrents: analog.sourceCurrents,
    positiveNodes: positive,
    negativeNodes: negative,
    hasPower: poweredComponents.size > 0 || highOutputComponents.size > 0
  };
}
