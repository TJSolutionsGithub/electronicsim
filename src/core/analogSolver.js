import { COMPONENT_TYPES } from './componentDefs.js';

const ref = (componentId, pinId) => `${componentId}.${pinId}`;

class UnionFind {
  constructor(values) { this.parent = new Map(values.map(value => [value, value])); }
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

function numberFrom(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseResistance(value, fallback = 0) {
  const source = String(value ?? '').trim(), amount = numberFrom(source, fallback);
  if (/G\s*(?:Ω|ohm)/.test(source)) return amount * 1e9;
  if (/M\s*(?:Ω|ohm)/.test(source)) return amount * 1e6;
  if (/k/i.test(source)) return amount * 1e3;
  if (/m\s*(?:Ω|ohm)/.test(source)) return amount / 1e3;
  return amount;
}

function parseCurrent(value) {
  const source = String(value ?? '').trim(), amount = numberFrom(source);
  if (/µ|u/i.test(source)) return amount / 1e6;
  if (/mA/i.test(source)) return amount / 1e3;
  if (/kA/i.test(source)) return amount * 1e3;
  return amount;
}

function parseRatio(value) {
  const [primary, secondary] = String(value || '1:1').split(':').map(part => Math.abs(numberFrom(part, 1)) || 1);
  return secondary / primary;
}

function gaussianSolve(matrix, vector) {
  const size = vector.length, a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-14) continue;
    if (pivot !== column) [a[pivot], a[column]] = [a[column], a[pivot]];
    const divisor = a[column][column];
    for (let index = column; index <= size; index += 1) a[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column || Math.abs(a[row][column]) < 1e-18) continue;
      const factor = a[row][column];
      for (let index = column; index <= size; index += 1) a[row][index] -= factor * a[column][index];
    }
  }
  return a.map((row, index) => Number.isFinite(row[size]) && Math.abs(row[index]) > 1e-10 ? row[size] : 0);
}

function loadResistance(component) {
  if (component.type === 'lamp') {
    const voltage = Math.max(0.1, numberFrom(component.voltage, 12)), power = Math.max(0.01, numberFrom(component.power, 5));
    return voltage * voltage / power;
  }
  if (component.type === 'motor') {
    const voltage = Math.max(0.1, numberFrom(component.voltage, 6));
    return voltage * voltage / 3;
  }
  if (component.type === 'buzzer') return 120;
  if (component.type === 'speaker') return Math.max(0.1, parseResistance(component.impedance, 8));
  if (component.type === 'solenoid') return Math.max(1, numberFrom(component.voltage, 12) * 2);
  return null;
}

function createTopology(state, controls = {}) {
  const batteryInternalNode = component => `@${component.id}.internal+`;
  const pinReferences = state.components.flatMap(component => COMPONENT_TYPES[component.type].pins.map(pin => ref(component.id, pin.id)));
  const internalReferences = state.components.filter(component => component.type === 'battery' && parseResistance(component.internalResistance, 0) > 0).map(batteryInternalNode);
  const references = [...pinReferences, ...internalReferences];
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

  const root = reference => reference == null ? null : union.find(reference);
  const resistors = [], currentSources = [], rawConstraints = [];
  const addResistor = (a, b, resistance, id = '', role = '') => {
    const value = Math.max(1e-6, Number(resistance) || 1e12), first = root(a), second = root(b);
    if (first !== second) resistors.push({ a: first, b: second, resistance: value, id, role });
  };
  const addCurrent = (from, to, current) => currentSources.push({ from: root(from), to: root(to), current: Number(current) || 0 });
  const addConstraint = (positive, negative, value, id = '', extraCoefficients = []) => {
    const coefficients = new Map();
    const add = (node, amount) => { const resolved = root(node); if (resolved != null) coefficients.set(resolved, (coefficients.get(resolved) || 0) + amount); };
    add(positive, 1); add(negative, -1); extraCoefficients.forEach(([node, amount]) => add(node, amount));
    for (const [node, amount] of coefficients) if (Math.abs(amount) < 1e-14) coefficients.delete(node);
    rawConstraints.push({ positive: root(positive), negative: root(negative), coefficients, value: Number(value) || 0, id });
  };

  const relayStates = controls.relays || new Set();
  const semiconductorStates = controls.transistors || new Set();
  state.components.forEach(component => {
    const node = pin => ref(component.id, pin);
    switch (component.type) {
      case 'battery': {
        const internalResistance = parseResistance(component.internalResistance, 0);
        if (internalResistance > 0) addResistor(batteryInternalNode(component), node('+'), internalResistance, component.id, 'source-internal');
        break;
      }
      case 'resistor': addResistor(node('1'), node('2'), parseResistance(component.value, 1000), component.id); break;
      case 'thermistor':
      case 'photoresistor': addResistor(node('1'), node('2'), parseResistance(component.resistance, 10000), component.id); break;
      case 'potentiometer': {
        const total = Math.max(1e-3, parseResistance(component.value, 10000)), position = Math.max(0, Math.min(100, Number(component.position) || 0)) / 100;
        addResistor(node('1'), node('W'), Math.max(1e-3, total * position), component.id);
        addResistor(node('W'), node('2'), Math.max(1e-3, total * (1 - position)), component.id);
        break;
      }
      case 'inductor':
      case 'fuse':
      case 'terminal-block': addResistor(node('1'), node('2'), 1e-3, component.id); break;
      case 'ammeter': addResistor(node('+'), node('-'), 0.1, component.id, 'ammeter'); break;
      case 'wattmeter': addResistor(node('I+'), node('I-'), 0.1, component.id, 'wattmeter-current'); break;
      case 'voltmeter': addResistor(node('+'), node('-'), parseResistance(component.impedance, 10e6), component.id, 'voltmeter'); break;
      case 'switch-spst': if (component.closed) addResistor(node('1'), node('2'), parseResistance(component.contactResistance, 0.05), component.id); break;
      case 'pushbutton': if (component.normallyClosed ? !component.closed : component.closed) addResistor(node('1'), node('2'), 0.01, component.id); break;
      case 'switch-spdt': addResistor(node('COM'), node(component.position === 'B' ? 'B' : 'A'), 0.01, component.id); break;
      case 'relay': if (relayStates.has(component.id) || component.energized) addResistor(node('COM'), node('NO'), 0.02, component.id); break;
      case 'relay-spdt': addResistor(node('COM'), node(relayStates.has(component.id) || component.energized ? 'NO' : 'NC'), 0.02, component.id); break;
      case 'transistor-npn': if (semiconductorStates.has(component.id)) addResistor(node('C'), node('E'), 0.1, component.id); break;
      case 'transistor-pnp': if (semiconductorStates.has(component.id)) addResistor(node('E'), node('C'), 0.1, component.id); break;
      case 'nmos': if (semiconductorStates.has(component.id)) addResistor(node('D'), node('S'), 0.05, component.id); break;
      case 'pmos': if (semiconductorStates.has(component.id)) addResistor(node('S'), node('D'), 0.05, component.id); break;
      case 'scr': if (semiconductorStates.has(component.id)) addResistor(node('A'), node('K'), 0.1, component.id); break;
      case 'triac': if (semiconductorStates.has(component.id)) addResistor(node('MT1'), node('MT2'), 0.1, component.id); break;
      case 'optocoupler': if (semiconductorStates.has(component.id)) addResistor(node('C'), node('E'), 10, component.id); break;
      case 'diode': if (controls.positiveNodes?.has(node('1')) && controls.negativeNodes?.has(node('2'))) addResistor(node('1'), node('2'), 1, component.id); break;
      case 'zener': addResistor(node('1'), node('2'), 10, component.id); break;
      case 'lamp':
      case 'motor':
      case 'buzzer':
      case 'speaker':
      case 'solenoid': addResistor(node('1'), node('2'), loadResistance(component), component.id, 'load'); break;
      default: break;
    }
  });

  const globalGround = grounds.length ? root(grounds[0]) : null;
  const constrainedVccRoots = new Set();
  state.components.forEach(component => {
    const node = pin => ref(component.id, pin);
    switch (component.type) {
      case 'battery': {
        const positive = parseResistance(component.internalResistance, 0) > 0 ? batteryInternalNode(component) : node('+');
        addConstraint(positive, node('-'), numberFrom(component.voltage, 9), component.id);
        break;
      }
      case 'dc-source': addConstraint(node('+'), node('-'), numberFrom(component.voltage, 5), component.id); break;
      case 'ac-source': addConstraint(node('1'), node('2'), numberFrom(component.voltage, 12), component.id); break;
      case 'current-source': addCurrent(node('1'), node('2'), parseCurrent(component.current)); break;
      case 'function-generator': if (component.enabled) addConstraint(node('OUT'), node('GND'), numberFrom(component.amplitude, 5), component.id); break;
      case 'logic-input': addConstraint(node('OUT'), node('GND'), component.high ? numberFrom(component.voltage, 5) : 0, component.id); break;
      case 'clock-generator': addConstraint(node('OUT'), node('GND'), component.enabled && component.high ? 5 : 0, component.id); break;
      case 'vcc': {
        const resolved = root(node('1'));
        if (!constrainedVccRoots.has(resolved)) { addConstraint(node('1'), globalGround, numberFrom(component.voltage, 5), component.id); constrainedVccRoots.add(resolved); }
        break;
      }
      case 'arduino-uno':
        addConstraint(node('5V'), node('GND'), 5, `${component.id}:5V`);
        addConstraint(node('D13'), node('GND'), 5, `${component.id}:D13`);
        addConstraint(node('D12'), node('GND'), 5, `${component.id}:D12`);
        break;
      case 'transformer': {
        const gain = parseRatio(component.ratio);
        addConstraint(node('S1'), node('S2'), 0, component.id, [[node('P1'), -gain], [node('P2'), gain]]);
        break;
      }
      case 'voltage-regulator':
        if (controls.positiveNodes?.has(node('IN')) && controls.negativeNodes?.has(node('GND'))) addConstraint(node('OUT'), node('GND'), numberFrom(component.outputVoltage, 5), component.id);
        break;
      default: break;
    }
  });

  (controls.logicHighOutputs || new Set()).forEach(reference => {
    const [componentId] = String(reference).split('.'), component = state.components.find(item => item.id === componentId);
    const groundPin = COMPONENT_TYPES[component?.type]?.pins.find(pin => pin.id === 'GND' || pin.id === 'V-');
    if (component && groundPin) addConstraint(reference, ref(component.id, groundPin.id), 5, `${reference}:logic`);
  });
  (controls.opampOutputs || new Set()).forEach(reference => {
    const componentId = String(reference).split('.')[0];
    addConstraint(reference, ref(componentId, 'V-'), 5, `${reference}:opamp`);
  });

  // Equal constraints in parallel are redundant and make an ideal-source MNA
  // matrix singular. Keep one exact electrical equation per coefficient set.
  const seenConstraints = new Set();
  const constraints = rawConstraints.filter(constraint => {
    const signature = [...constraint.coefficients].sort(([a], [b]) => a.localeCompare(b)).map(([node, coefficient]) => `${node}:${coefficient.toPrecision(12)}`).join('|') + `=${constraint.value.toPrecision(12)}`;
    if (seenConstraints.has(signature)) return false;
    seenConstraints.add(signature); return constraint.coefficients.size > 0;
  });

  return { union, root, references, globalGround, resistors, currentSources, constraints };
}

function solveTopology(topology) {
  const roots = [...new Set(topology.references.map(topology.root))];
  const nodeRoots = roots.filter(root => root !== topology.globalGround), nodeIndex = new Map(nodeRoots.map((root, index) => [root, index]));
  const nodeCount = nodeRoots.length, size = nodeCount + topology.constraints.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0)), vector = Array(size).fill(0);
  const indexOf = root => root == null || root === topology.globalGround ? -1 : nodeIndex.get(root);
  const stampConductance = (a, b, conductance) => {
    const first = indexOf(a), second = indexOf(b);
    if (first >= 0) matrix[first][first] += conductance;
    if (second >= 0) matrix[second][second] += conductance;
    if (first >= 0 && second >= 0) { matrix[first][second] -= conductance; matrix[second][first] -= conductance; }
  };
  topology.resistors.forEach(resistor => stampConductance(resistor.a, resistor.b, 1 / resistor.resistance));
  topology.currentSources.forEach(source => {
    const from = indexOf(source.from), to = indexOf(source.to);
    if (from >= 0) vector[from] -= source.current;
    if (to >= 0) vector[to] += source.current;
  });
  nodeRoots.forEach(root => { matrix[nodeIndex.get(root)][nodeIndex.get(root)] += 1e-12; });
  topology.constraints.forEach((constraint, constraintIndex) => {
    const sourceIndex = nodeCount + constraintIndex;
    const positive = indexOf(constraint.positive), negative = indexOf(constraint.negative);
    if (positive >= 0) matrix[positive][sourceIndex] += 1;
    if (negative >= 0) matrix[negative][sourceIndex] -= 1;
    constraint.coefficients.forEach((coefficient, root) => {
      const node = indexOf(root);
      if (node >= 0) matrix[sourceIndex][node] += coefficient;
    });
    vector[sourceIndex] = constraint.value;
  });
  const solution = size ? gaussianSolve(matrix, vector) : [];
  const rootVoltage = root => root == null || root === topology.globalGround ? 0 : (solution[nodeIndex.get(root)] || 0);
  const nodeVoltages = new Map(topology.references.map(reference => [reference, rootVoltage(topology.root(reference))]));
  const componentCurrents = new Map();
  topology.resistors.filter(resistor => resistor.role).forEach(resistor => {
    componentCurrents.set(resistor.id, (rootVoltage(resistor.a) - rootVoltage(resistor.b)) / resistor.resistance);
  });
  const sourceCurrents = new Map(topology.constraints.map((constraint, index) => [constraint.id, solution[nodeCount + index] || 0]));
  const islands = new UnionFind(roots);
  topology.resistors.forEach(item => islands.union(item.a, item.b));
  topology.currentSources.forEach(item => islands.union(item.from, item.to));
  topology.constraints.forEach(constraint => {
    const members = [...constraint.coefficients.keys()];
    members.slice(1).forEach(member => islands.union(members[0], member));
  });
  return {
    nodeVoltages, componentCurrents, sourceCurrents,
    voltageAt: reference => nodeVoltages.get(reference) || 0,
    voltageBetween: (positive, negative) => (nodeVoltages.get(positive) || 0) - (nodeVoltages.get(negative) || 0),
    isConnected: (first, second) => islands.find(topology.root(first)) === islands.find(topology.root(second))
  };
}

function equivalentResistanceForMeter(state, topology, meter) {
  const positiveRoot = topology.root(ref(meter.id, '+')), negativeRoot = topology.root(ref(meter.id, '-'));
  if (positiveRoot === negativeRoot) return 0;
  const roots = [...new Set(topology.references.map(topology.root))], nodeRoots = roots.filter(root => root !== negativeRoot);
  const index = new Map(nodeRoots.map((root, position) => [root, position])), size = nodeRoots.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0)), vector = Array(size).fill(0);
  const stamp = (a, b, conductance) => {
    const first = a === negativeRoot ? -1 : index.get(a), second = b === negativeRoot ? -1 : index.get(b);
    if (first >= 0) matrix[first][first] += conductance;
    if (second >= 0) matrix[second][second] += conductance;
    if (first >= 0 && second >= 0) { matrix[first][second] -= conductance; matrix[second][first] -= conductance; }
  };
  topology.resistors.filter(resistor => resistor.id !== meter.id && resistor.role !== 'voltmeter').forEach(resistor => stamp(resistor.a, resistor.b, 1 / resistor.resistance));
  nodeRoots.forEach(root => { matrix[index.get(root)][index.get(root)] += 1e-12; });
  if (index.has(positiveRoot)) vector[index.get(positiveRoot)] = 1;
  const solution = gaussianSolve(matrix, vector), resistance = solution[index.get(positiveRoot)] || 0;
  return resistance > 1e8 ? Infinity : Math.max(0, resistance);
}

export function solveAnalogCircuit(state, controls = {}) {
  const topology = createTopology(state, controls), solved = solveTopology(topology), equivalentResistances = new Map();
  state.components.filter(component => component.type === 'ohmmeter').forEach(component => equivalentResistances.set(component.id, equivalentResistanceForMeter(state, topology, component)));
  return { ...solved, equivalentResistances };
}
