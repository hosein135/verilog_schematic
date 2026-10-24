/* Schematic canvas. Parts and wires become Verilog through design.js. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var STORE = 'verilog-schematic-designer-v1';
  var PALETTE = [
    { group: 'Ports', items: [['in', 'Input'], ['out', 'Output']] },
    { group: 'Gates', items: [
      ['and', 'AND'], ['nand', 'NAND'], ['or', 'OR'], ['nor', 'NOR'],
      ['xor', 'XOR'], ['xnor', 'XNOR'], ['not', 'NOT'], ['buf', 'Buffer']
    ]},
    { group: 'Cells', items: [
      ['mux', 'Mux'], ['dff', 'Flip-flop'], ['c0', 'Constant 0'], ['c1', 'Constant 1'], ['block', 'Module']
    ]}
  ];

  var state = {
    doc: null,
    past: [],
    future: [],
    view: { x: 40, y: 32, z: 1 },
    sel: null,
    tool: '',
    toolRef: '',
    projectId: '',
    aspect: 'schematic',
    verilogText: null,
    vcd: {
      mode: 'text',
      text: '',
      log: '',
      model: null,
      selOrder: [],
      view0: 0,
      viewSpan: null,
      curT: null,
      running: false,
      drag: null,
      geom: null,
      plot: null
    },
    wiring: null,
    drag: null,
    marquee: null,
    pan: null,
    gesture: null,
    cursor: null,
    hover: null,
    report: null,
    viewer: null,
    notes: [],
    space: false,
    tex: { style: 'american', scope: 'active', dirty: false, busy: false }
  };
  var saveTimer = null;
  var toastTimer = null;

  function $(id) {
    if (id && id.charAt(0) === '#') id = id.slice(1);
    return document.getElementById(id);
  }

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    var k;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function svgText(attrs, text, parent) {
    var e = svgEl('text', attrs, parent);
    e.textContent = text == null ? '' : String(text);
    return e;
  }

  function el(tag, attrs, parent) {
    var node = document.createElement(tag);
    var k;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function disable(id, value) {
    var node = $(id);
    if (node) node.disabled = value;
  }

  function active() {
    return Design.moduleById(state.doc, state.doc.active) || state.doc.modules[0];
  }

  function partById(id) {
    var mod = active();
    var i;
    for (i = 0; i < mod.parts.length; i++) if (mod.parts[i].id === id) return mod.parts[i];
    return null;
  }

  function netById(id) {
    var nets = active().nets;
    var i;
    for (i = 0; i < nets.length; i++) if (nets[i].id === id) return nets[i];
    return null;
  }

  function netContaining(partId, pin) {
    var nets = active().nets;
    var i, j;
    for (i = 0; i < nets.length; i++) {
      var pins = nets[i].pins;
      for (j = 0; j < pins.length; j++) if (pins[j].part === partId && pins[j].pin === pin) return nets[i];
    }
    return null;
  }

  function snap(v) { return Math.round(v / 8) * 8; }

  function selectionList() {
    if (!state.sel) return [];
    if (state.sel.kind === 'many') return state.sel.items || [];
    return [state.sel];
  }

  function selectedPartIds() {
    var ids = [];
    selectionList().forEach(function (s) {
      if (s.kind === 'part') ids.push(s.id);
    });
    return ids;
  }

  function isSel(kind, id) {
    var list = selectionList();
    var i;
    for (i = 0; i < list.length; i++) if (list[i].kind === kind && list[i].id === id) return true;
    return false;
  }

  function setSelection(items) {
    var clean = [];
    var seen = Object.create(null);
    (items || []).forEach(function (s) {
      var key;
      if (!s || (s.kind !== 'part' && s.kind !== 'net')) return;
      key = s.kind + ':' + s.id;
      if (seen[key]) return;
      if (s.kind === 'part' && !partById(s.id)) return;
      if (s.kind === 'net' && !netById(s.id)) return;
      seen[key] = 1;
      clean.push({ kind: s.kind, id: s.id });
    });
    if (!clean.length) state.sel = null;
    else if (clean.length === 1) state.sel = clean[0];
    else state.sel = { kind: 'many', items: clean };
  }

  function partsInRect(box) {
    var x0 = Math.min(box.x0, box.x1);
    var y0 = Math.min(box.y0, box.y1);
    var x1 = Math.max(box.x0, box.x1);
    var y1 = Math.max(box.y0, box.y1);
    var ids = [];
    active().parts.forEach(function (part) {
      var m = Design.metrics(part, state.doc);
      if (part.x < x1 && part.x + m.w > x0 && part.y < y1 && part.y + m.h > y0) ids.push(part.id);
    });
    return ids;
  }

  function toolLabel(type) {
    var g, i;
    for (g = 0; g < PALETTE.length; g++) {
      for (i = 0; i < PALETTE[g].items.length; i++) if (PALETTE[g].items[i][0] === type) return PALETTE[g].items[i][1];
    }
    return type || 'part';
  }

  function typing(e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function toast(msg, ms) {
    var node = $('#toast');
    node.textContent = msg;
    node.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('on'); }, ms || 1700);
  }

  function saveNow() {
    if (state.projectId && window.Workspace) {
      Workspace.saveDrawing(state.projectId, state.doc, state.view);
      return;
    }
    try {
      localStorage.setItem(STORE, JSON.stringify({ doc: state.doc, view: state.view }));
    } catch (err) { /* private mode */ }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  }

  function pushUndo() {
    state.notes = [];
    state.past.push(Design.clone(state.doc));
    if (state.past.length > 80) state.past.shift();
    state.future = [];
  }

  function rememberSelection() {
    if (!state.sel) return;
    setSelection(selectionList());
  }

  function viewerOf(verilog) {
    if (typeof Schematic === 'undefined') return { ok: false, error: 'schematic.js did not load' };
    try { return Schematic.compile(verilog); }
    catch (err) { return { ok: false, error: (err && err.message) ? err.message : String(err) }; }
  }

  function onDocChange(opts) {
    opts = opts || {};
    if (opts.live) {
      renderCanvas();
      return;
    }
    rememberSelection();
    state.report = Design.report(state.doc);
    if (state.verilogText == null) loadVerilogBuffer();
    seedTestbenches();
    state.viewer = viewerOf(state.report.verilog);
    renderCanvas();
    renderCode();
    renderIssues();
    renderStatus();
    renderTabs();
    renderProjectModules();
    renderExplorer();
    renderAspectPane();
    if (opts.inspector !== false) renderInspector();
    if ($('#modname') && document.activeElement !== $('#modname')) $('#modname').value = active().name || '';
    disable('undo', !state.past.length);
    disable('redo', !state.future.length);
    disable('del', !state.sel);
    renderSync();
    saveSoon();
  }

  function undo() {
    if (!state.past.length) return;
    state.future.push(Design.clone(state.doc));
    state.doc = state.past.pop();
    Design.prune(state.doc);
    state.sel = null;
    state.wiring = null;
    onDocChange();
  }

  function redo() {
    if (!state.future.length) return;
    state.past.push(Design.clone(state.doc));
    state.doc = state.future.pop();
    Design.prune(state.doc);
    state.sel = null;
    state.wiring = null;
    onDocChange();
  }

  function icon(type) {
    var s = 'fill="none" stroke="#243044" stroke-width="1.5"';
    var body = '';
    if (type === 'in') body = '<rect ' + s + ' x="4" y="4" width="22" height="14" rx="3" fill="#e7f0fc"/>';
    else if (type === 'out') body = '<rect ' + s + ' x="4" y="4" width="22" height="14" rx="3" fill="#e5f6ec"/>';
    else if (type === 'and' || type === 'nand') {
      body = '<path ' + s + ' d="M4 3 H14 A8 8 0 0 1 14 19 H4 Z" fill="#fff"/>';
      if (type === 'nand') body += '<circle ' + s + ' cx="27" cy="11" r="3" fill="#fff"/>';
    } else if (type === 'or' || type === 'nor' || type === 'xor' || type === 'xnor') {
      body = '<path ' + s + ' d="M6 3 Q14 11 6 19 Q16 19 24 11 Q16 3 6 3 Z" fill="#fff"/>';
      if (type === 'xor' || type === 'xnor') body += '<path ' + s + ' d="M3 3 Q10 11 3 19"/>';
      if (type === 'nor' || type === 'xnor') body += '<circle ' + s + ' cx="29" cy="11" r="3" fill="#fff"/>';
    } else if (type === 'not' || type === 'buf') {
      body = '<path ' + s + ' d="M4 3 L22 11 L4 19 Z" fill="#fff"/>';
      if (type === 'not') body += '<circle ' + s + ' cx="26" cy="11" r="3" fill="#fff"/>';
    } else if (type === 'mux') body = '<path ' + s + ' d="M4 2 L28 7 L28 15 L4 20 Z" fill="#f7f2fc"/>';
    else if (type === 'dff') body = '<rect ' + s + ' x="4" y="3" width="24" height="16" fill="#fff8ec"/>';
    else if (type === 'c0' || type === 'c1') body = '<rect ' + s + ' x="6" y="3" width="16" height="16" rx="4" fill="#eef1f5"/><text x="14" y="15" text-anchor="middle" font-size="11" font-family="Segoe UI,sans-serif" fill="#161b22">' + (type === 'c1' ? '1' : '0') + '</text>';
    else if (type === 'block') body = '<rect ' + s + ' x="4" y="3" width="26" height="16" fill="#f3f6fb" stroke-dasharray="3 2"/>';
    else body = '<path ' + s + ' d="M8 3 L8 16 L11.5 12.5 L16 18 L18.2 16.8 L13.6 11.2 L18 11 Z" fill="#fff"/>';
    return '<svg viewBox="0 0 36 22" aria-hidden="true">' + body + '</svg>';
  }

  function buildPalette() {
    var host = $('#pal');
    var sel = el('button', { type: 'button', class: 'select-tool on', 'data-type': '' }, host);
    sel.innerHTML = icon('') + 'Select';
    PALETTE.forEach(function (group) {
      el('div', { class: 'pg', text: group.group }, host);
      group.items.forEach(function (item) {
        var b = el('button', { type: 'button', class: 'pi', 'data-type': item[0] }, host);
        b.innerHTML = icon(item[0]);
        b.appendChild(document.createTextNode(item[1]));
      });
    });
    el('div', { class: 'pg', id: 'modpalLabel', text: 'In this project' }, host);
    el('div', { id: 'modpal' }, host);
    var help = el('div', { class: 'help' }, host);
    el('p', { text: 'Click a tool, then the sheet. Drag a tool on to place it once. Shift keeps the tool armed.' }, help);
    el('p', { text: 'Modules already in this project are listed under In this project. Double-click a module on the sheet to open it.' }, help);
    el('p', { text: 'Click a pin, then another pin, to wire them. Alt-click a pin to disconnect it.' }, help);
    el('p', { text: 'Drag across the sheet to select every part in the box. Shift adds to the selection. Shift-click adds or removes one part. Ctrl+A selects every part.' }, help);
    var keys = el('p', {}, help);
    el('kbd', { text: 'Del' }, keys);
    keys.appendChild(document.createTextNode(' remove · '));
    el('kbd', { text: 'F' }, keys);
    keys.appendChild(document.createTextNode(' fit · '));
    el('kbd', { text: 'V' }, keys);
    keys.appendChild(document.createTextNode(' select · '));
    el('kbd', { text: 'Space' }, keys);
    keys.appendChild(document.createTextNode(' pan'));
    el('p', { text: 'Ctrl+Z undoes. Ctrl+Y or Ctrl+Shift+Z redoes.' }, help);
  }

  function syncPalette() {
    var nodes = document.querySelectorAll('#pal button');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i].hasAttribute('data-type')) continue;
      var ref = nodes[i].getAttribute('data-ref') || '';
      nodes[i].classList.toggle('on', nodes[i].getAttribute('data-type') === state.tool && ref === (state.toolRef || ''));
    }
    $('#canvas').classList.toggle('place', !!state.tool);
  }

  function fillExamples() {
    var sel = $('#examples');
    if (!sel) return;
    el('option', { value: '', text: 'Examples' }, sel);
    Design.EXAMPLES.forEach(function (pair) {
      el('option', { value: pair[0], text: pair[1] }, sel);
    });
  }

  function worldPins(part) {
    var m = Design.metrics(part, state.doc);
    return m.pins.map(function (p) {
      return {
        name: p.name,
        dir: p.dir,
        side: p.side,
        x: part.x + p.x,
        y: part.y + p.y,
        part: part
      };
    });
  }

  function pinWorld(part, name) {
    var pins = worldPins(part);
    var i;
    for (i = 0; i < pins.length; i++) if (pins[i].name === name) return pins[i];
    return null;
  }

  function planRoute(points) {
    if (!points || points.length < 2) return null;
    var src = points[0];
    var i;
    for (i = 0; i < points.length; i++) {
      var p = points[i];
      var srcOut = src.dir === 'out' || src.dir === 'inout';
      var pOut = p.dir === 'out' || p.dir === 'inout';
      if (pOut && (!srcOut || p.x > src.x)) src = p;
    }
    function tip(p) {
      var stub = 16;
      if (p.side === 'l') return { x: p.x - stub, y: p.y };
      if (p.side === 'r') return { x: p.x + stub, y: p.y };
      if (p.side === 'b') return { x: p.x, y: p.y + stub };
      return { x: p.x, y: p.y - stub };
    }
    var s0 = tip(src);
    var forward = [];
    var back = [];
    for (i = 0; i < points.length; i++) {
      if (points[i] === src) continue;
      var t = tip(points[i]);
      if (points[i].dir !== 'out' && points[i].dir !== 'inout' && t.x < s0.x - 8) back.push({ p: points[i], t: t });
      else forward.push({ p: points[i], t: t });
    }
    var minF = s0.x;
    if (forward.length) {
      minF = forward[0].t.x;
      forward.forEach(function (f) { if (f.t.x < minF) minF = f.t.x; });
    }
    var ys = [s0.y];
    var y0 = s0.y, y1 = s0.y;
    forward.forEach(function (f) {
      ys.push(f.t.y);
      if (f.t.y < y0) y0 = f.t.y;
      if (f.t.y > y1) y1 = f.t.y;
    });
    var bottom = src.y;
    points.forEach(function (pt) { if (pt.y > bottom) bottom = pt.y; });
    return {
      points: points, src: src, s0: s0, forward: forward, back: back,
      minF: minF, ys: ys, y0: y0, y1: y1, bottom: bottom
    };
  }

  function sharesChannel(a, b) {
    if (!a || !b || !a.forward.length || !b.forward.length) return false;
    if (!(a.minF > a.s0.x + 12) || !(b.minF > b.s0.x + 12)) return false;
    var midA = (a.s0.x + a.minF) / 2;
    var midB = (b.s0.x + b.minF) / 2;
    if (Math.abs(midA - midB) > 8) return false;
    return !(a.y1 < b.y0 - 6 || b.y1 < a.y0 - 6);
  }

  /* Nets that would draw the same vertical trunk get side-by-side lanes,
     so a and b in the half adder do not sit on one wire. */
  function assignLanes(plans) {
    var n = plans.length;
    var parent = [];
    var i, j;
    for (i = 0; i < n; i++) parent[i] = i;
    function find(a) {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    }
    for (i = 0; i < n; i++) {
      if (!plans[i]) continue;
      for (j = i + 1; j < n; j++) {
        if (sharesChannel(plans[i], plans[j])) parent[find(i)] = find(j);
      }
    }
    var groups = {};
    var lane = [];
    var count = [];
    for (i = 0; i < n; i++) {
      if (!plans[i] || !sharesChannel(plans[i], plans[i])) {
        lane[i] = 0;
        count[i] = 1;
        continue;
      }
      var root = find(i);
      if (!groups[root]) groups[root] = [];
      lane[i] = groups[root].length;
      groups[root].push(i);
    }
    for (i = 0; i < n; i++) {
      if (count[i] == null) count[i] = groups[find(i)].length;
    }
    return { lane: lane, count: count };
  }

  function trunkAt(plan, lane, count) {
    var x0 = plan.s0.x;
    var x1 = plan.minF;
    if (!plan.forward.length || !(x1 > x0 + 12) || count <= 1) {
      if (plan.forward.length && x1 > x0 + 12) return (x0 + x1) / 2;
      return x0;
    }
    var gap = x1 - x0;
    var inner = gap - 16;
    var pitch = inner / (count - 1);
    if (pitch > 16) return (x0 + x1) / 2 - 8 * (count - 1) + lane * 16;
    return x0 + 8 + lane * pitch;
  }

  function nearJoint(y, x0, x1, joints) {
    var lo = Math.min(x0, x1);
    var hi = Math.max(x0, x1);
    var i, d;
    for (i = 0; i < joints.length; i++) {
      d = joints[i];
      if (d.x <= lo + 1 || d.x >= hi - 1) continue;
      if (Math.abs(d.y - y) < 12) return true;
    }
    return false;
  }

  function jogOf(y, x0, x1, joints) {
    if (!nearJoint(y, x0, x1, joints)) return 0;
    var tries = [16, -16, 28, -28];
    var i;
    for (i = 0; i < tries.length; i++) {
      if (!nearJoint(y + tries[i], x0, x1, joints)) return tries[i];
    }
    return 16;
  }

  /* A straight run that passes another net's junction reads as a connection.
     Bend across that junction and come back to the pin. */
  function hrun(segs, x0, y, x1, joints) {
    var jog = jogOf(y, x0, x1, joints);
    if (!jog || Math.abs(x1 - x0) < 36) {
      segs.push([x0, y, x1, y]);
      return;
    }
    var lo = Math.min(x0, x1);
    var hi = Math.max(x0, x1);
    var xs = [];
    var i;
    for (i = 0; i < joints.length; i++) {
      var d = joints[i];
      if (d.x > lo + 4 && d.x < hi - 4 && Math.abs(d.y - y) < 12) xs.push(d.x);
    }
    if (!xs.length) {
      segs.push([x0, y, x1, y]);
      return;
    }
    var dir = x1 >= x0 ? 1 : -1;
    var enter = dir > 0 ? Math.min.apply(null, xs) : Math.max.apply(null, xs);
    var leave = dir > 0 ? Math.max.apply(null, xs) : Math.min.apply(null, xs);
    var xIn = enter - dir * 10;
    var xOut = leave + dir * 10;
    if (dir > 0) {
      if (xIn < x0 + 8) xIn = x0 + 8;
      if (xOut > x1 - 8) xOut = x1 - 8;
      if (xOut <= xIn) { segs.push([x0, y, x1, y]); return; }
    } else {
      if (xIn > x0 - 8) xIn = x0 - 8;
      if (xOut < x1 + 8) xOut = x1 + 8;
      if (xOut >= xIn) { segs.push([x0, y, x1, y]); return; }
    }
    var y2 = y + jog;
    segs.push([x0, y, xIn, y]);
    segs.push([xIn, y, xIn, y2]);
    segs.push([xIn, y2, xOut, y2]);
    segs.push([xOut, y2, xOut, y]);
    segs.push([xOut, y, x1, y]);
  }

  function route(plan, trunkX, joints) {
    joints = joints || [];
    var src = plan.src;
    var s0 = plan.s0;
    var ys = plan.ys;
    var segs = [[src.x, src.y, s0.x, s0.y]];
    hrun(segs, s0.x, s0.y, trunkX, joints);
    plan.forward.forEach(function (f) {
      hrun(segs, trunkX, f.t.y, f.t.x, joints);
      segs.push([f.t.x, f.t.y, f.p.x, f.p.y]);
    });
    if (ys.length >= 2) segs.push([trunkX, plan.y0, trunkX, plan.y1]);
    plan.back.forEach(function (b, idx) {
      var yf = plan.bottom + 28 + idx * 14;
      segs.push([b.p.x, b.p.y, b.t.x, b.t.y]);
      segs.push([b.t.x, b.t.y, b.t.x, yf]);
      hrun(segs, b.t.x, yf, trunkX, joints);
      segs.push([trunkX, yf, trunkX, plan.y0]);
    });
    var dots = [];
    if (plan.points.length >= 3) ys.forEach(function (y) { dots.push([trunkX, y]); });
    return { segs: segs, dots: dots };
  }

  function drawSymbol(g, part, m) {
    var w = m.w, h = m.h, t = part.type;
    var bubble = t === 'nand' || t === 'nor' || t === 'xnor';
    var inset = bubble ? 12 : 0;
    var stroke = '#243044';
    if (t === 'and' || t === 'nand') {
      var x0 = 2, y0 = 2, x1 = w - 2 - inset, y1 = h - 2;
      var r = Math.max(4, (y1 - y0) / 2);
      var ax = Math.max(x0 + 4, x1 - r);
      svgEl('path', {
        d: 'M ' + x0 + ' ' + y0 + ' H ' + ax + ' A ' + r + ' ' + r + ' 0 0 1 ' + ax + ' ' + y1 + ' H ' + x0 + ' Z',
        fill: '#fff', stroke: stroke, 'stroke-width': 1.6
      }, g);
    } else if (t === 'or' || t === 'nor' || t === 'xor' || t === 'xnor') {
      var ox0 = 8, oy0 = 3, ox1 = w - 3 - inset, oy1 = h - 3, om = h / 2;
      svgEl('path', {
        d: 'M ' + ox0 + ' ' + oy0 +
          ' Q ' + (ox0 + 16) + ' ' + om + ' ' + ox0 + ' ' + oy1 +
          ' Q ' + (ox0 + (ox1 - ox0) * 0.62) + ' ' + oy1 + ' ' + ox1 + ' ' + om +
          ' Q ' + (ox0 + (ox1 - ox0) * 0.62) + ' ' + oy0 + ' ' + ox0 + ' ' + oy0 + ' Z',
        fill: '#fff', stroke: stroke, 'stroke-width': 1.6
      }, g);
      if (t === 'xor' || t === 'xnor') {
        svgEl('path', {
          d: 'M ' + (ox0 - 5) + ' ' + oy0 + ' Q ' + (ox0 + 10) + ' ' + om + ' ' + (ox0 - 5) + ' ' + oy1,
          fill: 'none', stroke: stroke, 'stroke-width': 1.5
        }, g);
      }
    } else if (t === 'not' || t === 'buf') {
      var tip = t === 'not' ? w - 14 : w - 4;
      svgEl('path', {
        d: 'M 6 5 L ' + tip + ' ' + (h / 2) + ' L 6 ' + (h - 5) + ' Z',
        fill: '#fff', stroke: stroke, 'stroke-width': 1.6
      }, g);
      if (t === 'not') svgEl('circle', { cx: w - 7, cy: h / 2, r: 5, fill: '#fff', stroke: stroke, 'stroke-width': 1.5 }, g);
    } else if (t === 'dff') {
      svgEl('rect', { x: 2, y: 2, width: w - 4, height: h - 4, rx: 2, fill: '#fff8ec', stroke: stroke, 'stroke-width': 1.6 }, g);
      svgText({ x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#161b22', 'font-family': 'Segoe UI, sans-serif' }, 'FF', g);
    } else if (t === 'mux') {
      svgEl('path', {
        d: 'M 3 3 L ' + (w - 3) + ' ' + (h * 0.22) + ' L ' + (w - 3) + ' ' + (h * 0.78) + ' L 3 ' + (h - 3) + ' Z',
        fill: '#f7f2fc', stroke: stroke, 'stroke-width': 1.6
      }, g);
      svgText({ x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#161b22', 'font-family': 'Segoe UI, sans-serif' }, 'MUX', g);
    } else if (t === 'c0' || t === 'c1') {
      svgEl('rect', { x: 2, y: 2, width: w - 4, height: h - 4, rx: 6, fill: '#eef1f5', stroke: stroke, 'stroke-width': 1.6 }, g);
      svgText({ x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#161b22', 'font-family': 'Segoe UI, sans-serif' }, t === 'c1' ? '1' : '0', g);
    } else if (t === 'in' || t === 'out') {
      svgEl('rect', {
        x: 1, y: 1, width: w - 2, height: h - 2, rx: 5,
        fill: t === 'in' ? '#e7f0fc' : '#e5f6ec', stroke: stroke, 'stroke-width': 1.3
      }, g);
      svgText({ x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#161b22', 'font-family': 'Segoe UI, sans-serif' }, part.name || '', g);
    } else {
      svgEl('rect', {
        x: 2, y: 2, width: w - 4, height: h - 4, rx: 3,
        fill: '#f3f6fb', stroke: stroke, 'stroke-width': 1.6, 'stroke-dasharray': '5 3'
      }, g);
      svgText({ x: 10, y: 18, 'font-size': 12, 'font-weight': 700, fill: '#161b22', 'font-family': 'Segoe UI, sans-serif' }, part.name || '', g);
      var sub = Design.blockTypeName(part, state.doc);
      if (sub && sub !== part.name) {
        svgText({ x: 10, y: 34, 'font-size': 11, fill: '#5c6778', 'font-family': 'Segoe UI, sans-serif' }, sub.length > 28 ? sub.slice(0, 26) + '..' : sub, g);
      }
    }
    if (bubble) svgEl('circle', { cx: w - 6, cy: h / 2, r: 5, fill: '#fff', stroke: stroke, 'stroke-width': 1.5 }, g);
    if (t !== 'in' && t !== 'out' && t !== 'block' && t !== 'c0' && t !== 'c1') {
      var below = !m.pins.some(function (p) { return p.side === 'b'; });
      svgText({
        x: w / 2, y: below ? h + 13 : -6, 'text-anchor': 'middle', 'font-size': 11, fill: '#5c6778',
        'font-family': 'Segoe UI, sans-serif', 'pointer-events': 'none'
      }, part.name || '', g);
    }
    m.pins.forEach(function (p) {
      if (t !== 'dff') return;
      var lx = p.x, ly = p.y;
      if (p.name === 'CLK') {
        svgEl('path', {
          d: 'M ' + (lx - 5) + ' ' + (ly - 1) + ' L ' + (lx + 5) + ' ' + (ly - 1) + ' L ' + lx + ' ' + (ly - 9) + ' Z',
          fill: stroke, 'pointer-events': 'none'
        }, g);
      }
      var bub = (p.name === 'CLK' && part.clkEdge === 'neg') || ((p.name === 'RST' || p.name === 'SET') && part.rstEdge === 'neg');
      if (bub) {
        var cx = lx, cy = ly;
        if (p.side === 'l') cx = lx + 5;
        else if (p.side === 'b') cy = ly - 5;
        svgEl('circle', { cx: cx, cy: cy, r: 4, fill: '#fff', stroke: stroke, 'stroke-width': 1.3, 'pointer-events': 'none' }, g);
      }
    });
    if (t === 'mux' || t === 'dff' || t === 'block') {
      m.pins.forEach(function (p) {
        if (!p.name || p.side === 'b') return;
        svgText({
          x: p.side === 'r' ? w - 8 : 8,
          y: p.y + 3,
          'text-anchor': p.side === 'r' ? 'end' : 'start',
          'font-size': 9,
          fill: '#5c6778',
          'font-family': 'Segoe UI, sans-serif',
          'pointer-events': 'none'
        }, p.name, g);
      });
    }
  }

  function drawGrid(world) {
    var rect = $('#canvas').getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    var z = state.view.z || 1;
    var x0 = -state.view.x / z;
    var y0 = -state.view.y / z;
    var x1 = (rect.width - state.view.x) / z;
    var y1 = (rect.height - state.view.y) / z;
    var step = z < 0.5 ? 32 : (z > 1.75 ? 8 : 16);
    var major = step * 4;
    var left = Math.floor(x0 / step) * step;
    var top = Math.floor(y0 / step) * step;
    var right = x1 + step;
    var bottom = y1 + step;
    var minor = '';
    var majorD = '';
    var x, y, n;
    n = 0;
    for (x = left; x <= right && n < 240; x += step, n++) {
      var seg = 'M' + x + ' ' + top + 'V' + bottom + ' ';
      if (Math.abs(x / major - Math.round(x / major)) < 1e-6) majorD += seg;
      else minor += seg;
    }
    n = 0;
    for (y = top; y <= bottom && n < 240; y += step, n++) {
      var segY = 'M' + left + ' ' + y + 'H' + right + ' ';
      if (Math.abs(y / major - Math.round(y / major)) < 1e-6) majorD += segY;
      else minor += segY;
    }
    var g = svgEl('g', { 'pointer-events': 'none' }, world);
    svgEl('path', { d: minor, fill: 'none', stroke: '#e3ebf4', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, g);
    svgEl('path', { d: majorD, fill: 'none', stroke: '#d2deea', 'stroke-width': 1.15, 'vector-effect': 'non-scaling-stroke' }, g);
  }

  function renderCanvas() {
    var world = $('#world');
    var v = state.view;
    world.setAttribute('transform', 'translate(' + v.x + ' ' + v.y + ') scale(' + v.z + ')');
    while (world.firstChild) world.removeChild(world.firstChild);
    drawGrid(world);
    var mod = active();
    if (!mod) return;
    var lab = state.report && state.report.labels[mod.id];
    var drawNets = [];
    var plans = [];
    mod.nets.forEach(function (net) {
      var pts = [];
      net.pins.forEach(function (ref) {
        var part = partById(ref.part);
        if (!part) return;
        var pin = pinWorld(part, ref.pin);
        if (pin) pts.push(pin);
      });
      var plan = planRoute(pts);
      if (!plan) return;
      drawNets.push(net);
      plans.push(plan);
    });
    var lanes = assignLanes(plans);
    var trunks = [];
    var joints = [];
    plans.forEach(function (plan, i) {
      trunks[i] = trunkAt(plan, lanes.lane[i], lanes.count[i]);
      plan.ys.forEach(function (y) { joints.push({ net: i, x: trunks[i], y: y }); });
    });
    drawNets.forEach(function (net, ni) {
      var foreign = [];
      joints.forEach(function (j) { if (j.net !== ni) foreign.push(j); });
      var routed = route(plans[ni], trunks[ni], foreign);
      if (!routed.segs.length) return;
      var d = '';
      routed.segs.forEach(function (s) {
        if (Math.abs(s[0] - s[2]) < 0.4 && Math.abs(s[1] - s[3]) < 0.4) return;
        d += 'M ' + s[0].toFixed(1) + ' ' + s[1].toFixed(1) + ' L ' + s[2].toFixed(1) + ' ' + s[3].toFixed(1) + ' ';
      });
      if (!d) return;
      var on = isSel('net', net.id);
      var hot = state.hover && state.hover.net === net.id;
      svgEl('path', { d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 12, 'data-net': net.id }, world);
      svgEl('path', {
        d: d, fill: 'none', stroke: on || hot ? '#1d6fe0' : '#3e4c60',
        'stroke-width': on ? 2.4 : 1.6, 'stroke-linecap': 'square', 'stroke-linejoin': 'miter', 'pointer-events': 'none'
      }, world);
      routed.dots.forEach(function (dot) {
        svgEl('circle', { cx: dot[0], cy: dot[1], r: on ? 3.1 : 2.6, fill: on ? '#1d6fe0' : '#243044', stroke: '#f5f8fb', 'stroke-width': 1, 'pointer-events': 'none' }, world);
      });
      var info = lab && lab.nets[net.id];
      var label = info ? (info.vname || info.expr || '') : (net.name || '');
      if (label && String(label).length < 18 && routed.segs[0]) {
        var mid = routed.segs[0];
        svgText({
          x: (mid[0] + mid[2]) / 2,
          y: Math.min(mid[1], mid[3]) - 4,
          'font-size': 11,
          fill: '#5c6b7e',
          stroke: '#f5f8fb',
          'stroke-width': 3,
          'paint-order': 'stroke',
          'stroke-linejoin': 'round',
          'font-family': 'Segoe UI, sans-serif',
          'pointer-events': 'none'
        }, label, world);
      }
    });

    if (state.wiring) {
      var from = partById(state.wiring.part);
      var a = from && pinWorld(from, state.wiring.pin);
      if (a && state.cursor) {
        svgEl('path', {
          d: 'M ' + a.x + ' ' + a.y + ' L ' + state.cursor.x + ' ' + a.y + ' L ' + state.cursor.x + ' ' + state.cursor.y,
          fill: 'none', stroke: '#1d6fe0', 'stroke-width': 1.4, 'stroke-dasharray': '4 3', 'pointer-events': 'none'
        }, world);
      }
    }

    mod.parts.forEach(function (part) {
      var m = Design.metrics(part, state.doc);
      var g = svgEl('g', { transform: 'translate(' + part.x + ' ' + part.y + ')' }, world);
      drawSymbol(g, part, m);
      var selected = isSel('part', part.id);
      if (selected) {
        svgEl('rect', {
          x: -6, y: -6, width: m.w + 12, height: m.h + 12, rx: 7,
          fill: 'rgba(29,111,224,0.08)', stroke: '#1d6fe0', 'stroke-width': 1.6, 'pointer-events': 'none'
        }, g);
      }
      svgEl('rect', { x: 0, y: 0, width: m.w, height: m.h, fill: 'transparent', 'data-part': part.id }, g);
      m.pins.forEach(function (p) {
        var net = netContaining(part.id, p.name);
        var open = !net;
        var mark = (state.wiring && state.wiring.part === part.id && state.wiring.pin === p.name) ||
          (net && isSel('net', net.id));
        svgEl('circle', {
          cx: p.x, cy: p.y, r: 8, fill: 'transparent',
          'data-pin': p.name, 'data-part': part.id
        }, g);
        svgEl('circle', {
          cx: p.x, cy: p.y, r: mark ? 4.2 : 3.2,
          fill: open ? '#fff' : (mark ? '#1d6fe0' : '#243044'),
          stroke: mark ? '#1d6fe0' : '#243044',
          'stroke-width': 1.2,
          'pointer-events': 'none'
        }, g);
      });
    });

    if ((state.tool || (state.gesture && state.gesture.moved)) && state.cursor) {
      var kind = state.tool || (state.gesture && state.gesture.type);
      if (kind) {
        var ghost = {
          type: kind, name: kind === 'in' ? 'a' : kind === 'out' ? 'y' : 'u',
          x: 0, y: 0, inputs: 2, hasRst: false, clkEdge: 'pos', rstEdge: 'pos', rstVal: 0,
          ref: state.toolRef || '', ext: 'block', ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }]
        };
        var gm = Design.metrics(ghost, state.doc);
        var gx = snap(state.cursor.x - gm.w / 2);
        var gy = snap(state.cursor.y - gm.h / 2);
        var gg = svgEl('g', { transform: 'translate(' + gx + ' ' + gy + ')', opacity: 0.45, 'pointer-events': 'none' }, world);
        drawSymbol(gg, ghost, gm);
      }
    }

    if (state.marquee && state.marquee.moved) {
      var mx = Math.min(state.marquee.x0, state.marquee.x1);
      var my = Math.min(state.marquee.y0, state.marquee.y1);
      var mw = Math.abs(state.marquee.x1 - state.marquee.x0);
      var mh = Math.abs(state.marquee.y1 - state.marquee.y0);
      svgEl('rect', {
        x: mx, y: my, width: Math.max(mw, 0.5), height: Math.max(mh, 0.5),
        fill: 'rgba(29,111,224,0.14)', stroke: '#1d6fe0', 'stroke-width': 1.25,
        'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none'
      }, world);
    }
  }

  function renderCode() {
    var text = (state.report && state.report.verilog) || '';
    var box = $('#verilog');
    if (box) box.value = text;
    var stat = $('#codestat');
    if (!stat) return;
    var lines = text ? text.replace(/\n$/, '').split('\n').length : 0;
    stat.textContent = lines ? (lines + (lines === 1 ? ' line' : ' lines')) : '';
  }

  function allIssues() {
    var list = (state.notes || []).map(function (msg) {
      return { level: 'warn', msg: 'Import: ' + msg };
    });
    if (state.report && state.report.issues) list = list.concat(state.report.issues);
    if (state.viewer && !state.viewer.ok) {
      list.unshift({ level: 'error', msg: state.viewer.error || 'The viewer rejected this Verilog' });
    }
    return list;
  }

  function renderIssues() {
    var host = $('#issues');
    while (host.firstChild) host.removeChild(host.firstChild);
    var issues = allIssues();
    host.hidden = !issues.length;
    issues.forEach(function (issue) {
      var row = el('div', { class: 'issue ' + (issue.level === 'error' ? 'error' : 'warn'), text: issue.msg }, host);
      row.addEventListener('click', function () {
        if (issue.moduleId && issue.moduleId !== state.doc.active) {
          state.doc.active = issue.moduleId;
          state.sel = null;
        }
        if (issue.partId && partById(issue.partId)) {
          state.sel = { kind: 'part', id: issue.partId };
          var part = partById(issue.partId);
          reveal(part);
        } else if (issue.netId && netById(issue.netId)) {
          state.sel = { kind: 'net', id: issue.netId };
        }
        onDocChange();
      });
    });
  }

  function renderStatus() {
    var issues = allIssues();
    var errors = issues.filter(function (i) { return i.level === 'error'; }).length;
    var warns = issues.length - errors;
    var badge = $('#badge');
    if (badge) {
      badge.className = 'chip badge';
      if (!state.viewer || !state.viewer.ok) {
        badge.classList.add('bad');
        badge.textContent = 'Viewer rejected it';
      } else if (errors || warns) {
        badge.classList.add('warn');
        badge.textContent = 'Draws, with ' + issues.length + (issues.length === 1 ? ' note' : ' notes');
      } else {
        badge.classList.add('ok');
        badge.textContent = 'Viewer can draw this';
      }
    }
    var hint = $('#hint');
    if (state.wiring) {
      hint.hidden = false;
      hint.textContent = 'Click a pin to connect. Esc cancels.';
    } else if (state.tool) {
      hint.hidden = false;
      hint.textContent = 'Click to place ' + toolLabel(state.tool) + '. Shift keeps the tool.';
    } else if (state.marquee) {
      hint.hidden = false;
      hint.textContent = state.marquee.add ? 'Release to add these parts to the selection.' : 'Release to select the parts inside the box.';
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
    $('#canvas').classList.toggle('wire', !!state.wiring);
    $('#canvas').classList.toggle('area', !!state.marquee);
    $('#zoom').textContent = Math.round(state.view.z * 100) + '%';
  }

  function renderTabs() {
    var host = $('#tabs');
    while (host.firstChild) host.removeChild(host.firstChild);
    state.doc.modules.forEach(function (mod) {
      var b = el('button', {
        type: 'button',
        class: 'tab' + (mod.id === state.doc.active ? ' on' : '')
      }, host);
      b.appendChild(document.createTextNode(mod.name || 'module'));
      if (state.doc.modules.length > 1) {
        var x = el('span', { class: 'x', title: 'Delete module', text: '\u00d7' }, b);
        x.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          deleteModule(mod.id);
        });
      }
      b.addEventListener('click', function () {
        if (state.doc.active === mod.id) return;
        state.doc.active = mod.id;
        state.sel = null;
        state.wiring = null;
        onDocChange();
        requestAnimationFrame(fit);
      });
    });
    var add = el('button', { type: 'button', class: 'addtab', text: 'New module' }, host);
    add.addEventListener('click', addModule);
  }

  function field(label, control, parent) {
    var wrap = el('label', { class: 'field' }, parent);
    el('span', { text: label }, wrap);
    wrap.appendChild(control);
    return wrap;
  }

  function commitIfChanged(before) {
    if (!before) return;
    if (JSON.stringify(before) !== JSON.stringify(state.doc)) {
      state.past.push(before);
      if (state.past.length > 80) state.past.shift();
      state.future = [];
    }
  }

  function bindText(input, beforeSlot, read, write) {
    var before = null;
    input.addEventListener('focus', function () { before = Design.clone(state.doc); });
    input.addEventListener('input', function () {
      write(input.value);
      state.report = Design.report(state.doc);
      state.viewer = viewerOf(state.report.verilog);
      renderCanvas();
      renderCode();
      renderIssues();
      renderStatus();
      renderTabs();
      renderExplorer();
      if ($('#modname') && document.activeElement !== $('#modname')) $('#modname').value = active().name || '';
      if (state.aspect === 'icon') renderAspectPane();
      saveSoon();
    });
    input.addEventListener('blur', function (e) {
      commitIfChanged(before);
      before = null;
      disable('undo', !state.past.length);
      var next = e.relatedTarget;
      if (next && (($('#inspector') && $('#inspector').contains(next)) || ($('#aspectHost') && $('#aspectHost').contains(next)))) return;
      onDocChange();
    });
    input.value = read();
    return input;
  }

  function renderInspector() {
    var host = $('#inspector');
    while (host.firstChild) host.removeChild(host.firstChild);
    var mod = active();
    var lab = state.report && state.report.labels[mod.id];
    if (!state.sel) {
      el('h2', { text: mod.name || 'Module' }, host);
      el('p', {
        class: 'note',
        text: 'Draw the module here. Update Verilog copies this drawing into the Verilog editor. Apply from Verilog replaces the drawing with that editor.'
      }, host);
      var ports = mod.parts.filter(function (p) { return p.type === 'in' || p.type === 'out'; });
      if (!ports.length) el('p', { class: 'note', text: 'Add inputs and outputs from the palette. They become the module ports.' }, host);
      else {
        var list = el('div', { class: 'pins' }, host);
        ports.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (p) {
          var row = el('div', { class: 'pinrow' }, list);
          el('em', { class: p.type, text: p.type === 'in' ? 'in' : 'out' }, row);
          el('span', { text: (lab && lab.ports[p.id]) || p.name }, row);
        });
      }
      if (state.doc.modules.length > 1) {
        var del = el('button', { type: 'button', text: 'Delete this module' }, host);
        del.addEventListener('click', function () { deleteModule(mod.id); });
      }
      return;
    }
    if (state.sel.kind === 'many') {
      var pickedParts = selectionList().filter(function (s) { return s.kind === 'part'; });
      var pickedNets = selectionList().length - pickedParts.length;
      var pickedTitle = pickedParts.length + (pickedParts.length === 1 ? ' part' : ' parts');
      if (pickedNets) pickedTitle += ', ' + pickedNets + (pickedNets === 1 ? ' net' : ' nets');
      el('h2', { text: pickedTitle }, host);
      el('p', { class: 'note', text: 'Drag any selected part to move the group. Delete removes the whole selection.' }, host);
      var names = el('div', { class: 'pins' }, host);
      pickedParts.slice(0, 12).forEach(function (s) {
        var one = partById(s.id);
        if (!one) return;
        var row = el('div', { class: 'pinrow' }, names);
        el('span', { text: (one.name || one.type) + ' · ' + toolLabel(one.type) }, row);
      });
      if (pickedParts.length > 12) el('p', { class: 'note', text: (pickedParts.length - 12) + ' more' }, host);
      var drop = el('button', { type: 'button', text: 'Delete selection' }, host);
      drop.addEventListener('click', deleteSelection);
      return;
    }
    if (state.sel.kind === 'net') {
      var net = netById(state.sel.id);
      el('h2', { text: 'Net' }, host);
      if (!net) return;
      var info = lab && lab.nets[net.id];
      var locked = info && (info.kind === 'port-in' || info.kind === 'const' || (info.outPorts && info.outPorts.length));
      if (locked) {
        el('p', { class: 'note', text: 'Verilog name ' + ((info && (info.vname || info.expr)) || '') + '. It follows the port or constant on this net.' }, host);
      } else {
        var name = el('input', { spellcheck: 'false' });
        field('Net name', name, host);
        bindText(name, null, function () { return net.name || ''; }, function (v) { net.name = v; });
      }
      var pins = el('div', { class: 'pins' }, host);
      net.pins.forEach(function (ref) {
        var part = partById(ref.part);
        var row = el('div', { class: 'pinrow' }, pins);
        el('span', { text: (part ? part.name : ref.part) + '.' + ref.pin }, row);
        var b = el('button', { type: 'button', class: 'mini', text: 'Disconnect' }, row);
        b.addEventListener('click', function () {
          pushUndo();
          disconnect(ref.part, ref.pin);
          onDocChange();
        });
      });
      return;
    }
    var part = partById(state.sel.id);
    if (!part) return;
    el('h2', { text: toolLabel(part.type) }, host);
    var nameIn = el('input', { spellcheck: 'false' });
    field(part.type === 'in' || part.type === 'out' ? 'Port name' : 'Name', nameIn, host);
    bindText(nameIn, null, function () { return part.name || ''; }, function (v) { part.name = v; });
    if (lab && lab.inst && lab.inst[part.id] && lab.inst[part.id] !== part.name) {
      el('p', { class: 'note', text: 'Verilog instance name ' + lab.inst[part.id] }, host);
    }
    if (Design.MULTI[part.type]) {
      var num = el('input', { type: 'number', min: '2', max: '8' });
      num.value = String(part.inputs || 2);
      field('Inputs', num, host);
      num.addEventListener('change', function () {
        pushUndo();
        var n = parseInt(num.value, 10);
        if (!n || n < 2) n = 2;
        if (n > 8) n = 8;
        part.inputs = n;
        Design.prune(state.doc);
        onDocChange();
      });
    }
    if (part.type === 'dff') {
      var edge = el('select');
      el('option', { value: 'pos', text: 'Rising edge' }, edge);
      el('option', { value: 'neg', text: 'Falling edge' }, edge);
      edge.value = part.clkEdge === 'neg' ? 'neg' : 'pos';
      field('Clock', edge, host);
      edge.addEventListener('change', function () {
        pushUndo();
        part.clkEdge = edge.value === 'neg' ? 'neg' : 'pos';
        onDocChange();
      });
      var rst = el('select');
      el('option', { value: 'none', text: 'No reset' }, rst);
      el('option', { value: 'rst', text: 'Async reset to 0' }, rst);
      el('option', { value: 'set', text: 'Async set to 1' }, rst);
      rst.value = !part.hasRst ? 'none' : (part.rstVal ? 'set' : 'rst');
      field('Reset', rst, host);
      rst.addEventListener('change', function () {
        pushUndo();
        applyReset(part, rst.value);
        onDocChange();
      });
      if (part.hasRst) {
        var pol = el('select');
        el('option', { value: 'pos', text: 'Active high' }, pol);
        el('option', { value: 'neg', text: 'Active low' }, pol);
        pol.value = part.rstEdge === 'neg' ? 'neg' : 'pos';
        field('Reset level', pol, host);
        pol.addEventListener('change', function () {
          pushUndo();
          part.rstEdge = pol.value === 'neg' ? 'neg' : 'pos';
          onDocChange();
        });
      }
    }
    if (part.type === 'block') {
      var pick = el('select');
      el('option', { value: '', text: 'External module' }, pick);
      state.doc.modules.forEach(function (m) {
        if (m.id === mod.id) return;
        el('option', { value: m.id, text: m.name }, pick);
      });
      pick.value = part.ref || '';
      field('Module', pick, host);
      pick.addEventListener('change', function () {
        pushUndo();
        part.ref = pick.value || '';
        if (part.ref) part.ports = [];
        Design.prune(state.doc);
        onDocChange();
      });
      if (part.ref) {
        var open = el('button', { type: 'button', text: 'Open ' + Design.blockTypeName(part, state.doc) }, host);
        open.addEventListener('click', function () {
          state.doc.active = part.ref;
          state.sel = null;
          onDocChange();
          requestAnimationFrame(fit);
        });
      } else {
        var ext = el('input', { spellcheck: 'false' });
        field('External name', ext, host);
        bindText(ext, null, function () { return part.ext || ''; }, function (v) { part.ext = v; });
        renderBlockPorts(part, host);
        var make = el('button', { type: 'button', text: 'Create module from these ports' }, host);
        make.addEventListener('click', function () { createModuleFrom(part); });
      }
    }
    el('div', { class: 'pg', text: 'PINS' }, host);
    host.appendChild(pinList(part));
  }

  function pinList(part) {
    var box = el('div', { class: 'pins' });
    var lab = state.report && state.report.labels[active().id];
    Design.pins(part, state.doc).forEach(function (pin) {
      var row = el('div', { class: 'pinrow' }, box);
      el('em', { text: pin.name }, row);
      var net = netContaining(part.id, pin.name);
      var info = net && lab && lab.nets[net.id];
      var span = el('span', {
        class: net ? 'netlive' : 'netopen',
        text: net ? ((info && (info.vname || info.expr)) || 'connected') : 'open'
      }, row);
      span.style.flex = '1';
      if (net) {
        var b = el('button', { type: 'button', class: 'mini', text: 'Disconnect' }, row);
        b.addEventListener('click', function () {
          pushUndo();
          disconnect(part.id, pin.name);
          onDocChange();
        });
      }
    });
    return box;
  }

  function renderBlockPorts(part, host) {
    if (!part.ports) part.ports = [];
    part.ports.forEach(function (port, index) {
      var row = el('div', { class: 'row' }, host);
      var name = el('input', { spellcheck: 'false' });
      name.value = port.name || '';
      field('Port', name, row);
      var was = port.name;
      name.addEventListener('focus', function () { was = port.name; name._before = Design.clone(state.doc); });
      name.addEventListener('input', function () { port.name = name.value; });
      name.addEventListener('blur', function (e) {
        retarget(part.id, was, port.name);
        commitIfChanged(name._before);
        Design.prune(state.doc);
        var next = e.relatedTarget;
        if (next && host.contains(next)) {
          state.report = Design.report(state.doc);
          renderCanvas();
          renderCode();
          return;
        }
        onDocChange();
      });
      var dir = el('select');
      el('option', { value: 'input', text: 'input' }, dir);
      el('option', { value: 'output', text: 'output' }, dir);
      dir.value = port.dir === 'output' ? 'output' : 'input';
      field('Dir', dir, row);
      dir.addEventListener('change', function () {
        pushUndo();
        port.dir = dir.value === 'output' ? 'output' : 'input';
        onDocChange();
      });
      var rm = el('button', { type: 'button', class: 'mini', text: 'Remove' }, host);
      rm.addEventListener('click', function () {
        pushUndo();
        disconnect(part.id, port.name);
        part.ports.splice(index, 1);
        Design.prune(state.doc);
        onDocChange();
      });
    });
    var add = el('button', { type: 'button', text: 'Add port' }, host);
    add.addEventListener('click', function () {
      pushUndo();
      part.ports.push({ name: 'p' + (part.ports.length + 1), dir: 'input' });
      onDocChange();
    });
  }

  function applyReset(part, mode) {
    var oldName = part.hasRst ? (part.rstVal ? 'SET' : 'RST') : '';
    if (mode === 'none') part.hasRst = false;
    else if (mode === 'set') { part.hasRst = true; part.rstVal = 1; }
    else { part.hasRst = true; part.rstVal = 0; }
    var newName = part.hasRst ? (part.rstVal ? 'SET' : 'RST') : '';
    if (oldName && oldName !== newName) {
      if (newName) retarget(part.id, oldName, newName);
      else disconnect(part.id, oldName);
    }
    Design.prune(state.doc);
  }

  function retarget(partId, oldName, newName) {
    if (!oldName || oldName === newName) return;
    active().nets.forEach(function (net) {
      net.pins.forEach(function (ref) {
        if (ref.part === partId && ref.pin === oldName) ref.pin = newName;
      });
    });
  }

  function disconnect(partId, pin) {
    active().nets.forEach(function (net) {
      net.pins = net.pins.filter(function (ref) { return !(ref.part === partId && ref.pin === pin); });
    });
    Design.prune(state.doc);
  }

  function connect(a, b) {
    var mod = active();
    if (a.part === b.part && a.pin === b.pin) return null;
    var na = netContaining(a.part, a.pin);
    var nb = netContaining(b.part, b.pin);
    if (na && na === nb) return na;
    if (na && nb) {
      nb.pins.forEach(function (ref) { na.pins.push({ part: ref.part, pin: ref.pin }); });
      mod.nets = mod.nets.filter(function (n) { return n !== nb; });
      Design.prune(state.doc);
      return na;
    }
    if (na) { na.pins.push({ part: b.part, pin: b.pin }); Design.prune(state.doc); return na; }
    if (nb) { nb.pins.push({ part: a.part, pin: a.pin }); Design.prune(state.doc); return nb; }
    var net = {
      id: Design.uid(state.doc, 'n'),
      name: '',
      pins: [{ part: a.part, pin: a.pin }, { part: b.part, pin: b.pin }]
    };
    mod.nets.push(net);
    return net;
  }

  function placeAt(w, keep) {
    var mod = active();
    var probe = {
      type: state.tool, name: 'uu', inputs: 2, hasRst: false, ref: state.toolRef || '', ext: 'block',
      ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }]
    };
    var m = Design.metrics(probe, state.doc);
    pushUndo();
    var part = Design.freshPart(state.doc, mod.id, state.tool, snap(w.x - m.w / 2), snap(w.y - m.h / 2));
    if (state.toolRef) {
      part.ref = state.toolRef;
      part.ext = '';
      part.ports = [];
    }
    mod.parts.push(part);
    state.sel = { kind: 'part', id: part.id };
    if (!keep) {
      state.tool = '';
      state.toolRef = '';
    }
    state.wiring = null;
    syncPalette();
    onDocChange();
  }

  function deleteSelection() {
    var items = selectionList();
    if (!items.length) return;
    var mod = active();
    var parts = Object.create(null);
    var nets = Object.create(null);
    items.forEach(function (s) {
      if (s.kind === 'part') parts[s.id] = 1;
      else nets[s.id] = 1;
    });
    pushUndo();
    mod.parts = mod.parts.filter(function (p) { return !parts[p.id]; });
    mod.nets = mod.nets.filter(function (n) { return !nets[n.id]; });
    state.sel = null;
    state.marquee = null;
    Design.prune(state.doc);
    onDocChange();
  }

  function duplicate() {
    var ids = selectedPartIds();
    if (!ids.length) return;
    var mod = active();
    var copies = [];
    pushUndo();
    ids.forEach(function (id) {
      var part = partById(id);
      var copy;
      if (!part) return;
      copy = Design.clone(part);
      copy.id = Design.uid(state.doc, 'p');
      copy.x = snap(part.x + 24);
      copy.y = snap(part.y + 24);
      copy.name = Design.autoName(mod, part.type);
      mod.parts.push(copy);
      copies.push({ kind: 'part', id: copy.id });
    });
    setSelection(copies);
    onDocChange();
  }

  function addModule() {
    pushUndo();
    var id = Design.uid(state.doc, 'm');
    var name = 'mod';
    var i = 2;
    while (state.doc.modules.some(function (m) { return m.name === name; })) { name = 'mod' + i; i++; }
    state.doc.modules.push({ id: id, name: name, parts: [], nets: [] });
    state.doc.active = id;
    state.sel = null;
    state.wiring = null;
    onDocChange();
    requestAnimationFrame(fit);
  }

  function deleteModule(id) {
    if (state.doc.modules.length < 2) return;
    var mod = Design.moduleById(state.doc, id);
    if (!mod) return;
    var ports = Design.blockPorts({ type: 'block', ref: id, ports: [] }, state.doc);
    pushUndo();
    state.doc.modules.forEach(function (m) {
      m.parts.forEach(function (p) {
        if (p.type === 'block' && p.ref === id) {
          p.ref = '';
          p.ext = mod.name || 'block';
          p.ports = ports.map(function (port) { return { name: port.name, dir: port.dir }; });
        }
      });
    });
    state.doc.modules = state.doc.modules.filter(function (m) { return m.id !== id; });
    if (state.doc.active === id) state.doc.active = state.doc.modules[0].id;
    state.sel = null;
    Design.prune(state.doc);
    onDocChange();
    requestAnimationFrame(fit);
  }

  function createModuleFrom(part) {
    pushUndo();
    var id = Design.uid(state.doc, 'm');
    var base = (part.ext || 'block').replace(/[^A-Za-z0-9_$]/g, '') || 'block';
    if (/^[0-9]/.test(base)) base = 'm_' + base;
    var name = base;
    var i = 2;
    while (state.doc.modules.some(function (m) { return m.name === name; })) { name = base + i; i++; }
    var mod = { id: id, name: name, parts: [], nets: [] };
    var ports = (part.ports || []).slice();
    var y = 48;
    ports.forEach(function (p) {
      var type = p.dir === 'output' ? 'out' : 'in';
      mod.parts.push({
        id: Design.uid(state.doc, 'p'),
        type: type,
        name: p.name || (type === 'in' ? 'a' : 'y'),
        x: type === 'in' ? 48 : 300,
        y: y
      });
      y += 56;
    });
    state.doc.modules.push(mod);
    part.ref = id;
    part.ext = '';
    part.ports = [];
    state.doc.active = id;
    state.sel = null;
    Design.prune(state.doc);
    onDocChange();
    requestAnimationFrame(fit);
  }

  function reveal(part) {
    if (!part) return;
    var m = Design.metrics(part, state.doc);
    var rect = $('#canvas').getBoundingClientRect();
    var cx = part.x + m.w / 2;
    var cy = part.y + m.h / 2;
    state.view.x = rect.width / 2 - cx * state.view.z;
    state.view.y = rect.height / 2 - cy * state.view.z;
  }

  function zoomAround(z) {
    var rect = $('#canvas').getBoundingClientRect();
    var cx = rect.width / 2;
    var cy = rect.height / 2;
    var prev = state.view.z || 1;
    var wx = (cx - state.view.x) / prev;
    var wy = (cy - state.view.y) / prev;
    state.view.z = z;
    state.view.x = cx - wx * z;
    state.view.y = cy - wy * z;
    renderCanvas();
    renderStatus();
    saveSoon();
  }

  function zoomBy(factor) {
    var z = (state.view.z || 1) * factor;
    if (z < 0.25) z = 0.25;
    if (z > 2.4) z = 2.4;
    zoomAround(z);
  }

  function fit() {
    var mod = active();
    var rect = $('#canvas').getBoundingClientRect();
    if (!mod || !mod.parts.length || rect.width < 20) {
      state.view = { x: 40, y: 32, z: 1 };
      renderCanvas();
      renderStatus();
      saveSoon();
      return;
    }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    mod.parts.forEach(function (p) {
      var m = Design.metrics(p, state.doc);
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x + m.w > x1) x1 = p.x + m.w;
      if (p.y + m.h + 18 > y1) y1 = p.y + m.h + 18;
    });
    var z = Math.min((rect.width - 88) / Math.max(1, x1 - x0), (rect.height - 120) / Math.max(1, y1 - y0));
    if (!isFinite(z) || z <= 0) z = 1;
    z = Math.max(0.25, Math.min(1.7, z));
    state.view.z = z;
    state.view.x = (rect.width - (x1 - x0) * z) / 2 - x0 * z;
    state.view.y = (rect.height - (y1 - y0) * z) / 2 - y0 * z - 8;
    renderCanvas();
    renderStatus();
    saveSoon();
  }

  function worldFromEvent(e) {
    var rect = $('#canvas').getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - state.view.x) / state.view.z,
      y: (e.clientY - rect.top - state.view.y) / state.view.z
    };
  }

  function onCanvasDown(e) {
    if (e.button === 1 || state.space) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    var pinEl = e.target.closest && e.target.closest('[data-pin]');
    var partEl = e.target.closest && e.target.closest('[data-part]');
    var netEl = e.target.closest && e.target.closest('[data-net]');
    var w = worldFromEvent(e);
    if (pinEl && e.altKey) {
      e.preventDefault();
      pushUndo();
      disconnect(pinEl.getAttribute('data-part'), pinEl.getAttribute('data-pin'));
      state.wiring = null;
      onDocChange();
      return;
    }
    if (pinEl) {
      e.preventDefault();
      var ref = { part: pinEl.getAttribute('data-part'), pin: pinEl.getAttribute('data-pin') };
      if (state.wiring) {
        if (state.wiring.part !== ref.part || state.wiring.pin !== ref.pin) {
          pushUndo();
          var net = connect(state.wiring, ref);
          state.sel = net ? { kind: 'net', id: net.id } : null;
        }
        state.wiring = null;
        onDocChange();
      } else {
        state.wiring = ref;
        state.tool = '';
        syncPalette();
        renderCanvas();
        renderStatus();
      }
      return;
    }
    if (state.tool && !partEl) {
      placeAt(w, e.shiftKey);
      return;
    }
    if (partEl) {
      var id = partEl.getAttribute('data-part');
      var items, idx, i, ids, keepGroup, origins;
      state.wiring = null;
      if (state.tool) { state.tool = ''; syncPalette(); }
      if (e.shiftKey) {
        items = selectionList().map(function (s) { return { kind: s.kind, id: s.id }; });
        idx = -1;
        for (i = 0; i < items.length; i++) if (items[i].kind === 'part' && items[i].id === id) idx = i;
        if (idx >= 0) items.splice(idx, 1);
        else items.push({ kind: 'part', id: id });
        setSelection(items);
        onDocChange();
        return;
      }
      keepGroup = isSel('part', id) && selectedPartIds().length > 1;
      if (keepGroup) ids = selectedPartIds();
      else {
        setSelection([{ kind: 'part', id: id }]);
        ids = [id];
      }
      origins = {};
      ids.forEach(function (pid) {
        var p = partById(pid);
        if (p) origins[pid] = { x: p.x, y: p.y };
      });
      state.drag = { ids: ids, origins: origins, wx: w.x, wy: w.y, undo: false, narrow: keepGroup ? id : '' };
      try { $('#canvas').setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      renderCanvas();
      return;
    }
    if (netEl && !state.tool) {
      var nid = netEl.getAttribute('data-net');
      if (e.shiftKey) {
        var kept = selectionList().map(function (s) { return { kind: s.kind, id: s.id }; });
        var at = -1;
        var k;
        for (k = 0; k < kept.length; k++) if (kept[k].kind === 'net' && kept[k].id === nid) at = k;
        if (at >= 0) kept.splice(at, 1);
        else kept.push({ kind: 'net', id: nid });
        setSelection(kept);
      } else setSelection([{ kind: 'net', id: nid }]);
      state.wiring = null;
      onDocChange();
      return;
    }
    if (!state.tool) {
      state.marquee = {
        x0: w.x, y0: w.y, x1: w.x, y1: w.y,
        sx: e.clientX, sy: e.clientY,
        moved: false,
        add: !!e.shiftKey,
        base: e.shiftKey ? selectionList().map(function (s) { return { kind: s.kind, id: s.id }; }) : []
      };
      try { $('#canvas').setPointerCapture(e.pointerId); } catch (err2) { /* already released */ }
      renderStatus();
      return;
    }
  }

  function startPan(e, deselect) {
    state.pan = {
      x: e.clientX, y: e.clientY,
      ox: state.view.x, oy: state.view.y,
      moved: false,
      deselect: !!deselect
    };
    $('#canvas').setPointerCapture(e.pointerId);
    $('#canvas').classList.add('pan');
  }

  function onCanvasMove(e) {
    var w = worldFromEvent(e);
    state.cursor = w;
    if (state.drag) {
      var dx = w.x - state.drag.wx;
      var dy = w.y - state.drag.wy;
      var next = [];
      var changed = false;
      state.drag.ids.forEach(function (id) {
        var part = partById(id);
        var origin = state.drag.origins[id];
        var nx, ny;
        if (!part || !origin) return;
        if (state.drag.ids.length > 1) {
          nx = origin.x + snap(dx);
          ny = origin.y + snap(dy);
        } else {
          nx = snap(origin.x + dx);
          ny = snap(origin.y + dy);
        }
        if (nx !== part.x || ny !== part.y) changed = true;
        next.push({ part: part, x: nx, y: ny });
      });
      if (changed) {
        if (!state.drag.undo) {
          pushUndo();
          state.drag.undo = true;
        }
        next.forEach(function (item) {
          item.part.x = item.x;
          item.part.y = item.y;
        });
        onDocChange({ live: true });
      }
      return;
    }
    if (state.marquee) {
      state.marquee.x1 = w.x;
      state.marquee.y1 = w.y;
      if (Math.abs(e.clientX - state.marquee.sx) + Math.abs(e.clientY - state.marquee.sy) > 4) state.marquee.moved = true;
      renderCanvas();
      return;
    }
    if (state.pan) {
      var dx = e.clientX - state.pan.x;
      var dy = e.clientY - state.pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.pan.moved = true;
      state.view.x = state.pan.ox + dx;
      state.view.y = state.pan.oy + dy;
      renderCanvas();
      return;
    }
    var pinEl = e.target.closest && e.target.closest('[data-pin]');
    var netEl = e.target.closest && e.target.closest('[data-net]');
    var hover = null;
    if (pinEl) hover = { part: pinEl.getAttribute('data-part'), pin: pinEl.getAttribute('data-pin') };
    else if (netEl) hover = { net: netEl.getAttribute('data-net') };
    var same = JSON.stringify(hover) === JSON.stringify(state.hover);
    state.hover = hover;
    if (!same || state.wiring || state.tool) renderCanvas();
  }

  function finishMarquee() {
    var box = state.marquee;
    var hits, items;
    state.marquee = null;
    if (!box) return;
    if (!box.moved) {
      if (!box.add) {
        state.sel = null;
        state.wiring = null;
      }
      onDocChange();
      return;
    }
    hits = partsInRect(box);
    items = box.add ? box.base.slice() : [];
    hits.forEach(function (id) { items.push({ kind: 'part', id: id }); });
    setSelection(items);
    state.wiring = null;
    onDocChange();
  }

  function onCanvasUp(e) {
    if (state.drag) {
      var moved = state.drag.undo;
      var narrow = state.drag.narrow;
      var group = state.drag.ids.length > 1;
      state.drag = null;
      if (!moved && group && narrow) setSelection([{ kind: 'part', id: narrow }]);
      onDocChange(moved ? { inspector: false } : undefined);
      disable('undo', !state.past.length);
    }
    if (state.marquee) finishMarquee();
    if (state.pan) {
      var deselect = state.pan.deselect && !state.pan.moved;
      state.pan = null;
      $('#canvas').classList.remove('pan');
      if (deselect) {
        state.sel = null;
        state.wiring = null;
        onDocChange();
      } else saveSoon();
      renderStatus();
    }
  }

  function onWindowMove(e) {
    if (!state.gesture) return;
    var dx = e.clientX - state.gesture.x;
    var dy = e.clientY - state.gesture.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) state.gesture.moved = true;
    var rect = $('#canvas').getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      state.cursor = worldFromEvent(e);
    } else state.cursor = null;
    if (state.gesture.moved) renderCanvas();
  }

  function onWindowUp(e) {
    if (state.drag || state.pan || state.marquee) onCanvasUp(e);
    if (!state.gesture) return;
    var g = state.gesture;
    state.gesture = null;
    var rect = $('#canvas').getBoundingClientRect();
    var inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (g.moved && inside && g.type) {
      state.tool = g.type;
      state.toolRef = g.ref || '';
      state.cursor = worldFromEvent(e);
      placeAt(state.cursor, false);
    } else if (!g.moved) {
      if (state.tool === g.type && (state.toolRef || '') === (g.ref || '')) {
        state.tool = '';
        state.toolRef = '';
      } else {
        state.tool = g.type;
        state.toolRef = g.ref || '';
      }
      syncPalette();
      renderCanvas();
      renderStatus();
    } else {
      renderCanvas();
    }
  }

  function download(name, data, type) {
    var blob = (typeof Blob !== 'undefined' && data instanceof Blob) ? data : new Blob([data], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function closeSheet() {
    $('#modal').hidden = true;
    state.preview = null;
    setTexMode(false);
  }

  function setTexMode(on) {
    var bar = $('#texBar');
    var st = $('#texStyle');
    var sc = $('#texScope');
    if (bar) bar.hidden = !on;
    if (st) st.hidden = !on;
    if (sc) sc.hidden = !on;
  }

  function texStatus(msg) {
    var node = $('#texStatus');
    if (node) node.textContent = msg || '';
    var modal = $('#modal');
    if (msg && modal && modal.hidden) toast(msg, 4200);
  }

  function currentTex() {
    var ta = $('#texArea');
    return ta ? ta.value : '';
  }

  function drawingTex() {
    if (typeof CircuiTikZ === 'undefined') { toast('circuitikz.js did not load'); return null; }
    return CircuiTikZ.toTex(state.doc, { style: state.tex.style, scope: state.tex.scope });
  }

  function downloadDrawingTex() {
    var out = drawingTex();
    if (!out || !out.tex) return;
    download((active().name || 'schematic') + '.tex', out.tex, 'text/plain');
    if (out.warnings && out.warnings.length) toast(out.warnings[0], 4200);
  }

  function rememberTexStyle() {
    try { localStorage.setItem('verilog-schematic-designer-tex', state.tex.style); } catch (err) { /* private mode */ }
  }

  function fillTex(force) {
    var ta = $('#texArea');
    if (!ta || typeof CircuiTikZ === 'undefined') return;
    if (state.tex.dirty && !force) {
      if (!window.confirm('Replace the edited CircuiTikZ with the drawing?')) return;
    }
    var out = CircuiTikZ.toTex(state.doc, { style: state.tex.style, scope: state.tex.scope });
    ta.value = out.tex;
    state.tex.dirty = false;
    texStatus((out.warnings && out.warnings.length) ? out.warnings[0] : 'Edit this TeX, then convert it back or download a PDF.');
  }

  function openTex() {
    if (typeof CircuiTikZ === 'undefined') { toast('circuitikz.js did not load'); return; }
    var modal = $('#modal');
    modal.hidden = false;
    $('#sheet').classList.remove('compact');
    $('#importBar').hidden = true;
    $('#sheetMod').hidden = true;
    $('#sheetTitle').textContent = 'CircuiTikZ';
    setTexMode(true);
    var body = $('#sheetBody');
    clearNode(body);
    var ta = el('textarea', { id: 'texArea', class: 'tex', spellcheck: 'false' }, body);
    ta.addEventListener('input', function () { state.tex.dirty = true; });
    $('#texStyle').value = state.tex.style;
    $('#texScope').value = state.tex.scope;
    fillTex(true);
    setTimeout(function () { ta.focus(); }, 30);
  }

  function importTex(src) {
    if (typeof CircuiTikZ === 'undefined') { toast('circuitikz.js did not load'); return false; }
    var out = CircuiTikZ.fromTex(src);
    if (!out.doc) {
      var msg = out.error || 'That TeX did not convert';
      texStatus(msg);
      toast(msg);
      return false;
    }
    pushUndo();
    state.doc = out.doc;
    state.notes = out.warnings || [];
    state.sel = null;
    state.tool = '';
    state.wiring = null;
    syncPalette();
    onDocChange();
    requestAnimationFrame(fit);
    return true;
  }

  function texLogLine(log) {
    var lines = String(log || '').split(/\r?\n/);
    var i;
    var m;
    for (i = 0; i < lines.length; i++) {
      m = /^\.\/[^:]*:(\d+): (.*)$/.exec(lines[i]);
      if (m) return 'line ' + m[1] + ': ' + m[2];
      m = /^! (.*)$/.exec(lines[i]);
      if (m) return m[1];
    }
    return '';
  }

  function setPdfButtons(disabled) {
    ['texPdf', 'schPdf'].forEach(function (id) {
      var btn = $('#' + id);
      if (btn) btn.disabled = disabled;
    });
  }

  function downloadPdf(raw) {
    if (state.tex.busy) return;
    if (typeof CircuiTikZ === 'undefined') { toast('circuitikz.js did not load'); return; }
    if (typeof fetch !== 'function') {
      texStatus('This browser cannot compile PDF here. Use Open on TeXLive.net.');
      return;
    }
    var body = typeof raw === 'string' ? raw : currentTex();
    if (!String(body || '').trim()) { toast('Nothing to export'); return; }
    var tex = CircuiTikZ.wrapDocument(body);
    state.tex.busy = true;
    setPdfButtons(true);
    var t0 = Date.now();
    texStatus('Compiling on latex.ytotech.com (sends this TeX to a third-party server)...');
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 60000);
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiler: 'pdflatex', resources: [{ main: true, content: tex }] })
    };
    if (ctrl) opts.signal = ctrl.signal;
    fetch('https://latex.ytotech.com/builds/sync', opts).then(function (res) {
      clearTimeout(timer);
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('pdf') >= 0) return res.blob().then(function (blob) { return { blob: blob }; });
      return res.text().then(function (text) {
        var msg = 'PDF compile failed (' + res.status + ')';
        try {
          var parsed = JSON.parse(text);
          var log = '';
          if (parsed.log_files) {
            log = parsed.log_files['__main_document__.log'] || '';
            if (!log) {
              var keys = Object.keys(parsed.log_files);
              if (keys.length) log = parsed.log_files[keys[0]];
            }
          }
          var line = texLogLine(log);
          if (line) msg = line;
          else if (parsed.error) msg = String(parsed.error);
        } catch (err) { /* keep msg */ }
        throw new Error(msg);
      });
    }).then(function (got) {
      download((active().name || 'schematic') + '.pdf', got.blob, 'application/pdf');
      var kb = Math.max(1, Math.round(got.blob.size / 1024));
      var sec = ((Date.now() - t0) / 1000).toFixed(1);
      texStatus('Downloaded ' + kb + ' KB PDF in ' + sec + ' s.');
    }, function (err) {
      clearTimeout(timer);
      var msg = (err && err.name === 'AbortError') ? 'PDF compile timed out.' : ((err && err.message) || 'PDF compile failed.');
      texStatus(msg + ' You can use Open on TeXLive.net instead.');
    }).then(function () {
      state.tex.busy = false;
      setPdfButtons(false);
    });
  }

  function downloadDrawingPdf() {
    var out = drawingTex();
    if (!out || !out.tex) return;
    downloadPdf(out.tex);
  }

  function openTexLive() {
    if (typeof CircuiTikZ === 'undefined') { toast('circuitikz.js did not load'); return; }
    var form = document.createElement('form');
    form.method = 'post';
    form.enctype = 'multipart/form-data';
    form.target = '_blank';
    form.action = 'https://texlive.net/cgi-bin/latexcgi';
    form.style.display = 'none';
    function field(name, value, tag) {
      var input = document.createElement(tag || 'input');
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    field('filecontents[]', CircuiTikZ.wrapDocument(currentTex()), 'textarea');
    field('filename[]', 'document.tex');
    field('engine', 'pdflatex');
    field('return', 'pdf');
    document.body.appendChild(form);
    form.submit();
    form.remove();
    texStatus('Opened TeXLive.net in a new tab. That also sends this TeX to a third-party server.');
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function openPreview() {
    if (!state.report) return;
    var c = viewerOf(state.report.verilog);
    state.preview = c;
    var modal = $('#modal');
    modal.hidden = false;
    $('#sheet').classList.remove('compact');
    $('#importBar').hidden = true;
    setTexMode(false);
    $('#sheetTitle').textContent = 'Schematic viewer';
    var body = $('#sheetBody');
    clearNode(body);
    if (!c.ok) {
      $('#sheetMod').hidden = true;
      el('div', { class: 'err', text: c.error || 'Compile failed' }, body);
      return;
    }
    var sel = $('#sheetMod');
    sel.hidden = false;
    clearNode(sel);
    c.order.forEach(function (name) {
      el('option', { value: name, text: name }, sel);
    });
    sel.value = c.top || c.order[0];
    requestAnimationFrame(function () { drawPreview(sel.value); });
  }

  function drawPreview(name) {
    var c = state.preview;
    if (!c || !c.ok || !c.modules[name]) return;
    var body = $('#sheetBody');
    clearNode(body);
    var host = el('div', {}, body);
    host.style.height = '100%';
    host.style.minHeight = '460px';
    var mod = c.modules[name];
    Schematic.layout(mod);
    var w = body.clientWidth || 800;
    var h = body.clientHeight || 500;
    var fitTo = Schematic.fit(mod, w, h);
    host.appendChild(Schematic.draw(mod, fitTo));
  }

  function openImport() {
    var modal = $('#modal');
    modal.hidden = false;
    $('#sheet').classList.add('compact');
    $('#importBar').hidden = false;
    setTexMode(false);
    $('#sheetTitle').textContent = 'Import Verilog';
    $('#sheetMod').hidden = true;
    var body = $('#sheetBody');
    clearNode(body);
    var ta = el('textarea', { id: 'importText', placeholder: 'Paste Verilog or CircuiTikZ. Gates, mux assigns, flip-flop always blocks, and CircuiTikZ nodes become a drawing.' }, body);
    if (!$('#importFile')) {
      var b = el('button', { type: 'button', id: 'importFile', text: 'Open file' });
      b.addEventListener('click', function () { $('#file').click(); });
      $('#importBar').insertBefore(b, $('#importGo'));
    }
    setTimeout(function () { ta.focus(); }, 30);
  }

  function importVerilog(src) {
    if (typeof Schematic === 'undefined') { toast('schematic.js did not load'); return false; }
    var c = Schematic.compile(src);
    if (!c.ok) { toast(c.error || 'That Verilog did not compile'); return false; }
    c.order.forEach(function (name) {
      try { Schematic.layout(c.modules[name]); } catch (err) { /* grid fallback */ }
    });
    var keptTb = {};
    state.doc.modules.forEach(function (m) {
      if (m.tb) keptTb[m.name] = m.tb;
    });
    var out = Design.fromCompiled(c, { externals: Design.externalStubs(src) });
    out.doc.modules.forEach(function (m) {
      if (!m.tb && keptTb[m.name]) m.tb = keptTb[m.name];
    });
    pushUndo();
    state.doc = out.doc;
    state.notes = out.warnings || [];
    state.sel = null;
    state.tool = '';
    state.wiring = null;
    syncPalette();
    onDocChange();
    if (state.aspect === 'schematic') requestAnimationFrame(fit);
    return true;
  }

  function openFileText(text, filename) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return;
    if (trimmed.charAt(0) === '{' || /\.json$/i.test(filename || '')) {
      try {
        var data = JSON.parse(text);
        var doc = data.doc || data;
        if (!doc.modules) throw new Error('not a drawing');
        pushUndo();
        state.doc = doc;
        Design.prune(state.doc);
        state.sel = null;
        state.notes = [];
        if (data.view && typeof data.view.z === 'number') state.view = data.view;
        onDocChange();
        if (!data.view) requestAnimationFrame(fit);
        closeSheet();
        toast('Opened drawing');
      } catch (err) {
        toast('Could not read that drawing');
      }
      return;
    }
    if (typeof CircuiTikZ !== 'undefined' && (CircuiTikZ.looksLikeTex(text) || /\.(tex|tikz|pgf)$/i.test(filename || ''))) {
      if (importTex(text)) {
        closeSheet();
        toast('Imported CircuiTikZ');
      }
      return;
    }
    if (importVerilog(text)) {
      closeSheet();
      toast('Imported Verilog');
    }
  }

  function bind() {
    var canvas = $('#canvas');
    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('pointermove', onCanvasMove);
    canvas.addEventListener('pointerup', onCanvasUp);
    canvas.addEventListener('pointercancel', onCanvasUp);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var w = worldFromEvent(e);
      var z = state.view.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08);
      z = Math.max(0.25, Math.min(2.4, z));
      var rect = canvas.getBoundingClientRect();
      state.view.x = (e.clientX - rect.left) - w.x * z;
      state.view.y = (e.clientY - rect.top) - w.y * z;
      state.view.z = z;
      renderCanvas();
      renderStatus();
      saveSoon();
    }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('dblclick', function (e) {
      var partEl = e.target.closest && e.target.closest('[data-part]');
      if (!partEl) return;
      var part = partById(partEl.getAttribute('data-part'));
      if (part && part.type === 'block' && part.ref) activateModule(part.ref);
    });

    $('#pal').addEventListener('pointerdown', function (e) {
      var btn = e.target.closest && e.target.closest('button[data-type]');
      if (!btn) return;
      e.preventDefault();
      state.gesture = {
        type: btn.getAttribute('data-type'),
        ref: btn.getAttribute('data-ref') || '',
        x: e.clientX,
        y: e.clientY,
        moved: false
      };
    });
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);

    if ($('#undo')) $('#undo').addEventListener('click', undo);
    if ($('#redo')) $('#redo').addEventListener('click', redo);
    if ($('#del')) $('#del').addEventListener('click', deleteSelection);
    $('#fit').addEventListener('click', fit);
    $('#zin').addEventListener('click', function () { zoomBy(1.12); });
    $('#zout').addEventListener('click', function () { zoomBy(1 / 1.12); });
    $('#zoom').addEventListener('click', function () { zoomAround(1); });
    if ($('#preview')) $('#preview').addEventListener('click', openPreview);
    if ($('#imp')) $('#imp').addEventListener('click', openImport);
    $('#sheetClose').addEventListener('click', closeSheet);
    $('#modal').addEventListener('pointerdown', function (e) { if (e.target === $('#modal')) closeSheet(); });
    $('#sheetMod').addEventListener('change', function () { drawPreview($('#sheetMod').value); });
    $('#importGo').addEventListener('click', function () {
      var ta = $('#importText');
      if (!ta) return;
      if (typeof CircuiTikZ !== 'undefined' && CircuiTikZ.looksLikeTex(ta.value)) {
        if (importTex(ta.value)) {
          closeSheet();
          toast('Imported CircuiTikZ');
        }
        return;
      }
      if (importVerilog(ta.value)) {
        closeSheet();
        toast('Imported Verilog');
      }
    });
    if ($('#tex')) $('#tex').addEventListener('click', openTex);
    if ($('#texRegen')) $('#texRegen').addEventListener('click', function () { fillTex(false); });
    if ($('#texCopy')) $('#texCopy').addEventListener('click', function () {
      var text = currentTex();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied CircuiTikZ'); }, function () { toast('Select the text and copy it'); });
      } else toast('Select the text and copy it');
    });
    if ($('#texSave')) $('#texSave').addEventListener('click', function () {
      download((active().name || 'schematic') + '.tex', currentTex(), 'text/plain');
    });
    if ($('#texPdf')) $('#texPdf').addEventListener('click', downloadPdf);
    if ($('#texOnline')) $('#texOnline').addEventListener('click', openTexLive);
    if ($('#texToSch')) $('#texToSch').addEventListener('click', function () {
      if (importTex(currentTex())) {
        closeSheet();
        toast('Converted CircuiTikZ');
      }
    });
    function applyTexOpt(kind) {
      var sel = kind === 'style' ? $('#texStyle') : $('#texScope');
      var prev = state.tex[kind];
      if (state.tex.dirty && !window.confirm('Replace the edited CircuiTikZ with the drawing?')) {
        sel.value = prev;
        return;
      }
      state.tex[kind] = sel.value;
      if (kind === 'style') rememberTexStyle();
      fillTex(true);
    }
    if ($('#texStyle')) $('#texStyle').addEventListener('change', function () { applyTexOpt('style'); });
    if ($('#texScope')) $('#texScope').addEventListener('change', function () { applyTexOpt('scope'); });
    if ($('#copy') && $('#verilog')) $('#copy').addEventListener('click', function () {
      copyText($('#verilog').value);
    });
    if ($('#exp')) $('#exp').addEventListener('click', function () {
      var name = (active().name || 'schematic') + '.v';
      download(name, state.report ? state.report.verilog : '', 'text/plain');
    });
    if ($('#save')) $('#save').addEventListener('click', function () {
      saveNow();
      toast('Saved in the project');
    });
    if ($('#openSim')) $('#openSim').addEventListener('click', function () { openSimulator('vcd'); });
    if ($('#exCollapse')) $('#exCollapse').addEventListener('click', function () {
      document.body.classList.toggle('explorer-collapsed');
      $('#exCollapse').textContent = document.body.classList.contains('explorer-collapsed') ? '\u203a' : '\u2039';
      try {
        localStorage.setItem('vsch-explorer-collapsed', document.body.classList.contains('explorer-collapsed') ? '1' : '0');
      } catch (err) { /* ignore */ }
      if (state.aspect === 'schematic') requestAnimationFrame(function () { renderCanvas(); });
    });
    $('#file').addEventListener('change', function () {
      var file = $('#file').files && $('#file').files[0];
      $('#file').value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { openFileText(String(reader.result || ''), file.name); };
      reader.readAsText(file);
    });
    if ($('#examples')) $('#examples').addEventListener('change', function () {
      var name = $('#examples').value;
      $('#examples').value = '';
      if (!name) return;
      pushUndo();
      state.doc = Design.example(name);
      state.sel = null;
      state.tool = '';
      state.wiring = null;
      state.notes = [];
      syncPalette();
      onDocChange();
      requestAnimationFrame(fit);
    });
    var modname = $('#modname');
    var nameBefore = null;
    modname.addEventListener('focus', function () { nameBefore = Design.clone(state.doc); });
    modname.addEventListener('input', function () {
      active().name = modname.value;
      state.report = Design.report(state.doc);
      state.viewer = viewerOf(state.report.verilog);
      renderCode();
      renderIssues();
      renderStatus();
      renderTabs();
      if (state.aspect === 'icon') renderAspectPane();
      saveSoon();
    });
    modname.addEventListener('blur', function () {
      commitIfChanged(nameBefore);
      nameBefore = null;
      disable('undo', !state.past.length);
      onDocChange();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#modal').hidden) { closeSheet(); return; }
        if (state.marquee) {
          state.marquee = null;
          renderCanvas();
          renderStatus();
          return;
        }
        state.tool = '';
        state.wiring = null;
        state.gesture = null;
        syncPalette();
        renderCanvas();
        renderStatus();
        return;
      }
      if (e.code === 'Space' && !typing(e)) {
        state.space = true;
        canvas.classList.add('pan');
        e.preventDefault();
      }
      if (typing(e)) return;
      var key = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && key === 'd') {
        e.preventDefault();
        duplicate();
      } else if ((e.ctrlKey || e.metaKey) && key === 'a') {
        if (state.aspect !== 'schematic' || !$('#modal').hidden) return;
        e.preventDefault();
        setSelection((active().parts || []).map(function (p) { return { kind: 'part', id: p.id }; }));
        onDocChange();
      } else if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        saveNow();
        toast('Saved in the project');
      } else if (key === 'f') fit();
      else if (key === '=' || key === '+') zoomBy(1.12);
      else if (key === '-' || key === '_') zoomBy(1 / 1.12);
      else if (key === 'v') {
        state.tool = '';
        syncPalette();
        renderStatus();
        renderCanvas();
      }
    });
    document.addEventListener('keyup', function (e) {
      if (e.code === 'Space') {
        state.space = false;
        if (!state.pan) canvas.classList.remove('pan');
      }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text || '').then(function () { toast('Copied'); }, function () { toast('Select the text and copy it'); });
    } else toast('Select the text and copy it');
  }

  function moduleFileName() {
    var mod = active();
    var lab = state.report && state.report.labels && mod && state.report.labels[mod.id];
    return (lab && lab.vname) || (mod && mod.name) || 'module';
  }

  function closedFolders() {
    try {
      var raw = localStorage.getItem('vsch-explorer-folders');
      if (raw) return JSON.parse(raw) || {};
    } catch (err) { /* ignore */ }
    return {};
  }

  function renderProjectModules() {
    var host = $('#modpal');
    var label = $('#modpalLabel');
    if (!host || !state.doc) return;
    clearNode(host);
    var mods = state.doc.modules.filter(function (m) { return m.id !== state.doc.active; });
    if (label) label.hidden = !mods.length;
    host.hidden = !mods.length;
    mods.forEach(function (m) {
      var b = el('button', { type: 'button', class: 'pi', 'data-type': 'block', 'data-ref': m.id }, host);
      b.innerHTML = icon('block');
      b.appendChild(document.createTextNode(m.name || 'module'));
    });
    syncPalette();
  }

  function renderExplorer() {
    if (!window.Explorer || !state.doc) return;
    var project = state.projectId && window.Workspace ? Workspace.project(state.projectId) : null;
    var link = $('#exProject');
    if (link) link.textContent = project ? project.name : 'Project';
    document.title = (project ? project.name + ' — ' : '') + moduleFileName();
    Explorer.render($('#exbody'), {
      moduleName: moduleFileName(),
      active: state.aspect,
      closed: closedFolders(),
      onToggle: function (folder, shut) {
        var map = closedFolders();
        map[folder] = !!shut;
        try { localStorage.setItem('vsch-explorer-folders', JSON.stringify(map)); } catch (err) { /* ignore */ }
      },
      onOpen: showAspect
    });
    Explorer.hierarchy($('#exHier'), {
      deps: window.Workspace ? Workspace.moduleDeps(state.doc) : {},
      usedBy: window.Workspace ? Workspace.usedBy(state.doc) : {},
      names: window.Workspace ? Workspace.names(state.doc) : {},
      active: state.doc.active,
      onOpen: activateModule
    });
  }

  function setAspectChrome(title, stat) {
    $('#aspectTitle').textContent = title || '';
    $('#aspectStat').textContent = stat || '';
    var extra = $('#aspectExtra');
    clearNode(extra);
    return extra;
  }

  function drawIcon(mod) {
    var ports = (mod.parts || []).filter(function (p) { return p.type === 'in' || p.type === 'out'; })
      .slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var ins = [];
    var outs = [];
    ports.forEach(function (p) { (p.type === 'in' ? ins : outs).push(p); });
    var n = Math.max(ins.length, outs.length, 1);
    var w = 240;
    var h = Math.max(88, 40 + n * 28);
    var svg = svgEl('svg', { width: String(w + 80), height: String(h + 48), viewBox: '0 0 ' + (w + 80) + ' ' + (h + 48) });
    var g = svgEl('g', { transform: 'translate(40 24)' }, svg);
    svgEl('rect', { x: 0, y: 0, width: w, height: h, rx: 8, fill: '#fff', stroke: '#243044', 'stroke-width': 1.6 }, g);
    svgText({ x: w / 2, y: 22, 'text-anchor': 'middle', 'font-size': 14, 'font-family': 'Consolas, monospace', fill: '#152033' }, mod.name || 'module', g);
    function sidePins(list, side) {
      list.forEach(function (p, i) {
        var y = (i + 1) * h / (list.length + 1);
        var x = side === 'l' ? 0 : w;
        svgEl('line', {
          x1: x + (side === 'l' ? -18 : 0), y1: y, x2: x + (side === 'l' ? 0 : 18), y2: y,
          stroke: '#243044', 'stroke-width': 1.4
        }, g);
        svgEl('circle', { cx: x, cy: y, r: 3.2, fill: '#243044' }, g);
        svgText({
          x: side === 'l' ? 12 : w - 12,
          y: y + 4,
          'text-anchor': side === 'l' ? 'start' : 'end',
          'font-size': 12,
          'font-family': 'Consolas, monospace',
          fill: side === 'l' ? '#1d6fe0' : '#0f7a45'
        }, p.name || '', g);
      });
    }
    sidePins(ins, 'l');
    sidePins(outs, 'r');
    return svg;
  }

  function generatedVerilog() {
    if (state.report && state.report.verilog != null) return state.report.verilog;
    try { return Design.toVerilog(state.doc); } catch (err) { return ''; }
  }

  function loadVerilogBuffer() {
    var generated = generatedVerilog();
    var project = state.projectId && window.Workspace ? Workspace.project(state.projectId) : null;
    if (project && (project.verilogPinned || (project.simVerilog && String(project.simVerilog).length))) {
      state.verilogText = project.simVerilog || '';
      if (!project.verilogPinned) Workspace.setSimVerilog(project.id, state.verilogText);
    } else {
      state.verilogText = generated;
      if (project) Workspace.setSimVerilog(project.id, state.verilogText);
    }
  }

  function bareGenerated(tb) {
    var text = String(tb || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    return /initial begin\n    \$dumpfile\("dump\.vcd"\);\n    \$dumpvars\(0, tb\);\n    #10 \$finish;\n  end\nendmodule$/.test(text);
  }

  function seedTestbenches() {
    if (!state.doc) return;
    state.doc.modules.forEach(function (m) {
      if (m.tb != null && !bareGenerated(m.tb)) return;
      var next = Design.tbTemplate(state.doc, m.id);
      if (next) m.tb = next;
    });
  }

  function verilogTextNow() {
    var box = $('#aspectVerilog');
    if (box) state.verilogText = box.value;
    return state.verilogText || '';
  }

  function setVerilogBuffer(text) {
    state.verilogText = text == null ? '' : String(text);
    if (state.projectId && window.Workspace) Workspace.setSimVerilog(state.projectId, state.verilogText);
    var box = $('#aspectVerilog');
    if (box && box.value !== state.verilogText) box.value = state.verilogText;
    refreshVerilogStat();
  }

  function refreshVerilogStat() {
    var stat = $('#aspectStat');
    if (!stat || state.aspect !== 'verilog') return;
    var text = state.verilogText || '';
    var lines = text ? text.replace(/\n$/, '').split('\n').length : 0;
    stat.textContent = lines ? (lines + (lines === 1 ? ' line' : ' lines') + ' · every module') : 'every module';
  }

  function sameText(a, b) {
    return String(a || '').replace(/\s+$/, '') === String(b || '').replace(/\s+$/, '');
  }

  function updateVerilogFromSchematic() {
    var next = generatedVerilog();
    var cur = verilogTextNow();
    if (sameText(cur, next)) { toast('Verilog already matches the schematic'); return; }
    if (cur.trim() && !window.confirm('Replace the Verilog editor with the schematic?')) return;
    setVerilogBuffer(next);
    toast('Verilog updated from the schematic');
  }

  function updateTbFromSchematic() {
    var mod = active();
    if (!mod) return;
    var next = Design.tbTemplate(state.doc, mod.id);
    var cur = mod.tb || '';
    if (sameText(cur, next)) { toast('Testbench already matches the schematic'); return; }
    if (cur.trim() && !window.confirm('Replace the testbench with one generated from the schematic?')) return;
    mod.tb = next;
    var box = $('#aspectTb');
    if (box) box.value = next;
    saveSoon();
    toast('Testbench updated from the schematic');
  }

  function applyVerilogToSchematic() {
    var text = verilogTextNow();
    if (!String(text).trim()) { toast('The Verilog editor is empty'); return; }
    var current = generatedVerilog();
    if (sameText(text, current)) { toast('Schematic already matches the Verilog'); return; }
    var hasParts = state.doc.modules.some(function (m) { return (m.parts || []).length; });
    if (hasParts && !window.confirm('Replace the schematic with the Verilog editor?')) return;
    if (!importVerilog(text)) return;
    toast('Schematic updated from Verilog');
  }

  function syncButton(host, label, title, primary, fn) {
    var b = el('button', { type: 'button', class: primary ? 'primary' : 'ghost', title: title, text: label }, host);
    b.addEventListener('click', fn);
    return b;
  }

  function renderSync() {
    var host = $('#syncActions');
    if (!host) return;
    clearNode(host);
    if (state.aspect === 'schematic') {
      syncButton(host, 'Download .tex', 'Download this schematic as CircuiTikZ', false, downloadDrawingTex);
      var pdf = syncButton(host, 'Download PDF', 'Compile with pdflatex on latex.ytotech.com and download the PDF. Sends this TeX to a third-party server.', false, downloadDrawingPdf);
      pdf.id = 'schPdf';
      if (state.tex.busy) pdf.disabled = true;
      syncButton(host, 'Apply from Verilog', 'Replace the schematic with the Verilog editor', false, applyVerilogToSchematic);
      syncButton(host, 'Update Verilog', 'Copy this schematic into the Verilog editor', true, updateVerilogFromSchematic);
    } else if (state.aspect === 'verilog') {
      syncButton(host, 'Update from schematic', 'Replace this Verilog with the schematic', false, updateVerilogFromSchematic);
      syncButton(host, 'Apply to schematic', 'Replace the schematic with this Verilog', true, applyVerilogToSchematic);
    } else if (state.aspect === 'testbench') {
      syncButton(host, 'Update from schematic', 'Replace this testbench with stimulus for every input combination', false, updateTbFromSchematic);
      syncButton(host, 'Apply Verilog to schematic', 'Replace the schematic with the Verilog editor', true, applyVerilogToSchematic);
    } else if (state.aspect === 'icon') {
      el('span', { class: 'syncnote', text: 'Updates when the schematic changes' }, host);
    }
  }

  function downloadTextFile(name, text, type) {
    download(name, text || '', type || 'text/plain');
  }

  function refreshVcd(part) {
    var textBtn = $('#vcdModeText');
    var waveBtn = $('#vcdModeWave');
    var textPane = $('#vcdText');
    var logPane = $('#vcdLog');
    var wavePane = $('#vcdWave');
    var dlText = $('#vcdDlText');
    var dlWave = $('#vcdDlWave');
    var meta = $('#vcdMeta');
    var gen = $('#vcdGen');
    if (textBtn) textBtn.classList.toggle('on', state.vcd.mode !== 'wave');
    if (waveBtn) waveBtn.classList.toggle('on', state.vcd.mode === 'wave');
    if (textPane) {
      textPane.hidden = state.vcd.mode === 'wave';
      textPane.textContent = state.vcd.text || state.vcd.log || 'Generate a VCD from the Verilog and this module\u2019s testbench.';
    }
    if (logPane) {
      var showLog = state.vcd.mode !== 'wave' && !!state.vcd.text && !!state.vcd.log;
      logPane.hidden = !showLog;
      logPane.textContent = state.vcd.log || '';
    }
    if (wavePane) wavePane.hidden = state.vcd.mode !== 'wave';
    if (dlText) dlText.disabled = !state.vcd.text;
    if (dlWave) dlWave.disabled = !state.vcd.model;
    if (gen) gen.disabled = !!state.vcd.running;
    if (state.aspect === 'vcd') {
      var stat = state.vcd.running ? 'Generating\u2026' : (state.vcd.model ? 'VCD ready' : '');
      setAspectChrome(moduleFileName() + '.vcd', stat);
    }
    if (state.vcd.mode === 'wave' && window.Sim && $('#vcdPlot')) {
      if (part !== 'wave') Sim.renderSigs($('#vcdSigs'), state.vcd, function (kind) {
        refreshVcd(kind === 'check' ? 'wave' : '');
      });
      Sim.renderWave($('#vcdPlot'), state.vcd);
      if (meta) meta.textContent = [Sim.markerLabel(state.vcd), Sim.rangeLabel(state.vcd)].filter(Boolean).join(' \u00b7 ');
    } else if (meta) meta.textContent = '';
  }

  async function generateVcd() {
    if (!window.Sim) { toast('Simulator did not load'); return; }
    var mod = active();
    state.vcd.running = true;
    state.vcd.log = 'Generating\u2026';
    refreshVcd();
    try {
      var design = verilogTextNow();
      var tb = mod && mod.tb != null ? mod.tb : Design.tbTemplate(state.doc, mod.id);
      var genSel = $('#vcdGenSel');
      var generation = genSel ? genSel.value : '2005';
      try { localStorage.setItem('vsch-gen', generation); } catch (err) { /* ignore */ }
      var result = await Sim.run(design, tb, generation);
      state.vcd.log = result.log || '';
      state.vcd.text = result.vcd || '';
      state.vcd.model = result.vcd ? Sim.parseVCD(result.vcd) : null;
      state.vcd.selOrder = state.vcd.model ? state.vcd.model.order.slice() : [];
      state.vcd.view0 = 0;
      state.vcd.viewSpan = null;
      state.vcd.curT = null;
      state.vcd.mode = result.vcd ? 'wave' : 'text';
      if (!result.ok) toast(result.vcd ? 'VCD ready' : 'No VCD was generated');
    } catch (err) {
      state.vcd.log = (err && err.message) ? err.message : String(err);
      state.vcd.text = '';
      state.vcd.model = null;
      state.vcd.mode = 'text';
      toast('Simulation failed');
    } finally {
      state.vcd.running = false;
      refreshVcd();
    }
  }

  function renderVcdPane() {
    var host = $('#aspectHost');
    host.style.overflow = 'hidden';
    if (state.aspectBuilt !== 'vcd') {
      clearNode(host);
      var tools = el('div', { class: 'vcd-tools' }, host);
      var gen = el('button', { type: 'button', class: 'primary', id: 'vcdGen', text: 'Generate' }, tools);
      var genSel = el('select', { id: 'vcdGenSel', class: 'ex', title: 'Language generation' }, tools);
      [['2005', 'Verilog-2005'], ['2009', 'Verilog-2009'], ['2012', 'SystemVerilog-2012']].forEach(function (pair) {
        el('option', { value: pair[0], text: pair[1] }, genSel);
      });
      try {
        var savedGen = localStorage.getItem('vsch-gen');
        if (savedGen) genSel.value = savedGen;
      } catch (err) { /* keep 2005 */ }
      var textBtn = el('button', { type: 'button', class: 'mode', id: 'vcdModeText', text: 'Text' }, tools);
      var waveBtn = el('button', { type: 'button', class: 'mode', id: 'vcdModeWave', text: 'Waveform' }, tools);
      var dlText = el('button', { type: 'button', id: 'vcdDlText', text: 'Download .vcd' }, tools);
      var dlWave = el('button', { type: 'button', id: 'vcdDlWave', text: 'Download waveform.svg' }, tools);
      el('span', { id: 'vcdMeta', class: 'vcd-meta' }, tools);
      var logPane = el('pre', { id: 'vcdLog', class: 'vcd-log' }, host);
      logPane.hidden = true;
      el('pre', { id: 'vcdText', class: 'vcd-text' }, host);
      var wave = el('div', { id: 'vcdWave', class: 'vcd-wave' }, host);
      el('aside', { id: 'vcdSigs', class: 'vcd-sigs' }, wave);
      var plot = el('div', { id: 'vcdPlot', class: 'vcd-plot' }, wave);
      gen.addEventListener('click', function () { generateVcd(); });
      textBtn.addEventListener('click', function () { state.vcd.mode = 'text'; refreshVcd(); });
      waveBtn.addEventListener('click', function () { state.vcd.mode = 'wave'; refreshVcd(); });
      dlText.addEventListener('click', function () {
        if (!state.vcd.text) { toast('Generate a VCD first'); return; }
        downloadTextFile('dump.vcd', state.vcd.text, 'text/plain');
      });
      dlWave.addEventListener('click', function () {
        if (!state.vcd.model || !window.Sim) { toast('Generate a waveform first'); return; }
        var prevSpan = state.vcd.viewSpan;
        var prev0 = state.vcd.view0;
        var svg = Sim.waveformSvg(state.vcd, 960);
        state.vcd.viewSpan = prevSpan;
        state.vcd.view0 = prev0;
        if (state.vcd.mode === 'wave') refreshVcd('wave');
        if (!svg) { toast('Tick at least one signal, then download again'); return; }
        downloadTextFile('waveform.svg', svg, 'image/svg+xml');
      });
      if (window.Sim) Sim.bindWave(plot, state.vcd, function () { refreshVcd('wave'); });
      state.aspectBuilt = 'vcd';
    }
    refreshVcd();
  }

  function renderAspectPane() {
    var host = $('#aspectHost');
    if (!host) return;
    if (state.aspect === 'schematic') {
      state.aspectBuilt = '';
      host.style.overflow = '';
      return;
    }
    var mod = active();
    if (!mod) return;
    if (state.aspect !== 'vcd') host.style.overflow = 'auto';
    if (state.aspect === 'verilog') {
      var text = state.verilogText || '';
      var lines = text ? text.replace(/\n$/, '').split('\n').length : 0;
      setAspectChrome(moduleFileName() + '.v', (lines ? lines + (lines === 1 ? ' line' : ' lines') + ' · ' : '') + 'every module in this project');
      if (state.aspectBuilt !== 'verilog') {
        clearNode(host);
        var ta = el('textarea', { id: 'aspectVerilog', class: 'editor-full', spellcheck: 'false' }, host);
        ta.addEventListener('input', function () {
          state.verilogText = ta.value;
          if (state.projectId && window.Workspace) Workspace.setSimVerilog(state.projectId, ta.value);
          refreshVerilogStat();
        });
        ta.addEventListener('keydown', function (e) {
          if (e.key !== 'Tab') return;
          e.preventDefault();
          var s = ta.selectionStart;
          var n = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(n);
          ta.selectionStart = ta.selectionEnd = s + 2;
          state.verilogText = ta.value;
          if (state.projectId && window.Workspace) Workspace.setSimVerilog(state.projectId, ta.value);
        });
        ta.value = text;
        state.aspectBuilt = 'verilog';
      }
      return;
    }
    if (state.aspect === 'testbench') {
      var key = 'testbench:' + mod.id;
      var shown = mod.tb != null ? mod.tb : Design.tbTemplate(state.doc, mod.id);
      setAspectChrome(moduleFileName() + '_tb.v', 'Testbench for this module');
      if (state.aspectBuilt !== key) {
        clearNode(host);
        var box = el('textarea', { id: 'aspectTb', class: 'editor-full', spellcheck: 'false' }, host);
        box.addEventListener('input', function () {
          active().tb = box.value;
          saveSoon();
        });
        box.addEventListener('keydown', function (e) {
          if (e.key !== 'Tab') return;
          e.preventDefault();
          var s = box.selectionStart;
          var n = box.selectionEnd;
          box.value = box.value.slice(0, s) + '  ' + box.value.slice(n);
          box.selectionStart = box.selectionEnd = s + 2;
          active().tb = box.value;
          saveSoon();
        });
        box.value = shown;
        state.aspectBuilt = key;
      } else if (document.activeElement !== $('#aspectTb') && $('#aspectTb')) {
        $('#aspectTb').value = shown;
      }
      return;
    }
    if (state.aspect === 'icon') {
      setAspectChrome(moduleFileName() + '.ico', 'Updates when the schematic changes');
      clearNode(host);
      var stage = el('div', { class: 'icon-stage' }, host);
      stage.appendChild(drawIcon(mod));
      state.aspectBuilt = 'icon:' + mod.id;
      return;
    }
    if (state.aspect === 'vcd') renderVcdPane();
  }

  function showAspect(id) {
    if (id === 'console' || id === 'viewer') id = 'schematic';
    if (id === 'waveform') id = 'vcd';
    state.aspect = id || 'schematic';
    var drawing = state.aspect === 'schematic';
    var row = $('#aspectSchematic');
    var other = $('#aspectOther');
    if (row) row.hidden = !drawing;
    if (other) other.hidden = drawing;
    renderExplorer();
    renderSync();
    renderAspectPane();
    if (drawing) requestAnimationFrame(function () { renderCanvas(); });
  }

  function activateModule(id) {
    if (!state.doc || !Design.moduleById(state.doc, id)) return;
    if (state.doc.active !== id) {
      state.doc.active = id;
      state.sel = null;
      state.wiring = null;
      state.tool = '';
      state.toolRef = '';
      syncPalette();
      onDocChange();
      if (state.aspect === 'schematic') requestAnimationFrame(fit);
      return;
    }
    if (state.aspect !== 'schematic') showAspect('schematic');
  }

  function openSimulator() {
    showAspect('vcd');
  }

  function boot() {
    buildPalette();
    fillExamples();
    bind();
    var params = new URLSearchParams(window.location.search);
    var loadedView = false;
    if (window.Workspace) {
      var data = Workspace.ensure(Design);
      var picked = Workspace.project(params.get('project')) || Workspace.project(data.activeProject) || Workspace.current();
      if (picked) {
        state.projectId = picked.id;
        Workspace.setActive(picked.id);
        state.doc = picked.doc;
        Design.prune(state.doc);
        if (picked.view && typeof picked.view.z === 'number') {
          state.view = picked.view;
          loadedView = true;
        }
        var mid = params.get('module');
        if (mid && Design.moduleById(state.doc, mid)) state.doc.active = mid;
      }
    }
    if (!state.doc) {
      var saved = null;
      try {
        var raw = localStorage.getItem(STORE);
        if (raw) saved = JSON.parse(raw);
      } catch (err) { saved = null; }
      if (saved && saved.doc && saved.doc.modules) {
        state.doc = saved.doc;
        Design.prune(state.doc);
        if (saved.view && typeof saved.view.z === 'number') {
          state.view = saved.view;
          loadedView = true;
        }
      } else if (saved && saved.modules) {
        state.doc = saved;
        Design.prune(state.doc);
      } else state.doc = Design.example('half');
    }
    var wanted = params.get('aspect') || 'schematic';
    if (wanted === 'waveform' || wanted === 'console') wanted = 'vcd';
    if (wanted === 'viewer') wanted = 'schematic';
    var localAspect = { schematic: 1, icon: 1, verilog: 1, testbench: 1, vcd: 1 };
    state.aspect = localAspect[wanted] ? wanted : 'schematic';
    try {
      if (localStorage.getItem('vsch-explorer-collapsed') === '1') {
        document.body.classList.add('explorer-collapsed');
        if ($('#exCollapse')) $('#exCollapse').textContent = '\u203a';
      }
    } catch (err2) { /* ignore */ }
    try {
      var texStyle = localStorage.getItem('verilog-schematic-designer-tex');
      if (texStyle === 'european' || texStyle === 'ieeestd' || texStyle === 'american') state.tex.style = texStyle;
    } catch (err3) { /* keep american */ }
    syncPalette();
    onDocChange();
    showAspect(state.aspect);
    requestAnimationFrame(function () {
      if (state.aspect === 'schematic' && !loadedView) fit();
    });
  }

  boot();
})();
