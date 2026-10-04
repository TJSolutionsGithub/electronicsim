export default `
<div class="app-shell">
  <header class="topbar">
    <div class="topbar-main">
      <div class="brand"><div class="brand-mark">⌬</div><div><strong>CircuitLab</strong><span>STUDIO</span></div><em class="version-badge">WORKSPACE v3.1 · NGSPICE WASM</em></div>
      <nav class="menubar" aria-label="Application menu">
        <button data-menu="file">File</button><button data-menu="edit">Edit</button><button data-menu="view">View</button><button data-menu="history">History</button><button data-menu="circuit">Circuit</button><button data-menu="simulation">Simulation</button><button data-menu="help">Help</button>
      </nav>
      <div class="runbar"><span class="engine-badge idle" id="engineBadge" title="ngspice runs locally in this browser">NGSPICE · WASM</span><span class="sim-state stopped"><b></b> STOPPED</span><button class="run primary" id="runBtn">▶ <span>Run</span></button><button class="tool" id="pauseBtn" title="Pause">Ⅱ</button><button class="tool" id="stopBtn" title="Stop">■</button><button class="tool" id="resetBtn" title="Reset">↻</button><div class="speed">1×</div><button class="icon-btn" id="settingsBtn" title="View settings">⚙</button></div>
    </div>
    <div class="tabbar"><div class="tabs-wrap"><div class="tabs" id="documentTabs" role="tablist" aria-label="Open circuits"></div><button class="add-tab" id="newTabBtn" title="New circuit tab">+</button></div><span class="tabbar-tip">Ctrl/Shift + click: multi-select · drag background: box select</span></div>
  </header>
  <div id="menuDropdown" class="menu-dropdown hidden" role="menu"></div>

  <div class="workspace">
    <nav class="activitybar" aria-label="Activity bar">
      <button class="activity active" data-panel="explorer" title="Explorer">▤</button><button class="activity" data-panel="components" title="Components">◈</button><button class="activity" data-panel="examples" title="Examples & templates">▧</button><button class="activity" data-panel="circuit" title="Circuit view">⌁</button><button class="activity" data-panel="instruments" title="Instruments">◒</button><button class="activity" data-panel="code" title="Code">{ }</button><div class="activity-spacer"></div><button class="activity" data-command="shortcuts" title="Keyboard shortcuts">⌨</button><button class="activity" data-command="settings" title="Settings">⚙</button>
    </nav>

    <aside class="left-panel" id="leftPanel">
      <section class="panel-head"><span id="panelTitle">EXPLORER</span><div class="head-actions"><button class="new-circuit-btn" title="New circuit">＋</button><button data-command="toggle-left" title="Close sidebar">×</button></div></section>
      <div id="explorerPanel" class="panel-content">
        <div class="project-title"><span>⌄</span> CIRCUITLAB PROJECT <small>⋯</small></div>
        <div class="tree"><div class="tree-row folder"><span>⌄</span> circuits</div><div class="tree-row file selected"><span class="file-dot"></span> <span class="project-file-name">main.sim</span><em class="dirty-mark">●</em></div><div class="tree-row folder"><span>›</span> src</div><div class="tree-row file"><span class="file-dot purple"></span> main.cpp</div><div class="tree-row file"><span class="readme">▤</span> README.md</div></div>
        <div class="explorer-bottom"><div class="project-title"><span>⌄</span> OUTLINE</div><p class="muted" id="outlineSummary">5 components · 4 wires</p><div class="project-title"><span>⌄</span> TIMELINE</div><p class="muted" id="historySummary">No changes yet</p></div>
      </div>
      <div id="componentsPanel" class="panel-content hidden"><div class="search"><span>⌕</span><input id="componentSearch" placeholder="Search components..." autocomplete="off"/></div><p class="library-hint">Click <b>＋</b> or drag a component onto the canvas.</p><div class="component-groups" id="componentList"></div></div>
      <div id="examplesPanel" class="panel-content hidden"><div class="search"><span>⌕</span><input id="exampleSearch" placeholder="Search example circuits..." autocomplete="off"/></div><p class="library-hint">Open a ready-to-run example in a new tab.</p><div class="example-list" id="exampleList"></div></div>
      <div id="codePanel" class="panel-content hidden"><div class="search"><span>⌕</span><input placeholder="Search files..."/></div><div class="tree"><div class="tree-row file selected"><span class="file-dot purple"></span> main.cpp</div></div></div>
    </aside>

    <main class="main-area">
      <div class="editor-toolbar"><div class="breadcrumbs"><span>circuits</span><b>›</b><strong id="breadcrumbName">main.sim</strong><span class="modified">●</span></div><div class="canvas-tools"><button class="tool-toggle active" id="gridBtn">▦ <span>Grid</span></button><button class="tool-toggle active" id="snapBtn">⌗ <span>Snap</span></button><button title="Zoom out" id="zoomOutBtn">−</button><span class="zoom">100%</span><button title="Zoom in" id="zoomInBtn">＋</button><button title="Fit circuit" id="fitBtn">⛶</button><button title="Pan canvas (Space + drag)" id="panBtn">✋</button><button title="Automatically arrange and reorient components" id="layoutBtn" class="layout-action">◇ <span>Auto-layout diagram</span></button><button title="Recalculate and optimize every wire" id="routeBtn" class="route-action">⌁ <span>Auto-route all wires</span></button></div></div>
      <div class="canvas-wrap" id="canvasWrap">
        <svg id="circuit" viewBox="0 0 1000 600" role="img" aria-label="Circuit canvas"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#27313d"/></pattern><filter id="glow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="1000" height="600" fill="url(#grid)" class="grid-bg"/></svg>
        <div class="canvas-hint">Ctrl/Shift + click or drag background to multi-select · <kbd>Space</kbd> + drag to pan · <kbd>O</kbd> auto-route</div>
        <div class="minimap"><span>MAIN.SIM</span><div class="mini-circuit"></div></div>
      </div>
      <div class="bottom-panel" id="bottomPanel"><div class="bottom-tabs"><button class="active">PROBLEMS <b id="problemCount">0</b></button><button>OUTPUT</button><button>TERMINAL</button><button>SERIAL</button><button>VARIABLES</button><span class="panel-chevron">⌄</span></div><div class="log"><span class="log-time">READY</span><span class="ok">✓</span> Circuit loaded · Drag from one pin to another to create a wire <span class="cursor">▌</span></div></div>
    </main>

    <aside class="right-panel" id="rightPanel">
      <section class="panel-head"><span>INSPECTOR</span><button data-command="toggle-right" title="Close inspector">×</button></section>
      <div class="inspector" id="inspector"></div>
      <div class="instrument-card"><div class="instrument-title"><span>◒</span> MULTIMETER <i>•••</i></div><div class="meter-reading"><strong id="meterValue">—</strong><span id="meterUnit"></span></div><div class="meter-modes"><button class="active">V DC</button><button>V AC</button><button>A</button><button>Ω</button></div><div class="meter-status"><span class="probe red"></span> COM <span class="probe black"></span> INPUT <em id="meterStatus">READY</em></div></div>
    </aside>
  </div>

  <div class="statusbar"><span class="branch">⌘ main</span><span id="statusErrors">◉ 0 errors</span><span id="statusWarnings">↯ 0 warnings</span><span class="status-spacer"></span><span id="selectionStatus">No selection</span><span id="canvasPosition">X 0 · Y 0</span><span>⚡ CircuitLab Engine</span></div>
</div>

<input type="file" id="circuitFileInput" accept=".json,.sim,application/json" hidden />
<div class="palette hidden" id="palette"><div class="palette-box"><div class="palette-search">⌕ <input autofocus placeholder="Search commands..." id="commandInput"/></div><div class="command-list" id="commandList"></div><div class="palette-footer">↑↓ Navigate <span>↵ Select</span><span>Esc Close</span></div></div></div>
<div class="app-dialog hidden" id="appDialog" role="dialog" aria-modal="true"><div class="dialog-box"><div class="dialog-head"><strong id="dialogTitle">CircuitLab</strong><button id="dialogClose">×</button></div><div id="dialogBody" class="dialog-body"></div><div class="dialog-actions"><button id="dialogOk" class="primary-action">OK</button></div></div></div>
<div id="toastArea" class="toast-area" aria-live="polite"></div>
`;
