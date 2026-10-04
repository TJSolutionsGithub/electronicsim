import { createDemoEngine } from './src/core/simulationEngine.js';
import { createCanvasController } from './src/core/canvasController.js';
import { COMPONENT_CATALOG, COMPONENT_TYPES, createDefaultProperties } from './src/core/componentDefs.js';
import { CIRCUIT_EXAMPLES } from './src/core/examples.js';
import { normalizeCircuitData } from './src/core/circuitState.js';
import { evaluateCircuit } from './src/core/circuitEvaluator.js';
import { buildSpiceNetlist, runSpiceOperatingPoint } from './src/core/spiceEngine.js';

export function initCircuitLab() {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const engine = createDemoEngine();
  let simStatus = 'stopped', timer = null, currentPanel = 'explorer', lastSimulationResult = null;
  let spicePhase = 'idle', spiceDetail = '', spiceGeneration = 0, spiceTimer = null, announcedSpiceReady = false;
  let historyState = { canUndo: false, canRedo: false, length: 0 };
  let openMenuName = null, documentCounter = 0, activeDocumentId = null;
  const documents = [];

  function activeDocument() { return documents.find(document => document.id === activeDocumentId) || null; }

  function toast(message, tone = 'info') {
    const item = document.createElement('div');
    item.className = `toast ${tone}`;
    item.textContent = message;
    $('#toastArea').appendChild(item);
    requestAnimationFrame(() => item.classList.add('visible'));
    setTimeout(() => { item.classList.remove('visible'); setTimeout(() => item.remove(), 220); }, 2800);
  }

  function log(message, tone = 'ok') {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('.log').innerHTML = `<span class="log-time">${now}</span><span class="${tone}">${tone === 'ok' ? '✓' : '!'}</span> ${escapeHtml(message)} <span class="cursor">▌</span>`;
  }

  function markDirty(value = true) {
    const document = activeDocument();
    if (document) document.dirty = value;
    $('.modified').textContent = value ? '●' : '✓';
    $('.modified').classList.toggle('saved', !value);
    $$('.dirty-mark').forEach(mark => { mark.style.visibility = value ? 'visible' : 'hidden'; });
    renderDocumentTabs();
    if (document) updateFileName();
  }

  const canvas = createCanvasController($('#circuit'), {
    onSelect(selected) { updateInspector(selected); updateBenchMeter(lastSimulationResult, selected); },
    onNotify: toast,
    onHistory(next) {
      historyState = next;
      $('#historySummary').textContent = next.length ? `${next.length} change${next.length === 1 ? '' : 's'} · ${next.undoLabel}` : 'No changes yet';
      refreshOpenMenu();
    },
    onChange(state, reason) {
      const document = activeDocument();
      if (document) document.session = canvas.exportSession();
      if (!['view', 'document'].includes(reason)) markDirty(true);
      updateWorkspaceSummary();
      syncViewControls();
      if (simStatus === 'running') applySimulationOutputs(true);
    },
    onViewChange() { syncViewControls(); }
  });
  const initialCircuit = canvas.exportJSON();
  documents.push({ id: `document-${++documentCounter}`, name: 'main', dirty: false, session: canvas.exportSession() });
  activeDocumentId = documents[0].id;

  // ---------- Component library ----------
  function mountCatalogSymbol(slot, type) {
    const def = COMPONENT_TYPES[type];
    if (!def) return;
    const ns = 'http://www.w3.org/2000/svg';
    const preview = document.createElementNS(ns, 'svg');
    preview.setAttribute('viewBox', `${-4} ${-4} ${def.w + 8} ${def.h + 8}`);
    preview.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    preview.setAttribute('class', `catalog-symbol component component-${type}`);
    const instance = { id: def.prefix, type, ...createDefaultProperties(type) };
    def.build(instance).forEach(node => preview.appendChild(node));
    def.pins.forEach(pin => {
      const terminal = document.createElementNS(ns, 'circle');
      terminal.setAttribute('cx', pin.dx); terminal.setAttribute('cy', pin.dy); terminal.setAttribute('r', '4'); terminal.setAttribute('class', 'pin');
      preview.appendChild(terminal);
    });
    slot.replaceChildren(preview);
  }

  let collapsedComponentGroups = new Set();
  try { collapsedComponentGroups = new Set(JSON.parse(localStorage.getItem('circuitlab-collapsed-component-groups') || '[]')); } catch { collapsedComponentGroups = new Set(); }
  const saveCollapsedGroups = () => localStorage.setItem('circuitlab-collapsed-component-groups', JSON.stringify([...collapsedComponentGroups]));

  function renderComponents(filter = '') {
    const query = filter.trim().toLowerCase();
    const groups = COMPONENT_CATALOG.map(group => ({
      ...group,
      items: group.types.map(type => ({ type, def: COMPONENT_TYPES[type] })).filter(({ def }) => !query || `${def.label} ${def.prefix} ${def.category}`.toLowerCase().includes(query))
    })).filter(group => group.items.length);
    const accordion = groups.map(group => {
      const open = Boolean(query) || !collapsedComponentGroups.has(group.name);
      const items = group.items.map(({ type, def }) => `<div class="component-item" draggable="true" data-type="${type}" title="Drag ${escapeHtml(def.label)} to the canvas"><span class="comp-symbol" data-symbol="${type}" aria-hidden="true"></span><span class="comp-name">${escapeHtml(def.label)}</span><small>${escapeHtml(def.prefix)}</small><button class="component-add" data-add="${type}" title="Add ${escapeHtml(def.label)}">＋</button></div>`).join('');
      return `<details class="library-group" data-component-group="${escapeHtml(group.name)}" ${open ? 'open' : ''}><summary class="comp-group"><i aria-hidden="true">›</i><b>${escapeHtml(group.name)}</b><span>${group.items.length}</span></summary><div class="library-items">${items}</div></details>`;
    }).join('');
    $('#componentList').innerHTML = groups.length ? `<div class="catalog-accordion-actions"><button data-expand-groups>Expand all</button><button data-collapse-groups>Collapse all</button></div>${accordion}` : '<p class="empty-library">No matching components</p>';

    $$('[data-component-group]').forEach(details => details.querySelector('summary')?.addEventListener('click', () => {
      if (query) return;
      // The native <details> state changes after the summary click event, so
      // `open` here describes the previous state and lets us persist the
      // user's intended next state without reacting to initialization toggles.
      if (details.open) collapsedComponentGroups.add(details.dataset.componentGroup);
      else collapsedComponentGroups.delete(details.dataset.componentGroup);
      saveCollapsedGroups();
    }));
    $('[data-expand-groups]')?.addEventListener('click', () => { collapsedComponentGroups.clear(); saveCollapsedGroups(); renderComponents(filter); });
    $('[data-collapse-groups]')?.addEventListener('click', () => { COMPONENT_CATALOG.forEach(group => collapsedComponentGroups.add(group.name)); saveCollapsedGroups(); renderComponents(filter); });

    $$('[data-symbol]').forEach(slot => mountCatalogSymbol(slot, slot.dataset.symbol));
    $$('.component-item').forEach(item => {
      item.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-circuit-component', item.dataset.type);
        event.dataTransfer.setData('text/plain', item.dataset.type);
        item.classList.add('drag-source');
      });
      item.addEventListener('dragend', () => item.classList.remove('drag-source'));
      item.addEventListener('dblclick', event => { if (!event.target.closest('button')) canvas.addComponent(item.dataset.type); });
    });
    $$('.component-add').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      canvas.addComponent(button.dataset.add, 500, 300);
    }));
  }

  function renderExamples(filter = '') {
    const query = filter.trim().toLowerCase();
    const matches = CIRCUIT_EXAMPLES.filter(example => !query || `${example.title} ${example.category} ${example.description} ${example.difficulty}`.toLowerCase().includes(query));
    $('#exampleList').innerHTML = matches.map(example => `<article class="example-card" data-example="${example.id}"><div class="example-card-head"><span class="example-icon">${example.circuit.components.slice(0, 4).map(component => escapeHtml(COMPONENT_TYPES[component.type].icon)).join(' · ')}</span><small>${escapeHtml(example.difficulty)}</small></div><strong>${escapeHtml(example.title)}</strong><span>${escapeHtml(example.category)} · ${example.circuit.components.length} components</span><p>${escapeHtml(example.description)}</p><button data-open-example="${example.id}">Open in new tab</button></article>`).join('') || '<p class="empty-library">No matching examples</p>';
    $$('[data-open-example]').forEach(button => button.addEventListener('click', () => openExample(button.dataset.openExample)));
  }

  renderComponents();
  renderExamples();
  $('#componentSearch').addEventListener('input', event => renderComponents(event.target.value));
  $('#exampleSearch').addEventListener('input', event => renderExamples(event.target.value));
  $('#canvasWrap').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('#canvasWrap').classList.add('drop-target'); });
  $('#canvasWrap').addEventListener('dragleave', event => { if (!$('#canvasWrap').contains(event.relatedTarget)) $('#canvasWrap').classList.remove('drop-target'); });
  $('#canvasWrap').addEventListener('drop', event => {
    event.preventDefault(); $('#canvasWrap').classList.remove('drop-target');
    const type = event.dataTransfer.getData('application/x-circuit-component') || event.dataTransfer.getData('text/plain');
    if (!COMPONENT_TYPES[type]) return;
    const point = canvas.screenToCanvas(event.clientX, event.clientY);
    canvas.addComponent(type, point.x, point.y);
  });

  // ---------- Panels and inspector ----------
  function showPanel(panel) {
    currentPanel = ['components', 'examples', 'code'].includes(panel) ? panel : 'explorer';
    const titles = { explorer: 'EXPLORER', components: 'COMPONENTS', examples: 'EXAMPLES', code: 'SOURCE' };
    $('#panelTitle').textContent = titles[currentPanel];
    ['explorerPanel', 'componentsPanel', 'examplesPanel', 'codePanel'].forEach(id => $(`#${id}`).classList.toggle('hidden', id !== `${currentPanel}Panel`));
    $('#leftPanel').classList.remove('panel-hidden');
    $$('.activity[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === panel));
    if (currentPanel === 'components') setTimeout(() => $('#componentSearch').focus(), 0);
    if (currentPanel === 'examples') setTimeout(() => $('#exampleSearch').focus(), 0);
  }

  $$('.activity[data-panel]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.panel === 'instruments') { $('#rightPanel').classList.remove('panel-hidden'); toast('Multimeter opened', 'success'); return; }
    showPanel(button.dataset.panel === 'circuit' ? 'components' : button.dataset.panel);
  }));

  function inputForProperty(property, value) {
    const key = escapeHtml(property.key), label = escapeHtml(property.label);
    if (property.type === 'boolean') return `<label class="check-property"><span>${label}</span><input data-property="${key}" type="checkbox" ${value ? 'checked' : ''}/><i></i></label>`;
    if (property.type === 'select') return `<label>${label}<select data-property="${key}">${property.options.map(option => `<option ${String(option) === String(value) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
    const attrs = property.type === 'number' ? `type="number" min="${property.min ?? ''}" max="${property.max ?? ''}" step="${property.step ?? 'any'}"` : 'type="text"';
    return `<label>${label}<div class="property-value"><input data-property="${key}" ${attrs} value="${escapeHtml(value)}"/>${property.unit ? `<span>${escapeHtml(property.unit)}</span>` : ''}</div></label>`;
  }

  function updateInspector(selected) {
    const inspector = $('#inspector');
    if (!selected) {
      inspector.innerHTML = '<div class="inspector-empty"><b>◇</b><strong>Nothing selected</strong><span>Select a component or wire to edit its properties.</span></div>';
      $('#selectionStatus').textContent = 'No selection';
      return;
    }
    if (selected.kind === 'components') {
      const items = selected.items;
      inspector.innerHTML = `<div class="selection-title"><div class="component-symbol multi-symbol">${items.length}</div><div><strong>MULTIPLE SELECTION</strong><span>${items.length} components selected</span></div></div><div class="prop-group multi-selection-list"><div class="prop-title">COMPONENTS</div>${items.map(component => `<div><b>${escapeHtml(component.id)}</b><span>${escapeHtml(COMPONENT_TYPES[component.type].label)}</span></div>`).join('')}</div><div class="prop-group"><div class="prop-title">GROUP ACTIONS</div><p class="inspector-note">Drag any selected component to move the complete group. Ctrl/Cmd + click toggles items; Shift + click adds items.</p></div><div class="inspector-actions stacked"><button data-inspector-action="layout-selection">◇ Auto-arrange selected components</button><button data-inspector-action="route-selection">⌁ Auto-route connected wires</button><button data-inspector-action="duplicate">⧉ Duplicate group</button><button class="danger" data-inspector-action="delete">⌫ Delete group</button></div>`;
      bindInspectorActions();
      $('#selectionStatus').textContent = `${items.length} components selected`;
      return;
    }
    if (selected.kind === 'wire') {
      const wire = selected.item;
      inspector.innerHTML = `<div class="selection-title"><div class="component-symbol">⌁</div><div><strong>WIRE</strong><span>${escapeHtml(wire.id)}</span></div></div><div class="prop-group"><div class="prop-title">CONNECTION</div><label>From<input value="${escapeHtml(wire.from)}" readonly/></label><label>To<input value="${escapeHtml(wire.to)}" readonly/></label><label>Net type<select data-wire-kind><option value="signal" ${wire.kind === 'signal' ? 'selected' : ''}>Signal</option><option value="power" ${wire.kind === 'power' ? 'selected' : ''}>Power</option><option value="ground" ${wire.kind === 'ground' ? 'selected' : ''}>Ground</option></select></label><label>Routing<input value="${wire.manual ? 'Manual' : 'Automatic'}" readonly/></label></div><div class="inspector-actions"><button data-inspector-action="auto-route">⌁ Auto-route</button><button class="danger" data-inspector-action="delete">⌫ Delete</button></div>`;
      $('[data-wire-kind]')?.addEventListener('change', event => canvas.updateSelected({ kind: event.target.value }));
      bindInspectorActions();
      $('#selectionStatus').textContent = `${wire.id} · ${wire.from} → ${wire.to}`;
      return;
    }

    const component = selected.item, def = COMPONENT_TYPES[component.type];
    inspector.innerHTML = `<div class="selection-title"><div class="component-symbol">${escapeHtml(def.icon)}</div><div><strong>${escapeHtml(def.label.toUpperCase())}</strong><span>${escapeHtml(component.id)} · ${escapeHtml(def.category)}</span></div><button data-inspector-action="duplicate" title="Duplicate">⧉</button></div><div class="prop-group"><div class="prop-title">GENERAL</div><label>Reference<input data-property="id" value="${escapeHtml(component.id)}"/></label>${def.properties.map(property => inputForProperty(property, component[property.key])).join('')}</div><div class="prop-group"><div class="prop-title">TRANSFORM</div><div class="two-col"><label>X<input data-property="x" type="number" value="${Math.round(component.x)}"/></label><label>Y<input data-property="y" type="number" value="${Math.round(component.y)}"/></label></div><label>Rotation<select data-property="rotation">${[0, 90, 180, 270].map(angle => `<option value="${angle}" ${Number(component.rotation || 0) === angle ? 'selected' : ''}>${angle}°</option>`).join('')}</select></label></div><div class="prop-group pin-summary"><div class="prop-title">PINS <span>${def.pins.length}</span></div>${def.pins.map(pin => `<div><b>${escapeHtml(pin.id)}</b><span>${escapeHtml(pin.name || pin.electrical || 'Signal')}</span></div>`).join('')}</div><div class="inspector-actions"><button data-inspector-action="duplicate">⧉ Duplicate</button><button class="danger" data-inspector-action="delete">⌫ Delete</button></div>`;

    $$('[data-property]').forEach(input => input.addEventListener('change', event => {
      const property = event.currentTarget.dataset.property;
      let value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
      if (event.currentTarget.type === 'number') value = Number(value);
      const updated = canvas.updateSelected({ [property]: value });
      if (!updated) updateInspector(canvas.getSelected());
    }));
    bindInspectorActions();
    $('#selectionStatus').textContent = `${component.id} · ${def.label}`;
  }

  function bindInspectorActions() {
    $$('[data-inspector-action]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.inspectorAction === 'delete') canvas.deleteSelected();
      if (button.dataset.inspectorAction === 'duplicate') canvas.duplicateSelected();
      if (button.dataset.inspectorAction === 'auto-route') canvas.updateSelected({ automatic: true });
      if (button.dataset.inspectorAction === 'route-selection') showRoutingResult(canvas.optimizeRouting('selection'), true);
      if (button.dataset.inspectorAction === 'layout-selection') showLayoutResult(canvas.autoLayout('selection'), true);
    }));
  }
  updateInspector(null);

  // ---------- View controls ----------
  function syncViewControls() {
    const view = canvas.getView();
    $('.zoom').textContent = `${Math.round(view.zoom * 100)}%`;
    $('#gridBtn')?.classList.toggle('active', view.grid);
    $('#snapBtn')?.classList.toggle('active', view.snap);
    $('#panBtn')?.classList.toggle('active', view.panMode);
  }
  $('#gridBtn').addEventListener('click', () => canvas.setGrid(!canvas.getView().grid));
  $('#snapBtn').addEventListener('click', () => canvas.setSnap(!canvas.getView().snap));
  $('#zoomInBtn').addEventListener('click', () => canvas.setZoom(canvas.getZoom() + 0.1));
  $('#zoomOutBtn').addEventListener('click', () => canvas.setZoom(canvas.getZoom() - 0.1));
  $('#fitBtn').addEventListener('click', () => canvas.fitView());
  $('#panBtn').addEventListener('click', () => canvas.setPanMode(!canvas.getView().panMode));
  function showLayoutResult(result, selectedOnly = false) {
    if (!result?.count) return;
    canvas.fitView(); syncViewControls();
    toast(`${result.count} ${selectedOnly ? 'selected ' : ''}component${result.count === 1 ? '' : 's'} arranged in ${result.groups} connected group${result.groups === 1 ? '' : 's'}; wires rerouted`, 'success');
  }
  function showRoutingResult(result, selectedOnly = false) {
    if (!result?.routed) return;
    if (result.changed) toast(`${result.changed} of ${result.routed} ${selectedOnly ? 'selected/connected ' : ''}wire${result.routed === 1 ? '' : 's'} received a new route`, 'success');
    else toast(`${result.routed} wire${result.routed === 1 ? '' : 's'} analyzed — routing was already optimal`, 'info');
  }
  // The toolbar button is deliberately global and predictable. Selection-only
  // routing remains available in the Inspector, Circuit menu and Shift+O.
  $('#layoutBtn').addEventListener('click', () => showLayoutResult(canvas.autoLayout('all')));
  $('#routeBtn').addEventListener('click', () => showRoutingResult(canvas.optimizeRouting('all')));
  $('#circuit').addEventListener('pointermove', event => { const point = canvas.screenToCanvas(event.clientX, event.clientY); $('#canvasPosition').textContent = `X ${Math.round(point.x)} · Y ${Math.round(point.y)}`; });

  function togglePanel(id, visible) {
    const element = $(`#${id}`);
    const show = visible ?? element.classList.contains('panel-hidden');
    element.classList.toggle('panel-hidden', !show);
    return show;
  }

  // ---------- Simulation ----------
  function updateBenchMeter(result, selected = canvas?.getSelected?.()) {
    const componentId = selected?.item?.id, reading = componentId ? result?.measurements?.get(componentId) : null;
    if (!reading) {
      $('#meterValue').textContent = '—'; $('#meterUnit').textContent = '';
      $('#meterStatus').textContent = result ? 'SELECT A CONNECTED METER' : (componentId ? `RUN TO MEASURE ${componentId}` : 'SELECT A METER');
      return;
    }
    const match = String(reading).match(/^(\S+)\s*(.*)$/), value = match?.[1] || reading, unit = match?.[2] || '';
    $('#meterValue').textContent = value; $('#meterUnit').textContent = unit;
    const solverLabel = result?.solver === 'ngspice-wasm' ? 'NGSPICE' : 'LOCAL FALLBACK';
    $('#meterStatus').textContent = `${componentId} · ${solverLabel}`;
    const mode = unit.includes('A') ? 'A' : unit.includes('Ω') ? 'Ω' : unit.includes('V') ? 'V DC' : null;
    if (mode) $$('.meter-modes button').forEach(button => button.classList.toggle('active', button.textContent.trim() === mode));
  }

  function renderSimulationChrome() {
    const running = simStatus === 'running';
    const phaseLabels = {
      queued: 'RUNNING · SPICE QUEUED', loading: 'RUNNING · SPICE LOADING', initializing: 'RUNNING · SPICE INIT',
      running: 'RUNNING · SPICE SOLVING', ready: 'RUNNING · NGSPICE', fallback: 'RUNNING · HYBRID', error: 'RUNNING · FALLBACK'
    };
    const stateLabel = running ? (phaseLabels[spicePhase] || 'RUNNING') : simStatus.toUpperCase();
    $('.sim-state').className = `sim-state ${running ? 'running' : 'stopped'} ${spicePhase}`;
    $('.sim-state').innerHTML = `<b></b> ${stateLabel}`;
    $('#runBtn').innerHTML = running ? 'Ⅱ <span>Pause</span>' : '▶ <span>Run</span>';

    const badgeLabels = {
      idle: 'NGSPICE · WASM', queued: 'SPICE · QUEUED', loading: 'SPICE · LOADING', initializing: 'SPICE · INIT',
      running: 'SPICE · SOLVING', ready: 'NGSPICE · READY', fallback: 'HYBRID · FALLBACK', error: 'SPICE · ERROR'
    };
    const badge = $('#engineBadge');
    badge.className = `engine-badge ${spicePhase}`;
    badge.textContent = badgeLabels[spicePhase] || badgeLabels.idle;
    badge.title = spiceDetail || 'ngspice runs locally in this browser';
  }

  function setSpicePhase(phase, detail = '') {
    spicePhase = phase; spiceDetail = detail;
    renderSimulationChrome();
  }

  function cancelSpiceEvaluation() {
    spiceGeneration += 1;
    clearTimeout(spiceTimer); spiceTimer = null;
    spicePhase = 'idle'; spiceDetail = '';
  }

  function scheduleSpiceEvaluation(delay = 140) {
    const generation = ++spiceGeneration;
    clearTimeout(spiceTimer);
    const snapshot = typeof structuredClone === 'function' ? structuredClone(canvas.state) : JSON.parse(JSON.stringify(canvas.state));
    setSpicePhase('queued', 'Waiting to solve the current visual circuit');
    spiceTimer = setTimeout(async () => {
      if (generation !== spiceGeneration || simStatus !== 'running') return;
      // Re-evaluate the immutable snapshot so the SPICE merge and the digital
      // fallback always describe exactly the same revision of the schematic.
      const fallback = evaluateCircuit(snapshot);
      const result = await runSpiceOperatingPoint(snapshot, fallback, {
        onStatus(status) {
          if (generation !== spiceGeneration || simStatus !== 'running') return;
          const unsupported = status.unsupportedComponents?.length
            ? `${status.unsupportedComponents.length} unsupported digital component${status.unsupportedComponents.length === 1 ? '' : 's'}` : '';
          setSpicePhase(status.phase, status.message || unsupported || status.reason || '');
        }
      });
      if (generation !== spiceGeneration || simStatus !== 'running') return;
      lastSimulationResult = result; canvas.setSimulationResult(result); updateBenchMeter(result);
      if (result.solver === 'ngspice-wasm') {
        setSpicePhase('ready', `ngspice operating point · ${result.spice?.variables?.length || 0} variables`);
        if (!announcedSpiceReady) {
          announcedSpiceReady = true;
          toast('ngspice WebAssembly is ready — meter readings now come from SPICE', 'success');
          log(`ngspice solved the visual netlist · ${result.spice?.variables?.length || 0} variables · ${result.spice?.points || 0} operating point`);
        }
      } else if (result.spice?.reason === 'engine-error') {
        setSpicePhase('error', result.spice.error || 'ngspice error; using local node solver');
        if (!announcedSpiceReady) {
          announcedSpiceReady = true;
          toast('ngspice could not converge; the validated local solver remains active', 'warning');
          log(`ngspice fallback · ${result.spice.error || 'convergence error'}`, 'warning');
        }
      } else {
        const count = result.spice?.unsupportedComponents?.length || 0;
        setSpicePhase('fallback', count ? `${count} digital/unsupported component${count === 1 ? '' : 's'} use the local solver` : 'No analog source requires SPICE');
        if (!announcedSpiceReady && count) {
          announcedSpiceReady = true;
          log(`Hybrid simulation · ${count} digital/unsupported component${count === 1 ? '' : 's'} handled by the local solver`);
        }
      }
    }, delay);
  }

  function applySimulationOutputs(requestedOn, spiceDelay = 140) {
    if (!requestedOn) {
      cancelSpiceEvaluation();
      lastSimulationResult = null; canvas.setSimulationResult(null); updateBenchMeter(null);
      return null;
    }
    const result = evaluateCircuit(canvas.state);
    result.solver = 'node-mna-preview';
    lastSimulationResult = result; canvas.setSimulationResult(result); updateBenchMeter(result);
    scheduleSpiceEvaluation(spiceDelay);
    return result;
  }
  function updateSimulationUi() {
    const running = simStatus === 'running';
    renderSimulationChrome();
    return applySimulationOutputs(running, 0);
  }
  function runSimulation() {
    if (simStatus === 'running') return pauseSimulation();
    simStatus = 'running'; announcedSpiceReady = false; engine.start();
    clearInterval(timer); timer = setInterval(() => engine.step(0.08), 80);
    const result = updateSimulationUi();
    const activeNames = [...(result?.poweredComponents || [])].join(', ');
    log(activeNames ? `Simulation started · node preview: ${activeNames} · starting ngspice` : 'Simulation started · node preview ready · starting ngspice WebAssembly');
  }
  function pauseSimulation() { simStatus = 'paused'; engine.pause(); clearInterval(timer); updateSimulationUi(); log('Simulation paused'); }
  function stopSimulation() { simStatus = 'stopped'; engine.stop(); clearInterval(timer); updateSimulationUi(); log('Simulation stopped'); }
  function resetSimulation() { engine.reset(); simStatus = 'stopped'; clearInterval(timer); updateSimulationUi(); log('Simulation reset'); }
  $('#runBtn').addEventListener('click', runSimulation);
  $('#pauseBtn').addEventListener('click', pauseSimulation);
  $('#stopBtn').addEventListener('click', stopSimulation);
  $('#resetBtn').addEventListener('click', resetSimulation);

  // ---------- Documents, tabs and file operations ----------
  function uniqueDocumentName(requested) {
    const base = String(requested || 'untitled').replace(/\.(sim|json)$/i, '') || 'untitled';
    const names = new Set(documents.map(document => document.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let number = 2;
    while (names.has(`${base}-${number}`.toLowerCase())) number += 1;
    return `${base}-${number}`;
  }

  function persistActiveDocument() {
    const document = activeDocument();
    if (document) document.session = canvas.exportSession();
  }

  function renderDocumentTabs() {
    const container = $('#documentTabs');
    if (!container) return;
    container.innerHTML = documents.map(document => `<button class="tab ${document.id === activeDocumentId ? 'active' : ''}" role="tab" aria-selected="${document.id === activeDocumentId}" data-document="${document.id}" title="${escapeHtml(document.name)}.sim"><span class="dot ${document.dirty ? 'amber' : 'cyan'}"></span><span>${escapeHtml(document.name)}.sim</span>${document.dirty ? '<em>●</em>' : ''}<i data-close-document="${document.id}" title="Close tab">×</i></button>`).join('');
    $$('[data-document]').forEach(tab => {
      tab.addEventListener('click', event => { if (!event.target.closest('[data-close-document]')) activateDocument(tab.dataset.document); });
      tab.addEventListener('dblclick', event => {
        if (event.target.closest('[data-close-document]')) return;
        const document = documents.find(item => item.id === tab.dataset.document);
        const name = window.prompt('Rename circuit tab', document.name);
        if (name?.trim()) { document.name = uniqueDocumentName(name.trim()); if (document.id === activeDocumentId) { canvas.state.name = document.name; markDirty(true); updateFileName(); } renderDocumentTabs(); }
      });
    });
    $$('[data-close-document]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); closeDocument(button.dataset.closeDocument); }));
    requestAnimationFrame(() => container.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  function activateDocument(id) {
    if (id === activeDocumentId || !documents.some(document => document.id === id)) return;
    stopSimulation(); persistActiveDocument(); activeDocumentId = id;
    const document = activeDocument();
    canvas.loadSession(document.session);
    canvas.state.name = document.name;
    renderDocumentTabs(); updateFileName(); updateWorkspaceSummary(); syncViewControls();
    $('.modified').textContent = document.dirty ? '●' : '✓';
    $('.modified').classList.toggle('saved', !document.dirty);
    log(`${document.name}.sim activated`);
  }

  function addDocument(circuit, requestedName, { dirty = false } = {}) {
    stopSimulation(); persistActiveDocument();
    const normalized = normalizeCircuitData(circuit);
    const name = uniqueDocumentName(requestedName || normalized.name || 'untitled');
    const document = { id: `document-${++documentCounter}`, name, dirty, session: { circuit: structuredClone({ ...normalized, name }), undoStack: [], redoStack: [], view: { grid: true, snap: true, zoom: 1, panMode: false, center: { x: 500, y: 300 } } } };
    documents.push(document); activeDocumentId = document.id;
    canvas.loadSession(document.session); canvas.state.name = name; document.session = canvas.exportSession();
    renderDocumentTabs(); updateFileName(); updateWorkspaceSummary(); syncViewControls();
    $('.modified').textContent = dirty ? '●' : '✓';
    $('.modified').classList.toggle('saved', !dirty);
    return document;
  }

  function closeDocument(id) {
    const index = documents.findIndex(document => document.id === id);
    if (index < 0) return;
    const document = documents[index];
    if (document.dirty && !window.confirm(`Close ${document.name}.sim without saving?`)) return;
    const wasActive = id === activeDocumentId;
    documents.splice(index, 1);
    if (!documents.length) {
      activeDocumentId = null;
      addDocument({ version: 2, name: 'untitled', components: [], wires: [] }, 'untitled');
      return;
    }
    if (wasActive) {
      activeDocumentId = null;
      activateDocument(documents[Math.min(index, documents.length - 1)].id);
    } else renderDocumentTabs();
  }

  function cycleDocument(offset) {
    if (documents.length < 2) return;
    const index = documents.findIndex(document => document.id === activeDocumentId);
    activateDocument(documents[(index + offset + documents.length) % documents.length].id);
  }

  function newCircuit() {
    addDocument({ version: 2, name: 'untitled', components: [], wires: [] }, 'untitled', { dirty: true });
    log('New circuit tab created');
  }

  function openExample(exampleId) {
    const example = CIRCUIT_EXAMPLES.find(item => item.id === exampleId);
    if (!example) return;
    addDocument(example.circuit, example.circuit.name);
    canvas.fitView(); syncViewControls();
    toast(`${example.title} opened in a new tab`, 'success');
    log(`Example loaded · ${example.title} · ready to run`);
  }

  function safeFilename() { return (activeDocument()?.name || canvas.state.name || 'circuit').replace(/[^a-z0-9_-]/gi, '_'); }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function saveProject() {
    persistActiveDocument();
    const document = activeDocument();
    localStorage.setItem('circuitlab.current', canvas.exportJSON());
    if (document) { document.dirty = false; document.session = canvas.exportSession(); }
    saveWorkspaceSnapshot(); markDirty(false); toast('Active circuit and workspace saved', 'success'); log('Project saved');
  }
  function saveAllProjects() {
    persistActiveDocument();
    documents.forEach(document => { document.dirty = false; });
    saveWorkspaceSnapshot(); renderDocumentTabs(); markDirty(false);
    toast(`${documents.length} circuit tab${documents.length === 1 ? '' : 's'} saved`, 'success');
  }
  function saveWorkspaceSnapshot() {
    const payload = { activeDocumentId, documents: documents.map(document => ({ ...document, session: structuredClone(document.session) })) };
    localStorage.setItem('circuitlab.workspace.v2', JSON.stringify(payload));
  }
  function saveAsFile() { persistActiveDocument(); download(canvas.exportJSON(), `${safeFilename()}.sim`, 'application/json'); markDirty(false); toast('Circuit file downloaded', 'success'); }
  function openFile() { $('#circuitFileInput').value = ''; $('#circuitFileInput').click(); }
  function loadSaved() {
    const workspace = localStorage.getItem('circuitlab.workspace.v2');
    try {
      if (workspace) {
        const payload = JSON.parse(workspace);
        if (!Array.isArray(payload.documents) || !payload.documents.length) throw new Error('Saved workspace is empty');
        documents.splice(0, documents.length, ...payload.documents.map(document => ({ ...document, dirty: false })));
        documentCounter = Math.max(documentCounter, ...documents.map(document => Number(String(document.id).split('-').at(-1)) || 0));
        activeDocumentId = documents.some(document => document.id === payload.activeDocumentId) ? payload.activeDocumentId : documents[0].id;
        canvas.loadSession(activeDocument().session); canvas.state.name = activeDocument().name;
        renderDocumentTabs(); updateFileName(); updateWorkspaceSummary(); markDirty(false); log('Saved workspace loaded');
        return;
      }
      const saved = localStorage.getItem('circuitlab.current');
      if (!saved) return toast('No browser save was found', 'warning');
      addDocument(JSON.parse(saved), JSON.parse(saved).name || 'saved-circuit'); markDirty(false); log('Saved circuit loaded');
    } catch (error) { toast(`Could not load saved workspace: ${error.message}`, 'error'); }
  }
  $('#circuitFileInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { addDocument(JSON.parse(await file.text()), file.name.replace(/\.(json|sim)$/i, '')); markDirty(false); log(`${file.name} opened in a new tab`); }
    catch (error) { toast(`Invalid circuit file: ${error.message}`, 'error'); }
  });
  function exportSvg() {
    const clone = $('#circuit').cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelectorAll('.selection,.preview-layer').forEach(node => node.remove());
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = '.wire{fill:none;stroke-width:3;stroke-linejoin:round}.power{stroke:#d29922}.signal{stroke:#3fb950}.ground{stroke:#8492a1}.component{fill:#151d26;stroke:#8b9aaa}.component text{fill:#e6edf3;font:12px monospace}.symbol-path,.symbol-shape,.component line,.component path{fill:none;stroke:#dbe6ef;stroke-width:2}.pin{fill:#22d3ee;stroke:#dffbff}.board-shape,.chip{fill:#151d26;stroke:#6b7785}';
    clone.insertBefore(style, clone.firstChild);
    download(new XMLSerializer().serializeToString(clone), `${safeFilename()}.svg`, 'image/svg+xml'); toast('SVG exported', 'success');
  }
  function updateFileName() {
    const document = activeDocument();
    const filename = `${document?.name || canvas.state.name || 'untitled'}.sim`;
    $('#breadcrumbName').textContent = filename;
    $$('.project-file-name').forEach(element => { element.textContent = filename; });
    window.document.title = `${document?.dirty ? '● ' : ''}${filename} — CircuitLab Studio`;
  }

  // ---------- Dialogs ----------
  function showDialog(title, body) { $('#dialogTitle').textContent = title; $('#dialogBody').innerHTML = body; $('#appDialog').classList.remove('hidden'); }
  function closeDialog() { $('#appDialog').classList.add('hidden'); }
  $('#dialogClose').addEventListener('click', closeDialog); $('#dialogOk').addEventListener('click', closeDialog);
  $('#appDialog').addEventListener('click', event => { if (event.target.id === 'appDialog') closeDialog(); });
  function showShortcuts() { showDialog('Keyboard shortcuts', '<div class="shortcut-grid"><kbd>Ctrl N</kbd><span>New circuit tab</span><kbd>Ctrl Tab</kbd><span>Next circuit tab</span><kbd>Ctrl S</kbd><span>Save active tab</span><kbd>Ctrl O</kbd><span>Open in new tab</span><kbd>Ctrl Z / Y</kbd><span>Undo / redo</span><kbd>Ctrl A</kbd><span>Select all components</span><kbd>Ctrl/Shift + click</kbd><span>Toggle/add component selection</span><kbd>Background drag</kbd><span>Box selection</span><kbd>L / Shift L</kbd><span>Layout all / selected components</span><kbd>O / Shift O</kbd><span>Route all / selected nets</span><kbd>Space + drag</kbd><span>Pan canvas temporarily</span><kbd>Middle drag</kbd><span>Pan canvas</span><kbd>Mouse wheel</kbd><span>Zoom at pointer</span><kbd>H</kbd><span>Toggle hand tool</span><kbd>Delete</kbd><span>Delete selection</span><kbd>F6</kbd><span>Run / pause</span><kbd>O</kbd><span>Optimize routing</span><kbd>F</kbd><span>Fit circuit</span></div>'); }
  function showGuide() { showDialog('Component and wiring guide', '<p><b>Add:</b> open Components, then click ＋ or drag an SVG symbol onto the canvas.</p><p><b>Examples:</b> open the Examples panel and load any circuit in a new tab.</p><p><b>Wire:</b> drag from any cyan pin to another pin. The router avoids component bodies and reduces bends/crossings.</p><p><b>Move component:</b> drag it normally. Automatic nets reroute while manual nets preserve their bends.</p><p><b>Organize:</b> use Auto-layout Diagram to place and reorient components by electrical flow, then reroute every net. Use L for the full diagram or Shift+L for a multi-selection.</p><p><b>Move canvas:</b> hold Space and drag, use the middle mouse button, or activate the hand tool. Use the wheel to zoom around the pointer.</p><p><b>Switches:</b> double-click a switch or change its state in the Inspector.</p>'); }
  function showAbout() { showDialog('About CircuitLab Studio', `<p>CircuitLab Studio Interactive</p><p>${Object.keys(COMPONENT_TYPES).length} functional component types · ${CIRCUIT_EXAMPLES.length} ready-to-run examples · multi-tab workspace · pannable orthogonal canvas.</p><p><b>Simulation:</b> ngspice WebAssembly in the browser with a node-accurate MNA fallback for digital and unsupported devices.</p><p>Project format version 2.</p>`); }
  function showSpiceNetlist() {
    const fallback = evaluateCircuit(canvas.state);
    const adapter = buildSpiceNetlist(canvas.state, { fallbackResult: fallback });
    const unsupported = adapter.unsupportedComponents.length
      ? `<p class="spice-warning">Hybrid fallback required for: ${escapeHtml(adapter.unsupportedComponents.join(', '))}</p>`
      : '<p class="spice-ready">✓ This circuit is ready for ngspice WebAssembly.</p>';
    showDialog('Generated ngspice netlist', `${unsupported}<p class="dialog-note">Generated from the exact component pins and wire nodes currently visible on the canvas.</p><pre class="spice-netlist">${escapeHtml(adapter.netlist)}</pre>`);
  }

  // ---------- Menus and actions ----------
  const actions = {
    new: newCircuit, templates: () => showPanel('examples'), open: openFile, load: loadSaved, save: saveProject, saveAll: saveAllProjects, saveAs: saveAsFile, closeTab: () => closeDocument(activeDocumentId), exportSvg,
    print: () => window.print(), undo: () => canvas.undo(), redo: () => canvas.redo(), selectAll: () => canvas.selectAll(), cut: () => canvas.cutSelected(), copy: () => canvas.copySelected(), paste: () => canvas.paste(), duplicate: () => canvas.duplicateSelected(), delete: () => canvas.deleteSelected(),
    components: () => showPanel('components'), examples: () => showPanel('examples'), explorer: () => showPanel('explorer'), nextTab: () => cycleDocument(1), previousTab: () => cycleDocument(-1), toggleLeft: () => togglePanel('leftPanel'), toggleRight: () => togglePanel('rightPanel'), toggleBottom: () => togglePanel('bottomPanel'),
    grid: () => $('#gridBtn').click(), snap: () => $('#snapBtn').click(), pan: () => $('#panBtn').click(), zoomIn: () => $('#zoomInBtn').click(), zoomOut: () => $('#zoomOutBtn').click(), fit: () => $('#fitBtn').click(), fullscreen: () => { const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); request?.catch?.(() => toast('Full screen is not available in this preview', 'warning')); },
    clearHistory: () => canvas.clearHistory(), restoreDemo: () => { canvas.loadCircuit(JSON.parse(initialCircuit), 'Restore demo'); toast('Demo circuit restored', 'success'); },
    layout: () => showLayoutResult(canvas.autoLayout('all')), layoutSelected: () => showLayoutResult(canvas.autoLayout('selection'), true), optimize: () => showRoutingResult(canvas.optimizeRouting('all')), optimizeSelected: () => showRoutingResult(canvas.optimizeRouting('selection'), true), clearWires: () => { if (canvas.state.wires.length && window.confirm('Delete every wire?')) canvas.clearWires(); }, validate: validateCircuit,
    run: runSimulation, pause: pauseSimulation, stop: stopSimulation, reset: resetSimulation, spiceNetlist: showSpiceNetlist,
    shortcuts: showShortcuts, guide: showGuide, about: showAbout, palette: () => openPalette(true)
  };

  const menus = {
    file: [
      ['New Circuit Tab', 'Ctrl+N', 'new'], ['New from Template…', 'Ctrl+Shift+N', 'templates'], ['Open File in New Tab…', 'Ctrl+O', 'open'], ['Load Saved Workspace', '', 'load'], null,
      ['Save Active Circuit', 'Ctrl+S', 'save'], ['Save All Tabs', 'Ctrl+Alt+S', 'saveAll'], ['Download Active Circuit…', 'Ctrl+Shift+S', 'saveAs'], null,
      ['Close Active Tab', 'Ctrl+W', 'closeTab'], ['Export as SVG', '', 'exportSvg'], ['Print…', 'Ctrl+P', 'print']
    ],
    edit: [
      [() => `Undo${historyState.undoLabel ? ` ${historyState.undoLabel}` : ''}`, 'Ctrl+Z', 'undo', () => !historyState.canUndo], [() => `Redo${historyState.redoLabel ? ` ${historyState.redoLabel}` : ''}`, 'Ctrl+Y', 'redo', () => !historyState.canRedo], null,
      ['Select All Components', 'Ctrl+A', 'selectAll', () => !canvas.state.components.length], null,
      ['Cut', 'Ctrl+X', 'cut', () => !canvas.getSelected()], ['Copy', 'Ctrl+C', 'copy', () => !canvas.getSelected()], ['Paste', 'Ctrl+V', 'paste'], ['Duplicate', 'Ctrl+D', 'duplicate', () => !canvas.getSelected()], ['Delete', 'Del', 'delete', () => !canvas.getSelected()]
    ],
    view: [
      ['Components', 'Ctrl+1', 'components'], ['Examples & Templates', 'Ctrl+3', 'examples'], ['Explorer', 'Ctrl+2', 'explorer'], null,
      ['Next Circuit Tab', 'Ctrl+Tab', 'nextTab', () => documents.length < 2], ['Previous Circuit Tab', 'Ctrl+Shift+Tab', 'previousTab', () => documents.length < 2], null,
      ['Toggle Sidebar', 'Ctrl+B', 'toggleLeft'], ['Toggle Inspector', 'Ctrl+Alt+I', 'toggleRight'], ['Toggle Bottom Panel', 'Ctrl+J', 'toggleBottom'], null,
      ['Pan Tool', 'H', 'pan', false, () => canvas.getView().panMode], ['Grid', 'G', 'grid', false, () => canvas.getView().grid], ['Snap to Grid', 'Shift+G', 'snap', false, () => canvas.getView().snap], null,
      ['Zoom In', 'Ctrl++', 'zoomIn'], ['Zoom Out', 'Ctrl+-', 'zoomOut'], ['Fit Circuit', 'F', 'fit'], ['Full Screen', 'F11', 'fullscreen']
    ],
    history: [
      [() => `Undo${historyState.undoLabel ? ` ${historyState.undoLabel}` : ''}`, 'Ctrl+Z', 'undo', () => !historyState.canUndo], [() => `Redo${historyState.redoLabel ? ` ${historyState.redoLabel}` : ''}`, 'Ctrl+Y', 'redo', () => !historyState.canRedo], null,
      ['Restore Demo Circuit', '', 'restoreDemo'], ['Clear History', '', 'clearHistory', () => !historyState.canUndo && !historyState.canRedo]
    ],
    circuit: [
      ['Add Component…', 'Ctrl+1', 'components'], ['Command Palette…', 'Ctrl+Shift+P', 'palette'], null,
      ['Auto-layout Selected Components', 'Shift+L', 'layoutSelected', () => canvas.getSelected()?.kind !== 'components'], ['Auto-layout Complete Diagram', 'L', 'layout'], null,
      ['Auto-route Selected Nets', 'Shift+O', 'optimizeSelected', () => !canvas.getSelected()], ['Auto-route All Wires', 'O', 'optimize'], ['Validate Circuit', '', 'validate'], ['Delete All Wires', '', 'clearWires', () => !canvas.state.wires.length]
    ],
    simulation: [['Run / Continue', 'F6', 'run'], ['Pause', 'F7', 'pause', () => simStatus !== 'running'], ['Stop', 'Shift+F6', 'stop', () => simStatus === 'stopped'], ['Reset', '', 'reset'], null, ['View Generated SPICE Netlist…', '', 'spiceNetlist']],
    help: [['Keyboard Shortcuts', '', 'shortcuts'], ['Component & Wiring Guide', '', 'guide'], null, ['About CircuitLab Studio', '', 'about']]
  };

  function renderMenu(name, anchor) {
    openMenuName = name;
    const dropdown = $('#menuDropdown');
    dropdown.innerHTML = menus[name].map(item => {
      if (!item) return '<div class="menu-separator"></div>';
      const [label, shortcut, action, disabled, checked] = item;
      const text = typeof label === 'function' ? label() : label;
      const isDisabled = typeof disabled === 'function' ? disabled() : Boolean(disabled);
      const isChecked = typeof checked === 'function' ? checked() : false;
      return `<button role="menuitem" data-action="${action}" ${isDisabled ? 'disabled' : ''}><span class="menu-check">${isChecked ? '✓' : ''}</span><span>${escapeHtml(text)}</span><kbd>${escapeHtml(shortcut)}</kbd></button>`;
    }).join('');
    const rect = anchor.getBoundingClientRect();
    dropdown.style.left = `${Math.max(4, rect.left)}px`; dropdown.style.top = `${rect.bottom + 2}px`;
    dropdown.classList.remove('hidden');
    dropdown.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => { if (!button.disabled) actions[button.dataset.action]?.(); closeMenu(); }));
  }
  function refreshOpenMenu() { if (openMenuName) { const anchor = $(`.menubar [data-menu="${openMenuName}"]`); if (anchor) renderMenu(openMenuName, anchor); } }
  function closeMenu() { openMenuName = null; $('#menuDropdown').classList.add('hidden'); $$('.menubar button').forEach(button => button.classList.remove('open')); }
  $$('.menubar [data-menu]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (openMenuName === button.dataset.menu) return closeMenu();
    $$('.menubar button').forEach(item => item.classList.toggle('open', item === button)); renderMenu(button.dataset.menu, button);
  }));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.menubar') && !event.target.closest('#menuDropdown')) closeMenu(); });

  function validateCircuit() {
    const result = canvas.validateCircuit();
    $('#problemCount').textContent = result.errors.length + result.warnings.length;
    $('#statusErrors').textContent = `◉ ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`;
    $('#statusWarnings').textContent = `↯ ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`;
    const body = result.errors.length || result.warnings.length
      ? `${result.errors.length ? `<h4>Errors</h4><ul>${result.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>` : ''}${result.warnings.length ? `<h4>Warnings</h4><ul>${result.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}`
      : '<p class="validation-ok">✓ No circuit errors or warnings found.</p>';
    showDialog('Circuit validation', body); log(`Validation finished · ${result.errors.length} errors · ${result.warnings.length} warnings`);
  }

  // ---------- Command palette ----------
  const commands = [
    ['▶', 'Run Simulation', 'run', 'F6'], ['■', 'Stop Simulation', 'stop', ''], ['＋', 'New Circuit Tab', 'new', 'Ctrl+N'], ['▧', 'Open Example or Template', 'templates', 'Ctrl+Shift+N'], ['＋', 'Add Component', 'components', 'Ctrl+1'], ['✋', 'Toggle Pan Tool', 'pan', 'H'], ['◇', 'Auto-layout Diagram', 'layout', 'L'], ['⌁', 'Optimize Routing', 'optimize', 'O'], ['✓', 'Validate Circuit', 'validate', ''], ['⛶', 'Zoom to Fit', 'fit', 'F'], ['▣', 'Save Project', 'save', 'Ctrl+S'], ['↶', 'Undo', 'undo', 'Ctrl+Z'], ['?', 'Keyboard Shortcuts', 'shortcuts', '']
  ];
  function renderCommands(filter = '') {
    const query = filter.toLowerCase();
    $('#commandList').innerHTML = commands.filter(command => command[1].toLowerCase().includes(query)).map(command => `<button data-action="${command[2]}">${command[0]} <span>${command[1]}</span>${command[3] ? `<kbd>${command[3]}</kbd>` : ''}</button>`).join('');
    $$('#commandList button').forEach(button => button.addEventListener('click', () => { actions[button.dataset.action]?.(); openPalette(false); }));
  }
  function openPalette(open) { $('#palette').classList.toggle('hidden', !open); if (open) { $('#commandInput').value = ''; renderCommands(); setTimeout(() => $('#commandInput').focus(), 0); } }
  renderCommands();
  $('#commandInput').addEventListener('input', event => renderCommands(event.target.value));
  $('#palette').addEventListener('click', event => { if (event.target.id === 'palette') openPalette(false); });

  // ---------- Shortcuts and remaining shell controls ----------
  function isTyping(event) { return /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable; }
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') { closeMenu(); closeDialog(); openPalette(false); if (!isTyping(event)) canvas.clearSelection(); return; }
    if (mod && event.shiftKey && key === 'p') { event.preventDefault(); return openPalette(true); }
    if (isTyping(event)) return;
    const shortcut =
      mod && event.shiftKey && key === 'n' ? 'templates' : mod && event.altKey && key === 's' ? 'saveAll' : mod && event.shiftKey && key === 's' ? 'saveAs' : mod && event.shiftKey && key === 'z' ? 'redo' :
      mod && event.shiftKey && key === 'tab' ? 'previousTab' : mod && key === 'tab' ? 'nextTab' : mod && key === 'w' ? 'closeTab' :
      mod && key === 'n' ? 'new' : mod && key === 'o' ? 'open' : mod && key === 's' ? 'save' : mod && key === 'z' ? 'undo' : mod && key === 'y' ? 'redo' : mod && key === 'a' ? 'selectAll' :
      mod && key === 'x' ? 'cut' : mod && key === 'c' ? 'copy' : mod && key === 'v' ? 'paste' : mod && key === 'd' ? 'duplicate' :
      mod && key === 'b' ? 'toggleLeft' : mod && key === 'j' ? 'toggleBottom' : mod && event.altKey && key === 'i' ? 'toggleRight' :
      mod && (key === '+' || key === '=') ? 'zoomIn' : mod && key === '-' ? 'zoomOut' : event.key === 'Delete' || event.key === 'Backspace' ? 'delete' :
      event.key === 'F6' && event.shiftKey ? 'stop' : event.key === 'F6' ? 'run' : event.key === 'F7' ? 'pause' : event.key === 'F11' ? 'fullscreen' :
      event.shiftKey && key === 'l' ? 'layoutSelected' : key === 'l' ? 'layout' : event.shiftKey && key === 'o' ? 'optimizeSelected' : key === 'o' ? 'optimize' : key === 'f' ? 'fit' : key === 'h' ? 'pan' : event.shiftKey && key === 'g' ? 'snap' : key === 'g' ? 'grid' :
      mod && key === '1' ? 'components' : mod && key === '2' ? 'explorer' : mod && key === '3' ? 'examples' : null;
    if (shortcut) { event.preventDefault(); actions[shortcut]?.(); }
  });

  $$('.new-circuit-btn,.add-tab').forEach(button => button.addEventListener('click', newCircuit));
  $$('[data-command="toggle-left"]').forEach(button => button.addEventListener('click', () => togglePanel('leftPanel', false)));
  $$('[data-command="toggle-right"]').forEach(button => button.addEventListener('click', () => togglePanel('rightPanel', false)));
  $$('[data-command="shortcuts"]').forEach(button => button.addEventListener('click', showShortcuts));
  $$('[data-command="settings"],#settingsBtn').forEach(button => button.addEventListener('click', () => showDialog('View settings', '<p>Use the View menu to toggle the grid, snap, side panels and zoom. Component-specific electrical settings are available in the Inspector.</p>')));
  $$('.tree-row.file').forEach(row => row.addEventListener('click', () => { $$('.tree-row.file').forEach(item => item.classList.remove('selected')); row.classList.add('selected'); }));
  $$('.bottom-tabs button').forEach(button => button.addEventListener('click', () => { $$('.bottom-tabs button').forEach(item => item.classList.remove('active')); button.classList.add('active'); log(`${button.textContent.trim()} panel selected`); }));
  $$('.meter-modes button').forEach(button => button.addEventListener('click', () => { $$('.meter-modes button').forEach(item => item.classList.remove('active')); button.classList.add('active'); toast(`Multimeter mode: ${button.textContent}`, 'success'); }));

  function updateWorkspaceSummary() { $('#outlineSummary').textContent = `${canvas.state.components.length} components · ${canvas.state.wires.length} wires`; }
  renderDocumentTabs(); updateWorkspaceSummary(); updateFileName(); updateSimulationUi(); syncViewControls(); markDirty(false);
  window.addEventListener('beforeunload', event => { if (documents.some(document => document.dirty)) { event.preventDefault(); event.returnValue = ''; } });
}
