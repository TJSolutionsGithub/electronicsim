// Ready-to-open example circuits. Coordinates and endpoint references use the
// same version-2 project format as user files, so examples exercise the real
// loader, router, tabs and inspector rather than a separate demo renderer.

const component = (id, type, x, y, values = {}) => ({ id, type, x, y, rotation: 0, ...values });
const wire = (id, from, to, kind = 'signal') => ({ id, from, to, kind, points: [], manual: false });
const project = (name, components, wires) => ({ version: 2, name, components, wires });

function logicGateExample(id, title, type, a, b = null) {
  const singleInput = type === 'logic-not' || type === 'logic-buffer' || type === 'schmitt-trigger';
  const components = [
    component('DIN1', 'logic-input', 65, singleInput ? 215 : 125, { label: 'A', high: a }),
    ...(!singleInput ? [component('DIN2', 'logic-input', 65, 315, { label: 'B', high: b })] : []),
    component('VCC1', 'vcc', 300, 55, { voltage: 5 }), component('U1', type, 360, 205),
    component('R1', 'resistor', 565, 225, { value: '330 Ω' }), component('LED1', 'led', 755, 210, { color: 'Green' }),
    component('GND1', 'ground', 870, 440)
  ];
  const wires = [
    wire('W1', 'DIN1.OUT', 'U1.A'), ...(!singleInput ? [wire('W2', 'DIN2.OUT', 'U1.B')] : []),
    wire('W3', 'VCC1.1', 'U1.VCC', 'power'), wire('W4', 'U1.GND', 'GND1.1', 'ground'),
    wire('W5', 'U1.Y', 'R1.1'), wire('W6', 'R1.2', 'LED1.A'), wire('W7', 'LED1.K', 'GND1.1', 'ground'),
    wire('W8', 'DIN1.GND', 'GND1.1', 'ground'), ...(!singleInput ? [wire('W9', 'DIN2.GND', 'GND1.1', 'ground')] : [])
  ];
  const inputs = singleInput ? `A=${a ? 1 : 0}` : `A=${a ? 1 : 0}, B=${b ? 1 : 0}`;
  return {
    id, title, category: 'Logic gates', difficulty: 'Beginner',
    description: `${title} powered demonstration with ${inputs}. Double-click either logic input to explore its complete truth table.`,
    circuit: project(id, components, wires)
  };
}

export const CIRCUIT_EXAMPLES = [
  {
    id: 'arduino-blink', title: 'Arduino LED Blink', category: 'Microcontroller', difficulty: 'Beginner',
    description: 'Arduino D13 drives an LED through a current-limiting resistor.',
    circuit: project('arduino-blink', [
      component('U1', 'arduino-uno', 90, 150), component('R1', 'resistor', 330, 220, { value: '220 Ω' }),
      component('LED1', 'led', 500, 205, { color: 'Red' }), component('GND1', 'ground', 700, 390)
    ], [wire('W1', 'U1.D13', 'R1.1'), wire('W2', 'R1.2', 'LED1.A'), wire('W3', 'LED1.K', 'GND1.1', 'ground')])
  },
  {
    id: 'switched-led', title: 'Battery, Switch & LED', category: 'Fundamentals', difficulty: 'Beginner',
    description: 'A complete battery-powered LED circuit controlled by an SPST switch.',
    circuit: project('switched-led', [
      component('BT1', 'battery', 90, 245, { voltage: 9 }), component('S1', 'switch-spst', 250, 250, { closed: true }),
      component('R1', 'resistor', 420, 250, { value: '330 Ω' }), component('LED1', 'led', 600, 235, { color: 'Green' })
    ], [wire('W1', 'BT1.+', 'S1.1', 'power'), wire('W2', 'S1.2', 'R1.1', 'power'), wire('W3', 'R1.2', 'LED1.A'), wire('W4', 'LED1.K', 'BT1.-', 'ground')])
  },
  {
    id: 'voltage-divider', title: 'Voltage Divider Measurements', category: 'Fundamentals', difficulty: 'Beginner',
    description: 'Two resistors divide 12 V; separate meters verify 12 V at the input and 6 V at the midpoint.',
    circuit: project('voltage-divider', [
      component('V1', 'dc-source', 80, 245, { voltage: 12 }), component('R1', 'resistor', 315, 150, { value: '10 kΩ', rotation: 90 }),
      component('R2', 'resistor', 315, 350, { value: '10 kΩ', rotation: 90 }), component('VMIN', 'voltmeter', 545, 125),
      component('VMOUT', 'voltmeter', 545, 285), component('GND1', 'ground', 760, 450)
    ], [
      wire('W1', 'V1.+', 'R1.1', 'power'), wire('W2', 'R1.2', 'R2.1'), wire('W3', 'R2.2', 'V1.-', 'ground'), wire('W4', 'R2.2', 'GND1.1', 'ground'),
      wire('W5', 'VMIN.+', 'V1.+'), wire('W6', 'VMIN.-', 'V1.-'), wire('W7', 'VMOUT.+', 'R1.2'), wire('W8', 'VMOUT.-', 'V1.-')
    ])
  },
  {
    id: 'rc-low-pass', title: 'RC Low-pass Filter', category: 'Analog', difficulty: 'Beginner',
    description: 'A first-order low-pass filter driven by an AC signal source.',
    circuit: project('rc-low-pass', [
      component('VS1', 'ac-source', 90, 245, { voltage: 5, frequency: 1000 }), component('R1', 'resistor', 300, 250, { value: '1 kΩ' }),
      component('C1', 'capacitor', 520, 320, { value: '100 nF', rotation: 90 }), component('GND1', 'ground', 700, 430)
    ], [wire('W1', 'VS1.1', 'R1.1'), wire('W2', 'R1.2', 'C1.1'), wire('W3', 'C1.2', 'VS1.2', 'ground'), wire('W4', 'C1.2', 'GND1.1', 'ground')])
  },
  {
    id: 'rlc-series', title: 'Series RLC Resonator', category: 'Analog', difficulty: 'Intermediate',
    description: 'Series resistor, inductor and capacitor excited by a sine source.',
    circuit: project('rlc-series', [
      component('VS1', 'ac-source', 70, 245, { voltage: 10, frequency: 1000 }), component('R1', 'resistor', 235, 250, { value: '100 Ω' }),
      component('L1', 'inductor', 410, 250, { value: '10 mH' }), component('C1', 'capacitor', 590, 250, { value: '2.2 µF' })
    ], [wire('W1', 'VS1.1', 'R1.1'), wire('W2', 'R1.2', 'L1.1'), wire('W3', 'L1.2', 'C1.1'), wire('W4', 'C1.2', 'VS1.2', 'ground')])
  },
  {
    id: 'zener-regulator', title: 'Zener Voltage Regulator', category: 'Analog', difficulty: 'Intermediate',
    description: 'A resistor-fed 5.1 V Zener shunt regulator with a load resistor.',
    circuit: project('zener-regulator', [
      component('V1', 'dc-source', 75, 240, { voltage: 12 }), component('R1', 'resistor', 260, 180, { value: '680 Ω' }),
      component('DZ1', 'zener', 470, 280, { voltage: '5.1 V', rotation: 90 }), component('R2', 'resistor', 650, 280, { value: '1 kΩ', rotation: 90 }),
      component('GND1', 'ground', 500, 455)
    ], [wire('W1', 'V1.+', 'R1.1', 'power'), wire('W2', 'R1.2', 'DZ1.2'), wire('W3', 'R1.2', 'R2.1'), wire('W4', 'DZ1.1', 'V1.-', 'ground'), wire('W5', 'R2.2', 'V1.-', 'ground'), wire('W6', 'V1.-', 'GND1.1', 'ground')])
  },
  {
    id: 'transistor-lamp', title: 'NPN Lamp Driver', category: 'Transistors', difficulty: 'Intermediate',
    description: 'A push button biases an NPN transistor that switches a lamp.',
    circuit: project('transistor-lamp', [
      component('BT1', 'battery', 70, 245, { voltage: 9 }), component('SW1', 'pushbutton', 230, 380, { closed: false }),
      component('R1', 'resistor', 390, 380, { value: '1 kΩ' }), component('Q1', 'transistor-npn', 570, 245, { model: '2N2222' }),
      component('LP1', 'lamp', 380, 115, { voltage: 9 })
    ], [wire('W1', 'BT1.+', 'LP1.1', 'power'), wire('W2', 'LP1.2', 'Q1.C'), wire('W3', 'Q1.E', 'BT1.-', 'ground'), wire('W4', 'BT1.+', 'SW1.1', 'power'), wire('W5', 'SW1.2', 'R1.1'), wire('W6', 'R1.2', 'Q1.B')])
  },
  {
    id: 'mosfet-motor', title: 'MOSFET Motor Driver', category: 'Transistors', difficulty: 'Intermediate',
    description: 'An N-channel MOSFET controls a DC motor from a separate battery.',
    circuit: project('mosfet-motor', [
      component('BT1', 'battery', 75, 220, { voltage: 12 }), component('M1', 'motor', 330, 120, { voltage: 12 }),
      component('Q1', 'nmos', 540, 240, { model: '2N7000' }), component('S1', 'switch-spst', 270, 410, { closed: true }),
      component('VCC1', 'vcc', 110, 390, { net: 'GATE', voltage: 5 }), component('GND1', 'ground', 710, 430)
    ], [wire('W1', 'BT1.+', 'M1.1', 'power'), wire('W2', 'M1.2', 'Q1.D'), wire('W3', 'Q1.S', 'BT1.-', 'ground'), wire('W4', 'VCC1.1', 'S1.1', 'power'), wire('W5', 'S1.2', 'Q1.G'), wire('W6', 'BT1.-', 'GND1.1', 'ground')])
  },
  {
    id: 'opamp-comparator', title: 'Op-amp Comparator', category: 'Analog', difficulty: 'Intermediate',
    description: 'A potentiometer reference feeds an op-amp comparator with LED output.',
    circuit: project('opamp-comparator', [
      component('V1', 'dc-source', 60, 245, { voltage: 5 }), component('RV1', 'potentiometer', 255, 205, { value: '10 kΩ', position: 60 }),
      component('U1', 'opamp', 470, 190, { model: 'LM358' }), component('R1', 'resistor', 665, 235, { value: '330 Ω' }),
      component('LED1', 'led', 820, 220, { color: 'Amber' }), component('GND1', 'ground', 520, 430)
    ], [wire('W1', 'V1.+', 'RV1.1', 'power'), wire('W2', 'RV1.2', 'V1.-', 'ground'), wire('W3', 'RV1.W', 'U1.+'), wire('W4', 'V1.+', 'U1.V+', 'power'), wire('W5', 'V1.-', 'U1.V-', 'ground'), wire('W6', 'U1.OUT', 'R1.1'), wire('W7', 'R1.2', 'LED1.A'), wire('W8', 'LED1.K', 'GND1.1', 'ground')])
  },
  {
    id: 'relay-lamp', title: 'Relay-controlled Lamp', category: 'Electromechanical', difficulty: 'Intermediate',
    description: 'A relay coil and normally-open contact switch an isolated lamp load.',
    circuit: project('relay-lamp', [
      component('V1', 'dc-source', 65, 340, { voltage: 5 }), component('S1', 'switch-spst', 220, 390, { closed: true }),
      component('K1', 'relay', 410, 245, { coilVoltage: '5 V', energized: true }), component('BT1', 'battery', 650, 105, { voltage: 12 }),
      component('LP1', 'lamp', 790, 260, { voltage: 12 })
    ], [wire('W1', 'V1.+', 'S1.1', 'power'), wire('W2', 'S1.2', 'K1.A1'), wire('W3', 'K1.A2', 'V1.-', 'ground'), wire('W4', 'BT1.+', 'K1.COM', 'power'), wire('W5', 'K1.NO', 'LP1.1'), wire('W6', 'LP1.2', 'BT1.-', 'ground')])
  },
  {
    id: 'transformer-supply', title: 'Measured Step-down Transformer', category: 'Power', difficulty: 'Intermediate',
    description: 'A 10:1 transformer displays 120 V RMS on its primary meter and 12 V RMS on its secondary meter before rectification.',
    circuit: project('transformer-supply', [
      component('VS1', 'ac-source', 35, 235, { voltage: 120, frequency: 60 }), component('VMP', 'voltmeter', 155, 90),
      component('T1', 'transformer', 310, 225, { ratio: '10:1' }), component('VMS', 'voltmeter', 455, 90),
      component('D1', 'diode', 520, 225, { model: '1N4007' }), component('C1', 'polarized-capacitor', 700, 300, { value: '1000 µF', rotation: 90 }),
      component('R1', 'resistor', 840, 300, { value: '1 kΩ', rotation: 90 }), component('GND1', 'ground', 700, 470)
    ], [
      wire('W1', 'VS1.1', 'T1.P1'), wire('W2', 'VS1.2', 'T1.P2'), wire('W3', 'T1.S1', 'D1.1'), wire('W4', 'D1.2', 'C1.1', 'power'),
      wire('W5', 'D1.2', 'R1.1', 'power'), wire('W6', 'C1.2', 'T1.S2', 'ground'), wire('W7', 'R1.2', 'T1.S2', 'ground'), wire('W8', 'T1.S2', 'GND1.1', 'ground'),
      wire('W9', 'VMP.+', 'T1.P1'), wire('W10', 'VMP.-', 'T1.P2'), wire('W11', 'VMS.+', 'T1.S1'), wire('W12', 'VMS.-', 'T1.S2')
    ])
  },
  {
    id: 'spdt-selector', title: 'SPDT A/B LED Selector', category: 'Switches', difficulty: 'Beginner',
    description: 'COM receives battery power; position A or B energizes exactly one LED branch.',
    circuit: project('spdt-selector', [
      component('BT1', 'battery', 65, 250, { voltage: 9 }), component('S1', 'switch-spdt', 245, 235, { position: 'A' }),
      component('R1', 'resistor', 445, 145, { value: '330 Ω' }), component('LEDA', 'led', 650, 125, { color: 'Green' }),
      component('R2', 'resistor', 445, 355, { value: '330 Ω' }), component('LEDB', 'led', 650, 335, { color: 'Red' })
    ], [wire('W1', 'BT1.+', 'S1.COM', 'power'), wire('W2', 'S1.A', 'R1.1'), wire('W3', 'R1.2', 'LEDA.A'), wire('W4', 'LEDA.K', 'BT1.-', 'ground'), wire('W5', 'S1.B', 'R2.1'), wire('W6', 'R2.2', 'LEDB.A'), wire('W7', 'LEDB.K', 'BT1.-', 'ground')])
  },
  {
    id: 'door-buzzer', title: 'Push-button Buzzer', category: 'Fundamentals', difficulty: 'Beginner',
    description: 'A momentary push button powers a buzzer through a protected battery circuit.',
    circuit: project('door-buzzer', [
      component('BT1', 'battery', 100, 250, { voltage: 9 }), component('F1', 'fuse', 280, 250, { rating: '500 mA' }),
      component('SW1', 'pushbutton', 460, 245, { closed: false }), component('BZ1', 'buzzer', 650, 235, { voltage: 9, frequency: 2400 })
    ], [wire('W1', 'BT1.+', 'F1.1', 'power'), wire('W2', 'F1.2', 'SW1.1', 'power'), wire('W3', 'SW1.2', 'BZ1.1'), wire('W4', 'BZ1.2', 'BT1.-', 'ground')])
  },
  {
    id: 'and-gate-lab', title: 'AND Gate Logic Lab', category: 'Digital logic', difficulty: 'Beginner',
    description: 'Two interactive logic inputs drive a powered 74HC AND gate, LED and oscilloscope channel.',
    circuit: project('and-gate-lab', [
      component('DIN1', 'logic-input', 55, 100, { label: 'A', high: true }), component('DIN2', 'logic-input', 55, 270, { label: 'B', high: true }),
      component('VCC1', 'vcc', 280, 50, { voltage: 5 }), component('U1', 'logic-and', 350, 180), component('R1', 'resistor', 550, 205, { value: '330 Ω' }),
      component('LED1', 'led', 720, 190, { color: 'Green' }), component('OSC1', 'oscilloscope', 535, 350), component('GND1', 'ground', 850, 455)
    ], [
      wire('W1', 'DIN1.OUT', 'U1.A'), wire('W2', 'DIN2.OUT', 'U1.B'), wire('W3', 'VCC1.1', 'U1.VCC', 'power'), wire('W4', 'U1.GND', 'GND1.1', 'ground'),
      wire('W5', 'U1.Y', 'R1.1'), wire('W6', 'R1.2', 'LED1.A'), wire('W7', 'LED1.K', 'GND1.1', 'ground'), wire('W8', 'U1.Y', 'OSC1.CH1'), wire('W9', 'OSC1.GND', 'GND1.1', 'ground'),
      wire('W10', 'DIN1.GND', 'GND1.1', 'ground'), wire('W11', 'DIN2.GND', 'GND1.1', 'ground')
    ])
  },
  {
    id: 'digital-capture', title: 'Clocked Digital Capture', category: 'Digital logic', difficulty: 'Advanced',
    description: 'A clocked D flip-flop feeds a four-channel logic analyzer for professional digital inspection.',
    circuit: project('digital-capture', [
      component('DIN1', 'logic-input', 60, 115, { label: 'DATA', high: true }), component('CLK1', 'clock-generator', 55, 300, { frequency: 1000, high: true }),
      component('VCC1', 'vcc', 300, 45, { voltage: 5 }), component('U1', 'd-flip-flop', 350, 155, { q: false }),
      component('LA1', 'logic-analyzer', 650, 145, { sampleRate: '24 MHz' }), component('GND1', 'ground', 530, 480)
    ], [
      wire('W1', 'DIN1.OUT', 'U1.D'), wire('W2', 'CLK1.OUT', 'U1.CLK'), wire('W3', 'VCC1.1', 'U1.VCC', 'power'), wire('W4', 'U1.GND', 'GND1.1', 'ground'),
      wire('W5', 'U1.Q', 'LA1.D0'), wire('W6', 'U1.QN', 'LA1.D1'), wire('W7', 'CLK1.OUT', 'LA1.D2'), wire('W8', 'DIN1.OUT', 'LA1.D3'),
      wire('W9', 'LA1.GND', 'GND1.1', 'ground'), wire('W10', 'DIN1.GND', 'GND1.1', 'ground'), wire('W11', 'CLK1.GND', 'GND1.1', 'ground')
    ])
  },
  {
    id: 'bench-measurements', title: 'Professional DC Bench', category: 'Instrumentation', difficulty: 'Intermediate',
    description: 'Series current and parallel voltage measurements with dedicated digital bench instruments.',
    circuit: project('bench-measurements', [
      component('V1', 'dc-source', 55, 235, { voltage: 12 }), component('AM1', 'ammeter', 220, 210), component('R1', 'resistor', 405, 225, { value: '120 Ω' }),
      component('LP1', 'lamp', 585, 210, { voltage: 12 }), component('VM1', 'voltmeter', 570, 365), component('OSC1', 'oscilloscope', 780, 190)
    ], [
      wire('W1', 'V1.+', 'AM1.+', 'power'), wire('W2', 'AM1.-', 'R1.1', 'power'), wire('W3', 'R1.2', 'LP1.1'), wire('W4', 'LP1.2', 'V1.-', 'ground'),
      wire('W5', 'VM1.+', 'LP1.1'), wire('W6', 'VM1.-', 'LP1.2', 'ground'), wire('W7', 'OSC1.CH1', 'LP1.1'), wire('W8', 'OSC1.GND', 'LP1.2', 'ground')
    ])
  },
  logicGateExample('or-gate-demo', 'OR Gate', 'logic-or', false, true),
  logicGateExample('not-gate-demo', 'NOT Gate', 'logic-not', false),
  logicGateExample('nand-gate-demo', 'NAND Gate', 'logic-nand', true, false),
  logicGateExample('nor-gate-demo', 'NOR Gate', 'logic-nor', false, false),
  logicGateExample('xor-gate-demo', 'XOR Gate', 'logic-xor', true, false),
  logicGateExample('xnor-gate-demo', 'XNOR Gate', 'logic-xnor', true, true)
];

export function findExample(id) { return CIRCUIT_EXAMPLES.find(example => example.id === id); }
