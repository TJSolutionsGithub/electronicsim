import {
  COMPONENT_TYPES, createDefaultProperties, pinPosition, resolvedPin,
  findPin, componentBounds, normalizeRotation
} from './componentDefs.js';
import { autoRoute, reflowEndpoint } from './router.js';

export const CANVAS_W = 1000;
export const CANVAS_H = 600;
export const GRID = 24;

function instantiate(type, id, x, y, values = {}) {
  if (!COMPONENT_TYPES[type]) throw new Error(`Unknown component type: ${type}`);
  return { id, type, x, y, rotation: 0, ...createDefaultProperties(type), ...values };
}

function makeComponents() {
  return [
    instantiate('arduino-uno', 'U1', 58, 150, { board: 'UNO R3' }),
    instantiate('resistor', 'R1', 265, 220, { value: '220 Ω' }),
    instantiate('led', 'LED1', 425, 206, { color: 'Red' }),
    instantiate('switch-spst', 'S1', 565, 220, { closed: true }),
    instantiate('ground', 'GND1', 735, 400)
  ];
}

function makeWires() {
  return [
    { id: 'W1', from: 'U1.D13', to: 'R1.1', kind: 'signal', points: [], manual: false },
    { id: 'W2', from: 'R1.2', to: 'LED1.A', kind: 'signal', points: [], manual: false },
    { id: 'W3', from: 'LED1.K', to: 'S1.1', kind: 'signal', points: [], manual: false },
    { id: 'W4', from: 'S1.2', to: 'GND1.1', kind: 'ground', points: [], manual: false }
  ];
}

export function createCircuitState(data = null) {
  const state = data ? normalizeCircuitData(data) : { version: 2, name: 'main', components: makeComponents(), wires: makeWires() };
  routeMissingWires(state);
  return state;
}

export function splitEndpoint(ref) {
  const dot = String(ref).lastIndexOf('.');
  return dot < 1 ? [String(ref), ''] : [ref.slice(0, dot), ref.slice(dot + 1)];
}

export function endpoint(components, ref) {
  const [componentId, pinId] = splitEndpoint(ref);
  const component = components.find(item => item.id === componentId);
  if (!component) return null;
  const sourcePin = findPin(component, pinId);
  if (!sourcePin) return null;
  const pin = resolvedPin(component, sourcePin);
  return { comp: component, pin, pos: pinPosition(component, sourcePin) };
}

export function boundsList(state) {
  return state.components.map(component => ({ id: component.id, ...componentBounds(component) }));
}

export function inferWireKind(fromEndpoint, toEndpoint) {
  const electrical = [fromEndpoint?.pin?.electrical, toEndpoint?.pin?.electrical];
  if (electrical.includes('ground')) return 'ground';
  if (electrical.includes('power')) return 'power';
  return 'signal';
}

export function routeWire(state, wire, occupiedPaths = []) {
  const from = endpoint(state.components, wire.from);
  const to = endpoint(state.components, wire.to);
  if (!from || !to) return false;
  wire.points = autoRoute(from.pos, from.pin.dir, to.pos, to.pin.dir, boundsList(state), new Set([from.comp.id, to.comp.id]), occupiedPaths);
  wire.manual = false;
  return true;
}

export function routeAll(state) {
  const occupied = [];
  state.wires.forEach(wire => {
    if (routeWire(state, wire, occupied)) occupied.push(wire.points);
  });
}

export function routeMissingWires(state) {
  const occupied = state.wires.filter(wire => wire.manual && wire.points?.length).map(wire => wire.points);
  state.wires.forEach(wire => {
    if (!wire.points?.length && routeWire(state, wire, occupied)) occupied.push(wire.points);
  });
}

export function rerouteAutomaticWires(state) {
  const occupied = state.wires.filter(wire => wire.manual && wire.points?.length).map(wire => wire.points);
  state.wires.filter(wire => !wire.manual).forEach(wire => {
    if (routeWire(state, wire, occupied)) occupied.push(wire.points);
  });
}

export function reflowWiresForComponents(state, componentIds) {
  const movedIds = componentIds instanceof Set ? componentIds : new Set(componentIds);
  state.wires.filter(wire => wire.manual).forEach(wire => {
    const [fromId] = splitEndpoint(wire.from), [toId] = splitEndpoint(wire.to);
    if (movedIds.has(fromId)) {
      const from = endpoint(state.components, wire.from);
      if (from) wire.points = reflowEndpoint(wire.points, 'from', from.pos, from.pin.dir);
    }
    if (movedIds.has(toId)) {
      const to = endpoint(state.components, wire.to);
      if (to) wire.points = reflowEndpoint(wire.points, 'to', to.pos, to.pin.dir);
    }
  });
  // Route automatic nets once after every component in the batch has reached
  // its final position. This prevents group drags from calculating paths
  // against half-old/half-new component positions.
  rerouteAutomaticWires(state);
}

export function reflowWiresForComponent(state, componentId) {
  reflowWiresForComponents(state, new Set([componentId]));
}

export function optimizeAllWires(state) { routeAll(state); }

function positionComponent(component, x, y, snap = false) {
  let nextX = Number(x), nextY = Number(y);
  if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return component;
  if (snap) { nextX = Math.round(nextX / GRID) * GRID; nextY = Math.round(nextY / GRID) * GRID; }
  const bounds = componentBounds({ ...component, x: nextX, y: nextY });
  if (bounds.x < 0) nextX -= bounds.x;
  if (bounds.y < 0) nextY -= bounds.y;
  const corrected = componentBounds({ ...component, x: nextX, y: nextY });
  if (corrected.x + corrected.w > CANVAS_W) nextX -= corrected.x + corrected.w - CANVAS_W;
  if (corrected.y + corrected.h > CANVAS_H) nextY -= corrected.y + corrected.h - CANVAS_H;
  component.x = nextX; component.y = nextY;
  return component;
}

export function moveComponents(state, moves, snap = false) {
  const movedIds = new Set();
  const moved = [];
  moves.forEach(move => {
    const component = state.components.find(item => item.id === move.id);
    if (!component) return;
    positionComponent(component, move.x, move.y, snap);
    movedIds.add(component.id); moved.push(component);
  });
  if (movedIds.size) reflowWiresForComponents(state, movedIds);
  return moved;
}

export function moveComponent(state, componentId, x, y, snap = false) {
  return moveComponents(state, [{ id: componentId, x, y }], snap)[0] || null;
}

export function nextReference(state, type) {
  const prefix = COMPONENT_TYPES[type]?.prefix || 'X';
  const used = new Set(state.components.map(component => component.id.toUpperCase()));
  let number = 1;
  while (used.has(`${prefix}${number}`.toUpperCase())) number += 1;
  return `${prefix}${number}`;
}

export function addComponent(state, type, x = 440, y = 260) {
  if (!COMPONENT_TYPES[type]) throw new Error(`Unsupported component type: ${type}`);
  const component = instantiate(type, nextReference(state, type), Number(x), Number(y));
  state.components.push(component);
  moveComponent(state, component.id, component.x, component.y, false);
  return component;
}

export function renameComponent(state, oldId, requestedId) {
  const component = state.components.find(item => item.id === oldId);
  if (!component) return null;
  const id = String(requestedId || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
  if (!id || state.components.some(item => item !== component && item.id.toLowerCase() === id.toLowerCase())) throw new Error('Reference must be unique and contain only letters, numbers, _ or -');
  state.wires.forEach(wire => {
    const [fromId, fromPin] = splitEndpoint(wire.from), [toId, toPin] = splitEndpoint(wire.to);
    if (fromId === oldId) wire.from = `${id}.${fromPin}`;
    if (toId === oldId) wire.to = `${id}.${toPin}`;
  });
  component.id = id;
  return component;
}

export function updateComponent(state, componentId, changes) {
  let component = state.components.find(item => item.id === componentId);
  if (!component) return null;
  if (changes.id != null && changes.id !== component.id) component = renameComponent(state, component.id, changes.id);
  Object.entries(changes).forEach(([key, value]) => {
    if (key === 'id' || key === 'type' || key === 'x' || key === 'y') return;
    component[key] = key === 'rotation' ? normalizeRotation(value) : value;
  });
  if (changes.x != null || changes.y != null) moveComponent(state, component.id, changes.x ?? component.x, changes.y ?? component.y, false);
  else if (changes.rotation != null) reflowWiresForComponent(state, component.id);
  return component;
}

export function removeComponent(state, componentId) {
  const index = state.components.findIndex(component => component.id === componentId);
  if (index < 0) return false;
  state.components.splice(index, 1);
  state.wires = state.wires.filter(wire => {
    const [fromId] = splitEndpoint(wire.from), [toId] = splitEndpoint(wire.to);
    return fromId !== componentId && toId !== componentId;
  });
  rerouteAutomaticWires(state);
  return true;
}

export function addWire(state, fromRef, toRef, kind = null) {
  if (fromRef === toRef) throw new Error('A wire needs two different pins');
  const from = endpoint(state.components, fromRef), to = endpoint(state.components, toRef);
  if (!from || !to) throw new Error('One or both wire endpoints are invalid');
  const duplicate = state.wires.some(wire => (wire.from === fromRef && wire.to === toRef) || (wire.from === toRef && wire.to === fromRef));
  if (duplicate) throw new Error('These pins are already connected');
  let number = 1;
  const ids = new Set(state.wires.map(wire => wire.id));
  while (ids.has(`W${number}`)) number += 1;
  const wire = { id: `W${number}`, from: fromRef, to: toRef, kind: kind || inferWireKind(from, to), points: [], manual: false };
  state.wires.push(wire);
  routeWire(state, wire, state.wires.filter(item => item !== wire).map(item => item.points));
  return wire;
}

export function removeWire(state, wireId) {
  const index = state.wires.findIndex(wire => wire.id === wireId);
  if (index < 0) return false;
  state.wires.splice(index, 1);
  rerouteAutomaticWires(state);
  return true;
}

export function normalizeCircuitData(raw) {
  const source = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
  if (!source || !Array.isArray(source.components) || !Array.isArray(source.wires)) throw new Error('Invalid circuit file');
  const ids = new Set();
  const components = source.components.map((item, index) => {
    if (!COMPONENT_TYPES[item.type]) throw new Error(`Unsupported component type at position ${index + 1}: ${item.type}`);
    const id = String(item.id || '').trim();
    if (!id || ids.has(id.toLowerCase())) throw new Error(`Invalid or duplicate component reference: ${id || '(empty)'}`);
    ids.add(id.toLowerCase());
    return instantiate(item.type, id, Number(item.x) || 0, Number(item.y) || 0, { ...item, rotation: normalizeRotation(item.rotation || 0) });
  });
  const validEndpoint = ref => Boolean(endpoint(components, ref));
  const wires = source.wires.map((wire, index) => {
    if (!validEndpoint(wire.from) || !validEndpoint(wire.to)) throw new Error(`Invalid endpoint in wire ${wire.id || index + 1}`);
    return { id: String(wire.id || `W${index + 1}`), from: wire.from, to: wire.to, kind: ['power', 'signal', 'ground'].includes(wire.kind) ? wire.kind : 'signal', points: Array.isArray(wire.points) ? wire.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) : [], manual: Boolean(wire.manual) };
  });
  return { version: 2, name: String(source.name || 'main'), components, wires };
}

export function serializeCircuit(state) {
  const components = state.components.map(component => Object.fromEntries(Object.entries(component).filter(([key]) => !key.startsWith('_sim'))));
  return JSON.stringify({ version: 2, name: state.name || 'main', components, wires: state.wires }, null, 2);
}
