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
    wiring: null,
    drag: null,
    pan: null,
    gesture: null,
    cursor: null,
    hover: null,
    report: null,
    viewer: null,
    notes: [],
    space: false
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

  function toast(msg) {
    var node = $('#toast');
    node.textContent = msg;
    node.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('on'); }, 1700);
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE, JSON.stringify({ doc: state.doc, view: state.view }));
      } catch (err) { /* private mode */ }
    }, 180);
  }

  function pushUndo() {
    state.notes = [];
    state.past.push(Design.clone(state.doc));
    if (state.past.length > 80) state.past.shift();
    state.future = [];
  }

  function rememberSelection() {
    if (!state.sel) return;
    if (state.sel.kind === 'part' && !partById(state.sel.id)) state.sel = null;
    if (state.sel.kind === 'net' && !netById(state.sel.id)) state.sel = null;
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
    state.viewer = viewerOf(state.report.verilog);
    renderCanvas();
    renderCode();
    renderIssues();
    renderStatus();
    renderTabs();
    if (opts.inspector !== false) renderInspector();
    if (document.activeElement !== $('#modname')) $('#modname').value = active().name || '';
    $('#undo').disabled = !state.past.length;
    $('#redo').disabled = !state.future.length;
    $('#del').disabled = !state.sel;
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
    var help = el('div', { class: 'help' }, host);
    el('p', { text: 'Click a tool, then the sheet. Drag a tool on to place it once. Shift keeps the tool armed.' }, help);
    el('p', { text: 'Click a pin, then another pin, to wire them. Alt-click a pin to disconnect it.' }, help);
    var keys = el('p', {}, help);
    el('kbd', { text: 'Del' }, keys);
    keys.appendChild(document.createTextNode(' remove · '));
    el('kbd', { text: 'F' }, keys);
    keys.appendChild(document.createTextNode(' fit · '));
    el('kbd', { text: 'V' }, keys);
    keys.appendChild(document.createTextNode(' select · '));
    el('kbd', { text: 'Space' }, keys);
    keys.appendChild(document.createTextNode(' pan'));
  }

  function syncPalette() {
    var nodes = document.querySelectorAll('#pal button');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i].hasAttribute('data-type')) continue;
      nodes[i].classList.toggle('on', nodes[i].getAttribute('data-type') === state.tool);
    }
    $('#canvas').classList.toggle('place', !!state.tool);
  }

  function fillExamples() {
    var sel = $('#examples');
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

  function route(points) {
    if (!points || points.length < 2) return { segs: [], dots: [] };
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
    var segs = [[src.x, src.y, s0.x, s0.y]];
    var forward = [];
    var back = [];
    for (i = 0; i < points.length; i++) {
      if (points[i] === src) continue;
      var t = tip(points[i]);
      if (points[i].dir !== 'out' && points[i].dir !== 'inout' && t.x < s0.x - 8) back.push({ p: points[i], t: t });
      else forward.push({ p: points[i], t: t });
    }
    var trunkX = s0.x;
    if (forward.length) {
      var minF = forward[0].t.x;
      forward.forEach(function (f) { if (f.t.x < minF) minF = f.t.x; });
      if (minF > s0.x + 12) trunkX = (s0.x + minF) / 2;
    }
    segs.push([s0.x, s0.y, trunkX, s0.y]);
    var ys = [s0.y];
    forward.forEach(function (f) {
      ys.push(f.t.y);
      segs.push([trunkX, f.t.y, f.t.x, f.t.y]);
      segs.push([f.t.x, f.t.y, f.p.x, f.p.y]);
    });
    if (ys.length >= 2) {
      var lo = ys[0], hi = ys[0];
      ys.forEach(function (y) { if (y < lo) lo = y; if (y > hi) hi = y; });
      segs.push([trunkX, lo, trunkX, hi]);
    }
    var bottom = src.y;
    points.forEach(function (p) { if (p.y > bottom) bottom = p.y; });
    back.forEach(function (b, idx) {
      var yf = bottom + 28 + idx * 14;
      var topY = ys[0];
      ys.forEach(function (y) { if (y < topY) topY = y; });
      segs.push([b.p.x, b.p.y, b.t.x, b.t.y]);
      segs.push([b.t.x, b.t.y, b.t.x, yf]);
      segs.push([b.t.x, yf, trunkX, yf]);
      segs.push([trunkX, yf, trunkX, topY]);
    });
    var dots = [];
    if (points.length >= 3) ys.forEach(function (y) { dots.push([trunkX, y]); });
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
    mod.nets.forEach(function (net) {
      var pts = [];
      net.pins.forEach(function (ref) {
        var part = partById(ref.part);
        if (!part) return;
        var pin = pinWorld(part, ref.pin);
        if (pin) pts.push(pin);
      });
      var routed = route(pts);
      if (!routed.segs.length) return;
      var d = '';
      routed.segs.forEach(function (s) {
        if (Math.abs(s[0] - s[2]) < 0.4 && Math.abs(s[1] - s[3]) < 0.4) return;
        d += 'M ' + s[0].toFixed(1) + ' ' + s[1].toFixed(1) + ' L ' + s[2].toFixed(1) + ' ' + s[3].toFixed(1) + ' ';
      });
      if (!d) return;
      var on = state.sel && state.sel.kind === 'net' && state.sel.id === net.id;
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
      var selected = state.sel && state.sel.kind === 'part' && state.sel.id === part.id;
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
          (state.sel && state.sel.kind === 'net' && net && state.sel.id === net.id);
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
          ref: '', ext: 'block', ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }]
        };
        var gm = Design.metrics(ghost, state.doc);
        var gx = snap(state.cursor.x - gm.w / 2);
        var gy = snap(state.cursor.y - gm.h / 2);
        var gg = svgEl('g', { transform: 'translate(' + gx + ' ' + gy + ')', opacity: 0.45, 'pointer-events': 'none' }, world);
        drawSymbol(gg, ghost, gm);
      }
    }
  }

  function renderCode() {
    var text = (state.report && state.report.verilog) || '';
    $('#verilog').value = text;
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
    var hint = $('#hint');
    if (state.wiring) {
      hint.hidden = false;
      hint.textContent = 'Click a pin to connect. Esc cancels.';
    } else if (state.tool) {
      hint.hidden = false;
      hint.textContent = 'Click to place ' + toolLabel(state.tool) + '. Shift keeps the tool.';
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
    $('#canvas').classList.toggle('wire', !!state.wiring);
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
      if (document.activeElement !== $('#modname')) $('#modname').value = active().name || '';
      saveSoon();
    });
    input.addEventListener('blur', function (e) {
      commitIfChanged(before);
      before = null;
      $('#undo').disabled = !state.past.length;
      var next = e.relatedTarget;
      if (next && $('#inspector').contains(next)) return;
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
        text: 'The drawing exports structural Verilog as you edit it. Preview checks that the schematic viewer can read it back.'
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
      type: state.tool, name: 'uu', inputs: 2, hasRst: false, ref: '', ext: 'block',
      ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }]
    };
    var m = Design.metrics(probe, state.doc);
    pushUndo();
    var part = Design.freshPart(state.doc, mod.id, state.tool, snap(w.x - m.w / 2), snap(w.y - m.h / 2));
    mod.parts.push(part);
    state.sel = { kind: 'part', id: part.id };
    if (!keep) state.tool = '';
    state.wiring = null;
    syncPalette();
    onDocChange();
  }

  function deleteSelection() {
    if (!state.sel) return;
    var mod = active();
    pushUndo();
    if (state.sel.kind === 'part') mod.parts = mod.parts.filter(function (p) { return p.id !== state.sel.id; });
    else mod.nets = mod.nets.filter(function (n) { return n.id !== state.sel.id; });
    state.sel = null;
    Design.prune(state.doc);
    onDocChange();
  }

  function duplicate() {
    if (!state.sel || state.sel.kind !== 'part') return;
    var part = partById(state.sel.id);
    if (!part) return;
    var mod = active();
    var copy = Design.clone(part);
    pushUndo();
    copy.id = Design.uid(state.doc, 'p');
    copy.x = snap(part.x + 24);
    copy.y = snap(part.y + 24);
    copy.name = Design.autoName(mod, part.type);
    mod.parts.push(copy);
    state.sel = { kind: 'part', id: copy.id };
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
      state.sel = { kind: 'part', id: id };
      state.wiring = null;
      if (state.tool) { state.tool = ''; syncPalette(); }
      var part = partById(id);
      state.drag = { id: id, ox: part.x, oy: part.y, wx: w.x, wy: w.y, changed: false, undo: false };
      try { $('#canvas').setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      return;
    }
    if (netEl && !state.tool) {
      state.sel = { kind: 'net', id: netEl.getAttribute('data-net') };
      state.wiring = null;
      onDocChange();
      return;
    }
    startPan(e, true);
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
      var part = partById(state.drag.id);
      if (!part) return;
      var nx = snap(state.drag.ox + w.x - state.drag.wx);
      var ny = snap(state.drag.oy + w.y - state.drag.wy);
      if (nx !== part.x || ny !== part.y) {
        if (!state.drag.undo) {
          pushUndo();
          state.drag.undo = true;
        }
        part.x = nx;
        part.y = ny;
        state.drag.changed = true;
        onDocChange({ live: true });
      }
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

  function onCanvasUp(e) {
    if (state.drag) {
      var moved = state.drag.undo;
      state.drag = null;
      onDocChange(moved ? { inspector: false } : undefined);
      $('#undo').disabled = !state.past.length;
    }
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
    if (state.drag || state.pan) onCanvasUp(e);
    if (!state.gesture) return;
    var g = state.gesture;
    state.gesture = null;
    var rect = $('#canvas').getBoundingClientRect();
    var inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (g.moved && inside && g.type) {
      state.tool = g.type;
      state.cursor = worldFromEvent(e);
      placeAt(state.cursor, false);
    } else if (!g.moved) {
      state.tool = state.tool === g.type ? '' : g.type;
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
    $('#sheetTitle').textContent = 'Import Verilog';
    $('#sheetMod').hidden = true;
    var body = $('#sheetBody');
    clearNode(body);
    var ta = el('textarea', { id: 'importText', placeholder: 'Paste Verilog. Gates, mux assigns, and flip-flop always blocks become a drawing.' }, body);
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
    var out = Design.fromCompiled(c);
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

    $('#pal').addEventListener('pointerdown', function (e) {
      var btn = e.target.closest && e.target.closest('button[data-type]');
      if (!btn) return;
      e.preventDefault();
      state.gesture = {
        type: btn.getAttribute('data-type'),
        x: e.clientX,
        y: e.clientY,
        moved: false
      };
    });
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowUp);

    $('#undo').addEventListener('click', undo);
    $('#redo').addEventListener('click', redo);
    $('#del').addEventListener('click', deleteSelection);
    $('#fit').addEventListener('click', fit);
    $('#zin').addEventListener('click', function () { zoomBy(1.12); });
    $('#zout').addEventListener('click', function () { zoomBy(1 / 1.12); });
    $('#zoom').addEventListener('click', function () { zoomAround(1); });
    $('#preview').addEventListener('click', openPreview);
    $('#imp').addEventListener('click', openImport);
    $('#sheetClose').addEventListener('click', closeSheet);
    $('#modal').addEventListener('pointerdown', function (e) { if (e.target === $('#modal')) closeSheet(); });
    $('#sheetMod').addEventListener('change', function () { drawPreview($('#sheetMod').value); });
    $('#importGo').addEventListener('click', function () {
      var ta = $('#importText');
      if (ta && importVerilog(ta.value)) {
        closeSheet();
        toast('Imported Verilog');
      }
    });
    $('#copy').addEventListener('click', function () {
      var box = $('#verilog');
      var text = box ? box.value : '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied Verilog'); }, function () {
          box.focus();
          box.select();
          toast('Select the text and copy it');
        });
      } else {
        box.focus();
        box.select();
        try { document.execCommand('copy'); toast('Copied Verilog'); }
        catch (err) { toast('Select the text and copy it'); }
      }
    });
    $('#exp').addEventListener('click', function () {
      var name = (active().name || 'schematic') + '.v';
      download(name, state.report ? state.report.verilog : '', 'text/plain');
    });
    $('#save').addEventListener('click', function () {
      download((active().name || 'schematic') + '.json', JSON.stringify({ doc: state.doc, view: state.view }, null, 2), 'application/json');
    });
    $('#openSim').addEventListener('click', function () {
      try {
        localStorage.setItem('vsch-from-designer', state.report ? state.report.verilog : '');
        window.open('verilog.html', '_blank');
      } catch (err) { toast('Could not open the simulator'); }
    });
    $('#file').addEventListener('change', function () {
      var file = $('#file').files && $('#file').files[0];
      $('#file').value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { openFileText(String(reader.result || ''), file.name); };
      reader.readAsText(file);
    });
    $('#examples').addEventListener('change', function () {
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
      saveSoon();
    });
    modname.addEventListener('blur', function () {
      commitIfChanged(nameBefore);
      nameBefore = null;
      $('#undo').disabled = !state.past.length;
      onDocChange();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('#modal').hidden) { closeSheet(); return; }
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
      } else if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault();
        download((active().name || 'schematic') + '.json', JSON.stringify({ doc: state.doc, view: state.view }, null, 2), 'application/json');
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

  function boot() {
    buildPalette();
    fillExamples();
    bind();
    var saved = null;
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) saved = JSON.parse(raw);
    } catch (err) { saved = null; }
    if (saved && saved.doc && saved.doc.modules) {
      state.doc = saved.doc;
      Design.prune(state.doc);
      if (saved.view && typeof saved.view.z === 'number') state.view = saved.view;
    } else if (saved && saved.modules) {
      state.doc = saved;
      Design.prune(state.doc);
    } else {
      state.doc = Design.example('half');
    }
    syncPalette();
    onDocChange();
    requestAnimationFrame(function () {
      if (!saved || !saved.view) fit();
    });
  }

  boot();
})();
