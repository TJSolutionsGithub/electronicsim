import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENT_CATALOG, COMPONENT_TYPES, componentBounds, pinPosition } from './componentDefs.js';
import {
  addComponent, createCircuitState, moveComponents, normalizeCircuitData, optimizeAllWires,
  renameComponent, serializeCircuit
} from './circuitState.js';
import { autoRoute, dragSegment, pathIsOrthogonal } from './router.js';
import { CIRCUIT_EXAMPLES } from './examples.js';
import { autoLayoutCircuit } from './layout.js';

test('every catalog component has defaults, pins and valid geometry', () => {
  const catalogTypes = COMPONENT_CATALOG.flatMap(group => group.types);
  assert.equal(new Set(catalogTypes).size, Object.keys(COMPONENT_TYPES).length);
  const state = createCircuitState({ version: 2, name: 'catalog', components: [], wires: [] });
  for (const type of catalogTypes) {
    const component = addComponent(state, type, 400, 280);
    const def = COMPONENT_TYPES[type];
    assert.ok(def.label && def.prefix && def.icon);
    assert.ok(def.pins.length > 0, `${type} needs at least one pin`);
    for (const pin of def.pins) {
      const point = pinPosition(component, pin);
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }
  assert.equal(state.components.length, catalogTypes.length);
});

test('demo and optimized routes stay orthogonal', () => {
  const state = createCircuitState();
  assert.equal(state.wires.length, 4);
  state.wires.forEach(wire => assert.ok(pathIsOrthogonal(wire.points), wire.id));
  addComponent(state, 'transformer', 470, 280);
  optimizeAllWires(state);
  state.wires.forEach(wire => assert.ok(pathIsOrthogonal(wire.points), wire.id));
});

test('batch component movement preserves group offsets and valid wire endpoints', () => {
  const state = createCircuitState();
  const resistor = state.components.find(component => component.id === 'R1');
  const led = state.components.find(component => component.id === 'LED1');
  const originalOffset = { x: led.x - resistor.x, y: led.y - resistor.y };
  moveComponents(state, [
    { id: 'R1', x: resistor.x + 48, y: resistor.y + 24 },
    { id: 'LED1', x: led.x + 48, y: led.y + 24 }
  ]);
  assert.deepEqual({ x: led.x - resistor.x, y: led.y - resistor.y }, originalOffset);
  state.wires.forEach(wire => assert.ok(pathIsOrthogonal(wire.points), wire.id));
  const r2 = pinPosition(resistor, COMPONENT_TYPES.resistor.pins.find(pin => pin.id === '2'));
  const wireFromR2 = state.wires.find(wire => wire.from === 'R1.2');
  assert.deepEqual(wireFromR2.points[0], r2);
});

test('router avoids an obstacle and keeps pin stubs', () => {
  const obstacle = { id: 'BLOCK', x: 90, y: 30, w: 80, h: 80 };
  const route = autoRoute({ x: 20, y: 70 }, 'right', { x: 240, y: 70 }, 'left', [obstacle], new Set());
  assert.ok(pathIsOrthogonal(route));
  // The inflated obstacle occupies y=18..122, so a valid path must leave that band.
  assert.ok(route.some(point => point.y <= 18 || point.y >= 122));
  assert.deepEqual(route[0], { x: 20, y: 70 });
  assert.deepEqual(route.at(-1), { x: 240, y: 70 });
});

test('manual segment drag preserves endpoints and orthogonality', () => {
  const original = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 0 }];
  const result = dragSegment(original, 0, 20, 0);
  assert.deepEqual(result[0], original[0]);
  assert.deepEqual(result.at(-1), original.at(-1));
  assert.ok(pathIsOrthogonal(result));
});

test('all example circuits load and route successfully', () => {
  assert.ok(CIRCUIT_EXAMPLES.length >= 10);
  for (const example of CIRCUIT_EXAMPLES) {
    const state = createCircuitState(example.circuit);
    assert.ok(state.components.length >= 4, example.id);
    state.wires.forEach(wire => {
      assert.ok(wire.points.length >= 2, `${example.id}/${wire.id}`);
      assert.ok(pathIsOrthogonal(wire.points), `${example.id}/${wire.id}`);
    });
  }
});

test('auto-layout organizes every example without overlap and keeps routes valid', () => {
  for (const example of CIRCUIT_EXAMPLES) {
    const state = createCircuitState(example.circuit);
    const before = state.components.map(component => `${component.x},${component.y}`).join('|');
    const result = autoLayoutCircuit(state);
    optimizeAllWires(state);
    assert.equal(result.count, state.components.length, example.id);
    assert.notEqual(state.components.map(component => `${component.x},${component.y}`).join('|'), before, example.id);
    state.components.forEach(component => {
      const bounds = componentBounds(component);
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.w <= 1000 && bounds.y + bounds.h <= 600, `${example.id}/${component.id}`);
    });
    for (let first = 0; first < state.components.length; first += 1) for (let second = first + 1; second < state.components.length; second += 1) {
      const a = componentBounds(state.components[first]), b = componentBounds(state.components[second]);
      const overlaps = a.x < b.x + b.w + 5 && a.x + a.w + 5 > b.x && a.y < b.y + b.h + 5 && a.y + a.h + 5 > b.y;
      assert.equal(overlaps, false, `${example.id}: ${state.components[first].id}/${state.components[second].id}`);
    }
    state.wires.forEach(wire => assert.ok(pathIsOrthogonal(wire.points), `${example.id}/${wire.id}`));
  }
});

test('renaming and serialization preserve wire endpoints', () => {
  const state = createCircuitState();
  renameComponent(state, 'U1', 'MCU1');
  assert.equal(state.wires[0].from, 'MCU1.D13');
  const loaded = normalizeCircuitData(JSON.parse(serializeCircuit(state)));
  assert.equal(loaded.components.length, state.components.length);
  assert.equal(loaded.wires[0].from, 'MCU1.D13');
});

test('all schematic symbols render with boundary-aligned unique pins', () => {
  class FakeSvgNode {
    constructor(tagName) { this.tagName = tagName; this.attributes = {}; this.children = []; this.textContent = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    appendChild(child) { this.children.push(child); return child; }
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: (_namespace, tagName) => new FakeSvgNode(tagName) };
  try {
    for (const [type, def] of Object.entries(COMPONENT_TYPES)) {
      const ids = def.pins.map(pin => pin.id);
      assert.equal(new Set(ids).size, ids.length, `${type}: pin identifiers must be unique`);
      def.pins.forEach(pin => {
        assert.ok(pin.dx >= 0 && pin.dx <= def.w && pin.dy >= 0 && pin.dy <= def.h, `${type}.${pin.id}: pin outside symbol bounds`);
        assert.ok(pin.dx === 0 || pin.dx === def.w || pin.dy === 0 || pin.dy === def.h, `${type}.${pin.id}: pin must terminate on symbol boundary`);
      });
      const nodes = def.build({ id: def.prefix, type, ...structuredClone(def.defaults) });
      assert.ok(Array.isArray(nodes) && nodes.length > 0, `${type}: symbol builder returned no geometry`);
      assert.ok(nodes.every(Boolean), `${type}: symbol builder returned an invalid node`);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('polarity-sensitive and multi-device symbols use the matching standard glyphs', () => {
  class FakeSvgNode {
    constructor(tagName) { this.tagName = tagName; this.attributes = {}; this.children = []; this.textContent = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    appendChild(child) { this.children.push(child); return child; }
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: (_namespace, tagName) => new FakeSvgNode(tagName) };
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
  const render = type => flatten(COMPONENT_TYPES[type].build({ id: COMPONENT_TYPES[type].prefix, type, ...structuredClone(COMPONENT_TYPES[type].defaults) }));
  const classHas = (node, name) => String(node.attributes.class || '').split(/\s+/).includes(name);
  try {
    const dcMarks = render('dc-source').filter(node => classHas(node, 'source-sign'));
    const plus = dcMarks.find(node => node.textContent === '+'), minus = dcMarks.find(node => node.textContent === '−');
    assert.ok(plus && minus && plus.attributes.y === minus.attributes.y && Number(plus.attributes.x) < Number(minus.attributes.x), 'DC polarity must match left (+) and right (-) pins');

    const currentArrow = render('current-source').find(node => node.tagName === 'line' && classHas(node, 'source-arrow'));
    assert.ok(currentArrow && Number(currentArrow.attributes.x1) < Number(currentArrow.attributes.x2) && currentArrow.attributes.y1 === currentArrow.attributes.y2, 'current-source arrow must point from pin 1 to pin 2');

    assert.equal(render('transformer').filter(node => classHas(node, 'polarity-dot')).length, 2, 'transformer must show matching winding polarity dots');
    assert.equal(render('bridge-rectifier').filter(node => classHas(node, 'diode-glyph')).length, 4, 'bridge rectifier must show four diodes');
    assert.equal(render('rgb-led').filter(node => classHas(node, 'diode-glyph')).length, 3, 'RGB LED must show three LED junctions');
    assert.equal(render('optocoupler').filter(node => classHas(node, 'diode-glyph')).length, 1, 'optocoupler must show its input LED');
    assert.ok(render('optocoupler').some(node => classHas(node, 'isolation-barrier')), 'optocoupler must show galvanic isolation');
    assert.ok(render('schmitt-trigger').some(node => classHas(node, 'schmitt-mark')), 'Schmitt trigger must show hysteresis');

    const relayLabels = new Set(render('relay-spdt').filter(node => classHas(node, 'terminal-label')).map(node => node.textContent));
    assert.ok(['COM', 'NO', 'NC'].every(label => relayLabels.has(label)), 'SPDT relay must identify COM, NO and NC');
    assert.ok(render('relay-spdt').some(node => classHas(node, 'switch-arm')), 'SPDT relay must render its moving contact');

    const arrowLine = type => render(type).find(node => node.tagName === 'line' && classHas(node, 'transistor-arrow'));
    assert.ok(Number(arrowLine('transistor-npn').attributes.x1) < Number(arrowLine('transistor-npn').attributes.x2), 'NPN emitter arrow must point out');
    assert.ok(Number(arrowLine('transistor-pnp').attributes.x1) > Number(arrowLine('transistor-pnp').attributes.x2), 'PNP emitter arrow must point in');
    assert.ok(Number(arrowLine('nmos').attributes.x1) > Number(arrowLine('nmos').attributes.x2), 'NMOS body arrow must point inward');
    assert.ok(Number(arrowLine('pmos').attributes.x1) < Number(arrowLine('pmos').attributes.x2), 'PMOS body arrow must point outward');

    const timerLabels = render('timer-555').filter(node => classHas(node, 'supply-label')).map(node => node.textContent);
    assert.ok(timerLabels.includes('VCC') && timerLabels.includes('GND'), 'IC supply pins must be visibly labeled');
    assert.deepEqual(COMPONENT_TYPES.diode.pins.map(pin => pin.name), ['Anode (A)', 'Cathode (K)']);
    assert.deepEqual(COMPONENT_TYPES['polarized-capacitor'].pins.map(pin => pin.name), ['Positive', 'Negative']);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
