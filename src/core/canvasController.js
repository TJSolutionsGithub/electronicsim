import { COMPONENT_TYPES, componentBounds, findPin, pinPosition } from './componentDefs.js';
import { dragSegment, pathToD } from './router.js';
import { autoLayoutCircuit } from './layout.js';
import {
  CANVAS_W, CANVAS_H, GRID, addComponent as addStateComponent, addWire,
  createCircuitState, moveComponent, moveComponents, normalizeCircuitData, optimizeAllWires,
  removeComponent, removeWire, renameComponent, routeWire, serializeCircuit,
  updateComponent
} from './circuitState.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
};
const snapshotOf = state => serializeCircuit(state);

function clientToSvg(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX; point.y = clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function nearestSegment(points, point) {
  let best = 0, distance = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidate = distanceToSegment(point, points[index], points[index + 1]);
    if (candidate < distance) { distance = candidate; best = index; }
  }
  return best;
}

export function createCanvasController(svg, options = {}) {
  let state = createCircuitState();
  let selection = null; // primary component or selected wire
  const selectedComponentIds = new Set();
  let clipboard = null;
  let snap = true, grid = true, zoom = 1;
  let viewCenter = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
  let panMode = false, spacePressed = false;
  let pasteOffset = 0;
  const undoStack = [], redoStack = [];
  const MAX_HISTORY = 75;

  const wireLayer = svgEl('g', { class: 'wire-layer' });
  const previewLayer = svgEl('g', { class: 'preview-layer' });
  const componentLayer = svgEl('g', { class: 'component-layer' });
  const selectionLayer = svgEl('g', { class: 'selection', id: 'selection' });
  svg.append(wireLayer, previewLayer, componentLayer, selectionLayer);

  const wireEls = new Map();
  const componentEls = new Map();

  function selectionValue() {
    if (selectedComponentIds.size > 1) {
      const items = state.components.filter(component => selectedComponentIds.has(component.id));
      return { kind: 'components', items, item: items.find(component => component.id === selection?.id) || items.at(-1) || null };
    }
    if (selectedComponentIds.size === 1) {
      const id = [...selectedComponentIds][0];
      const item = state.components.find(component => component.id === id);
      return item ? { kind: 'component', item } : null;
    }
    if (selection?.kind === 'wire') {
      const item = state.wires.find(wire => wire.id === selection.id);
      return item ? { kind: 'wire', item } : null;
    }
    return null;
  }

  function emitSelection() { options.onSelect?.(selectionValue()); }
  function emitChange(reason = 'change') { options.onChange?.(state, reason); }
  function emitHistory() { options.onHistory?.({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoLabel: undoStack.at(-1)?.label || '', redoLabel: redoStack.at(-1)?.label || '', length: undoStack.length }); }
  function notify(message, tone = 'info') { options.onNotify?.(message, tone); }

  function recordMutation(before, label) {
    const after = snapshotOf(state);
    if (before === after) return false;
    undoStack.push({ label, before, after });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    emitHistory(); emitChange(label);
    return true;
  }

  function mutate(label, callback) {
    const before = snapshotOf(state);
    let result;
    try { result = callback(); }
    catch (error) { notify(error.message || String(error), 'error'); return null; }
    recordMutation(before, label);
    return result;
  }

  function restoreSnapshot(serialized, reason) {
    state = createCircuitState(JSON.parse(serialized));
    selection = null; selectedComponentIds.clear();
    renderAll(); emitSelection(); emitChange(reason); emitHistory();
  }

  function renderWire(wire) {
    let entry = wireEls.get(wire.id);
    if (!entry) {
      const group = svgEl('g', { class: 'wire-group', 'data-wire': wire.id });
      const hit = svgEl('path', { class: 'wire-hit', 'data-wire': wire.id });
      const path = svgEl('path', { class: `wire ${wire.kind}`, 'data-wire': wire.id });
      group.append(hit, path);
      wireLayer.appendChild(group);
      entry = { group, hit, path };
      wireEls.set(wire.id, entry);
      attachWireHandlers(hit, wire.id);
    }
    const d = pathToD(wire.points);
    entry.hit.setAttribute('d', d);
    entry.path.setAttribute('d', d);
    entry.path.setAttribute('class', `wire ${wire.kind}${selection?.kind === 'wire' && selection.id === wire.id ? ' selected' : ''}`);
    entry.group.classList.toggle('selected', selection?.kind === 'wire' && selection.id === wire.id);
  }

  function renderAllWires() {
    const ids = new Set(state.wires.map(wire => wire.id));
    for (const [id, entry] of wireEls) if (!ids.has(id)) { entry.group.remove(); wireEls.delete(id); }
    state.wires.forEach(renderWire);
  }

  function createComponentElement(component) {
    const def = COMPONENT_TYPES[component.type];
    const group = svgEl('g', {
      class: `component component-${component.type}`,
      'data-id': component.id,
      'data-component': def.label,
      tabindex: '0',
      role: 'button',
      'aria-label': `${def.label} ${component.id}`
    });
    // SVG only receives pointer events on painted geometry by default. Place an
    // invisible rectangle behind the symbol so the component's complete visual
    // footprint can be selected and dragged, including empty space between its
    // strokes. Pins are appended last and retain priority for wiring gestures.
    group.appendChild(svgEl('rect', {
      x: 0, y: 0, width: def.w, height: def.h,
      class: 'component-hitbox', 'aria-hidden': 'true'
    }));
    def.build(component).forEach(node => group.appendChild(node));
    def.pins.forEach(pin => {
      const terminal = svgEl('circle', { cx: pin.dx, cy: pin.dy, r: 5, class: `pin${pin.electrical ? ` ${pin.electrical}` : ''}`, 'data-pin': pin.id, 'data-ref': `${component.id}.${pin.id}` });
      const title = svgEl('title'); title.textContent = `${component.id}.${pin.id}${pin.name ? ` — ${pin.name}` : ''}`;
      terminal.appendChild(title);
      group.appendChild(terminal);
      attachPinHandlers(terminal, component.id, pin.id);
    });
    attachComponentHandlers(group, component.id);
    return group;
  }

  function positionComponentElement(group, component) {
    const def = COMPONENT_TYPES[component.type];
    group.setAttribute('transform', `translate(${component.x} ${component.y}) rotate(${component.rotation || 0} ${def.w / 2} ${def.h / 2})`);
    group.classList.toggle('selected', selectedComponentIds.has(component.id));
    group.classList.toggle('closed', Boolean(component.closed));
    const simulatedActive = Boolean(component._simOn ?? component.on) || Boolean(component._simRunning ?? component.running) ||
      Boolean(component._simEnergized ?? component.energized) || Boolean(component._simConducting) || Boolean(component._simHigh) || Boolean(component._simActive);
    group.classList.toggle('active', simulatedActive);
  }

  function renderComponent(component, rebuild = false) {
    let group = componentEls.get(component.id);
    if (!group || rebuild) {
      if (group) group.remove();
      group = createComponentElement(component);
      componentLayer.appendChild(group);
      componentEls.set(component.id, group);
    }
    positionComponentElement(group, component);
  }

  function renderAllComponents(rebuild = false) {
    const ids = new Set(state.components.map(component => component.id));
    for (const [id, group] of componentEls) if (!ids.has(id) || rebuild) { group.remove(); componentEls.delete(id); }
    state.components.forEach(component => renderComponent(component, rebuild));
  }

  function updateSelectionBox() {
    selectionLayer.innerHTML = '';
    state.components.filter(component => selectedComponentIds.has(component.id)).forEach(component => {
      const bounds = componentBounds(component), padding = 8;
      selectionLayer.appendChild(svgEl('rect', { x: bounds.x - padding, y: bounds.y - padding, width: bounds.w + padding * 2, height: bounds.h + padding * 2, rx: 5, 'data-selection-for': component.id }));
    });
  }

  function renderAll() {
    renderAllComponents(true);
    renderAllWires();
    updateSelectionBox();
  }

  function select(kind, id, mode = 'replace') {
    if (kind === 'component' && id) {
      if (mode === 'replace') selectedComponentIds.clear();
      if (mode === 'toggle') {
        if (selectedComponentIds.has(id)) selectedComponentIds.delete(id);
        else selectedComponentIds.add(id);
      } else selectedComponentIds.add(id);
      selection = selectedComponentIds.size ? { kind: 'component', id: selectedComponentIds.has(id) ? id : [...selectedComponentIds].at(-1) } : null;
    } else if (kind === 'wire' && id) {
      selectedComponentIds.clear(); selection = { kind: 'wire', id };
    } else {
      selectedComponentIds.clear(); selection = null;
    }
    renderAllComponents(); renderAllWires(); updateSelectionBox(); emitSelection();
  }

  function selectMany(ids, additive = false) {
    if (!additive) selectedComponentIds.clear();
    ids.forEach(id => { if (state.components.some(component => component.id === id)) selectedComponentIds.add(id); });
    selection = selectedComponentIds.size ? { kind: 'component', id: [...selectedComponentIds].at(-1) } : null;
    renderAllComponents(); renderAllWires(); updateSelectionBox(); emitSelection();
  }

  function attachComponentHandlers(group, componentId) {
    group.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.classList.contains('pin')) return;
      event.preventDefault(); event.stopPropagation();
      if (event.ctrlKey || event.metaKey) { select('component', componentId, 'toggle'); return; }
      if (event.shiftKey) { select('component', componentId, 'add'); return; }
      // Clicking an already-selected item preserves the group so all selected
      // components can be moved together. Clicking another item starts a new selection.
      if (!selectedComponentIds.has(componentId)) select('component', componentId);
      const component = state.components.find(item => item.id === componentId);
      if (!component) return;
      const selected = state.components.filter(item => selectedComponentIds.has(item.id));
      const startPositions = new Map(selected.map(item => [item.id, { x: item.x, y: item.y }]));
      const selectedBounds = selected.map(componentBounds);
      const groupBounds = {
        x: Math.min(...selectedBounds.map(bounds => bounds.x)),
        y: Math.min(...selectedBounds.map(bounds => bounds.y)),
        right: Math.max(...selectedBounds.map(bounds => bounds.x + bounds.w)),
        bottom: Math.max(...selectedBounds.map(bounds => bounds.y + bounds.h))
      };
      const before = snapshotOf(state), start = clientToSvg(svg, event.clientX, event.clientY);
      let moved = false, pendingDelta = null, animationFrame = null;
      let lastApplied = { x: 0, y: 0 };
      const constrainDelta = (rawX, rawY) => {
        // Snap the common delta, not each absolute position. This eliminates
        // the initial jump of components whose saved position is off-grid and
        // keeps every item in a multi-selection at the same relative offset.
        let dx = snap ? Math.round(rawX / GRID) * GRID : rawX;
        let dy = snap ? Math.round(rawY / GRID) * GRID : rawY;
        dx = Math.max(-groupBounds.x, Math.min(CANVAS_W - groupBounds.right, dx));
        dy = Math.max(-groupBounds.y, Math.min(CANVAS_H - groupBounds.bottom, dy));
        return { x: dx, y: dy };
      };
      const applyPendingDrag = () => {
        animationFrame = null;
        if (!pendingDelta) return;
        const delta = pendingDelta; pendingDelta = null;
        if (Math.abs(delta.x - lastApplied.x) < .01 && Math.abs(delta.y - lastApplied.y) < .01) return;
        lastApplied = delta; moved = Math.abs(delta.x) > .01 || Math.abs(delta.y) > .01;
        moveComponents(state, selected.map(item => {
          const origin = startPositions.get(item.id);
          return { id: item.id, x: origin.x + delta.x, y: origin.y + delta.y };
        }), false);
        selected.forEach(item => positionComponentElement(componentEls.get(item.id), item));
        renderAllWires(); updateSelectionBox();
      };
      group.setPointerCapture?.(event.pointerId);
      svg.classList.add('component-dragging');
      selected.forEach(item => componentEls.get(item.id)?.classList.add('dragging'));
      const onMove = moveEvent => {
        const current = clientToSvg(svg, moveEvent.clientX, moveEvent.clientY);
        const rawX = current.x - start.x, rawY = current.y - start.y;
        if (!moved && Math.hypot(rawX, rawY) < 2 / zoom) return;
        pendingDelta = constrainDelta(rawX, rawY);
        if (animationFrame === null) animationFrame = requestAnimationFrame(applyPendingDrag);
      };
      const onEnd = endEvent => {
        if (animationFrame !== null) { cancelAnimationFrame(animationFrame); animationFrame = null; }
        if (endEvent.type === 'pointercancel') {
          pendingDelta = null; moved = false;
          moveComponents(state, selected.map(item => ({ id: item.id, ...startPositions.get(item.id) })), false);
          selected.forEach(item => positionComponentElement(componentEls.get(item.id), item));
          renderAllWires(); updateSelectionBox();
        } else applyPendingDrag();
        if (group.hasPointerCapture?.(endEvent.pointerId)) group.releasePointerCapture(endEvent.pointerId);
        svg.classList.remove('component-dragging');
        selected.forEach(item => componentEls.get(item.id)?.classList.remove('dragging'));
        group.removeEventListener('pointermove', onMove);
        group.removeEventListener('pointerup', onEnd);
        group.removeEventListener('pointercancel', onEnd);
        emitSelection();
        if (moved) recordMutation(before, selected.length > 1 ? `Move ${selected.length} components` : `Move ${component.id}`);
      };
      group.addEventListener('pointermove', onMove);
      group.addEventListener('pointerup', onEnd);
      group.addEventListener('pointercancel', onEnd);
    });
    group.addEventListener('dblclick', event => {
      event.preventDefault();
      const component = state.components.find(item => item.id === componentId);
      if (!component) return;
      if (['binary-counter', 'shift-register'].includes(component.type)) {
        mutate(`Advance ${component.id}`, () => {
          component.value = ((Number(component.value) || 0) + 1) % 16;
          renderAllComponents(true); emitSelection();
        });
        return;
      }
      const directToggle = { 'logic-input': 'high', 'clock-generator': 'high', 'd-flip-flop': 'q', 'jk-flip-flop': 'q', 'sr-latch': 'q', 'function-generator': 'enabled', 'hall-sensor': 'magneticField' }[component.type];
      const key = component.type === 'switch-spdt' ? 'position' : (directToggle || (Object.hasOwn(component, 'closed') ? 'closed' : Object.hasOwn(component, 'energized') ? 'energized' : null));
      if (!key) return;
      mutate(`Toggle ${component.id}`, () => {
        component[key] = key === 'position' ? (component.position === 'A' ? 'B' : 'A') : !component[key];
        renderAllComponents(true); emitSelection();
      });
    });
  }

  function attachPinHandlers(pinElement, componentId, pinId) {
    pinElement.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const component = state.components.find(item => item.id === componentId);
      const pin = component && findPin(component, pinId);
      if (!component || !pin) return;
      const fromRef = `${componentId}.${pinId}`, from = pinPosition(component, pin);
      const preview = svgEl('path', { class: 'wire wire-preview' });
      previewLayer.appendChild(preview);
      pinElement.classList.add('wiring');
      const pointerId = event.pointerId;
      const isActivePointer = pointerEvent => pointerId == null || pointerEvent.pointerId === pointerId;
      const onMove = moveEvent => {
        if (!isActivePointer(moveEvent)) return;
        const point = clientToSvg(svg, moveEvent.clientX, moveEvent.clientY);
        const middleX = from.x + (point.x - from.x) / 2;
        preview.setAttribute('d', pathToD([from, { x: middleX, y: from.y }, { x: middleX, y: point.y }, point]));
      };
      const cleanup = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        preview.remove(); pinElement.classList.remove('wiring');
      };
      const onEnd = endEvent => {
        if (!isActivePointer(endEvent)) return;
        cleanup();
        if (endEvent.type === 'pointercancel') return;
        const target = document.elementFromPoint(endEvent.clientX, endEvent.clientY)?.closest?.('.pin');
        const toRef = target?.dataset.ref;
        if (!toRef || toRef === fromRef) return;
        const wire = mutate('Connect wire', () => addWire(state, fromRef, toRef));
        if (wire) { renderAllWires(); select('wire', wire.id); }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    });
  }

  function attachWireHandlers(hit, wireId) {
    hit.addEventListener('pointermove', event => {
      if (hit.classList.contains('dragging-active')) return;
      const wire = state.wires.find(item => item.id === wireId);
      if (!wire || wire.points.length < 2) return;
      const point = clientToSvg(svg, event.clientX, event.clientY);
      const index = nearestSegment(wire.points, point);
      hit.style.cursor = Math.abs(wire.points[index].y - wire.points[index + 1].y) < 0.01 ? 'ns-resize' : 'ew-resize';
    });
    hit.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      select('wire', wireId);
      const wire = state.wires.find(item => item.id === wireId);
      if (!wire || wire.points.length < 2) return;
      const before = snapshotOf(state), start = clientToSvg(svg, event.clientX, event.clientY);
      const segmentIndex = nearestSegment(wire.points, start), original = wire.points.map(point => ({ ...point }));
      const originalManual = wire.manual;
      let moved = false;
      hit.setPointerCapture?.(event.pointerId); hit.classList.add('dragging-active');
      const onMove = moveEvent => {
        const current = clientToSvg(svg, moveEvent.clientX, moveEvent.clientY);
        let dx = current.x - start.x, dy = current.y - start.y;
        if (snap) { dx = Math.round(dx / GRID) * GRID; dy = Math.round(dy / GRID) * GRID; }
        moved = Math.abs(dx) + Math.abs(dy) >= 0.1;
        wire.points = moved ? dragSegment(original, segmentIndex, dx, dy) : original.map(point => ({ ...point }));
        wire.manual = moved ? true : originalManual;
        renderWire(wire);
      };
      const onEnd = endEvent => {
        if (hit.hasPointerCapture?.(endEvent.pointerId)) hit.releasePointerCapture(endEvent.pointerId);
        hit.classList.remove('dragging-active');
        hit.removeEventListener('pointermove', onMove);
        hit.removeEventListener('pointerup', onEnd);
        hit.removeEventListener('pointercancel', onEnd);
        if (endEvent.type === 'pointercancel') {
          wire.points = original.map(point => ({ ...point }));
          wire.manual = originalManual;
          moved = false;
          renderWire(wire);
        }
        emitSelection();
        if (moved) recordMutation(before, `Route ${wire.id}`);
      };
      hit.addEventListener('pointermove', onMove);
      hit.addEventListener('pointerup', onEnd);
      hit.addEventListener('pointercancel', onEnd);
    });
  }

  function addComponent(type, x = CANVAS_W / 2, y = CANVAS_H / 2) {
    return mutate(`Add ${COMPONENT_TYPES[type]?.label || type}`, () => {
      const def = COMPONENT_TYPES[type];
      if (!def) throw new Error('Unknown component');
      const component = addStateComponent(state, type, x - def.w / 2, y - def.h / 2);
      renderAll(); select('component', component.id);
      return component;
    });
  }

  function updateSelected(changes) {
    if (!selection && !selectedComponentIds.size) return null;
    if (selectedComponentIds.size > 1) {
      return mutate(`Edit ${selectedComponentIds.size} components`, () => {
        const safeChanges = { ...changes }; delete safeChanges.id; delete safeChanges.x; delete safeChanges.y;
        const items = state.components.filter(component => selectedComponentIds.has(component.id));
        items.forEach(component => updateComponent(state, component.id, safeChanges));
        renderAll(); emitSelection();
        return items;
      });
    }
    if (selection.kind === 'wire') {
      const wire = state.wires.find(item => item.id === selection.id);
      if (!wire) return null;
      return mutate(`Edit ${wire.id}`, () => {
        if (changes.kind) wire.kind = changes.kind;
        if (changes.automatic === true) routeWire(state, wire, state.wires.filter(item => item !== wire).map(item => item.points));
        renderAllWires(); emitSelection();
        return wire;
      });
    }
    const oldId = selection.id;
    return mutate(`Edit ${oldId}`, () => {
      const component = updateComponent(state, oldId, changes);
      if (!component) return null;
      if (component.id !== oldId) { selectedComponentIds.delete(oldId); selectedComponentIds.add(component.id); }
      selection.id = component.id;
      renderAll(); emitSelection();
      return component;
    });
  }

  function deleteSelected() {
    const selected = selectionValue();
    if (!selected) return false;
    return Boolean(mutate(selected.kind === 'components' ? `Delete ${selected.items.length} components` : `Delete ${selected.item.id}`, () => {
      let removed = false;
      if (selected.kind === 'components') {
        selected.items.forEach(component => { removed = removeComponent(state, component.id) || removed; });
      } else if (selected.kind === 'component') removed = removeComponent(state, selected.item.id);
      else removed = removeWire(state, selected.item.id);
      if (!removed) return false;
      selection = null; selectedComponentIds.clear(); renderAll(); emitSelection();
      return selected;
    }));
  }

  function copySelected() {
    const selected = selectionValue();
    if (!selected) return false;
    if (selected.kind === 'components') {
      const ids = new Set(selected.items.map(component => component.id));
      const internalWires = state.wires.filter(wire => ids.has(wire.from.slice(0, wire.from.lastIndexOf('.'))) && ids.has(wire.to.slice(0, wire.to.lastIndexOf('.'))));
      clipboard = { kind: 'components', items: structuredClone(selected.items), wires: structuredClone(internalWires) };
      notify(`${selected.items.length} components copied`, 'success');
    } else {
      clipboard = structuredClone(selected);
      notify(`${selected.item.id} copied`, 'success');
    }
    pasteOffset = 0;
    return true;
  }

  function paste() {
    if (!clipboard) { notify('Nothing to paste', 'warning'); return null; }
    if (clipboard.kind === 'wire') { notify('Copy components rather than an individual wire', 'warning'); return null; }
    pasteOffset += GRID;
    const sources = clipboard.kind === 'components' ? clipboard.items : [clipboard.item];
    return mutate(`Paste ${sources.length > 1 ? `${sources.length} components` : sources[0].id}`, () => {
      const idMap = new Map(), pasted = [];
      sources.forEach(source => {
        const component = addStateComponent(state, source.type, source.x + pasteOffset, source.y + pasteOffset);
        const id = component.id;
        idMap.set(source.id, id);
        Object.assign(component, structuredClone(source), { id, x: source.x + pasteOffset, y: source.y + pasteOffset });
        moveComponent(state, id, component.x, component.y, snap);
        pasted.push(component);
      });
      (clipboard.wires || []).forEach(sourceWire => {
        const remap = ref => {
          const dot = ref.lastIndexOf('.'), oldId = ref.slice(0, dot);
          return `${idMap.get(oldId)}${ref.slice(dot)}`;
        };
        addWire(state, remap(sourceWire.from), remap(sourceWire.to), sourceWire.kind);
      });
      renderAll(); selectMany(pasted.map(component => component.id));
      return pasted.length === 1 ? pasted[0] : pasted;
    });
  }

  function duplicateSelected() { if (!copySelected()) return null; return paste(); }
  function cutSelected() { if (!copySelected()) return false; return deleteSelected(); }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return false;
    redoStack.push(entry); restoreSnapshot(entry.before, `Undo ${entry.label}`); return true;
  }
  function redo() {
    const entry = redoStack.pop();
    if (!entry) return false;
    undoStack.push(entry); restoreSnapshot(entry.after, `Redo ${entry.label}`); return true;
  }
  function clearHistory() { undoStack.length = 0; redoStack.length = 0; emitHistory(); notify('History cleared', 'success'); }

  function exportSession() {
    return {
      circuit: JSON.parse(snapshotOf(state)),
      undoStack: structuredClone(undoStack),
      redoStack: structuredClone(redoStack),
      view: { grid, snap, zoom, panMode, center: { ...viewCenter } }
    };
  }

  function loadSession(session) {
    const source = session?.circuit || session;
    state = createCircuitState(normalizeCircuitData(source));
    undoStack.splice(0, undoStack.length, ...structuredClone(session?.undoStack || []));
    redoStack.splice(0, redoStack.length, ...structuredClone(session?.redoStack || []));
    if (session?.view) {
      grid = session.view.grid ?? grid;
      snap = session.view.snap ?? snap;
      zoom = session.view.zoom ?? 1;
      panMode = session.view.panMode ?? false;
      viewCenter = { ...(session.view.center || { x: CANVAS_W / 2, y: CANVAS_H / 2 }) };
    } else {
      zoom = 1; viewCenter = { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    }
    selection = null; selectedComponentIds.clear();
    renderAll(); setGrid(grid); applyView(); emitSelection(); emitHistory(); emitChange('document');
    return state;
  }

  function replaceCircuit(data, label = 'Open circuit') {
    const next = normalizeCircuitData(data), before = snapshotOf(state);
    state = createCircuitState(next); selection = null; selectedComponentIds.clear(); renderAll(); emitSelection(); recordMutation(before, label); return state;
  }
  function newCircuit() { return replaceCircuit({ version: 2, name: 'untitled', components: [], wires: [] }, 'New circuit'); }

  function autoLayout(scope = 'all') {
    const ids = scope === 'selection' ? [...selectedComponentIds] : state.components.map(component => component.id);
    if (!ids.length) { notify(scope === 'selection' ? 'Select two or more components to arrange' : 'The circuit has no components to arrange', 'warning'); return { count: 0, groups: 0 }; }
    return mutate(scope === 'selection' ? `Auto-layout ${ids.length} components` : 'Auto-layout diagram', () => {
      const result = autoLayoutCircuit(state, ids, { width: CANVAS_W, height: CANVAS_H });
      // A component relocation changes the obstacle map for every net, so the
      // full wire set is routed again after either global or selected layout.
      optimizeAllWires(state);
      renderAll(); emitSelection();
      ids.forEach(id => {
        const group = componentEls.get(id);
        if (!group) return;
        group.classList.remove('layout-pulse');
        requestAnimationFrame(() => {
          group.classList.add('layout-pulse');
          setTimeout(() => group.classList.remove('layout-pulse'), 750);
        });
      });
      return result;
    });
  }

  function optimizeRouting(scope = 'all') {
    const selectedIds = new Set(selectedComponentIds);
    let targets = state.wires;
    if (scope === 'selection') {
      if (selection?.kind === 'wire') targets = state.wires.filter(wire => wire.id === selection.id);
      else if (selectedIds.size) targets = state.wires.filter(wire => {
        const fromId = wire.from.slice(0, wire.from.lastIndexOf('.'));
        const toId = wire.to.slice(0, wire.to.lastIndexOf('.'));
        return selectedIds.has(fromId) || selectedIds.has(toId);
      });
      else targets = [];
    }
    if (!targets.length) { notify('No connected wires to route', 'warning'); return { routed: 0, changed: 0 }; }
    const previous = new Map(targets.map(wire => [wire.id, { path: pathToD(wire.points), manual: wire.manual }]));
    const label = targets.length === state.wires.length ? 'Auto-route all wires' : `Auto-route ${targets.length} selected wire${targets.length === 1 ? '' : 's'}`;
    return mutate(label, () => {
      if (targets.length === state.wires.length) optimizeAllWires(state);
      else {
        const targetIds = new Set(targets.map(wire => wire.id));
        const occupied = state.wires.filter(wire => !targetIds.has(wire.id)).map(wire => wire.points);
        targets.forEach(wire => { if (routeWire(state, wire, occupied)) occupied.push(wire.points); });
      }
      const changed = targets.filter(wire => previous.get(wire.id)?.path !== pathToD(wire.points) || previous.get(wire.id)?.manual).length;
      renderAllWires(); emitSelection();
      // Animate every processed net, including an already-optimal net, so the
      // user gets clear feedback that the routing command actually ran.
      targets.forEach(wire => {
        const path = wireEls.get(wire.id)?.path;
        if (!path) return;
        path.classList.remove('route-pulse');
        requestAnimationFrame(() => {
          path.classList.add('route-pulse');
          setTimeout(() => path.classList.remove('route-pulse'), 700);
        });
      });
      return { routed: targets.length, changed };
    });
  }
  function clearWires() { return mutate('Clear wires', () => { state.wires = []; selection = null; selectedComponentIds.clear(); renderAll(); emitSelection(); }); }

  function validateCircuit() {
    const errors = [], warnings = [];
    state.wires.forEach(wire => {
      if (!wire.points?.length) errors.push(`${wire.id}: no route`);
      if (!state.components.some(component => wire.from.startsWith(`${component.id}.`))) errors.push(`${wire.id}: invalid source`);
      if (!state.components.some(component => wire.to.startsWith(`${component.id}.`))) errors.push(`${wire.id}: invalid destination`);
    });
    state.components.forEach(component => {
      const connected = state.wires.some(wire => wire.from.startsWith(`${component.id}.`) || wire.to.startsWith(`${component.id}.`));
      if (!connected && !['ground', 'vcc'].includes(component.type)) warnings.push(`${component.id}: not connected`);
    });
    return { errors, warnings };
  }

  function setComponentPosition(id, x, y) {
    const component = state.components.find(item => item.id === id);
    if (!component) return null;
    const before = snapshotOf(state);
    moveComponent(state, id, x, y, false); renderAll(); emitSelection(); recordMutation(before, `Move ${id}`); return component;
  }

  function setGrid(value) { grid = Boolean(value); svg.querySelector('.grid-bg')?.setAttribute('opacity', grid ? '1' : '0'); emitChange('view'); }
  function setSnap(value) { snap = Boolean(value); emitChange('view'); }
  function clampViewCenter() {
    const width = CANVAS_W / zoom, height = CANVAS_H / zoom;
    // Keep at least part of the drawing sheet reachable while allowing useful
    // overscroll around it at high zoom levels.
    viewCenter.x = Math.max(-120 + Math.min(width / 2, CANVAS_W / 2), Math.min(CANVAS_W + 120 - Math.min(width / 2, CANVAS_W / 2), viewCenter.x));
    viewCenter.y = Math.max(-100 + Math.min(height / 2, CANVAS_H / 2), Math.min(CANVAS_H + 100 - Math.min(height / 2, CANVAS_H / 2), viewCenter.y));
  }
  function applyView() {
    clampViewCenter();
    const width = CANVAS_W / zoom, height = CANVAS_H / zoom;
    svg.setAttribute('viewBox', `${viewCenter.x - width / 2} ${viewCenter.y - height / 2} ${width} ${height}`);
    svg.classList.toggle('pan-mode', panMode);
  }
  function setZoom(value, focalClientPoint = null) {
    const before = focalClientPoint ? clientToSvg(svg, focalClientPoint.x, focalClientPoint.y) : null;
    zoom = Math.max(0.35, Math.min(4, Number(value) || 1));
    applyView();
    if (before && focalClientPoint) {
      const after = clientToSvg(svg, focalClientPoint.x, focalClientPoint.y);
      viewCenter.x += before.x - after.x;
      viewCenter.y += before.y - after.y;
      applyView();
    }
    emitChange('view');
    return zoom;
  }
  function setPanMode(value) { panMode = Boolean(value); applyView(); emitChange('view'); return panMode; }
  function fitView() {
    if (!state.components.length) { viewCenter = { x: CANVAS_W / 2, y: CANVAS_H / 2 }; zoom = 1; applyView(); emitChange('view'); return zoom; }
    const bounds = state.components.map(componentBounds);
    const minX = Math.min(...bounds.map(item => item.x)), minY = Math.min(...bounds.map(item => item.y));
    const maxX = Math.max(...bounds.map(item => item.x + item.w)), maxY = Math.max(...bounds.map(item => item.y + item.h));
    const padding = 80, contentWidth = Math.max(120, maxX - minX + padding * 2), contentHeight = Math.max(100, maxY - minY + padding * 2);
    const rect = svg.getBoundingClientRect();
    const aspect = rect.width && rect.height ? rect.width / rect.height : CANVAS_W / CANVAS_H;
    const fittedWidth = Math.max(contentWidth, contentHeight * aspect);
    zoom = Math.max(0.35, Math.min(4, CANVAS_W / fittedWidth));
    viewCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    applyView(); emitChange('view'); return zoom;
  }

  function setSimulationResult(result = null) {
    state.components.forEach(component => {
      Object.keys(component).filter(key => key.startsWith('_sim')).forEach(key => delete component[key]);
      if (!result) return;
      if (['led', 'lamp', 'buzzer', 'speaker', 'solenoid'].includes(component.type)) component._simOn = result.poweredComponents.has(component.id);
      if (['motor', 'stepper-motor', 'servo'].includes(component.type)) component._simRunning = result.poweredComponents.has(component.id);
      if (['relay', 'relay-spdt'].includes(component.type)) component._simEnergized = result.energizedRelays.has(component.id);
      if (['transistor-npn', 'transistor-pnp', 'nmos', 'pmos', 'scr', 'triac', 'optocoupler'].includes(component.type)) component._simConducting = result.conductingSemiconductors.has(component.id);
      component._simHigh = Boolean(result.highOutputComponents?.has(component.id));
      if (result.measurements?.has(component.id)) {
        component._simReading = result.measurements.get(component.id);
        component._simCaption = component._simReading;
        component._simActive = !/^0(?:\.0+)?\s/.test(component._simReading);
      }
      if (result.signalStates?.has(component.id)) {
        component._simChannels = [...result.signalStates.get(component.id)];
        component._simActive = component._simChannels.some(Boolean);
      }
      if (result.segmentStates?.has(component.id)) {
        component._simSegments = [...result.segmentStates.get(component.id)];
        component._simActive = component._simSegments.length > 0;
      }
      if (result.digitalStates?.has(component.id)) component._simQ = result.digitalStates.get(component.id);
    });
    renderAllComponents(true);
    state.wires.forEach(wire => wireEls.get(wire.id)?.path.classList.toggle('active', Boolean(result?.activeWires.has(wire.id))));
  }

  // Backward-compatible helper used by older adapters.
  function setOutputState(on) {
    if (!on) return setSimulationResult(null);
    setSimulationResult({
      poweredComponents: new Set(state.components.filter(component => ['led', 'lamp', 'motor', 'buzzer'].includes(component.type)).map(component => component.id)),
      energizedRelays: new Set(), conductingSemiconductors: new Set(), activeWires: new Set(state.wires.map(wire => wire.id))
    });
  }

  // Canvas navigation: hand tool, middle-button drag or Space + left drag.
  document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
      spacePressed = true;
      svg.classList.add('space-pan');
      event.preventDefault();
    }
  });
  document.addEventListener('keyup', event => {
    if (event.code === 'Space') { spacePressed = false; svg.classList.remove('space-pan'); }
  });
  window.addEventListener('blur', () => { spacePressed = false; svg.classList.remove('space-pan'); });

  svg.addEventListener('pointerdown', event => {
    const shouldPan = event.button === 1 || (event.button === 0 && (panMode || spacePressed));
    if (!shouldPan) return;
    event.preventDefault(); event.stopPropagation();
    const startClient = { x: event.clientX, y: event.clientY };
    const startCenter = { ...viewCenter };
    const rect = svg.getBoundingClientRect();
    const unitsX = (CANVAS_W / zoom) / Math.max(1, rect.width);
    const unitsY = (CANVAS_H / zoom) / Math.max(1, rect.height);
    svg.setPointerCapture(event.pointerId); svg.classList.add('panning');
    const onMove = moveEvent => {
      viewCenter.x = startCenter.x - (moveEvent.clientX - startClient.x) * unitsX;
      viewCenter.y = startCenter.y - (moveEvent.clientY - startClient.y) * unitsY;
      applyView(); options.onViewChange?.({ grid, snap, zoom, panMode, center: { ...viewCenter } });
    };
    const onEnd = endEvent => {
      if (svg.hasPointerCapture(endEvent.pointerId)) svg.releasePointerCapture(endEvent.pointerId);
      svg.classList.remove('panning');
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onEnd);
      svg.removeEventListener('pointercancel', onEnd);
      emitChange('view');
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onEnd);
    svg.addEventListener('pointercancel', onEnd);
  }, true);

  svg.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.shiftKey) {
      viewCenter.x += event.deltaY / zoom;
      applyView(); emitChange('view');
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0015);
    setZoom(zoom * factor, { x: event.clientX, y: event.clientY });
    options.onViewChange?.({ grid, snap, zoom, panMode, center: { ...viewCenter } });
  }, { passive: false });

  // Drag an empty part of the sheet to select every component intersecting
  // the marquee. Shift/Ctrl adds the marquee result to the current selection.
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target !== svg && !event.target.classList.contains('grid-bg'))) return;
    event.preventDefault();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!additive) select(null, null);
    const start = clientToSvg(svg, event.clientX, event.clientY);
    const marquee = svgEl('rect', { x: start.x, y: start.y, width: 0, height: 0, class: 'marquee-rect' });
    selectionLayer.appendChild(marquee);
    let moved = false, current = start;
    svg.setPointerCapture(event.pointerId);
    const onMove = moveEvent => {
      current = clientToSvg(svg, moveEvent.clientX, moveEvent.clientY);
      moved = moved || Math.hypot(current.x - start.x, current.y - start.y) > 3;
      marquee.setAttribute('x', Math.min(start.x, current.x));
      marquee.setAttribute('y', Math.min(start.y, current.y));
      marquee.setAttribute('width', Math.abs(current.x - start.x));
      marquee.setAttribute('height', Math.abs(current.y - start.y));
    };
    const onEnd = endEvent => {
      if (svg.hasPointerCapture(endEvent.pointerId)) svg.releasePointerCapture(endEvent.pointerId);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onEnd);
      svg.removeEventListener('pointercancel', onEnd);
      marquee.remove();
      if (!moved) { if (!additive) select(null, null); return; }
      const area = { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y) };
      const ids = state.components.filter(component => {
        const bounds = componentBounds(component);
        return bounds.x <= area.x + area.w && bounds.x + bounds.w >= area.x && bounds.y <= area.y + area.h && bounds.y + bounds.h >= area.y;
      }).map(component => component.id);
      selectMany(ids, additive);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onEnd);
    svg.addEventListener('pointercancel', onEnd);
  });

  renderAll(); applyView(); emitHistory();

  return {
    get state() { return state; },
    addComponent,
    autoLayout,
    clearHistory,
    clearWires,
    copySelected,
    cutSelected,
    deleteSelected,
    duplicateSelected,
    exportJSON: () => serializeCircuit(state),
    exportObject: () => JSON.parse(serializeCircuit(state)),
    exportSession,
    fitView,
    getHistory: () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, undoLabel: undoStack.at(-1)?.label || '', redoLabel: redoStack.at(-1)?.label || '', length: undoStack.length }),
    getSelected: selectionValue,
    getView: () => ({ grid, snap, zoom, panMode, center: { ...viewCenter } }),
    getZoom: () => zoom,
    loadCircuit: replaceCircuit,
    loadSession,
    newCircuit,
    optimizeRouting,
    paste,
    redo,
    renameComponent: (oldId, nextId) => mutate(`Rename ${oldId}`, () => renameComponent(state, oldId, nextId)),
    screenToCanvas: (x, y) => clientToSvg(svg, x, y),
    selectAll: () => selectMany(state.components.map(component => component.id)),
    clearSelection: () => select(null, null),
    selectComponent: (id, additive = false) => select('component', id, additive ? 'add' : 'replace'),
    setComponentPos: setComponentPosition,
    setGrid,
    setLedOn: setOutputState,
    setOutputState,
    setSimulationResult,
    setPanMode,
    setSnap,
    setZoom,
    undo,
    updateSelected,
    validateCircuit,
    wireEl: id => wireEls.get(id)?.path || null
  };
}
