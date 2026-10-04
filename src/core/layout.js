import { COMPONENT_TYPES, componentBounds, normalizeRotation } from './componentDefs.js';

const SOURCE_TYPES = new Set(['battery', 'dc-source', 'ac-source', 'current-source', 'function-generator', 'logic-input', 'clock-generator', 'arduino-uno']);
const REFERENCE_TYPES = new Set(['ground', 'vcc']);
const MARGIN = 28;

function endpointId(reference) {
  const dot = String(reference).lastIndexOf('.');
  return dot < 0 ? reference : reference.slice(0, dot);
}

function centerOf(component) {
  const def = COMPONENT_TYPES[component.type];
  return { x: component.x + def.w / 2, y: component.y + def.h / 2 };
}

function graphFor(state, allowedIds) {
  const adjacency = new Map([...allowedIds].map(id => [id, new Set()]));
  const outgoing = new Map([...allowedIds].map(id => [id, new Set()]));
  const incoming = new Map([...allowedIds].map(id => [id, new Set()]));
  state.wires.forEach(wire => {
    const from = endpointId(wire.from), to = endpointId(wire.to);
    if (!allowedIds.has(from) || !allowedIds.has(to) || from === to) return;
    adjacency.get(from).add(to); adjacency.get(to).add(from);
    outgoing.get(from).add(to); incoming.get(to).add(from);
  });
  return { adjacency, outgoing, incoming };
}

function connectedGroups(ids, adjacency) {
  const remaining = new Set(ids), groups = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const group = [], queue = [first]; remaining.delete(first);
    while (queue.length) {
      const id = queue.shift(); group.push(id);
      adjacency.get(id)?.forEach(next => { if (remaining.delete(next)) queue.push(next); });
    }
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length);
}

function buildLayers(group, componentMap, graph) {
  const references = group.filter(id => REFERENCE_TYPES.has(componentMap.get(id).type));
  const regular = group.filter(id => !REFERENCE_TYPES.has(componentMap.get(id).type));
  if (!regular.length) return { layers: [], references };
  const regularSet = new Set(regular);
  let roots = regular.filter(id => SOURCE_TYPES.has(componentMap.get(id).type));
  if (!roots.length) roots = regular.filter(id => [...(graph.incoming.get(id) || [])].every(source => !regularSet.has(source)));
  if (!roots.length) roots = [regular.reduce((best, id) => (graph.adjacency.get(id)?.size || 0) > (graph.adjacency.get(best)?.size || 0) ? id : best, regular[0])];

  const layer = new Map(), queue = [];
  roots.forEach(id => { if (!layer.has(id)) { layer.set(id, 0); queue.push(id); } });
  // Directed traversal preserves the intended source-to-load order and avoids
  // pushing a source to the end when the return wire closes a loop.
  while (queue.length) {
    const id = queue.shift(), nextLayer = layer.get(id) + 1;
    graph.outgoing.get(id)?.forEach(next => {
      if (!regularSet.has(next) || layer.has(next)) return;
      layer.set(next, nextLayer); queue.push(next);
    });
  }
  // Components reached only through reverse-oriented/imported wires still join
  // the closest already-positioned stage.
  let pending = regular.filter(id => !layer.has(id));
  while (pending.length) {
    let progress = false;
    pending.forEach(id => {
      const neighbors = [...(graph.adjacency.get(id) || [])].filter(next => layer.has(next));
      if (!neighbors.length) return;
      layer.set(id, Math.min(...neighbors.map(next => layer.get(next) + 1))); progress = true;
    });
    if (!progress) { layer.set(pending[0], Math.max(0, ...layer.values()) + 1); }
    pending = regular.filter(id => !layer.has(id));
  }

  const values = [...new Set(layer.values())].sort((a, b) => a - b);
  const compressed = new Map(values.map((value, index) => [value, index]));
  const layers = values.map(value => regular.filter(id => layer.get(id) === value));
  // Barycentric ordering reduces crossings between adjacent layers.
  for (let index = 1; index < layers.length; index += 1) {
    const previousOrder = new Map(layers[index - 1].map((id, order) => [id, order]));
    layers[index].sort((a, b) => {
      const score = id => {
        const neighbors = [...(graph.adjacency.get(id) || [])].filter(next => previousOrder.has(next));
        return neighbors.length ? neighbors.reduce((sum, next) => sum + previousOrder.get(next), 0) / neighbors.length : centerOf(componentMap.get(id)).y;
      };
      return score(a) - score(b);
    });
  }
  return { layers, references, layer: new Map([...layer].map(([id, value]) => [id, compressed.get(value)])) };
}

function placeLayer(ids, x, top, height, componentMap) {
  const gap = 26;
  const itemHeights = ids.map(id => COMPONENT_TYPES[componentMap.get(id).type].h);
  const total = itemHeights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, ids.length - 1);
  let cursor = top + Math.max(12, (height - total) / 2);
  ids.forEach((id, index) => {
    const component = componentMap.get(id), def = COMPONENT_TYPES[component.type];
    component.x = x - def.w / 2;
    component.y = cursor;
    cursor += itemHeights[index] + gap;
  });
}

function placeReference(id, index, cell, componentMap, graph) {
  const component = componentMap.get(id), def = COMPONENT_TYPES[component.type];
  const neighbors = [...(graph.adjacency.get(id) || [])].map(next => componentMap.get(next)).filter(Boolean);
  const neighborCenters = neighbors.map(centerOf);
  const targetX = neighborCenters.length ? neighborCenters.reduce((sum, point) => sum + point.x, 0) / neighborCenters.length : cell.x + cell.w / 2;
  const offset = (index - (Math.max(1, neighbors.length) - 1) / 2) * 58;
  component.x = targetX - def.w / 2 + offset;
  if (component.type === 'ground') {
    const below = neighbors.length ? Math.max(...neighbors.map(item => componentBounds(item).y + componentBounds(item).h)) + 58 : cell.y + cell.h * .72;
    component.y = Math.min(cell.y + cell.h - def.h - 12, below);
  } else {
    const above = neighbors.length ? Math.min(...neighbors.map(item => componentBounds(item).y)) - def.h - 48 : cell.y + 12;
    component.y = Math.max(cell.y + 12, above);
  }
}

function orientTwoPinComponents(ids, componentMap, graph) {
  ids.forEach(id => {
    const component = componentMap.get(id), def = COMPONENT_TYPES[component.type];
    if (def.pins.length !== 2 || SOURCE_TYPES.has(component.type) || ['lamp', 'motor', 'buzzer', 'speaker', 'solenoid'].includes(component.type)) return;
    const origin = centerOf(component);
    const neighbors = [...(graph.adjacency.get(id) || [])].map(next => componentMap.get(next)).filter(Boolean);
    if (!neighbors.length) return;
    const target = neighbors.map(centerOf).reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    target.x /= neighbors.length; target.y /= neighbors.length;
    component.rotation = normalizeRotation(Math.abs(target.y - origin.y) > Math.abs(target.x - origin.x) * 1.25 ? 90 : 0);
  });
}

function clampToCanvas(component, width, height) {
  let bounds = componentBounds(component);
  if (bounds.x < MARGIN) component.x += MARGIN - bounds.x;
  if (bounds.y < MARGIN) component.y += MARGIN - bounds.y;
  bounds = componentBounds(component);
  if (bounds.x + bounds.w > width - MARGIN) component.x -= bounds.x + bounds.w - (width - MARGIN);
  if (bounds.y + bounds.h > height - MARGIN) component.y -= bounds.y + bounds.h - (height - MARGIN);
}

function resolveOverlaps(components, width, height) {
  // Place each item once against an immutable set of accepted items. The old
  // pairwise nudging could oscillate when a wide instrument was squeezed
  // between two compact gates: resolving one collision recreated another.
  const placed = [], clearance = 16, step = 20;
  const overlapsPlaced = component => {
    const bounds = componentBounds(component);
    return placed.some(other => {
      const fixed = componentBounds(other);
      return bounds.x < fixed.x + fixed.w + clearance && bounds.x + bounds.w + clearance > fixed.x &&
        bounds.y < fixed.y + fixed.h + clearance && bounds.y + bounds.h + clearance > fixed.y;
    });
  };

  components.forEach(component => {
    const desired = { x: component.x, y: component.y };
    clampToCanvas(component, width, height);
    if (!overlapsPlaced(component)) { placed.push(component); return; }

    const tested = new Set(), maxRadius = Math.ceil(Math.max(width, height) / step);
    let found = false;
    for (let radius = 1; radius <= maxRadius && !found; radius += 1) {
      const offsets = [];
      for (let dx = -radius; dx <= radius; dx += 1) {
        offsets.push([dx, -radius], [dx, radius]);
      }
      for (let dy = -radius + 1; dy < radius; dy += 1) {
        offsets.push([-radius, dy], [radius, dy]);
      }
      offsets.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));
      for (const [dx, dy] of offsets) {
        component.x = desired.x + dx * step; component.y = desired.y + dy * step;
        clampToCanvas(component, width, height);
        const key = `${component.x.toFixed(2)},${component.y.toFixed(2)}`;
        if (tested.has(key)) continue;
        tested.add(key);
        if (!overlapsPlaced(component)) { found = true; break; }
      }
    }
    if (!found) { component.x = desired.x; component.y = desired.y; clampToCanvas(component, width, height); }
    placed.push(component);
  });
}

export function autoLayoutCircuit(state, componentIds = null, { width = 1000, height = 600 } = {}) {
  const ids = new Set(componentIds?.length ? componentIds : state.components.map(component => component.id));
  const components = state.components.filter(component => ids.has(component.id));
  if (!components.length) return { count: 0, groups: 0 };
  const componentMap = new Map(state.components.map(component => [component.id, component]));
  const graph = graphFor(state, ids);
  const groups = connectedGroups(ids, graph.adjacency);
  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length * 1.4)));
  const rows = Math.ceil(groups.length / columns);
  const usable = { x: MARGIN, y: MARGIN, w: width - MARGIN * 2, h: height - MARGIN * 2 };
  const cellWidth = usable.w / columns, cellHeight = usable.h / rows;

  groups.forEach((group, groupIndex) => {
    const column = groupIndex % columns, row = Math.floor(groupIndex / columns);
    const cell = { x: usable.x + column * cellWidth, y: usable.y + row * cellHeight, w: cellWidth, h: cellHeight };
    group.forEach(id => { componentMap.get(id).rotation = 0; });
    const { layers, references } = buildLayers(group, componentMap, graph);
    if (layers.length) {
      const left = cell.x + Math.min(72, cell.w * .12), right = cell.x + cell.w - Math.min(72, cell.w * .12);
      layers.forEach((layerIds, index) => {
        const x = layers.length === 1 ? cell.x + cell.w / 2 : left + (right - left) * index / (layers.length - 1);
        placeLayer(layerIds, x, cell.y + 8, cell.h - 80, componentMap);
      });
    }
    references.forEach((id, index) => placeReference(id, index, cell, componentMap, graph));
    orientTwoPinComponents(group, componentMap, graph);
  });

  components.forEach(component => clampToCanvas(component, width, height));
  resolveOverlaps(components, width, height);
  return { count: components.length, groups: groups.length };
}
