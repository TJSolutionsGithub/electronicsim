// Component library: visual geometry, pins, defaults and editable properties.
// Keeping all metadata here makes the palette, inspector, renderer and router
// agree about every component instead of maintaining parallel hard-coded lists.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
};
const text = (x, y, value, className = '') => {
  const node = el('text', { x, y, class: className });
  node.textContent = value;
  return node;
};
const path = (d, className = 'symbol-path') => el('path', { d, class: className });
const line = (x1, y1, x2, y2, className = 'symbol-path') => el('line', { x1, y1, x2, y2, class: className });
const arrow = (x1, y1, x2, y2, className = 'symbol-path', head = 6) => {
  const angle = Math.atan2(y2 - y1, x2 - x1), wing = Math.PI / 7;
  const first = `${x2 - head * Math.cos(angle - wing)} ${y2 - head * Math.sin(angle - wing)}`;
  const second = `${x2 - head * Math.cos(angle + wing)} ${y2 - head * Math.sin(angle + wing)}`;
  return [line(x1, y1, x2, y2, className), path(`M${first} L${x2} ${y2} L${second}`, className)];
};
const circle = (cx, cy, r, className = 'symbol-shape') => el('circle', { cx, cy, r, class: className });
const rect = (x, y, width, height, className = 'symbol-shape', rx = 3) => el('rect', { x, y, width, height, rx, class: className });
const group = (children, attrs = {}) => {
  const node = el('g', attrs);
  children.forEach(child => node.appendChild(child));
  return node;
};
const diodeGlyph = (cx, cy, rotation = 0, scale = 1, className = 'symbol-path') => group([
  path('M-12 -10 L9 0 L-12 10 Z', className), line(10, -11, 10, 11, className)
], { transform: `translate(${cx} ${cy}) rotate(${rotation}) scale(${scale})`, class: 'diode-glyph' });
const labelNodes = (inst, x, y, detail = '') => [text(x, y, inst.id, 'component-ref'), ...(detail ? [text(x, y + 14, detail, 'sub')] : [])];
const twoPins = (w, y = 24) => [{ id: '1', name: '1', dx: 0, dy: y, dir: 'left' }, { id: '2', name: '2', dx: w, dy: y, dir: 'right' }];

const textProp = (key, label, unit = '') => ({ key, label, type: 'text', unit });
const numberProp = (key, label, unit = '', min, max, step = 'any') => ({ key, label, type: 'number', unit, min, max, step });
const boolProp = (key, label) => ({ key, label, type: 'boolean' });
const selectProp = (key, label, options) => ({ key, label, type: 'select', options });

const passive = (label, prefix, icon, defaults, properties, build, extra = {}) => ({
  label, prefix, icon, category: 'Basic', w: 100, h: 68, pins: twoPins(100), defaults, properties, build, ...extra
});

const logicGate = (label, icon, shape, inverted = false, singleInput = false) => ({
  label, prefix: 'U', icon, category: 'Logic', w: 112, h: 104,
  pins: [
    { id: 'A', name: 'Input A', dx: 0, dy: singleInput ? 44 : 30, dir: 'left', electrical: 'digital' },
    ...(!singleInput ? [{ id: 'B', name: 'Input B', dx: 0, dy: 62, dir: 'left', electrical: 'digital' }] : []),
    { id: 'Y', name: 'Output', dx: 112, dy: 46, dir: 'right', electrical: 'digital' },
    { id: 'VCC', name: 'Supply', dx: 56, dy: 0, dir: 'up', electrical: 'power' },
    { id: 'GND', name: 'Ground', dx: 56, dy: 104, dir: 'down', electrical: 'ground' }
  ],
  defaults: { family: '74HC', propagationDelay: '8 ns' },
  properties: [selectProp('family', 'Logic family', ['74HC', '74HCT', '74LS', 'CD4000']), textProp('propagationDelay', 'Propagation delay')],
  build(inst) {
    const outputStart = inverted ? 99 : 92;
    const nodes = [
      line(0, singleInput ? 44 : 30, 24, singleInput ? 44 : 30),
      ...(!singleInput ? [line(0, 62, 24, 62)] : []),
      line(outputStart, 46, 112, 46), line(56, 0, 56, 13), line(56, 79, 56, 104)
    ];
    if (shape === 'and') nodes.push(path('M24 14 H55 C80 14 92 28 92 46 C92 64 80 78 55 78 H24 Z'));
    if (shape === 'or' || shape === 'xor') {
      nodes.push(path('M24 14 C48 20 68 16 92 46 C68 76 48 72 24 78 C38 57 38 35 24 14 Z'));
      if (shape === 'xor') nodes.push(path('M17 14 C32 36 32 56 17 78'));
    }
    if (shape === 'not' || shape === 'schmitt') nodes.push(path('M24 14 L92 46 L24 78 Z'));
    // ANSI/IEC Schmitt-trigger hysteresis mark: offset rising/falling thresholds.
    if (shape === 'schmitt') nodes.push(path('M45 34 H56 V41 H68 M45 58 H56 V51 H68', 'schmitt-mark'));
    if (inverted) nodes.push(circle(96, 46, 4, 'logic-bubble'));
    nodes.push(circle(103, 16, 4, `logic-indicator${inst._simHigh ? ' logic-high' : ''}`));
    nodes.push(...labelNodes(inst, 34, 92, `${inst.family} · ${inst._simHigh ? 'HIGH' : 'LOW'}`));
    return nodes;
  }
});

const instrumentPins = width => [
  { id: '+', name: 'Positive', dx: 0, dy: 42, dir: 'left' },
  { id: '-', name: 'Negative / COM', dx: width, dy: 42, dir: 'right' }
];

const blockComponent = ({ label, prefix = 'U', icon = 'IC', category = 'Digital ICs', w = 132, h = 130, pins, defaults = {}, properties = [], model = '' }) => ({
  label, prefix, icon, category, w, h, pins, defaults, properties,
  build(inst) {
    const inset = 14, nodes = [rect(inset, inset, w - inset * 2, h - inset * 2, 'logic-ic-body', 4)];
    pins.forEach(pin => {
      const pinLabel = pin.name || pin.id;
      if (pin.dx === 0) { nodes.push(line(0, pin.dy, inset, pin.dy)); nodes.push(text(inset + 4, pin.dy + 3, pinLabel, 'pin-label')); }
      else if (pin.dx === w) { nodes.push(line(w - inset, pin.dy, w, pin.dy)); nodes.push(text(w - inset - 5 - String(pinLabel).length * 5, pin.dy + 3, pinLabel, 'pin-label')); }
      else if (pin.dy === 0) {
        nodes.push(line(pin.dx, 0, pin.dx, inset));
        nodes.push(text(pin.dx - String(pin.id).length * 2.5, inset + 10, pin.id, 'pin-label supply-label'));
      } else if (pin.dy === h) {
        nodes.push(line(pin.dx, h - inset, pin.dx, h));
        nodes.push(text(pin.dx - String(pin.id).length * 2.5, h - inset - 5, pin.id, 'pin-label supply-label'));
      }
    });
    nodes.push(text(26, h / 2, model || label, 'ic-title'));
    nodes.push(circle(w - 24, 25, 4, `logic-indicator${inst._simHigh ? ' logic-high' : ''}`));
    nodes.push(...labelNodes(inst, 24, h - 3, inst._simCaption || model));
    return nodes;
  }
});

const leftPin = (id, y, name = id) => ({ id, name, dx: 0, dy: y, dir: 'left', electrical: 'digital' });
const rightPin = (id, w, y, name = id) => ({ id, name, dx: w, dy: y, dir: 'right', electrical: 'digital' });
const supplyPins = (w, h) => [
  { id: 'VCC', name: 'Supply', dx: w / 2, dy: 0, dir: 'up', electrical: 'power' },
  { id: 'GND', name: 'Ground', dx: w / 2, dy: h, dir: 'down', electrical: 'ground' }
];

export const COMPONENT_TYPES = {
  resistor: passive('Resistor', 'R', 'R', { value: '220 Ω', tolerance: '5%', power: '0.25 W' }, [
    textProp('value', 'Resistance'), selectProp('tolerance', 'Tolerance', ['1%', '2%', '5%', '10%']), textProp('power', 'Power rating')
  ], inst => [line(0, 24, 14, 24), path('M14 24 l10 -12 10 24 10 -24 10 24 10 -24 10 24 12 -12'), line(86, 24, 100, 24), ...labelNodes(inst, 32, 53, inst.value)]),

  potentiometer: {
    label: 'Potentiometer', prefix: 'RV', icon: '↗R', category: 'Basic', w: 100, h: 82,
    pins: [...twoPins(100, 24), { id: 'W', name: 'Wiper', dx: 50, dy: 0, dir: 'up' }],
    defaults: { value: '10 kΩ', position: 50, taper: 'Linear' },
    properties: [textProp('value', 'Resistance'), numberProp('position', 'Wiper', '%', 0, 100, 1), selectProp('taper', 'Taper', ['Linear', 'Logarithmic'])],
    build: inst => [line(0, 24, 14, 24), path('M14 24 l10 -12 10 24 10 -24 10 24 10 -24 10 24 12 -12'), line(86, 24, 100, 24), line(50, 0, 50, 12), path('M44 8 l6 6 6 -6'), ...labelNodes(inst, 28, 56, `${inst.value} · ${inst.position}%`)]
  },

  capacitor: passive('Capacitor', 'C', 'C', { value: '100 nF', voltage: '50 V' }, [textProp('value', 'Capacitance'), textProp('voltage', 'Max voltage')], inst => [line(0, 24, 42, 24), line(42, 8, 42, 40), line(58, 8, 58, 40), line(58, 24, 100, 24), ...labelNodes(inst, 29, 55, inst.value)]),

  'polarized-capacitor': passive('Polarized capacitor', 'C', 'C+', { value: '10 µF', voltage: '25 V' }, [textProp('value', 'Capacitance'), textProp('voltage', 'Max voltage')], inst => [line(0, 24, 42, 24), line(42, 8, 42, 40), path('M58 8 Q48 24 58 40'), line(58, 24, 100, 24), text(29, 11, '+', 'polarity'), ...labelNodes(inst, 25, 55, inst.value)], {
    pins: [{ id: '1', name: 'Positive', dx: 0, dy: 24, dir: 'left' }, { id: '2', name: 'Negative', dx: 100, dy: 24, dir: 'right' }]
  }),

  inductor: passive('Inductor', 'L', 'L', { value: '10 mH', current: '1 A' }, [textProp('value', 'Inductance'), textProp('current', 'Max current')], inst => [line(0, 24, 16, 24), path('M16 24 q8 -20 16 0 q8 -20 16 0 q8 -20 16 0 q8 -20 16 0 q8 -20 16 0'), line(80, 24, 100, 24), ...labelNodes(inst, 28, 55, inst.value)]),

  fuse: passive('Fuse', 'F', 'F', { rating: '1 A', voltage: '250 V' }, [textProp('rating', 'Current rating'), textProp('voltage', 'Voltage rating')], inst => [line(0, 24, 22, 24), rect(22, 13, 56, 22, 'symbol-shape', 11), line(29, 24, 71, 24), line(78, 24, 100, 24), ...labelNodes(inst, 34, 55, inst.rating)]),

  transformer: {
    label: 'Transformer', prefix: 'T', icon: '∿∿', category: 'Basic', w: 100, h: 100,
    pins: [{ id: 'P1', name: 'Primary start', dx: 0, dy: 20, dir: 'left' }, { id: 'P2', name: 'Primary end', dx: 0, dy: 72, dir: 'left' }, { id: 'S1', name: 'Secondary start', dx: 100, dy: 20, dir: 'right' }, { id: 'S2', name: 'Secondary end', dx: 100, dy: 72, dir: 'right' }],
    defaults: { ratio: '10:1', power: '5 VA' }, properties: [textProp('ratio', 'Turns ratio'), textProp('power', 'Power rating')],
    build: inst => [line(0, 20, 24, 20), line(0, 72, 24, 72), path('M24 20 q18 8 0 17 q18 8 0 18 q18 8 0 17'), line(43, 11, 43, 82), line(55, 11, 55, 82), path('M76 20 q-18 8 0 17 q-18 8 0 18 q-18 8 0 17'), line(76, 20, 100, 20), line(76, 72, 100, 72), circle(33, 16, 2.5, 'polarity-dot'), circle(67, 16, 2.5, 'polarity-dot'), text(4, 15, 'P1', 'terminal-label'), text(82, 15, 'S1', 'terminal-label'), ...labelNodes(inst, 38, 96, inst.ratio)]
  },

  diode: passive('Diode', 'D', '▷|', { model: '1N4148', forwardVoltage: '0.7 V' }, [textProp('model', 'Model'), textProp('forwardVoltage', 'Forward voltage')], inst => [line(0, 24, 31, 24), path('M31 8 L67 24 L31 40 Z'), line(68, 7, 68, 41), line(68, 24, 100, 24), text(14, 17, 'A', 'terminal-label'), text(79, 17, 'K', 'terminal-label'), ...labelNodes(inst, 28, 55, inst.model)], {
    category: 'Semiconductors', pins: [{ id: '1', name: 'Anode (A)', dx: 0, dy: 24, dir: 'left' }, { id: '2', name: 'Cathode (K)', dx: 100, dy: 24, dir: 'right' }]
  }),

  zener: passive('Zener diode', 'DZ', 'Z', { voltage: '5.1 V', power: '0.5 W' }, [textProp('voltage', 'Zener voltage'), textProp('power', 'Power rating')], inst => [line(0, 24, 31, 24), path('M31 8 L67 24 L31 40 Z'), path('M61 7 H69 V14 M69 34 V41 H77'), line(68, 24, 100, 24), text(14, 17, 'A', 'terminal-label'), text(79, 17, 'K', 'terminal-label'), ...labelNodes(inst, 28, 55, inst.voltage)], {
    category: 'Semiconductors', pins: [{ id: '1', name: 'Anode (A)', dx: 0, dy: 24, dir: 'left' }, { id: '2', name: 'Cathode (K)', dx: 100, dy: 24, dir: 'right' }]
  }),

  led: {
    label: 'LED', prefix: 'LED', icon: '◉', category: 'Semiconductors', w: 92, h: 78,
    pins: [{ id: 'A', name: 'Anode', dx: 0, dy: 28, dir: 'left' }, { id: 'K', name: 'Cathode', dx: 92, dy: 28, dir: 'right' }],
    defaults: { color: 'Red', forwardVoltage: '2.0 V', on: false },
    properties: [selectProp('color', 'Color', ['Red', 'Green', 'Blue', 'Amber', 'White']), textProp('forwardVoltage', 'Forward voltage')],
    build: inst => [line(0, 28, 25, 28), circle(46, 28, 21, 'led-ring'), path('M33 13 L59 28 L33 43 Z'), line(60, 11, 60, 45), line(60, 28, 92, 28), ...arrow(57, 12, 72, 2, 'light-rays', 5), ...arrow(64, 20, 81, 10, 'light-rays', 5), text(9, 21, 'A', 'terminal-label'), text(78, 21, 'K', 'terminal-label'), ...labelNodes(inst, 28, 65, `${inst.color} · ${(inst._simOn ?? inst.on) ? 'ON' : 'OFF'}`)]
  },

  'switch-spst': {
    label: 'Switch SPST', prefix: 'S', icon: '—/', category: 'Switches', w: 100, h: 68, pins: twoPins(100, 25),
    defaults: { closed: false, contactResistance: '0.05 Ω' }, properties: [boolProp('closed', 'Closed'), textProp('contactResistance', 'Contact resistance')],
    build: inst => [line(0, 25, 28, 25), circle(30, 25, 3, 'terminal'), circle(70, 25, 3, 'terminal'), line(70, 25, 100, 25), line(31, 23, inst.closed ? 69 : 63, inst.closed ? 23 : 7, 'switch-arm'), ...labelNodes(inst, 30, 54, inst.closed ? 'CLOSED' : 'OPEN')]
  },

  'switch-spdt': {
    label: 'Switch SPDT', prefix: 'S', icon: '—/<', category: 'Switches', w: 108, h: 86,
    pins: [{ id: 'COM', name: 'Common', dx: 0, dy: 38, dir: 'left' }, { id: 'A', name: 'Throw A', dx: 108, dy: 18, dir: 'right' }, { id: 'B', name: 'Throw B', dx: 108, dy: 58, dir: 'right' }],
    defaults: { position: 'A' }, properties: [selectProp('position', 'Position', ['A', 'B'])],
    build: inst => [line(0, 38, 30, 38), circle(31, 38, 3, 'terminal'), circle(76, 18, 3, 'terminal'), circle(76, 58, 3, 'terminal'), line(76, 18, 108, 18), line(76, 58, 108, 58), line(32, 36, 74, inst.position === 'A' ? 19 : 57, 'switch-arm'), ...labelNodes(inst, 37, 78, `→ ${inst.position}`)]
  },

  pushbutton: {
    label: 'Push button', prefix: 'SW', icon: '↓', category: 'Switches', w: 100, h: 72, pins: twoPins(100, 30),
    defaults: { closed: false, normallyClosed: false }, properties: [boolProp('closed', 'Pressed'), boolProp('normallyClosed', 'Normally closed')],
    build: inst => { const conducting = inst.normallyClosed ? !inst.closed : inst.closed; return [line(0, 30, 30, 30), line(70, 30, 100, 30), circle(31, 30, 3, 'terminal'), circle(69, 30, 3, 'terminal'), line(31, conducting ? 28 : 18, 69, conducting ? 28 : 18, 'switch-arm'), line(50, 2, 50, 17), line(38, 2, 62, 2), ...labelNodes(inst, 27, 59, inst.closed ? 'PRESSED' : 'RELEASED')]; }
  },

  relay: {
    label: 'Relay SPST', prefix: 'K', icon: 'K', category: 'Switches', w: 124, h: 100,
    pins: [{ id: 'A1', name: 'Coil A1', dx: 0, dy: 23, dir: 'left' }, { id: 'A2', name: 'Coil A2', dx: 0, dy: 70, dir: 'left' }, { id: 'COM', name: 'Common', dx: 124, dy: 23, dir: 'right' }, { id: 'NO', name: 'Normally open', dx: 124, dy: 70, dir: 'right' }],
    defaults: { coilVoltage: '5 V', energized: false }, properties: [textProp('coilVoltage', 'Coil voltage'), boolProp('energized', 'Energized')],
    build: inst => { const energized = inst._simEnergized ?? inst.energized; return [line(0, 23, 18, 23), line(0, 70, 18, 70), path('M18 23 C34 23 34 34 18 34 C34 34 34 45 18 45 C34 45 34 56 18 56 C34 56 34 70 18 70', 'relay-coil'), path('M39 47 H68', 'mechanical-link'), line(76, 23, 124, 23), line(76, 70, 124, 70), circle(77, 23, 3, 'terminal'), circle(77, 70, 3, 'terminal'), line(78, 25, energized ? 78 : 108, energized ? 68 : 52, 'switch-arm'), text(92, 17, 'COM', 'terminal-label'), text(94, 65, 'NO', 'terminal-label'), ...labelNodes(inst, 48, 93, `${inst.coilVoltage} · ${energized ? 'ON' : 'OFF'}`)]; }
  },

  battery: {
    label: 'Battery', prefix: 'BT', icon: '▯', category: 'Sources', w: 100, h: 76, pins: [{ id: '+', name: 'Positive', dx: 0, dy: 28, dir: 'left', electrical: 'power' }, { id: '-', name: 'Negative', dx: 100, dy: 28, dir: 'right', electrical: 'ground' }],
    defaults: { voltage: 9, internalResistance: '0.5 Ω' }, properties: [numberProp('voltage', 'Voltage', 'V', 0, 1000, 0.1), textProp('internalResistance', 'Internal resistance')],
    build: inst => [line(0, 28, 30, 28), line(30, 7, 30, 49), line(41, 14, 41, 42), line(41, 28, 55, 28), line(55, 7, 55, 49), line(66, 14, 66, 42), line(66, 28, 100, 28), text(17, 13, '+', 'polarity'), text(73, 13, '−', 'polarity'), ...labelNodes(inst, 31, 62, `${inst.voltage} V`)]
  },

  'dc-source': {
    label: 'DC voltage source', prefix: 'V', icon: '⎓', category: 'Sources', w: 94, h: 88,
    pins: [{ id: '+', name: 'Positive', dx: 0, dy: 36, dir: 'left', electrical: 'power' }, { id: '-', name: 'Negative', dx: 94, dy: 36, dir: 'right', electrical: 'ground' }],
    defaults: { voltage: 5, currentLimit: 1 }, properties: [numberProp('voltage', 'Voltage', 'V', -1000, 1000, 0.1), numberProp('currentLimit', 'Current limit', 'A', 0, 100, 0.1)],
    // Polarity marks align with the actual left (+) and right (-) terminals.
    build: inst => [line(0, 36, 18, 36), circle(47, 36, 28), line(76, 36, 94, 36), text(27, 41, '+', 'source-sign'), text(61, 41, '−', 'source-sign'), ...labelNodes(inst, 29, 78, `${inst.voltage} V`)]
  },

  'ac-source': {
    label: 'AC voltage source', prefix: 'VS', icon: '∿', category: 'Sources', w: 94, h: 88,
    pins: [{ id: '1', name: 'AC terminal 1', dx: 0, dy: 36, dir: 'left' }, { id: '2', name: 'AC terminal 2', dx: 94, dy: 36, dir: 'right' }], defaults: { voltage: 12, frequency: 60, phase: 0 },
    properties: [numberProp('voltage', 'RMS voltage', 'V', 0, 1000, 0.1), numberProp('frequency', 'Frequency', 'Hz', 0, 1e9, 0.1), numberProp('phase', 'Phase', '°', -360, 360, 1)],
    build: inst => [line(0, 36, 18, 36), circle(47, 36, 28), path('M28 36 q9 -16 19 0 q10 16 19 0'), line(76, 36, 94, 36), ...labelNodes(inst, 24, 78, `${inst.voltage} V / ${inst.frequency} Hz`)]
  },

  'current-source': {
    label: 'Current source', prefix: 'I', icon: '→', category: 'Sources', w: 94, h: 88,
    pins: [{ id: '1', name: 'Current enters', dx: 0, dy: 36, dir: 'left' }, { id: '2', name: 'Current exits', dx: 94, dy: 36, dir: 'right' }], defaults: { current: '20 mA' }, properties: [textProp('current', 'Current')],
    // Arrow direction matches the SPICE convention: pin 1 → pin 2.
    build: inst => [line(0, 36, 18, 36), circle(47, 36, 28), line(76, 36, 94, 36), ...arrow(30, 36, 64, 36, 'source-arrow', 8), ...labelNodes(inst, 28, 78, inst.current)]
  },

  ground: {
    label: 'Ground', prefix: 'GND', icon: '⏚', category: 'Power & reference', w: 50, h: 66,
    pins: [{ id: '1', name: 'Ground', dx: 25, dy: 0, dir: 'up', electrical: 'ground' }], defaults: {}, properties: [],
    build: inst => [line(25, 0, 25, 20), line(4, 20, 46, 20), line(11, 29, 39, 29), line(18, 38, 32, 38), ...labelNodes(inst, 9, 58)]
  },

  vcc: {
    label: 'Power port', prefix: 'VCC', icon: '▲', category: 'Power & reference', w: 54, h: 66,
    pins: [{ id: '1', name: 'Power', dx: 27, dy: 66, dir: 'down', electrical: 'power' }], defaults: { net: 'VCC', voltage: 5 },
    properties: [textProp('net', 'Net name'), numberProp('voltage', 'Nominal voltage', 'V', -1000, 1000, 0.1)],
    build: inst => [line(27, 66, 27, 22), path('M10 24 L27 4 L44 24 Z'), ...labelNodes(inst, 10, 51, `${inst.net} · ${inst.voltage} V`)]
  },

  lamp: {
    label: 'Lamp', prefix: 'LP', icon: '⊗', category: 'Outputs', w: 94, h: 88, pins: twoPins(94, 36),
    defaults: { voltage: 12, power: '5 W', on: false }, properties: [numberProp('voltage', 'Rated voltage', 'V', 0, 1000, 0.1), textProp('power', 'Power')],
    build: inst => [line(0, 36, 18, 36), circle(47, 36, 28, (inst._simOn ?? inst.on) ? 'symbol-shape lamp-on' : 'symbol-shape'), line(28, 17, 66, 55), line(66, 17, 28, 55), line(76, 36, 94, 36), ...labelNodes(inst, 31, 78, `${inst.voltage} V`)]
  },

  motor: {
    label: 'DC motor', prefix: 'M', icon: 'M', category: 'Outputs', w: 94, h: 88, pins: twoPins(94, 36),
    defaults: { voltage: 6, rpm: 3000, running: false }, properties: [numberProp('voltage', 'Rated voltage', 'V', 0, 1000, 0.1), numberProp('rpm', 'Speed', 'RPM', 0, 100000, 1)],
    build: inst => [line(0, 36, 18, 36), circle(47, 36, 28), text(37, 44, 'M', 'motor-letter'), line(76, 36, 94, 36), ...labelNodes(inst, 28, 78, `${inst.voltage} V`)]
  },

  buzzer: {
    label: 'Buzzer', prefix: 'BZ', icon: '♪', category: 'Outputs', w: 94, h: 82, pins: twoPins(94, 34),
    defaults: { voltage: 5, frequency: 2400 }, properties: [numberProp('voltage', 'Rated voltage', 'V', 0, 1000, 0.1), numberProp('frequency', 'Tone', 'Hz', 1, 50000, 1)],
    build: inst => [line(0, 34, 29, 34), path('M29 23 H44 L60 10 V58 L44 45 H29 Z'), path('M66 21 q13 13 0 26 M72 14 q20 20 0 40'), line(60, 34, 94, 34), ...labelNodes(inst, 26, 72, `${inst.frequency} Hz`)]
  },

  'transistor-npn': {
    label: 'NPN transistor', prefix: 'Q', icon: 'NPN', category: 'Semiconductors', w: 96, h: 94,
    pins: [{ id: 'B', name: 'Base', dx: 0, dy: 46, dir: 'left' }, { id: 'C', name: 'Collector', dx: 96, dy: 18, dir: 'right' }, { id: 'E', name: 'Emitter', dx: 96, dy: 74, dir: 'right' }],
    defaults: { model: '2N2222', gain: 100 }, properties: [textProp('model', 'Model'), numberProp('gain', 'DC gain β', '', 1, 1000, 1)],
    build: inst => [line(0, 46, 35, 46), line(35, 20, 35, 72), line(35, 34, 76, 18), line(35, 58, 76, 74), line(76, 18, 96, 18), line(76, 74, 96, 74), ...arrow(55, 66, 73, 73, 'transistor-arrow', 7), text(12, 40, 'B', 'terminal-label'), text(82, 13, 'C', 'terminal-label'), text(82, 70, 'E', 'terminal-label'), ...labelNodes(inst, 38, 91, inst.model)]
  },

  'transistor-pnp': {
    label: 'PNP transistor', prefix: 'Q', icon: 'PNP', category: 'Semiconductors', w: 96, h: 94,
    pins: [{ id: 'B', name: 'Base', dx: 0, dy: 46, dir: 'left' }, { id: 'E', name: 'Emitter', dx: 96, dy: 18, dir: 'right' }, { id: 'C', name: 'Collector', dx: 96, dy: 74, dir: 'right' }],
    defaults: { model: '2N2907', gain: 100 }, properties: [textProp('model', 'Model'), numberProp('gain', 'DC gain β', '', 1, 1000, 1)],
    build: inst => [line(0, 46, 35, 46), line(35, 20, 35, 72), line(35, 34, 76, 18), line(35, 58, 76, 74), line(76, 18, 96, 18), line(76, 74, 96, 74), ...arrow(73, 19, 55, 28, 'transistor-arrow', 7), text(12, 40, 'B', 'terminal-label'), text(82, 13, 'E', 'terminal-label'), text(82, 70, 'C', 'terminal-label'), ...labelNodes(inst, 38, 91, inst.model)]
  },

  nmos: {
    label: 'N-channel MOSFET', prefix: 'Q', icon: 'NMOS', category: 'Semiconductors', w: 104, h: 96,
    pins: [{ id: 'G', name: 'Gate', dx: 0, dy: 48, dir: 'left' }, { id: 'D', name: 'Drain', dx: 104, dy: 17, dir: 'right' }, { id: 'S', name: 'Source', dx: 104, dy: 79, dir: 'right' }],
    defaults: { model: '2N7000', threshold: '2.1 V' }, properties: [textProp('model', 'Model'), textProp('threshold', 'Threshold')],
    build: inst => [line(0, 48, 30, 48), line(30, 18, 30, 78), line(42, 25, 42, 42), line(42, 54, 42, 71), line(42, 33, 77, 17), line(42, 63, 77, 79), line(77, 17, 104, 17), line(77, 79, 104, 79), ...arrow(68, 63, 50, 63, 'transistor-arrow', 7), text(12, 42, 'G', 'terminal-label'), text(88, 12, 'D', 'terminal-label'), text(88, 75, 'S', 'terminal-label'), ...labelNodes(inst, 40, 93, inst.model)]
  },

  opamp: {
    label: 'Operational amplifier', prefix: 'U', icon: '△', category: 'Semiconductors', w: 118, h: 104,
    pins: [{ id: '+', dx: 0, dy: 32, dir: 'left' }, { id: '-', dx: 0, dy: 72, dir: 'left' }, { id: 'OUT', dx: 118, dy: 52, dir: 'right' }, { id: 'V+', dx: 56, dy: 0, dir: 'up', electrical: 'power' }, { id: 'V-', dx: 56, dy: 104, dir: 'down', electrical: 'ground' }],
    defaults: { model: 'LM358', gainBandwidth: '1 MHz' }, properties: [textProp('model', 'Model'), textProp('gainBandwidth', 'Gain bandwidth')],
    build: inst => [line(0, 32, 24, 32), line(0, 72, 24, 72), path('M24 10 L24 94 L98 52 Z'), line(98, 52, 118, 52), line(56, 0, 56, 27), line(56, 77, 56, 104), text(31, 36, '+', 'source-sign'), text(32, 77, '−', 'source-sign'), ...labelNodes(inst, 48, 97, inst.model)]
  },

  thermistor: passive('NTC thermistor', 'RT', 'NTC', { resistance: '10 kΩ', beta: '3950 K', temperature: 25 }, [
    textProp('resistance', 'Resistance at 25°C'), textProp('beta', 'Beta coefficient'), numberProp('temperature', 'Temperature', '°C', -55, 200, 1)
  ], inst => [line(0, 24, 14, 24), path('M14 24 l10 -12 10 24 10 -24 10 24 10 -24 10 24 12 -12'), line(86, 24, 100, 24), path('M29 42 L70 5 M62 5 H70 V13'), ...labelNodes(inst, 24, 57, `${inst.resistance} · ${inst.temperature}°C`)], { category: 'Sensors' }),

  photoresistor: passive('Photoresistor (LDR)', 'RPH', '☀R', { resistance: '10 kΩ', illumination: '500 lx' }, [
    textProp('resistance', 'Light resistance'), textProp('illumination', 'Illumination')
  ], inst => [line(0, 24, 18, 24), rect(18, 7, 64, 34, 'symbol-shape', 16), path('M24 24 l9 -10 9 20 9 -20 9 20 9 -10'), line(82, 24, 100, 24), ...arrow(92, 0, 73, 12, 'light-rays', 5), ...arrow(99, 11, 79, 23, 'light-rays', 5), ...labelNodes(inst, 24, 57, inst.illumination)], { category: 'Sensors' }),

  speaker: {
    label: 'Speaker', prefix: 'SPK', icon: '◖))', category: 'Outputs', w: 104, h: 88, pins: twoPins(104, 36),
    defaults: { impedance: '8 Ω', power: '1 W', on: false }, properties: [textProp('impedance', 'Impedance'), textProp('power', 'Power rating')],
    build: inst => [line(0, 36, 26, 36), path('M26 23 H42 L61 8 V64 L42 49 H26 Z'), path('M67 22 q13 14 0 28 M74 14 q22 22 0 44'), line(61, 36, 104, 36), ...labelNodes(inst, 30, 78, `${inst.impedance} · ${(inst._simOn ?? inst.on) ? 'ACTIVE' : 'IDLE'}`)]
  },

  comparator: {
    label: 'Voltage comparator', prefix: 'U', icon: '▷', category: 'Analog ICs', w: 118, h: 104,
    pins: [{ id: '+', name: 'Non-inverting', dx: 0, dy: 32, dir: 'left' }, { id: '-', name: 'Inverting', dx: 0, dy: 72, dir: 'left' }, { id: 'OUT', dx: 118, dy: 52, dir: 'right' }, { id: 'VCC', dx: 56, dy: 0, dir: 'up', electrical: 'power' }, { id: 'GND', dx: 56, dy: 104, dir: 'down', electrical: 'ground' }],
    defaults: { model: 'LM393', output: 'Open collector' }, properties: [textProp('model', 'Model'), selectProp('output', 'Output type', ['Open collector', 'Push-pull'])],
    build: inst => [line(0, 32, 24, 32), line(0, 72, 24, 72), path('M24 10 L24 94 L98 52 Z'), line(98, 52, 118, 52), line(56, 0, 56, 27), line(56, 77, 56, 104), text(31, 36, '+', 'source-sign'), text(32, 77, '−', 'source-sign'), circle(105, 18, 4, `logic-indicator${inst._simHigh ? ' logic-high' : ''}`), ...labelNodes(inst, 46, 97, `${inst.model} · ${inst._simHigh ? 'HIGH' : 'LOW'}`)]
  },

  'logic-and': logicGate('AND gate', 'AND', 'and'),
  'logic-or': logicGate('OR gate', 'OR', 'or'),
  'logic-not': logicGate('NOT gate', 'NOT', 'not', true, true),
  'logic-nand': logicGate('NAND gate', 'NAND', 'and', true),
  'logic-nor': logicGate('NOR gate', 'NOR', 'or', true),
  'logic-xor': logicGate('XOR gate', 'XOR', 'xor'),
  'logic-xnor': logicGate('XNOR gate', 'XNOR', 'xor', true),

  'logic-input': {
    label: 'Logic input', prefix: 'DIN', icon: '0/1', category: 'Digital sources', w: 96, h: 84,
    pins: [{ id: 'OUT', name: 'Digital output', dx: 96, dy: 36, dir: 'right', electrical: 'digital' }, { id: 'GND', name: 'Ground', dx: 48, dy: 84, dir: 'down', electrical: 'ground' }],
    defaults: { high: true, voltage: 5, label: 'INPUT' }, properties: [boolProp('high', 'Logic HIGH'), numberProp('voltage', 'High voltage', 'V', 1.8, 24, 0.1), textProp('label', 'Signal label')],
    build: inst => [rect(8, 10, 68, 52, 'logic-source-body', 5), line(76, 36, 96, 36), line(48, 62, 48, 84), text(31, 45, (inst._simHigh ?? inst.high) ? '1' : '0', 'logic-value'), ...labelNodes(inst, 16, 76, `${inst.label} · ${(inst._simHigh ?? inst.high) ? 'HIGH' : 'LOW'}`)]
  },

  'clock-generator': {
    label: 'Digital clock', prefix: 'CLK', icon: '▱', category: 'Digital sources', w: 108, h: 92,
    pins: [{ id: 'OUT', name: 'Clock output', dx: 108, dy: 39, dir: 'right', electrical: 'digital' }, { id: 'GND', name: 'Ground', dx: 54, dy: 92, dir: 'down', electrical: 'ground' }],
    defaults: { frequency: 1000, dutyCycle: 50, enabled: true, high: true }, properties: [numberProp('frequency', 'Frequency', 'Hz', 0.1, 1e9, 0.1), numberProp('dutyCycle', 'Duty cycle', '%', 1, 99, 1), boolProp('enabled', 'Enabled'), boolProp('high', 'Current HIGH')],
    build: inst => [rect(8, 9, 78, 58, 'logic-source-body', 5), path('M18 48 V27 H36 V48 H55 V27 H76'), line(86, 39, 108, 39), line(54, 67, 54, 92), circle(94, 16, 4, `logic-indicator${inst._simHigh ? ' logic-high' : ''}`), ...labelNodes(inst, 18, 81, `${inst.frequency} Hz · ${inst._simHigh ? 'HIGH' : 'LOW'}`)]
  },

  'd-flip-flop': {
    label: 'D flip-flop', prefix: 'U', icon: 'D→Q', category: 'Logic', w: 126, h: 154,
    pins: [{ id: 'D', dx: 0, dy: 40, dir: 'left', electrical: 'digital' }, { id: 'CLK', dx: 0, dy: 78, dir: 'left', electrical: 'digital' }, { id: 'SET', dx: 0, dy: 112, dir: 'left', electrical: 'digital' }, { id: 'Q', dx: 126, dy: 40, dir: 'right', electrical: 'digital' }, { id: 'QN', name: 'Q not', dx: 126, dy: 88, dir: 'right', electrical: 'digital' }, { id: 'VCC', dx: 63, dy: 0, dir: 'up', electrical: 'power' }, { id: 'GND', dx: 63, dy: 154, dir: 'down', electrical: 'ground' }],
    defaults: { q: false, family: 'Generic DFF', edge: 'Rising' }, properties: [boolProp('q', 'Stored Q'), textProp('family', 'Device'), selectProp('edge', 'Clock edge', ['Rising', 'Falling'])],
    build: inst => { const q = inst._simQ ?? inst.q; return [rect(24, 14, 78, 122, 'logic-ic-body', 3), line(0, 40, 24, 40), line(0, 78, 24, 78), line(0, 112, 24, 112), line(102, 40, 126, 40), line(112, 88, 126, 88), circle(107, 88, 5, 'logic-bubble'), line(63, 0, 63, 14), line(63, 136, 63, 154), path('M24 70 l10 8 -10 8'), text(35, 45, 'D', 'pin-label'), text(35, 82, 'CLK', 'pin-label'), text(34, 116, 'S', 'pin-label'), text(83, 45, 'Q', 'pin-label'), text(78, 92, 'Q̅', 'pin-label'), circle(113, 18, 4, `logic-indicator${q ? ' logic-high' : ''}`), ...labelNodes(inst, 39, 149, `${inst.family} · Q=${q ? '1' : '0'}`)]; }
  },

  'seven-segment': {
    label: '7-segment display', prefix: 'DS', icon: '8.', category: 'Digital outputs', w: 120, h: 190,
    pins: [
      { id: 'A', dx: 0, dy: 24, dir: 'left' }, { id: 'B', dx: 0, dy: 58, dir: 'left' }, { id: 'C', dx: 0, dy: 92, dir: 'left' }, { id: 'D', dx: 0, dy: 126, dir: 'left' },
      { id: 'E', dx: 120, dy: 24, dir: 'right' }, { id: 'F', dx: 120, dy: 58, dir: 'right' }, { id: 'G', dx: 120, dy: 92, dir: 'right' }, { id: 'DP', dx: 120, dy: 126, dir: 'right' },
      { id: 'COM', name: 'Common cathode', dx: 60, dy: 190, dir: 'down', electrical: 'ground' }
    ],
    defaults: { color: 'Red', common: 'Cathode' }, properties: [selectProp('color', 'Color', ['Red', 'Green', 'Blue']), selectProp('common', 'Common', ['Cathode'])],
    build(inst) {
      const on = new Set(inst._simSegments || []), segment = (id, x, y, width, height) => rect(x, y, width, height, `seven-segment${on.has(id) ? ' segment-on' : ''}`, 3);
      return [rect(22, 10, 76, 145, 'display-body', 7), segment('A', 41, 22, 38, 7), segment('B', 78, 31, 7, 45), segment('C', 78, 83, 7, 45), segment('D', 41, 129, 38, 7), segment('E', 34, 83, 7, 45), segment('F', 34, 31, 7, 45), segment('G', 41, 76, 38, 7), circle(91, 131, 5, `seven-segment${on.has('DP') ? ' segment-on' : ''}`), line(0, 24, 22, 24), line(0, 58, 22, 58), line(0, 92, 22, 92), line(0, 126, 22, 126), line(98, 24, 120, 24), line(98, 58, 120, 58), line(98, 92, 120, 92), line(98, 126, 120, 126), line(60, 155, 60, 190), ...labelNodes(inst, 33, 174, `${inst.common} · ${on.size} ON`)];
    }
  },

  voltmeter: {
    label: 'Digital voltmeter', prefix: 'VM', icon: 'V', category: 'Instruments', w: 116, h: 104, pins: instrumentPins(116),
    defaults: { range: 'Auto', impedance: '10 MΩ' }, properties: [selectProp('range', 'Range', ['Auto', '200 mV', '2 V', '20 V', '200 V', '1000 V']), textProp('impedance', 'Input impedance')],
    build: inst => [line(0, 42, 15, 42), line(101, 42, 116, 42), rect(15, 9, 86, 68, 'instrument-body', 6), rect(24, 20, 68, 28, 'instrument-screen', 2), text(31, 40, inst._simReading || '0.00 V', 'instrument-reading'), text(25, 63, `V DC · ${inst.range}`, 'instrument-caption'), text(4, 35, '+', 'polarity'), text(103, 35, '−', 'polarity'), ...labelNodes(inst, 38, 94, inst.impedance)]
  },

  ammeter: {
    label: 'Digital ammeter', prefix: 'AM', icon: 'A', category: 'Instruments', w: 116, h: 104, pins: instrumentPins(116),
    defaults: { range: 'Auto', burden: '100 mV' }, properties: [selectProp('range', 'Range', ['Auto', '20 mA', '200 mA', '10 A']), textProp('burden', 'Burden voltage')],
    build: inst => [line(0, 42, 15, 42), line(101, 42, 116, 42), rect(15, 9, 86, 68, 'instrument-body', 6), rect(24, 20, 68, 28, 'instrument-screen', 2), text(29, 40, inst._simReading || '0.000 A', 'instrument-reading'), text(25, 63, `A DC · ${inst.range}`, 'instrument-caption'), text(4, 35, '+', 'polarity'), text(103, 35, '−', 'polarity'), ...labelNodes(inst, 38, 94, inst.burden)]
  },

  oscilloscope: {
    label: '2-channel oscilloscope', prefix: 'OSC', icon: '▰∿', category: 'Instruments', w: 150, h: 126,
    pins: [{ id: 'CH1', dx: 0, dy: 30, dir: 'left' }, { id: 'CH2', dx: 0, dy: 70, dir: 'left' }, { id: 'GND', dx: 75, dy: 126, dir: 'down', electrical: 'ground' }],
    defaults: { timebase: '1 ms/div', voltsPerDiv: '2 V/div', trigger: 'CH1 Rising' }, properties: [textProp('timebase', 'Timebase'), textProp('voltsPerDiv', 'Vertical scale'), selectProp('trigger', 'Trigger', ['CH1 Rising', 'CH1 Falling', 'CH2 Rising', 'Auto'])],
    build(inst) { const channels = inst._simChannels || [false, false]; return [rect(16, 8, 118, 92, 'instrument-body', 6), rect(28, 19, 78, 55, 'scope-screen', 2), path(`M31 ${channels[0] ? 35 : 49} H44 V${channels[0] ? 28 : 49} H58 V${channels[0] ? 35 : 49} H72 V${channels[0] ? 28 : 49} H88 V${channels[0] ? 35 : 49} H103`, `scope-trace ch1${channels[0] ? ' trace-active' : ''}`), path(`M31 ${channels[1] ? 57 : 64} H49 V${channels[1] ? 51 : 64} H67 V${channels[1] ? 57 : 64} H85 V${channels[1] ? 51 : 64} H103`, `scope-trace ch2${channels[1] ? ' trace-active' : ''}`), line(0, 30, 16, 30), line(0, 70, 16, 70), line(75, 100, 75, 126), text(112, 32, '1', 'scope-channel ch1'), text(112, 55, '2', 'scope-channel ch2'), ...labelNodes(inst, 38, 116, `${inst.timebase} · ${inst.voltsPerDiv}`)]; }
  },

  'logic-analyzer': {
    label: '4-channel logic analyzer', prefix: 'LA', icon: '▥', category: 'Instruments', w: 156, h: 148,
    pins: [{ id: 'D0', dx: 0, dy: 24, dir: 'left' }, { id: 'D1', dx: 0, dy: 50, dir: 'left' }, { id: 'D2', dx: 0, dy: 76, dir: 'left' }, { id: 'D3', dx: 0, dy: 102, dir: 'left' }, { id: 'GND', dx: 78, dy: 148, dir: 'down', electrical: 'ground' }],
    defaults: { sampleRate: '24 MHz', threshold: '2.0 V' }, properties: [textProp('sampleRate', 'Sample rate'), textProp('threshold', 'Logic threshold')],
    build(inst) { const channels = inst._simChannels || [false, false, false, false]; return [rect(18, 8, 122, 112, 'instrument-body', 6), rect(42, 18, 85, 89, 'scope-screen', 2), ...channels.flatMap((high, index) => [line(0, 24 + index * 26, 18, 24 + index * 26), text(24, 28 + index * 26, `D${index}`, 'pin-label'), path(`M47 ${high ? 25 + index * 19 : 31 + index * 19} H63 V${high ? 20 + index * 19 : 31 + index * 19} H80 V${high ? 25 + index * 19 : 31 + index * 19} H98 V${high ? 20 + index * 19 : 31 + index * 19} H120`, `logic-trace${high ? ' trace-active' : ''}`)]), line(78, 120, 78, 148), ...labelNodes(inst, 44, 137, `${inst.sampleRate} · ${channels.map(value => value ? 1 : 0).join('')}`)]; }
  },

  'logic-buffer': logicGate('Logic buffer', 'BUF', 'not', false, true),
  'schmitt-trigger': logicGate('Schmitt trigger', 'ST', 'schmitt', false, true),
  'tri-state-buffer': blockComponent({
    label: 'Tri-state buffer', icon: '3S', w: 120, h: 126, model: '74HC125',
    pins: [leftPin('A', 38), leftPin('EN', 82, 'Enable'), rightPin('Y', 120, 58), ...supplyPins(120, 126)],
    defaults: { family: '74HC125', enabled: true }, properties: [textProp('family', 'Device'), boolProp('enabled', 'Enabled')]
  }),
  'jk-flip-flop': blockComponent({
    label: 'JK flip-flop', icon: 'JK', w: 140, h: 174, model: '74HC76',
    pins: [leftPin('J', 34), leftPin('CLK', 68), leftPin('K', 102), leftPin('CLR', 136), rightPin('Q', 140, 45), rightPin('QN', 140, 105, 'Q not'), ...supplyPins(140, 174)],
    defaults: { q: false, family: '74HC76' }, properties: [boolProp('q', 'Stored Q'), textProp('family', 'Device')]
  }),
  'sr-latch': blockComponent({
    label: 'SR latch', icon: 'SR', w: 126, h: 142, model: 'CD4043',
    pins: [leftPin('S', 40, 'Set'), leftPin('R', 92, 'Reset'), rightPin('Q', 126, 40), rightPin('QN', 126, 92, 'Q not'), ...supplyPins(126, 142)],
    defaults: { q: false, family: 'CD4043' }, properties: [boolProp('q', 'Stored Q'), textProp('family', 'Device')]
  }),
  'binary-counter': blockComponent({
    label: '4-bit binary counter', icon: '0→F', w: 150, h: 190, model: '74HC161',
    pins: [leftPin('CLK', 38), leftPin('EN', 76), leftPin('RESET', 120), rightPin('Q0', 150, 30), rightPin('Q1', 150, 65), rightPin('Q2', 150, 100), rightPin('Q3', 150, 135), ...supplyPins(150, 190)],
    defaults: { value: 0, family: '74HC161' }, properties: [numberProp('value', 'Count', '', 0, 15, 1), textProp('family', 'Device')]
  }),
  'mux-2to1': blockComponent({
    label: '2-to-1 multiplexer', icon: 'MUX', w: 140, h: 158, model: '74HC157',
    pins: [leftPin('A', 30), leftPin('B', 62), leftPin('S', 94, 'Select'), leftPin('EN', 126, 'Enable'), rightPin('Y', 140, 70), ...supplyPins(140, 158)],
    defaults: { family: '74HC157', enabled: true }, properties: [textProp('family', 'Device'), boolProp('enabled', 'Enabled')]
  }),
  'demux-1to2': blockComponent({
    label: '1-to-2 demultiplexer', icon: 'DEMUX', w: 146, h: 158, model: '74HC139',
    pins: [leftPin('D', 42, 'Data'), leftPin('S', 92, 'Select'), rightPin('Y0', 146, 42), rightPin('Y1', 146, 92), ...supplyPins(146, 158)],
    defaults: { family: '74HC139' }, properties: [textProp('family', 'Device')]
  }),
  'decoder-2to4': blockComponent({
    label: '2-to-4 decoder', icon: '2→4', w: 150, h: 190, model: '74HC139',
    pins: [leftPin('A', 38), leftPin('B', 76), leftPin('EN', 120), rightPin('Y0', 150, 30), rightPin('Y1', 150, 65), rightPin('Y2', 150, 100), rightPin('Y3', 150, 135), ...supplyPins(150, 190)],
    defaults: { family: '74HC139', enabled: true }, properties: [textProp('family', 'Device'), boolProp('enabled', 'Enabled')]
  }),
  'encoder-4to2': blockComponent({
    label: '4-to-2 priority encoder', icon: '4→2', w: 150, h: 190, model: '74HC148',
    pins: [leftPin('D0', 30), leftPin('D1', 62), leftPin('D2', 94), leftPin('D3', 126), rightPin('Q0', 150, 55), rightPin('Q1', 150, 105), ...supplyPins(150, 190)],
    defaults: { family: '74HC148' }, properties: [textProp('family', 'Device')]
  }),
  'shift-register': blockComponent({
    label: '4-bit shift register', icon: 'SRG', w: 160, h: 206, model: '74HC595',
    pins: [leftPin('SER', 34), leftPin('CLK', 70), leftPin('LATCH', 106), leftPin('RESET', 146), rightPin('Q0', 160, 30), rightPin('Q1', 160, 65), rightPin('Q2', 160, 100), rightPin('Q3', 160, 135), ...supplyPins(160, 206)],
    defaults: { value: 0, family: '74HC595' }, properties: [numberProp('value', 'Register value', '', 0, 15, 1), textProp('family', 'Device')]
  }),

  'timer-555': blockComponent({
    label: '555 timer', icon: '555', category: 'Analog ICs', w: 150, h: 184, model: 'NE555',
    pins: [{ id: 'TRIG', name: 'Trigger', dx: 0, dy: 34, dir: 'left' }, { id: 'THR', name: 'Threshold', dx: 0, dy: 70, dir: 'left' }, { id: 'RESET', name: 'Reset', dx: 0, dy: 108, dir: 'left', electrical: 'digital' }, { id: 'CTRL', name: 'Control voltage', dx: 0, dy: 142, dir: 'left' }, { id: 'OUT', name: 'Output', dx: 150, dy: 45, dir: 'right', electrical: 'digital' }, { id: 'DISCH', name: 'Discharge', dx: 150, dy: 105, dir: 'right' }, ...supplyPins(150, 184)],
    defaults: { mode: 'Astable', frequency: 1000, dutyCycle: 50 }, properties: [selectProp('mode', 'Mode', ['Astable', 'Monostable', 'Bistable']), numberProp('frequency', 'Frequency', 'Hz', 0.1, 1e6, 0.1), numberProp('dutyCycle', 'Duty cycle', '%', 1, 99, 1)]
  }),
  'voltage-regulator': blockComponent({
    label: 'Linear voltage regulator', icon: 'REG', category: 'Power ICs', w: 132, h: 112, model: '7805',
    pins: [{ id: 'IN', name: 'Input', dx: 0, dy: 48, dir: 'left', electrical: 'power' }, { id: 'OUT', name: 'Regulated output', dx: 132, dy: 48, dir: 'right', electrical: 'power' }, { id: 'GND', name: 'Ground / adjust', dx: 66, dy: 112, dir: 'down', electrical: 'ground' }],
    defaults: { model: '7805', outputVoltage: 5, maxCurrent: '1 A' }, properties: [textProp('model', 'Model'), numberProp('outputVoltage', 'Output voltage', 'V', 1.2, 48, 0.1), textProp('maxCurrent', 'Maximum current')]
  }),
  'bridge-rectifier': {
    label: 'Bridge rectifier', prefix: 'BR', icon: '◇', category: 'Power semiconductors', w: 126, h: 126,
    pins: [{ id: 'AC1', name: 'AC input 1', dx: 0, dy: 63, dir: 'left' }, { id: 'AC2', name: 'AC input 2', dx: 126, dy: 63, dir: 'right' }, { id: '+', name: 'DC positive', dx: 63, dy: 0, dir: 'up', electrical: 'power' }, { id: '-', name: 'DC negative', dx: 63, dy: 126, dir: 'down', electrical: 'ground' }],
    defaults: { model: 'KBP206', current: '2 A', voltage: '600 V' }, properties: [textProp('model', 'Model'), textProp('current', 'Rated current'), textProp('voltage', 'Peak voltage')],
    build: inst => [line(0, 63, 18, 63), line(108, 63, 126, 63), line(63, 0, 63, 18), line(63, 108, 63, 126), path('M63 18 L108 63 L63 108 L18 63 Z', 'bridge-outline'), diodeGlyph(40, 40, -45, 0.55), diodeGlyph(86, 40, -135, 0.55), diodeGlyph(40, 86, -135, 0.55), diodeGlyph(86, 86, -45, 0.55), text(58, 14, '+', 'source-sign'), text(58, 121, '−', 'source-sign'), text(7, 58, '~', 'source-sign'), text(113, 58, '~', 'source-sign'), ...labelNodes(inst, 37, 122, inst.model)]
  },
  crystal: passive('Quartz crystal', 'Y', '◇', { frequency: '16 MHz', loadCapacitance: '18 pF' }, [textProp('frequency', 'Frequency'), textProp('loadCapacitance', 'Load capacitance')], inst => [line(0, 24, 36, 24), line(36, 8, 36, 40), rect(42, 9, 16, 30, 'symbol-shape', 1), line(64, 8, 64, 40), line(64, 24, 100, 24), ...labelNodes(inst, 26, 56, inst.frequency)], { category: 'Timing' }),
  varistor: passive('Metal oxide varistor', 'MOV', 'VDR', { voltage: '275 VAC', energy: '60 J' }, [textProp('voltage', 'Clamping voltage'), textProp('energy', 'Energy rating')], inst => [line(0, 24, 18, 24), path('M18 24 l10 -12 10 24 10 -24 10 24 10 -24 10 24 14 -12'), line(82, 24, 100, 24), path('M25 42 L76 6'), text(44, 17, 'V', 'sub'), ...labelNodes(inst, 24, 57, inst.voltage)], { category: 'Protection' }),
  pmos: {
    label: 'P-channel MOSFET', prefix: 'Q', icon: 'PMOS', category: 'Semiconductors', w: 104, h: 96,
    pins: [{ id: 'G', name: 'Gate', dx: 0, dy: 48, dir: 'left' }, { id: 'S', name: 'Source', dx: 104, dy: 17, dir: 'right' }, { id: 'D', name: 'Drain', dx: 104, dy: 79, dir: 'right' }],
    defaults: { model: 'BS250', threshold: '-2.1 V' }, properties: [textProp('model', 'Model'), textProp('threshold', 'Threshold')],
    build: inst => [line(0, 48, 30, 48), line(30, 18, 30, 78), line(42, 25, 42, 42), line(42, 54, 42, 71), line(42, 33, 77, 17), line(42, 63, 77, 79), line(77, 17, 104, 17), line(77, 79, 104, 79), ...arrow(50, 33, 68, 33, 'transistor-arrow', 7), text(12, 42, 'G', 'terminal-label'), text(88, 12, 'S', 'terminal-label'), text(88, 75, 'D', 'terminal-label'), ...labelNodes(inst, 40, 93, inst.model)]
  },
  scr: {
    label: 'SCR thyristor', prefix: 'Q', icon: 'SCR', category: 'Power semiconductors', w: 110, h: 96,
    pins: [{ id: 'A', name: 'Anode', dx: 0, dy: 34, dir: 'left' }, { id: 'K', name: 'Cathode', dx: 110, dy: 34, dir: 'right' }, { id: 'G', name: 'Gate', dx: 55, dy: 96, dir: 'down' }],
    defaults: { model: 'C106', current: '4 A' }, properties: [textProp('model', 'Model'), textProp('current', 'Rated current')],
    build: inst => [line(0, 34, 30, 34), path('M30 17 L67 34 L30 51 Z'), line(68, 16, 68, 52), line(68, 34, 110, 34), line(55, 96, 55, 58), line(55, 58, 67, 45), ...labelNodes(inst, 34, 79, inst.model)]
  },
  triac: {
    label: 'TRIAC', prefix: 'Q', icon: 'TRIAC', category: 'Power semiconductors', w: 112, h: 104,
    pins: [{ id: 'MT1', name: 'Main terminal 1', dx: 0, dy: 38, dir: 'left' }, { id: 'MT2', name: 'Main terminal 2', dx: 112, dy: 38, dir: 'right' }, { id: 'G', name: 'Gate', dx: 56, dy: 104, dir: 'down' }],
    defaults: { model: 'BT136', current: '4 A' }, properties: [textProp('model', 'Model'), textProp('current', 'Rated current')],
    build: inst => [line(0, 38, 27, 38), path('M27 19 L58 38 L27 57 Z M85 19 L54 38 L85 57 Z'), line(85, 38, 112, 38), line(56, 104, 56, 66), line(56, 66, 70, 52), ...labelNodes(inst, 35, 87, inst.model)]
  },
  optocoupler: {
    label: 'Optocoupler', prefix: 'U', icon: '⇥', category: 'Isolation', w: 140, h: 126,
    pins: [{ id: 'A', name: 'LED anode', dx: 0, dy: 34, dir: 'left' }, { id: 'K', name: 'LED cathode', dx: 0, dy: 86, dir: 'left' }, { id: 'C', name: 'Phototransistor collector', dx: 140, dy: 34, dir: 'right' }, { id: 'E', name: 'Phototransistor emitter', dx: 140, dy: 86, dir: 'right' }],
    defaults: { model: 'PC817', ctr: '80–160%' }, properties: [textProp('model', 'Model'), textProp('ctr', 'Current transfer ratio')],
    build: inst => [rect(14, 8, 112, 98, 'opto-body', 5), line(0, 34, 22, 34), path('M22 34 H39 V47'), diodeGlyph(39, 60, 90, 0.62), path('M39 73 V86 H0'), path('M70 17 V98', 'isolation-barrier'), ...arrow(55, 50, 76, 44, 'light-rays', 5), ...arrow(55, 68, 76, 62, 'light-rays', 5), line(84, 47, 84, 77), line(84, 54, 112, 34), line(84, 70, 112, 86), line(112, 34, 140, 34), line(112, 86, 140, 86), ...arrow(98, 76, 110, 84, 'transistor-arrow', 5), text(6, 28, 'A', 'terminal-label'), text(6, 81, 'K', 'terminal-label'), text(124, 28, 'C', 'terminal-label'), text(124, 81, 'E', 'terminal-label'), ...labelNodes(inst, 48, 119, `${inst.model} · ${inst.ctr}`)]
  },

  'hall-sensor': blockComponent({ label: 'Hall-effect sensor', prefix: 'HS', icon: 'H', category: 'Sensors', w: 126, h: 118, model: 'A3144', pins: [{ id: 'VCC', dx: 0, dy: 30, dir: 'left', electrical: 'power' }, { id: 'OUT', dx: 126, dy: 55, dir: 'right' }, { id: 'GND', dx: 0, dy: 84, dir: 'left', electrical: 'ground' }], defaults: { magneticField: false, sensitivity: '40 mT' }, properties: [boolProp('magneticField', 'Magnet detected'), textProp('sensitivity', 'Operate point')] }),
  microphone: {
    label: 'Electret microphone', prefix: 'MIC', icon: '◉', category: 'Sensors', w: 96, h: 88, pins: [{ id: '1', name: 'Positive', dx: 0, dy: 36, dir: 'left' }, { id: '2', name: 'Negative', dx: 96, dy: 36, dir: 'right' }],
    defaults: { sensitivity: '-44 dBV', frequency: '20 Hz–20 kHz' }, properties: [textProp('sensitivity', 'Sensitivity'), textProp('frequency', 'Frequency range')],
    build: inst => [line(0, 36, 20, 36), circle(48, 36, 27), line(40, 17, 40, 55), line(48, 17, 48, 55), line(76, 36, 96, 36), ...arrow(9, 15, 28, 24, 'sound-rays', 5), ...arrow(7, 29, 27, 33, 'sound-rays', 5), text(25, 49, '+', 'polarity'), ...labelNodes(inst, 24, 78, inst.sensitivity)]
  },
  'temperature-sensor': blockComponent({ label: 'Digital temperature sensor', prefix: 'TS', icon: '°C', category: 'Sensors', w: 132, h: 122, model: 'DS18B20', pins: [{ id: 'VCC', dx: 0, dy: 30, dir: 'left', electrical: 'power' }, { id: 'DATA', dx: 132, dy: 58, dir: 'right', electrical: 'digital' }, { id: 'GND', dx: 0, dy: 90, dir: 'left', electrical: 'ground' }], defaults: { temperature: 25, resolution: '12 bit' }, properties: [numberProp('temperature', 'Temperature', '°C', -55, 125, 0.1), selectProp('resolution', 'Resolution', ['9 bit', '10 bit', '11 bit', '12 bit'])] }),
  'ultrasonic-sensor': blockComponent({ label: 'Ultrasonic distance sensor', prefix: 'US', icon: '))', category: 'Sensors', w: 148, h: 136, model: 'HC-SR04', pins: [{ id: 'VCC', dx: 0, dy: 28, dir: 'left', electrical: 'power' }, { id: 'TRIG', dx: 0, dy: 62, dir: 'left', electrical: 'digital' }, { id: 'ECHO', dx: 148, dy: 62, dir: 'right', electrical: 'digital' }, { id: 'GND', dx: 0, dy: 102, dir: 'left', electrical: 'ground' }], defaults: { distance: 100, maxRange: '4 m' }, properties: [numberProp('distance', 'Distance', 'cm', 2, 400, 1), textProp('maxRange', 'Maximum range')] }),
  'rotary-encoder': blockComponent({ label: 'Rotary encoder', prefix: 'ENC', icon: '↻', category: 'Sensors', w: 132, h: 144, model: 'Incremental', pins: [{ id: 'A', dx: 132, dy: 34, dir: 'right', electrical: 'digital' }, { id: 'B', dx: 132, dy: 72, dir: 'right', electrical: 'digital' }, { id: 'SW', dx: 132, dy: 108, dir: 'right' }, { id: 'COM', dx: 0, dy: 72, dir: 'left', electrical: 'ground' }], defaults: { position: 0, pulses: 20 }, properties: [numberProp('position', 'Position', '°', 0, 359, 1), numberProp('pulses', 'Pulses/revolution', '', 1, 1024, 1)] }),

  'rgb-led': {
    label: 'RGB LED', prefix: 'RGB', icon: '◉', category: 'Digital outputs', w: 118, h: 126,
    pins: [{ id: 'R', dx: 0, dy: 26, dir: 'left' }, { id: 'G', dx: 0, dy: 58, dir: 'left' }, { id: 'B', dx: 0, dy: 90, dir: 'left' }, { id: 'COM', dx: 118, dy: 58, dir: 'right', electrical: 'ground' }],
    defaults: { red: true, green: false, blue: false, common: 'Cathode' }, properties: [boolProp('red', 'Red'), boolProp('green', 'Green'), boolProp('blue', 'Blue'), selectProp('common', 'Common', ['Cathode'])],
    build: inst => { const channels = inst._simChannels || [inst.red, inst.green, inst.blue], colors = ['red', 'green', 'blue']; return [rect(24, 9, 72, 98, 'rgb-body', 24), ...[26, 58, 90].flatMap((y, index) => [line(0, y, 36, y), diodeGlyph(46, y, 0, 0.55, `symbol-path rgb-diode ${colors[index]}${channels[index] ? ' channel-on' : ''}`), line(52, y, 88, y)]), line(88, 26, 88, 90), line(88, 58, 118, 58), ...arrow(57, 24, 72, 14, 'light-rays', 5), ...arrow(63, 34, 79, 25, 'light-rays', 5), text(7, 21, 'R', 'terminal-label'), text(7, 53, 'G', 'terminal-label'), text(7, 85, 'B', 'terminal-label'), text(96, 52, 'K', 'terminal-label'), ...labelNodes(inst, 38, 114, channels.map(value => value ? '1' : '0').join(''))]; }
  },
  servo: blockComponent({ label: 'RC servo motor', prefix: 'SV', icon: '↻', category: 'Actuators', w: 138, h: 128, model: 'SG90', pins: [{ id: 'VCC', dx: 0, dy: 30, dir: 'left', electrical: 'power' }, { id: 'PWM', dx: 0, dy: 64, dir: 'left', electrical: 'digital' }, { id: 'GND', dx: 0, dy: 98, dir: 'left', electrical: 'ground' }], defaults: { angle: 90, pulse: '1.5 ms' }, properties: [numberProp('angle', 'Angle', '°', 0, 180, 1), textProp('pulse', 'Pulse width')] }),
  solenoid: {
    label: 'Solenoid', prefix: 'SOL', icon: '⇥', category: 'Actuators', w: 112, h: 82, pins: twoPins(112, 32),
    defaults: { voltage: 12, force: '10 N' }, properties: [numberProp('voltage', 'Rated voltage', 'V', 1, 240, 1), textProp('force', 'Force')],
    build: inst => [line(0, 32, 16, 32), rect(16, 13, 64, 38, 'symbol-shape', 2), path('M22 32 q8 -14 16 0 q8 -14 16 0 q8 -14 16 0'), line(80, 32, 112, 32), path('M84 20 h20 l-8 -8 M104 20 l-8 8'), ...labelNodes(inst, 30, 70, `${inst.voltage} V · ${inst.force}`)]
  },
  'stepper-motor': {
    label: 'Bipolar stepper motor', prefix: 'STP', icon: 'M4', category: 'Actuators', w: 142, h: 152,
    pins: [{ id: 'A1', name: 'Phase A start', dx: 0, dy: 32, dir: 'left' }, { id: 'A2', name: 'Phase A end', dx: 0, dy: 76, dir: 'left' }, { id: 'B1', name: 'Phase B start', dx: 142, dy: 32, dir: 'right' }, { id: 'B2', name: 'Phase B end', dx: 142, dy: 76, dir: 'right' }],
    defaults: { stepAngle: 1.8, current: '1.2 A' }, properties: [numberProp('stepAngle', 'Step angle', '°', 0.1, 90, 0.1), textProp('current', 'Phase current')],
    build: inst => [circle(71, 54, 42, 'motor-body'), line(0, 32, 25, 32), path('M25 32 C42 32 42 43 25 43 C42 43 42 54 25 54 C42 54 42 65 25 65 C42 65 42 76 25 76', 'motor-winding phase-a'), line(25, 76, 0, 76), line(142, 32, 117, 32), path('M117 32 C100 32 100 43 117 43 C100 43 100 54 117 54 C100 54 100 65 117 65 C100 65 100 76 117 76', 'motor-winding phase-b'), line(117, 76, 142, 76), text(61, 62, 'M', 'motor-letter'), text(10, 26, 'A1', 'terminal-label'), text(10, 91, 'A2', 'terminal-label'), text(120, 26, 'B1', 'terminal-label'), text(120, 91, 'B2', 'terminal-label'), ...labelNodes(inst, 38, 122, `NEMA 17 · ${inst.stepAngle}°`)]
  },
  'relay-spdt': {
    label: 'Relay SPDT', prefix: 'K', icon: 'K↔', category: 'Switches', w: 150, h: 156,
    pins: [{ id: 'A1', name: 'Coil A1', dx: 0, dy: 32, dir: 'left' }, { id: 'A2', name: 'Coil A2', dx: 0, dy: 76, dir: 'left' }, { id: 'COM', name: 'Common', dx: 150, dy: 38, dir: 'right' }, { id: 'NO', name: 'Normally open', dx: 150, dy: 78, dir: 'right' }, { id: 'NC', name: 'Normally closed', dx: 150, dy: 118, dir: 'right' }],
    defaults: { coilVoltage: '5 V', energized: false }, properties: [textProp('coilVoltage', 'Coil voltage'), boolProp('energized', 'Energized')],
    build: inst => { const energized = inst._simEnergized ?? inst.energized; return [line(0, 32, 18, 32), line(0, 76, 18, 76), path('M18 32 C34 32 34 43 18 43 C34 43 34 54 18 54 C34 54 34 65 18 65 C34 65 34 76 18 76', 'relay-coil'), path('M40 54 H70', 'mechanical-link'), line(82, 38, 150, 38), line(112, 78, 150, 78), line(112, 118, 150, 118), circle(82, 38, 3, 'terminal'), circle(112, 78, 3, 'terminal'), circle(112, 118, 3, 'terminal'), line(84, 40, 110, energized ? 77 : 117, 'switch-arm'), text(118, 32, 'COM', 'terminal-label'), text(122, 72, 'NO', 'terminal-label'), text(122, 112, 'NC', 'terminal-label'), ...labelNodes(inst, 42, 145, `${inst.coilVoltage} · ${energized ? 'NO' : 'NC'}`)]; }
  },
  'lcd-16x2': blockComponent({ label: '16×2 character LCD', prefix: 'LCD', icon: 'LCD', category: 'Digital outputs', w: 184, h: 176, model: 'LCD1602', pins: [{ id: 'VCC', dx: 0, dy: 26, dir: 'left', electrical: 'power' }, { id: 'GND', dx: 0, dy: 56, dir: 'left', electrical: 'ground' }, { id: 'RS', dx: 0, dy: 92, dir: 'left', electrical: 'digital' }, { id: 'EN', dx: 0, dy: 126, dir: 'left', electrical: 'digital' }, { id: 'D4', dx: 184, dy: 34, dir: 'right', electrical: 'digital' }, { id: 'D5', dx: 184, dy: 66, dir: 'right', electrical: 'digital' }, { id: 'D6', dx: 184, dy: 98, dir: 'right', electrical: 'digital' }, { id: 'D7', dx: 184, dy: 130, dir: 'right', electrical: 'digital' }], defaults: { line1: 'CircuitLab Pro', line2: 'Ready', backlight: true }, properties: [textProp('line1', 'Display line 1'), textProp('line2', 'Display line 2'), boolProp('backlight', 'Backlight')] }),

  ohmmeter: {
    label: 'Digital ohmmeter', prefix: 'OM', icon: 'Ω', category: 'Instruments', w: 116, h: 104, pins: instrumentPins(116),
    defaults: { range: 'Auto' }, properties: [selectProp('range', 'Range', ['Auto', '200 Ω', '2 kΩ', '20 kΩ', '2 MΩ'])],
    build: inst => [line(0, 42, 15, 42), line(101, 42, 116, 42), rect(15, 9, 86, 68, 'instrument-body', 6), rect(24, 20, 68, 28, 'instrument-screen', 2), text(29, 40, inst._simReading || '0.0 Ω', 'instrument-reading'), text(25, 63, `Ω · ${inst.range}`, 'instrument-caption'), ...labelNodes(inst, 38, 94)]
  },
  'frequency-counter': blockComponent({ label: 'Frequency counter', prefix: 'FC', icon: 'Hz', category: 'Instruments', w: 148, h: 122, model: 'COUNTER', pins: [{ id: 'IN', dx: 0, dy: 42, dir: 'left' }, { id: 'GND', dx: 74, dy: 122, dir: 'down', electrical: 'ground' }], defaults: { range: 'Auto', gateTime: '1 s' }, properties: [selectProp('range', 'Range', ['Auto', '1 kHz', '1 MHz', '100 MHz']), textProp('gateTime', 'Gate time')] }),
  wattmeter: blockComponent({ label: 'Digital wattmeter', prefix: 'WM', icon: 'W', category: 'Instruments', w: 154, h: 146, model: 'POWER', pins: [{ id: 'V+', dx: 0, dy: 30, dir: 'left' }, { id: 'V-', dx: 0, dy: 78, dir: 'left' }, { id: 'I+', dx: 154, dy: 30, dir: 'right' }, { id: 'I-', dx: 154, dy: 78, dir: 'right' }], defaults: { range: 'Auto' }, properties: [selectProp('range', 'Range', ['Auto', '10 W', '100 W', '1 kW'])] }),
  'function-generator': blockComponent({ label: 'Function generator', prefix: 'FG', icon: '∿▱', category: 'Instruments', w: 154, h: 132, model: 'FUNC GEN', pins: [{ id: 'OUT', dx: 154, dy: 44, dir: 'right' }, { id: 'SYNC', dx: 154, dy: 86, dir: 'right', electrical: 'digital' }, { id: 'GND', dx: 77, dy: 132, dir: 'down', electrical: 'ground' }], defaults: { waveform: 'Sine', frequency: 1000, amplitude: 5, offset: 0, enabled: true }, properties: [selectProp('waveform', 'Waveform', ['Sine', 'Square', 'Triangle', 'Sawtooth']), numberProp('frequency', 'Frequency', 'Hz', 0.01, 1e9, 0.01), numberProp('amplitude', 'Amplitude', 'Vpp', 0, 100, 0.1), numberProp('offset', 'DC offset', 'V', -50, 50, 0.1), boolProp('enabled', 'Output enabled')] }),

  'test-point': { label: 'Test point', prefix: 'TP', icon: '●', category: 'Connectivity', w: 56, h: 62, pins: [{ id: '1', dx: 28, dy: 62, dir: 'down' }], defaults: { color: 'Red' }, properties: [selectProp('color', 'Color', ['Red', 'Black', 'Blue', 'Yellow'])], build: inst => [line(28, 62, 28, 36), circle(28, 22, 12, 'test-point-ring'), circle(28, 22, 4, 'terminal'), ...labelNodes(inst, 11, 55, inst.color)] },
  'terminal-block': { label: '2-position terminal block', prefix: 'J', icon: '▣', category: 'Connectivity', w: 112, h: 82, pins: twoPins(112, 34), defaults: { pitch: '5.08 mm', current: '10 A' }, properties: [textProp('pitch', 'Pitch'), textProp('current', 'Current rating')], build: inst => [line(0, 34, 12, 34), rect(12, 8, 88, 52, 'connector-body', 3), circle(36, 34, 13, 'terminal-screw'), circle(76, 34, 13, 'terminal-screw'), path('M28 34 h16 M36 26 v16 M68 34 h16 M76 26 v16'), line(100, 34, 112, 34), ...labelNodes(inst, 31, 75, inst.pitch)] },
  'connector-4': blockComponent({ label: '4-pin connector', prefix: 'J', icon: '||||', category: 'Connectivity', w: 112, h: 152, model: 'HEADER', pins: [rightPin('1', 112, 28), rightPin('2', 112, 58), rightPin('3', 112, 88), rightPin('4', 112, 118)], defaults: { pitch: '2.54 mm', gender: 'Male' }, properties: [textProp('pitch', 'Pitch'), selectProp('gender', 'Gender', ['Male', 'Female'])] }),

  'arduino-uno': {
    label: 'Arduino UNO', prefix: 'U', icon: 'μ', category: 'Controllers', w: 132, h: 240,
    pins: [
      { id: 'VIN', dx: 132, dy: 24, dir: 'right', electrical: 'power' }, { id: '5V', dx: 132, dy: 54, dir: 'right', electrical: 'power' },
      { id: 'D13', dx: 132, dy: 100, dir: 'right' }, { id: 'D12', dx: 132, dy: 128, dir: 'right' },
      { id: 'A0', dx: 132, dy: 170, dir: 'right' }, { id: 'GND', dx: 66, dy: 240, dir: 'down', electrical: 'ground' }
    ],
    defaults: { board: 'UNO R3', clock: '16 MHz' }, properties: [selectProp('board', 'Board', ['UNO R3', 'UNO R4 Minima', 'Nano']), textProp('clock', 'Clock')],
    build(inst) { return [rect(0, 0, 132, 240, 'board-shape', 6), rect(14, 30, 57, 103, 'chip', 2), text(14, 162, 'ARDUINO'), text(14, 180, inst.board, 'sub'), text(25, 51, 'ATmega328P', 'chip-text'), text(95, 20, 'VIN', 'pin-label'), text(100, 50, '5V', 'pin-label'), text(91, 96, 'D13', 'pin-label'), text(91, 124, 'D12', 'pin-label'), text(98, 166, 'A0', 'pin-label'), text(51, 225, 'GND', 'pin-label')]; }
  }
};

export const COMPONENT_CATALOG = [
  { name: 'BASIC & PASSIVE', types: ['resistor', 'potentiometer', 'capacitor', 'polarized-capacitor', 'inductor', 'transformer', 'fuse'] },
  { name: 'TIMING & PROTECTION', types: ['crystal', 'varistor'] },
  { name: 'SENSORS', types: ['thermistor', 'photoresistor', 'hall-sensor', 'microphone', 'temperature-sensor', 'ultrasonic-sensor', 'rotary-encoder'] },
  { name: 'DIODES', types: ['diode', 'zener', 'led'] },
  { name: 'SWITCHES & RELAYS', types: ['switch-spst', 'switch-spdt', 'pushbutton', 'relay', 'relay-spdt'] },
  { name: 'SOURCES', types: ['battery', 'dc-source', 'ac-source', 'current-source'] },
  { name: 'DIGITAL SOURCES', types: ['logic-input', 'clock-generator'] },
  { name: 'POWER & REFERENCE', types: ['ground', 'vcc'] },
  { name: 'LOGIC GATES', types: ['logic-and', 'logic-or', 'logic-not', 'logic-nand', 'logic-nor', 'logic-xor', 'logic-xnor', 'logic-buffer', 'schmitt-trigger', 'tri-state-buffer'] },
  { name: 'DIGITAL ICs', types: ['d-flip-flop', 'jk-flip-flop', 'sr-latch', 'binary-counter', 'mux-2to1', 'demux-1to2', 'decoder-2to4', 'encoder-4to2', 'shift-register'] },
  { name: 'ANALOG & POWER ICs', types: ['opamp', 'comparator', 'timer-555', 'voltage-regulator'] },
  { name: 'SEMICONDUCTORS', types: ['transistor-npn', 'transistor-pnp', 'nmos', 'pmos'] },
  { name: 'POWER & ISOLATION', types: ['bridge-rectifier', 'scr', 'triac', 'optocoupler'] },
  { name: 'OUTPUTS & DISPLAYS', types: ['lamp', 'motor', 'buzzer', 'speaker', 'rgb-led', 'seven-segment', 'lcd-16x2'] },
  { name: 'ACTUATORS', types: ['servo', 'solenoid', 'stepper-motor'] },
  { name: 'INSTRUMENTS', types: ['voltmeter', 'ammeter', 'ohmmeter', 'oscilloscope', 'logic-analyzer', 'frequency-counter', 'wattmeter', 'function-generator'] },
  { name: 'CONNECTIVITY', types: ['test-point', 'terminal-block', 'connector-4'] },
  { name: 'CONTROLLERS', types: ['arduino-uno'] }
];

export function getComponentDefinition(type) { return COMPONENT_TYPES[type]; }
export function createDefaultProperties(type) { return structuredClone(COMPONENT_TYPES[type]?.defaults || {}); }
export function normalizeRotation(rotation) { return ((Math.round(Number(rotation) / 90) * 90) % 360 + 360) % 360; }

function rotatePoint(dx, dy, width, height, rotation) {
  const angle = normalizeRotation(rotation) * Math.PI / 180;
  const cx = width / 2, cy = height / 2;
  const x = dx - cx, y = dy - cy;
  return { dx: cx + x * Math.cos(angle) - y * Math.sin(angle), dy: cy + x * Math.sin(angle) + y * Math.cos(angle) };
}

export function rotateDirection(direction, rotation) {
  const order = ['right', 'down', 'left', 'up'];
  const index = order.indexOf(direction);
  return index < 0 ? direction : order[(index + normalizeRotation(rotation) / 90) % 4];
}

export function pinPosition(component, pin) {
  const def = COMPONENT_TYPES[component.type];
  const rotated = rotatePoint(pin.dx, pin.dy, def.w, def.h, component.rotation || 0);
  return { x: component.x + rotated.dx, y: component.y + rotated.dy };
}

export function resolvedPin(component, pin) {
  return { ...pin, dir: rotateDirection(pin.dir, component.rotation || 0) };
}

export function componentBounds(component) {
  const def = COMPONENT_TYPES[component.type];
  const corners = [[0, 0], [def.w, 0], [def.w, def.h], [0, def.h]].map(([x, y]) => rotatePoint(x, y, def.w, def.h, component.rotation || 0));
  const xs = corners.map(point => point.dx), ys = corners.map(point => point.dy);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return { x: component.x + minX, y: component.y + minY, w: maxX - minX, h: maxY - minY, offsetX: minX, offsetY: minY };
}

export function findPin(component, pinId) { return COMPONENT_TYPES[component.type]?.pins.find(pin => pin.id === pinId); }
