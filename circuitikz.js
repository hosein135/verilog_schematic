/* Drawing <-> CircuiTikZ.
   Depends on design.js. Pure functions: no DOM, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CircuiTikZ = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var S = 2.54 / 96;
  var STYLES = [['american', 'American'], ['european', 'European'], ['ieeestd', 'IEEE']];
  var GATE = {
    american: { inX: -1.386, outX: 0.154, h: 0.56, textX: -0.616 },
    european: { inX: -1.764, outX: 0.196, h: 0.455, textX: -0.784 },
    ieeestd: { inX: -1.0812, outX: 1.0812, h: 0.56, textX: 0 }
  };
  var MONO = {
    american: { inX: -0.7, outX: 0.7, y: 0.7 },
    european: { inX: -1.764, outX: 0.196, y: 0.455 },
    ieeestd: { inX: -0.8769, outX: 0.8769, y: 0.56 }
  };
  var IEEE_BIN = { and: -0.6892, nand: -0.6892, or: -0.7227, nor: -0.7227, xor: -0.8302, xnor: -0.8302 };
  var IEEE_BOUT = { and: 0.6892, or: 0.6892, xor: 0.6892, nand: 0.8617, nor: 0.8617, xnor: 0.8617 };
  var FF = {
    'pin 1': { x: -1.12, y: 0.84 }, 'pin 2': { x: -1.12, y: 0 }, 'pin 3': { x: -1.12, y: -0.84 },
    'pin 4': { x: 1.12, y: -0.84 }, 'pin 5': { x: 1.12, y: 0 }, 'pin 6': { x: 1.12, y: 0.84 },
    up: { x: 0, y: 1.54 }, down: { x: 0, y: -1.54 }
  };
  var MULTI = { and: 1, nand: 1, or: 1, nor: 1, xor: 1, xnor: 1 };
  var INNER = { and: 'and', nand: 'and', or: 'or', nor: 'or', xor: 'xor', xnor: 'xor' };
  var INVERTING = { nand: 1, nor: 1, xnor: 1 };
  var POLE = { ocirc: 1, circ: 1, diamondpole: 1, odiamondpole: 1, squarepole: 1, osquarepole: 1 };
  var SUPPLY = {
    vcc: 'c1', vee: 'c0', ground: 'c0', tlground: 'c0', rground: 'c0', sground: 'c0',
    tground: 'c0', nground: 'c0', pground: 'c0', cground: 'c0', eground: 'c0', eground2: 'c0'
  };
  var OPEN_POLE = { ocirc: 1, odiamondpole: 1, osquarepole: 1, diamondpole: 1, squarepole: 1 };
  var IGNORE_OPT = {
    thick: 1, thin: 1, dashed: 1, dotted: 1, draw: 1, fill: 1, semithick: 1, ultra: 1,
    help: 1, solid: 1, color: 1, black: 1, red: 1, blue: 1
  };

  function lib() {
    if (typeof Design !== 'undefined' && Design && Design.metrics) return Design;
    if (typeof require === 'function') return require('./design.js');
    throw new Error('design.js is required');
  }

  function num(n) {
    if (!isFinite(n)) return '0';
    var s = (Math.round(n * 10000) / 10000).toFixed(4);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : (s || '0');
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  function snap(v) { return Math.round(v / 8) * 8; }

  function texText(s) {
    var t = String(s == null ? '' : s);
    t = t.replace(/\\/g, '\u0000');
    t = t.replace(/([&%$#_{}])/g, '\\$1');
    t = t.replace(/\^/g, '\\textasciicircum{}');
    t = t.replace(/~/g, '\\textasciitilde{}');
    t = t.replace(/\u0000/g, '\\textbackslash{}');
    return t;
  }

  function inName(i, n) {
    var names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    if (n === 1) return 'A';
    return names[i] || ('I' + i);
  }

  function styleOf(shape) {
    var m = /^(american|european|ieeestd)\b/.exec(shape || '');
    return m ? m[1] : '';
  }

  function kindOfShape(shape) {
    var m = /(?:^|\s)(and|nand|or|nor|xor|xnor|not|buffer|schmitt|invschmitt)\s+port$/.exec(String(shape || '').trim());
    if (m) return m[1];
    if (/^flipflop\b/.test(shape || '')) return 'flipflop';
    if (shape === 'muxdemux') return 'muxdemux';
    if (shape === 'latch') return 'latch';
    return '';
  }

  function originDx(style, kind, originCenter) {
    if (!originCenter) return 0;
    if (style === 'ieeestd') return 0;
    if (style === 'european') return 0.784;
    if (kind === 'not' || kind === 'buffer' || kind === 'schmitt' || kind === 'invschmitt') return 0;
    return 0.616;
  }

  function muxDef(opts) {
    var d = (opts && opts.mux) || {};
    return {
      NL: d.NL > 0 ? d.NL : 8,
      NR: d.NR > 0 ? d.NR : 1,
      NB: d.NB > 0 ? d.NB : 0,
      NT: d.NT > 0 ? d.NT : 0,
      w: d.w > 0 ? d.w : 3,
      Lh: d.Lh > 0 ? d.Lh : 8,
      Rh: d.Rh > 0 ? d.Rh : 6
    };
  }

  function muxPoint(def, which, k) {
    var u = 0.56;
    var L = 0.28;
    var xk, t, hb;
    if (which === 'lpin') {
      return { x: -(def.w * u / 2 + L), y: def.Lh * u / 2 - (k - 0.5) * def.Lh * u / def.NL };
    }
    if (which === 'rpin') {
      return { x: def.w * u / 2 + L, y: def.Rh * u / 2 - (k - 0.5) * def.Rh * u / def.NR };
    }
    xk = -def.w * u / 2 + (k - 0.5) * def.w * u / (which === 'bpin' || which === 'tpin' ? Math.max(def.NB || def.NT, 1) : 1);
    if (which === 'bpin' || which === 'tpin') {
      var slots = which === 'bpin' ? def.NB : def.NT;
      xk = -def.w * u / 2 + (k - 0.5) * def.w * u / slots;
    }
    t = (xk + def.w * u / 2) / (def.w * u);
    hb = (def.Lh / 2 + (def.Rh / 2 - def.Lh / 2) * t) * u;
    if (which === 'tpin') return { x: xk, y: hb + L };
    return { x: xk, y: -(hb + L) };
  }

  function muxBox(def) {
    var xs = [-def.w * 0.56 / 2, def.w * 0.56 / 2];
    var ys = [-def.Lh * 0.56 / 2, def.Lh * 0.56 / 2, -def.Rh * 0.56 / 2, def.Rh * 0.56 / 2];
    var k;
    for (k = 1; k <= def.NL; k++) { var p = muxPoint(def, 'lpin', k); xs.push(p.x); ys.push(p.y); }
    for (k = 1; k <= def.NR; k++) { var q = muxPoint(def, 'rpin', k); xs.push(q.x); ys.push(q.y); }
    for (k = 1; k <= def.NB; k++) { var b = muxPoint(def, 'bpin', k); xs.push(b.x); ys.push(b.y); }
    for (k = 1; k <= def.NT; k++) { var t = muxPoint(def, 'tpin', k); xs.push(t.x); ys.push(t.y); }
    return {
      x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
      y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys),
      textX: 0, textY: 0
    };
  }

  function logicBox(shape, opts) {
    var style = styleOf(shape) || (opts && opts.style) || 'american';
    var kind = kindOfShape(shape);
    if (MULTI[kind]) {
      var g = GATE[style] || GATE.american;
      return { x0: g.inX, x1: g.outX, y0: -g.h, y1: g.h, textX: g.textX, textY: 0, style: style, kind: kind };
    }
    if (kind === 'not' || kind === 'buffer' || kind === 'schmitt' || kind === 'invschmitt') {
      var m = MONO[style] || MONO.american;
      if ((kind === 'schmitt' || kind === 'invschmitt') && style !== 'ieeestd' && style !== 'european') m = MONO.american;
      return { x0: m.inX, x1: m.outX, y0: -m.y, y1: m.y, textX: (m.inX + m.outX) / 2, textY: 0, style: style, kind: kind };
    }
    if (kind === 'flipflop' || shape === 'latch' || /^flipflop/.test(shape || '')) {
      return { x0: -1.12, x1: 1.12, y0: -1.54, y1: 1.54, textX: 0, textY: 0, style: style, kind: 'flipflop' };
    }
    if (shape === 'muxdemux' || kind === 'muxdemux') {
      var box = muxBox(muxDef(opts));
      box.style = style;
      box.kind = 'muxdemux';
      return box;
    }
    if (POLE[shape]) return { x0: -0.056, x1: 0.056, y0: -0.056, y1: 0.056, textX: 0, textY: 0, style: style, kind: shape };
    return null;
  }

  function compass(box, name) {
    var cx = (box.x0 + box.x1) / 2;
    var cy = (box.y0 + box.y1) / 2;
    if (name === 'north') return { x: cx, y: box.y1 };
    if (name === 'south') return { x: cx, y: box.y0 };
    if (name === 'east') return { x: box.x1, y: cy };
    if (name === 'west') return { x: box.x0, y: cy };
    if (name === 'north east' || name === 'northeast') return { x: box.x1, y: box.y1 };
    if (name === 'north west' || name === 'northwest') return { x: box.x0, y: box.y1 };
    if (name === 'south east' || name === 'southeast') return { x: box.x1, y: box.y0 };
    if (name === 'south west' || name === 'southwest') return { x: box.x0, y: box.y0 };
    if (name === 'text') return { x: box.textX, y: box.textY || 0 };
    return null;
  }

  function anchor(shape, name, opts) {
    opts = opts || {};
    var raw = String(shape || '').trim();
    var style = styleOf(raw) || opts.style || 'american';
    var kind = kindOfShape(raw);
    var unstyled = raw.replace(/^(american|european|ieeestd)\s+/, '');
    var box = logicBox(style + ' ' + (kind ? (kind + ' port') : unstyled), opts);
    if (kind === 'flipflop' || /^flipflop/.test(raw) || raw === 'latch') box = logicBox('flipflop D', opts);
    if (raw === 'muxdemux' || unstyled === 'muxdemux') box = logicBox('muxdemux', opts);
    if (POLE[raw] || SUPPLY[raw]) box = logicBox('ocirc', opts);
    if (!box && !POLE[raw] && !SUPPLY[raw] && raw !== 'muxdemux') {
      box = logicBox(style + ' ' + raw, opts);
    }
    var nIn = opts.inputs > 0 ? opts.inputs : 2;
    var p = null;
    if (name === 'center' || name === '' || name == null) p = { x: 0, y: 0 };
    else if (FF[name] && (kind === 'flipflop' || /^flipflop/.test(raw) || raw === 'latch')) p = { x: FF[name].x, y: FF[name].y };
    else if (raw === 'muxdemux' || unstyled === 'muxdemux' || (box && box.kind === 'muxdemux')) {
      var def = muxDef(opts);
      var mk = /^((?:l|r|b|t)pin)\s+(\d+)$/.exec(name);
      if (mk) p = muxPoint(def, mk[1], parseInt(mk[2], 10));
    } else if (box && (MULTI[box.kind] || box.kind === 'not' || box.kind === 'buffer' || box.kind === 'schmitt' || box.kind === 'invschmitt')) {
      var mono = box.kind === 'not' || box.kind === 'buffer' || box.kind === 'schmitt' || box.kind === 'invschmitt';
      var baseKind = box.kind === 'invschmitt' ? 'not' : (box.kind === 'schmitt' ? 'buffer' : box.kind);
      if (name === 'out' || name === 'bout') {
        if (name === 'bout' && style === 'ieeestd') {
          p = { x: mono ? (baseKind === 'not' ? 0.6575 : 0.485) : (IEEE_BOUT[baseKind] || box.x1), y: 0 };
        } else p = { x: box.x1, y: 0 };
      } else if (name === 'in' || name === 'in 1' || name === 'bin' || name === 'bin 1') {
        var y0 = 0;
        if (!mono && /^in /.test(name) === false && name !== 'in' && name !== 'bin') y0 = 0;
        if (!mono && name === 'in 1') y0 = box.y1 * (1 - 1 / nIn);
        if (name === 'bin' || name === 'bin 1') {
          if (style === 'ieeestd') p = { x: mono ? -0.485 : (IEEE_BIN[baseKind] || box.x0), y: mono ? 0 : box.y1 * (1 - 1 / nIn) };
          else p = { x: box.x0, y: mono ? 0 : box.y1 * (1 - 1 / nIn) };
        } else p = { x: box.x0, y: mono ? 0 : (name === 'in' ? 0 : y0) };
        if (mono && (name === 'in' || name === 'in 1')) p = { x: box.x0, y: 0 };
      } else {
        var inm = /^in (\d+)$/.exec(name);
        var binm = /^bin (\d+)$/.exec(name);
        if (inm) {
          var k = parseInt(inm[1], 10);
          p = { x: box.x0, y: box.y1 * (1 - (2 * k - 1) / nIn) };
        } else if (binm) {
          var kb = parseInt(binm[1], 10);
          var yb = box.y1 * (1 - (2 * kb - 1) / nIn);
          p = { x: style === 'ieeestd' ? (IEEE_BIN[baseKind] || box.x0) : box.x0, y: yb };
        }
      }
    }
    if (!p && box) p = compass(box, name);
    if (!p && (POLE[raw] || SUPPLY[raw]) && (name === 'center' || name === 'text')) p = { x: 0, y: 0 };
    if (!p) return null;
    if (name !== 'center') p = { x: p.x + originDx(style, box ? box.kind : kind, opts.originCenter), y: p.y };
    return p;
  }

  function nodeName(raw, used) {
    var s = String(raw || 'n').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!s || /^[0-9]/.test(s)) s = 'n' + s;
    var base = s;
    var n = s;
    var i = 2;
    while (used[n]) { n = base + '_' + i; i++; }
    used[n] = 1;
    return n;
  }

  function byPos(a, b) {
    return a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id));
  }

  function shapeName(part, style) {
    if (MULTI[part.type]) return style + ' ' + part.type + ' port';
    if (part.type === 'not') return style + ' not port';
    if (part.type === 'buf') return style + ' buffer port';
    if (part.type === 'dff') return 'flipflop D';
    if (part.type === 'mux' || part.type === 'block') return 'muxdemux';
    return '';
  }

  function toTex(doc, opts) {
    var D = lib();
    var warnings = [];
    opts = opts || {};
    var style = opts.style || 'american';
    if (!GATE[style]) style = 'american';
    var scope = opts.scope === 'all' ? 'all' : 'active';
    var mods = [];
    if (doc && doc.modules) {
      if (scope === 'all') mods = doc.modules.slice();
      else {
        var active = D.moduleById(doc, doc.active) || doc.modules[0];
        if (active) mods = [active];
      }
    }
    var rep = D.report(doc || { modules: [] });
    var lines = [];
    lines.push('% Generated by Schematic Designer. Compile with pdflatex.');
    lines.push('% "Convert to schematic" reads this back: nodes, wires, labels and the');
    lines.push('% "% module:" / "% net:" comments.');
    var opt = 'border=10pt';
    if (mods.length > 1) opt += ',multi=circuitikz';
    lines.push('\\documentclass[' + opt + ']{standalone}');
    lines.push('\\usepackage{circuitikz}');
    lines.push('\\begin{document}');
    mods.forEach(function (mod) {
      lines.push('% module: ' + (mod.name || 'top'));
      lines.push('\\begin{circuitikz}');
      if (!mod.parts || !mod.parts.length) {
        lines.push('  \\node {empty};');
        lines.push('\\end{circuitikz}');
        lines.push('');
        return;
      }
      var orgX = Infinity;
      var orgY = Infinity;
      mod.parts.forEach(function (p) {
        if (p.x < orgX) orgX = p.x;
        if (p.y < orgY) orgY = p.y;
      });
      lines.push('% origin: ' + num(orgX) + ' ' + num(orgY));
      function texPt(px, py) {
        return { x: (px - orgX) * S, y: -(py - orgY) * S };
      }
      var lab = rep.labels[mod.id] || {};
      var used = Object.create(null);
      var placed = [];
      var byId = Object.create(null);
      mod.parts.forEach(function (p) { byId[p.id] = p; });
      mod.parts.slice().sort(byPos).forEach(function (part) {
        var m = D.metrics(part, doc);
        var cx = part.x + m.w / 2;
        var cy = part.y + m.h / 2;
        var mid = texPt(cx, cy);
        var base = (lab.ports && lab.ports[part.id]) || (lab.inst && lab.inst[part.id]) || part.name || part.type;
        var nm = nodeName(base, used);
        var rec = { part: part, name: nm, metrics: m, pins: {} };
        if (part.type === 'in' || part.type === 'out' || part.type === 'c0' || part.type === 'c1') {
          var pin = part.type === 'out' ? 'A' : 'Y';
          var pp = null;
          m.pins.forEach(function (q) { if (q.name === pin) pp = q; });
          var at = texPt(part.x + pp.x, part.y + pp.y);
          rec.x = r2(at.x);
          rec.y = r2(at.y);
          rec.shape = part.type === 'c0' ? 'ground' : (part.type === 'c1' ? 'vcc' : 'ocirc');
          var label = texText(part.name || nm);
          if (part.type === 'in') lines.push('  \\node[ocirc, label={left:' + label + '}] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {};');
          else if (part.type === 'out') lines.push('  \\node[ocirc, label={right:' + label + '}] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {};');
          else lines.push('  \\node[' + rec.shape + '] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {};');
        } else if (part.type === 'dff') {
          var def = [];
          if (part.clkEdge === 'neg') def.push('n3=1');
          if (part.hasRst) {
            if (part.rstVal) {
              def.push('tu=SET');
              if (part.rstEdge === 'neg') def.push('nu=1');
            } else {
              def.push('td=RST');
              if (part.rstEdge === 'neg') def.push('nd=1');
            }
          }
          var optff = 'flipflop D' + (def.length ? ', flipflop def={' + def.join(', ') + '}' : '');
          var bc = anchor('flipflop D', 'text', {}) || { x: 0, y: 0 };
          var box = logicBox('flipflop D', {});
          var ccx = (box.x0 + box.x1) / 2;
          var ccy = (box.y0 + box.y1) / 2;
          rec.x = r2(mid.x - ccx);
          rec.y = r2(mid.y - ccy);
          rec.shape = 'flipflop D';
          lines.push('  \\node[' + optff + '] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {};');
          void bc;
        } else if (part.type === 'mux') {
          var md = { NL: 2, NR: 1, NB: 1, NT: 0, w: 1.5, Lh: 2.5, Rh: 1.5 };
          var mb = muxBox(md);
          rec.x = r2(mid.x - (mb.x0 + mb.x1) / 2);
          rec.y = r2(mid.y - (mb.y0 + mb.y1) / 2);
          rec.shape = 'muxdemux';
          rec.opts = { mux: md, inputs: 2 };
          lines.push('  \\node[muxdemux, muxdemux def={NL=2, NR=1, NB=1, NT=0, w=1.5, Lh=2.5, Rh=1.5}, muxdemux label={L1={0}, L2={1}}] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {};');
        } else if (part.type === 'block') {
          var pins = D.pins(part, doc);
          var ins = [];
          var outs = [];
          pins.forEach(function (q) { if (q.dir === 'out') outs.push(q); else ins.push(q); });
          var I = Math.max(ins.length, 1);
          var O = Math.max(outs.length, 1);
          var H = Math.max(ins.length, outs.length, 2);
          var longest = String(part.name || '').length;
          var modLabel = D.blockTypeName(part, doc) || 'block';
          if (String(modLabel).length > longest) longest = String(modLabel).length;
          ins.concat(outs).forEach(function (q) { if (String(q.name).length > longest) longest = String(q.name).length; });
          var W = Math.max(2.5, Math.round((0.16 * longest + 1.2) * 2) / 2);
          var bd = { NL: I, NR: O, NB: 0, NT: 0, w: W, Lh: H, Rh: H };
          var bb = muxBox(bd);
          rec.x = r2(mid.x - (bb.x0 + bb.x1) / 2);
          rec.y = r2(mid.y - (bb.y0 + bb.y1) / 2);
          rec.shape = 'muxdemux';
          rec.opts = { mux: bd };
          var labs = [];
          ins.forEach(function (q, i) { labs.push('L' + (i + 1) + '={' + texText(q.name) + '}'); });
          outs.forEach(function (q, i) { labs.push('R' + (i + 1) + '={' + texText(q.name) + '}'); });
          var body = '\\shortstack{' + texText(part.name || nm) + '\\\\ \\footnotesize ' + texText(modLabel) + '}';
          lines.push('  \\node[muxdemux, muxdemux def={NL=' + I + ', NR=' + O + ', NB=0, NT=0, w=' + num(W) + ', Lh=' + H + ', Rh=' + H + '}, muxdemux label={' + labs.join(', ') + '}] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {' + body + '};');
        } else if (MULTI[part.type] || part.type === 'not' || part.type === 'buf') {
          var sh = shapeName(part, style);
          var nIn = MULTI[part.type] ? Math.max(2, Math.min(8, part.inputs || 2)) : 1;
          var gb = logicBox(sh, { inputs: nIn });
          rec.x = r2(mid.x - (gb.x0 + gb.x1) / 2);
          rec.y = r2(mid.y);
          rec.shape = sh;
          rec.opts = { inputs: nIn, style: style };
          var extra = MULTI[part.type] && nIn > 2 ? ', number inputs=' + nIn : '';
          lines.push('  \\node[' + sh + extra + '] (' + nm + ') at (' + num(rec.x) + ', ' + num(rec.y) + ') {};');
        } else {
          warnings.push('Skipped ' + (part.type || 'part'));
          return;
        }
        placed.push(rec);
      });
      var recBy = Object.create(null);
      placed.forEach(function (r) { recBy[r.part.id] = r; });
      function pinRef(part, pin) {
        var rec = recBy[part.id];
        if (!rec) return null;
        var anchorName = '';
        var side = 'l';
        if (part.type === 'in' || part.type === 'c0' || part.type === 'c1') { side = 'r'; }
        else if (part.type === 'out') { side = 'l'; }
        else if (part.type === 'not' || part.type === 'buf') {
          anchorName = pin === 'Y' ? 'out' : 'in';
          side = pin === 'Y' ? 'r' : 'l';
        } else if (part.type === 'dff') {
          if (pin === 'D') { anchorName = 'pin 1'; side = 'l'; }
          else if (pin === 'CLK') { anchorName = 'pin 3'; side = 'l'; }
          else if (pin === 'Q') { anchorName = 'pin 6'; side = 'r'; }
          else if (pin === 'RST') { anchorName = 'down'; side = 'b'; }
          else if (pin === 'SET') { anchorName = 'up'; side = 't'; }
          else return null;
        } else if (part.type === 'mux') {
          if (pin === 'D0') { anchorName = 'lpin 1'; side = 'l'; }
          else if (pin === 'D1') { anchorName = 'lpin 2'; side = 'l'; }
          else if (pin === 'Y') { anchorName = 'rpin 1'; side = 'r'; }
          else if (pin === 'S') { anchorName = 'bpin 1'; side = 'b'; }
          else return null;
        } else if (part.type === 'block') {
          var spec = D.pins(part, doc);
          var ins = [];
          var outs = [];
          spec.forEach(function (q) { if (q.dir === 'out') outs.push(q); else ins.push(q); });
          var found = -1;
          ins.forEach(function (q, i) { if (q.name === pin) found = i; });
          if (found >= 0) { anchorName = 'lpin ' + (found + 1); side = 'l'; }
          else {
            outs.forEach(function (q, i) { if (q.name === pin) found = i; });
            if (found < 0) return null;
            anchorName = 'rpin ' + (found + 1);
            side = 'r';
          }
        } else if (MULTI[part.type]) {
          if (pin === 'Y') { anchorName = 'out'; side = 'r'; }
          else {
            var spec2 = D.pins(part, doc);
            var idx = 0;
            var hit = 0;
            spec2.forEach(function (q) {
              if (q.dir !== 'in') return;
              idx++;
              if (q.name === pin) hit = idx;
            });
            if (!hit) return null;
            anchorName = 'in ' + hit;
            side = 'l';
          }
        } else return null;
        var off = anchorName ? anchor(rec.shape, anchorName, rec.opts || { inputs: rec.opts && rec.opts.inputs }) : { x: 0, y: 0 };
        if (!off) off = { x: 0, y: 0 };
        var dir = 'in';
        D.pins(part, doc).forEach(function (q) { if (q.name === pin) dir = q.dir; });
        return {
          ref: anchorName ? (rec.name + '.' + anchorName) : rec.name,
          x: rec.x + off.x,
          y: rec.y + off.y,
          side: side,
          dir: dir
        };
      }
      (mod.nets || []).forEach(function (net) {
        var ends = [];
        (net.pins || []).forEach(function (ref) {
          var part = byId[ref.part];
          if (!part) return;
          var pr = pinRef(part, ref.pin);
          if (!pr) return;
          pr.part = part;
          pr.pin = ref.pin;
          ends.push(pr);
        });
        if (ends.length < 2) return;
        var info = lab.nets && lab.nets[net.id];
        var hint = (info && info.vname) || net.name || '';
        if (hint) lines.push('  % net: ' + hint);
        var src = ends[0];
        ends.forEach(function (e) {
          var srcOut = src.dir === 'out' || src.dir === 'inout';
          var eOut = e.dir === 'out' || e.dir === 'inout';
          if (eOut && (!srcOut || e.x > src.x)) src = e;
        });
        function tip(e) {
          if (e.side === 'l') return { x: e.x - 0.42, y: e.y };
          if (e.side === 'r') return { x: e.x + 0.42, y: e.y };
          if (e.side === 'b') return { x: e.x, y: e.y - 0.42 };
          return { x: e.x, y: e.y + 0.42 };
        }
        var s0 = tip(src);
        var forward = [];
        var back = [];
        ends.forEach(function (e) {
          if (e === src) return;
          var t = tip(e);
          if (e.dir !== 'out' && e.dir !== 'inout' && t.x < s0.x - 0.21) back.push(e);
          else forward.push(e);
        });
        var trunk = s0.x;
        if (forward.length) {
          var minF = tip(forward[0]).x;
          forward.forEach(function (e) { var tx = tip(e).x; if (tx < minF) minF = tx; });
          if (minF > s0.x + 0.32) trunk = (s0.x + minF) / 2;
        }
        var dx = r2(trunk - src.x);
        var low = ends[0].y;
        ends.forEach(function (e) { if (e.y < low) low = e.y; });
        var segs = [];
        function addSeg(a, b) {
          if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) return;
          segs.push(a, b);
        }
        function emit(load, kind, extra) {
          var tail = '(' + load.ref + ')';
          if (kind === 'b') lines.push('  \\draw (' + src.ref + ') -- ++(' + num(dx) + ',0) |- ([yshift=-0.42cm]' + load.ref + ') -- ' + tail + ';');
          else if (kind === 't') lines.push('  \\draw (' + src.ref + ') -- ++(' + num(dx) + ',0) |- ([yshift=0.42cm]' + load.ref + ') -- ' + tail + ';');
          else if (kind === 'back') lines.push('  \\draw (' + src.ref + ') -- ++(' + num(dx) + ',0) |- (' + num(extra.xL) + ', ' + num(extra.yB) + ') |- ' + tail + ';');
          else lines.push('  \\draw (' + src.ref + ') -- ++(' + num(dx) + ',0) |- ' + tail + ';');
          var p0 = { x: src.x, y: src.y };
          var p1 = { x: src.x + dx, y: src.y };
          addSeg(p0, p1);
          if (kind === 'b' || kind === 't') {
            var yy = load.y + (kind === 'b' ? -0.42 : 0.42);
            addSeg(p1, { x: p1.x, y: yy });
            addSeg({ x: p1.x, y: yy }, { x: load.x, y: yy });
            addSeg({ x: load.x, y: yy }, { x: load.x, y: load.y });
          } else if (kind === 'back') {
            addSeg(p1, { x: p1.x, y: extra.yB });
            addSeg({ x: p1.x, y: extra.yB }, { x: extra.xL, y: extra.yB });
            addSeg({ x: extra.xL, y: extra.yB }, { x: extra.xL, y: load.y });
            addSeg({ x: extra.xL, y: load.y }, { x: load.x, y: load.y });
          } else {
            addSeg(p1, { x: p1.x, y: load.y });
            addSeg({ x: p1.x, y: load.y }, { x: load.x, y: load.y });
          }
        }
        forward.forEach(function (load) {
          var kind = load.side === 'b' ? 'b' : (load.side === 't' ? 't' : 'lr');
          emit(load, kind);
        });
        back.forEach(function (load, idx) {
          emit(load, 'back', { xL: load.x - 0.42, yB: low - 0.74 - 0.37 * idx });
        });
        var dots = junctionDots(segs, ends);
        dots.forEach(function (d) {
          lines.push('  \\node[circ] at (' + num(d.x) + ', ' + num(d.y) + ') {};');
        });
      });
      lines.push('\\end{circuitikz}');
      lines.push('');
    });
    if (!mods.length) {
      lines.push('\\begin{circuitikz}');
      lines.push('  \\node {empty};');
      lines.push('\\end{circuitikz}');
      lines.push('');
    }
    lines.push('\\end{document}');
    lines.push('');
    return { tex: lines.join('\n'), warnings: warnings };
  }

  function junctionDots(segs, pins) {
    var at = Object.create(null);
    function key(x, y) { return Math.round(x * 1000) + ':' + Math.round(y * 1000); }
    function touch(x, y, dir) {
      var k = key(x, y);
      if (!at[k]) at[k] = { x: x, y: y, dirs: Object.create(null) };
      if (dir) at[k].dirs[dir] = 1;
    }
    function orient(x1, y1, x2, y2) {
      if (Math.abs(y1 - y2) <= 1e-4 && Math.abs(x1 - x2) > 1e-4) return x2 > x1 ? 'r' : 'l';
      if (Math.abs(x1 - x2) <= 1e-4 && Math.abs(y1 - y2) > 1e-4) return y2 > y1 ? 'u' : 'd';
      return '';
    }
    var list = [];
    var i;
    for (i = 0; i + 1 < segs.length; i += 2) {
      var a = segs[i];
      var b = segs[i + 1];
      var d = orient(a.x, a.y, b.x, b.y);
      if (!d) continue;
      var opp = { l: 'r', r: 'l', u: 'd', d: 'u' }[d];
      touch(a.x, a.y, d);
      touch(b.x, b.y, opp);
      list.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, d: d, opp: opp });
    }
    Object.keys(at).forEach(function (k) {
      var p = at[k];
      list.forEach(function (s) {
        var on = false;
        if (s.d === 'l' || s.d === 'r') {
          var y = s.y1;
          var lo = Math.min(s.x1, s.x2);
          var hi = Math.max(s.x1, s.x2);
          on = Math.abs(p.y - y) <= 0.02 && p.x > lo + 0.01 && p.x < hi - 0.01;
        } else {
          var x = s.x1;
          var ylo = Math.min(s.y1, s.y2);
          var yhi = Math.max(s.y1, s.y2);
          on = Math.abs(p.x - x) <= 0.02 && p.y > ylo + 0.01 && p.y < yhi - 0.01;
        }
        if (on) { p.dirs[s.d] = 1; p.dirs[s.opp] = 1; }
      });
    });
    var dots = [];
    Object.keys(at).forEach(function (k) {
      var p = at[k];
      var n = Object.keys(p.dirs).length;
      if (n < 3) return;
      var onPin = pins.some(function (pin) {
        return Math.abs(pin.x - p.x) <= 0.03 && Math.abs(pin.y - p.y) <= 0.03;
      });
      if (!onPin) dots.push(p);
    });
    return dots;
  }

  function readDelim(s, i, open, close) {
    if (s.charAt(i) !== open) return null;
    var depth = 0;
    var brace = 0;
    var start = i;
    for (; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\') { i++; continue; }
      if (open !== '{') {
        if (c === '{') { brace++; continue; }
        if (c === '}') { brace = Math.max(0, brace - 1); continue; }
        if (brace) continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return { inner: s.slice(start + 1, i), next: i + 1 };
      }
    }
    return null;
  }

  function splitTop(s, sep) {
    var out = [];
    var buf = '';
    var b = 0;
    var k = 0;
    var p = 0;
    var i;
    for (i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\') { buf += c + (s.charAt(i + 1) || ''); i++; continue; }
      if (c === '{') b++;
      else if (c === '}') b = Math.max(0, b - 1);
      else if (c === '[') k++;
      else if (c === ']') k = Math.max(0, k - 1);
      else if (c === '(') p++;
      else if (c === ')') p = Math.max(0, p - 1);
      if (c === sep && !b && !k && !p) { out.push(buf); buf = ''; }
      else buf += c;
    }
    out.push(buf);
    return out;
  }

  function unbrace(v) {
    var t = String(v == null ? '' : v).trim();
    while (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') {
      var inner = t.slice(1, -1).trim();
      if (inner.indexOf('{') >= 0 && inner.indexOf('}') < 0) break;
      t = inner;
    }
    return t;
  }

  function evalExpr(s) {
    var i = 0;
    function peek() { return s.charAt(i); }
    function number() {
      var st = i;
      if (peek() === '+' || peek() === '-') i++;
      var any = false;
      var dot = false;
      while (i < s.length && /[\d.]/.test(s.charAt(i))) {
        if (s.charAt(i) === '.') {
          if (dot) break;
          dot = true;
        }
        any = true;
        i++;
      }
      if (!any) return null;
      return parseFloat(s.slice(st, i));
    }
    function factor() {
      if (peek() === '(') {
        i++;
        var v = expr();
        if (peek() === ')') i++;
        return v;
      }
      return number();
    }
    function term() {
      var v = factor();
      if (v == null) return null;
      while (peek() === '*' || peek() === '/') {
        var op = peek();
        i++;
        var r = factor();
        if (r == null) return null;
        v = op === '*' ? v * r : (r === 0 ? null : v / r);
        if (v == null) return null;
      }
      return v;
    }
    function expr() {
      var v = term();
      if (v == null) return null;
      while (peek() === '+' || peek() === '-') {
        var op = peek();
        i++;
        var r = term();
        if (r == null) return null;
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    if (!s) return null;
    var v = expr();
    if (v == null || i !== s.length || !isFinite(v)) return null;
    return v;
  }

  function lengthOf(raw) {
    var s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return null;
    var unit = 'cm';
    var um = /^(.*?)(cm|mm|pt|in|bp)$/i.exec(s);
    if (um) { unit = um[2].toLowerCase(); s = um[1]; }
    var v = evalExpr(s);
    if (v == null) return null;
    if (unit === 'mm') return v / 10;
    if (unit === 'pt') return v / 28.4528;
    if (unit === 'bp') return v * 2.54 / 72;
    if (unit === 'in') return v * 2.54;
    return v;
  }

  function wordAt(s, i, w) {
    if (s.slice(i, i + w.length) !== w) return false;
    var before = i > 0 ? s.charAt(i - 1) : '';
    var after = s.charAt(i + w.length) || '';
    if (/[A-Za-z\\]/.test(before)) return false;
    if (/[A-Za-z]/.test(after)) return false;
    return true;
  }

  function skipSpace(s, i) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    return i;
  }

  function preprocess(src) {
    var out = '';
    var hints = [];
    var i = 0;
    while (i < src.length) {
      var c = src.charAt(i);
      if (c === '\\') {
        out += c;
        i++;
        if (i < src.length) { out += src.charAt(i); i++; }
        continue;
      }
      if (c === '%') {
        var nl = src.indexOf('\n', i);
        if (nl < 0) nl = src.length;
        var body = src.slice(i + 1, nl);
        var mm = /^\s*module:\s*(\S.*?)\s*$/.exec(body);
        var nn = /^\s*net:\s*(\S.*?)\s*$/.exec(body);
        var oo = /^\s*origin:\s*([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\s*$/.exec(body);
        if (mm) hints.push({ at: out.length, kind: 'module', name: mm[1].trim() });
        else if (nn) hints.push({ at: out.length, kind: 'net', name: nn[1].trim() });
        else if (oo) hints.push({ at: out.length, kind: 'origin', x: parseFloat(oo[1]), y: parseFloat(oo[2]) });
        i = nl;
        continue;
      }
      out += c;
      i++;
    }
    return { text: out, hints: hints };
  }

  function looksLikeTex(text) {
    return /\\(begin\s*\{(circuitikz|tikzpicture)\}|node\b|draw\b|usepackage(\[[^\]]*\])?\{circuitikz\}|ctikzset\b)/.test(String(text || ''));
  }

  function wrapDocument(text) {
    var src = String(text || '');
    if (/\\documentclass\b/.test(src)) return src;
    var libs = [];
    var body = src.replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}/g, function (m) { libs.push(m); return ''; });
    body = body.replace(/\\usetikzlibrary\{[^}]+\}/g, function (m) { libs.push(m); return ''; });
    var envCount = (body.match(/\\begin\{(?:circuitikz|tikzpicture)\}/g) || []).length;
    var opt = 'border=10pt';
    if (envCount > 1) opt += ',multi=circuitikz';
    var lines = ['\\documentclass[' + opt + ']{standalone}', '\\usepackage{circuitikz}'];
    libs.forEach(function (l) { lines.push(l); });
    lines.push('\\begin{document}');
    if (!envCount) {
      lines.push('\\begin{circuitikz}');
      lines.push(body.trim());
      lines.push('\\end{circuitikz}');
    } else lines.push(body.trim());
    lines.push('\\end{document}');
    lines.push('');
    return lines.join('\n');
  }

  function consumeStyle(raw, ctx) {
    var t = String(raw || '').trim().toLowerCase();
    if (t === 'european' || t === 'european ports' || t === 'cute') { ctx.style = 'european'; return true; }
    if (t === 'american' || t === 'american ports') { ctx.style = 'american'; return true; }
    if (t === 'ieee ports') { ctx.style = 'ieeestd'; return true; }
    return false;
  }

  function applyCtikz(inner, ctx) {
    splitTop(inner, ',').forEach(function (piece) {
      var eq = piece.indexOf('=');
      if (eq < 0) return;
      var k = piece.slice(0, eq).trim().toLowerCase();
      var v = unbrace(piece.slice(eq + 1)).trim().toLowerCase();
      if (k === 'logic ports') {
        if (v === 'european') ctx.style = 'european';
        else if (v === 'american') ctx.style = 'american';
        else if (v === 'ieee') ctx.style = 'ieeestd';
      } else if (k === 'logic ports origin') ctx.originCenter = v === 'center';
    });
  }

  function styleAt(text, index) {
    var ctx = { style: 'american', originCenter: false };
    var re = /\\usepackage\s*(\[[^\]]*\])?\s*\{circuitikz\}|\\ctikzset\s*\{|\\tikzset\s*\{/g;
    var m;
    while ((m = re.exec(text))) {
      if (m.index >= index) break;
      if (m[0].indexOf('usepackage') >= 0) {
        splitTop(String(m[1] || '').replace(/^\[|\]$/g, ''), ',').forEach(function (o) { consumeStyle(o, ctx); });
      } else {
        var br = readDelim(text, m.index + m[0].length - 1, '{', '}');
        if (br) applyCtikz(br.inner, ctx);
      }
    }
    return ctx;
  }

  function parseKv(s) {
    var map = Object.create(null);
    splitTop(String(s || ''), ',').forEach(function (piece) {
      var eq = piece.indexOf('=');
      if (eq < 0) return;
      map[piece.slice(0, eq).trim()] = unbrace(piece.slice(eq + 1)).trim();
    });
    return map;
  }

  function parseOptions(s) {
    var list = [];
    splitTop(s || '', ',').forEach(function (piece) {
      var raw = piece.trim();
      if (!raw) return;
      var eq = -1;
      var b = 0;
      var i;
      for (i = 0; i < raw.length; i++) {
        var c = raw.charAt(i);
        if (c === '{') b++;
        else if (c === '}') b = Math.max(0, b - 1);
        else if (c === '=' && !b) { eq = i; break; }
      }
      if (eq < 0) list.push({ raw: raw, key: '', val: '' });
      else list.push({ raw: raw, key: raw.slice(0, eq).trim(), val: raw.slice(eq + 1).trim() });
    });
    return list;
  }

  function isShapeWord(raw) {
    if (!raw) return false;
    if (/port$/.test(raw)) return true;
    if (/^flipflop\b/.test(raw) || raw === 'latch' || raw === 'muxdemux') return true;
    if (POLE[raw] || SUPPLY[raw]) return true;
    if (raw === 'schmitt' || raw === 'invschmitt') return true;
    return false;
  }

  function classifyOptions(list) {
    var shape = '';
    var inputs = 0;
    var ff = {};
    var mux = null;
    var muxLabels = Object.create(null);
    var label = null;
    var anchorName = '';
    var transforms = [];
    var nameOpt = '';
    list.forEach(function (o) {
      if (o.key) {
        var k = o.key.toLowerCase();
        var v = unbrace(o.val);
        if (k === 'number inputs') inputs = parseInt(v, 10) || inputs;
        else if (k === 'flipflop def') ff.def = parseKv(v);
        else if (k === 'muxdemux def') mux = parseKv(v);
        else if (k === 'muxdemux label') muxLabels = parseKv(v);
        else if (k === 'label') label = parseLabelVal(v);
        else if (k === 'anchor') anchorName = v.trim();
        else if (k === 'rotate') transforms.push({ t: 'rot', deg: parseFloat(v) || 0 });
        else if (k === 'xscale') transforms.push({ t: 'scale', x: parseFloat(v) || 1, y: 1 });
        else if (k === 'yscale') transforms.push({ t: 'scale', x: 1, y: parseFloat(v) || 1 });
        else if (k === 'scale') { var sc = parseFloat(v) || 1; transforms.push({ t: 'scale', x: sc, y: sc }); }
        else if (k === 'shape' || k === 'shape name') shape = v.trim();
        else if (k === 'name') nameOpt = v.trim();
      } else if (isShapeWord(o.raw)) shape = o.raw;
      else if (!IGNORE_OPT[o.raw.toLowerCase()] && /^[A-Za-z]/.test(o.raw) && !shape) shape = o.raw;
      else if (/^add async sr$/i.test(o.raw)) ff.async = true;
      else if (/dot on not/i.test(o.raw)) ff.dot = true;
    });
    return {
      shape: shape, inputs: inputs, ff: ff, mux: mux, muxLabels: muxLabels,
      label: label, anchorName: anchorName, transforms: transforms, nameOpt: nameOpt
    };
  }

  function parseLabelVal(v) {
    var t = unbrace(v).trim().replace(/^\[[^\]]*\]\s*/, '');
    var c = t.indexOf(':');
    if (c < 0) return { pos: '', text: t };
    return { pos: t.slice(0, c).trim().toLowerCase(), text: t.slice(c + 1).trim() };
  }

  function cleanLabel(s) {
    var t = String(s || '');
    t = t.replace(/\\ctikztextnot\s*\{([^{}]*)\}/g, '$1_n');
    t = t.replace(/\\overline\s*\{([^{}]*)\}/g, '$1_n');
    t = t.replace(/\\bar\s*\{([^{}]*)\}/g, '$1_n');
    var prev;
    do {
      prev = t;
      t = t.replace(/\\(mathrm|text|texttt|textit|mathit|textbf|footnotesize|scriptsize|small|strut)\s*\{([^{}]*)\}/g, '$2');
      t = t.replace(/\\(mathrm|text|texttt|textit|mathit|textbf|footnotesize|scriptsize|small|strut)\b\s*/g, '');
    } while (t !== prev);
    t = t.replace(/\$/g, '');
    t = t.replace(/\\_/g, '_');
    t = t.replace(/_\{([^{}]*)\}/g, '_$1');
    t = t.replace(/[{}]/g, '');
    t = t.replace(/\\[A-Za-z]+\s*/g, '');
    t = t.replace(/\s+/g, '_');
    t = t.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return t;
  }

  function identOf(s) {
    var D = lib();
    return D.ident(cleanLabel(s));
  }

  function negated(s) {
    return /\\ctikztextnot|\\overline|\\bar\b/.test(String(s || ''));
  }

  function stackSnap(stack) {
    return stack.map(function (fr) {
      return { ops: fr.ops.slice(), shape: fr.shape };
    });
  }

  function applyOps(p, ops) {
    var x = p.x;
    var y = p.y;
    var i;
    for (i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t === 'shift') { x += op.x; y += op.y; }
      else if (op.t === 'scale') { x *= op.x; y *= op.y; }
      else if (op.t === 'rot') {
        var r = (op.deg || 0) * Math.PI / 180;
        var c = Math.cos(r);
        var sn = Math.sin(r);
        var nx = x * c - y * sn;
        var ny = x * sn + y * c;
        x = nx;
        y = ny;
      }
    }
    return { x: x, y: y };
  }

  function flatOps(stack, linearOnly, shapeOnly) {
    var ops = [];
    var i;
    var k;
    for (i = stack.length - 1; i >= 0; i--) {
      if (shapeOnly && !stack[i].shape) continue;
      var list = stack[i].ops;
      for (k = 0; k < list.length; k++) {
        if (linearOnly && list[k].t === 'shift') continue;
        ops.push(list[k]);
      }
    }
    return ops;
  }

  function scopeFromOptions(list) {
    var ops = [];
    var shape = false;
    list.forEach(function (o) {
      var raw = o.raw.trim().toLowerCase();
      if (raw === 'transform shape') { shape = true; return; }
      if (!o.key) return;
      var k = o.key.toLowerCase();
      var v = unbrace(o.val);
      if (k === 'shift') {
        var inner = v.replace(/^\(|\)$/g, '');
        var parts = splitTop(inner, ',');
        if (parts.length === 2) ops.push({ t: 'shift', x: lengthOf(parts[0]) || 0, y: lengthOf(parts[1]) || 0 });
      } else if (k === 'xshift') ops.push({ t: 'shift', x: lengthOf(v) || 0, y: 0 });
      else if (k === 'yshift') ops.push({ t: 'shift', x: 0, y: lengthOf(v) || 0 });
      else if (k === 'scale') { var sc = parseFloat(v) || 1; ops.push({ t: 'scale', x: sc, y: sc }); }
      else if (k === 'xscale') ops.push({ t: 'scale', x: parseFloat(v) || 1, y: 1 });
      else if (k === 'yscale') ops.push({ t: 'scale', x: 1, y: parseFloat(v) || 1 });
      else if (k === 'rotate') ops.push({ t: 'rot', deg: parseFloat(v) || 0 });
    });
    return { ops: ops, shape: shape };
  }

  function interpretInner(inner) {
    var s = String(inner || '').trim();
    if (!s) return null;
    if (s.charAt(0) === '$') return { bad: 'calc' };
    var shifts = [];
    if (s.charAt(0) === '[') {
      var fake = '[' + s;
      var br = readDelim(fake, 0, '[', ']');
      if (!br) return null;
      var rest = fake.slice(br.next).trim();
      parseOptions(br.inner).forEach(function (o) {
        if (!o.key) return;
        var k = o.key.toLowerCase();
        var v = unbrace(o.val);
        if (k === 'xshift') shifts.push({ t: 'shift', x: lengthOf(v) || 0, y: 0 });
        else if (k === 'yshift') shifts.push({ t: 'shift', x: 0, y: lengthOf(v) || 0 });
        else if (k === 'shift') {
          var inner2 = v.replace(/^\(|\)$/g, '');
          var parts = splitTop(inner2, ',');
          if (parts.length === 2) shifts.push({ t: 'shift', x: lengthOf(parts[0]) || 0, y: lengthOf(parts[1]) || 0 });
        }
      });
      s = rest;
    }
    var bar = s.indexOf('|-');
    var dash = s.indexOf('-|');
    if (bar >= 0 || (dash >= 0 && (bar < 0 || dash < bar))) {
      var op = bar >= 0 && (dash < 0 || bar < dash) ? '|-' : '-|';
      var idx = s.indexOf(op);
      return { inter: op, a: s.slice(0, idx).trim(), b: s.slice(idx + op.length).trim(), shifts: shifts };
    }
    var parts = splitTop(s, ',');
    if (parts.length === 2) {
      var x = lengthOf(parts[0]);
      var y = lengthOf(parts[1]);
      if (x != null && y != null) return { xy: { x: x, y: y }, shifts: shifts };
    }
    var polar = /^\s*([+-]?\d*\.?\d+)\s*:\s*(.+)$/.exec(s);
    if (polar && parts.length === 1) {
      var ang = parseFloat(polar[1]) * Math.PI / 180;
      var rad = lengthOf(polar[2]);
      if (rad == null) return null;
      return { xy: { x: rad * Math.cos(ang), y: rad * Math.sin(ang) }, shifts: shifts };
    }
    var dot = s.indexOf('.');
    if (dot < 0) return { ref: { name: s.trim(), anchor: '' }, shifts: shifts };
    return { ref: { name: s.slice(0, dot).trim(), anchor: s.slice(dot + 1).trim() }, shifts: shifts };
  }

  function parseCoordToken(s, i) {
    var rel = '';
    if (s.slice(i, i + 2) === '++') { rel = 'update'; i += 2; }
    else if (s.charAt(i) === '+' && s.charAt(i + 1) === '(') { rel = 'keep'; i += 1; }
    if (s.charAt(i) !== '(') return null;
    var pr = readDelim(s, i, '(', ')');
    if (!pr) return null;
    return { rel: rel, spec: interpretInner(pr.inner), next: pr.next };
  }

  function parseNodeSpec(s, i) {
    var opts = '';
    var name = '';
    var at = null;
    function skip() { i = skipSpace(s, i); }
    var guard = 0;
    while (guard++ < 8) {
      skip();
      if (s.charAt(i) === '[') {
        var br = readDelim(s, i, '[', ']');
        if (!br) break;
        opts = opts ? (opts + ',' + br.inner) : br.inner;
        i = br.next;
        continue;
      }
      if (s.charAt(i) === '(') {
        var pr = readDelim(s, i, '(', ')');
        if (!pr) break;
        name = pr.inner.trim();
        i = pr.next;
        continue;
      }
      break;
    }
    skip();
    if (wordAt(s, i, 'at')) {
      i = skipSpace(s, i + 2);
      at = parseCoordToken(s, i);
      if (at) i = at.next;
    }
    skip();
    var content = '';
    if (s.charAt(i) === '{') {
      var cr = readDelim(s, i, '{', '}');
      if (cr) { content = cr.inner; i = cr.next; }
    }
    return { opts: opts, name: name, at: at, content: content, next: i };
  }

  function extractEnvs(text) {
    var envs = [];
    var i = 0;
    while (i < text.length) {
      var b = text.indexOf('\\begin{', i);
      if (b < 0) break;
      var m = /^\\begin\{(circuitikz|tikzpicture)\}/.exec(text.slice(b));
      if (!m) { i = b + 7; continue; }
      var kind = m[1];
      var j = b + m[0].length;
      var opt = '';
      if (text.charAt(j) === '[') {
        var br = readDelim(text, j, '[', ']');
        if (br) { opt = br.inner; j = br.next; }
      }
      var endTok = '\\end{' + kind + '}';
      var depth = 1;
      var k = j;
      var bodyEnd = -1;
      while (k < text.length && depth > 0) {
        var nb = text.indexOf('\\begin{' + kind + '}', k);
        var ne = text.indexOf(endTok, k);
        if (ne < 0) break;
        if (nb >= 0 && nb < ne) { depth++; k = nb + kind.length; }
        else {
          depth--;
          if (depth === 0) { bodyEnd = ne; k = ne + endTok.length; break; }
          k = ne + endTok.length;
        }
      }
      if (bodyEnd >= 0) {
        envs.push({ kind: kind, opt: opt, body: text.slice(j, bodyEnd), start: b, bodyStart: j });
        i = k;
      } else i = j;
    }
    return envs;
  }

  function hintBefore(hints, kind, pos) {
    var best = null;
    hints.forEach(function (h) {
      if (h.kind === kind && h.at <= pos && (!best || h.at >= best.at)) best = h;
    });
    return best;
  }

  function fromTex(text) {
    var warnings = [];
    function warn(msg) {
      if (warnings.indexOf(msg) < 0) warnings.push(msg);
    }
    try {
      return fromTexInner(String(text || ''), warnings, warn);
    } catch (err) {
      return { doc: null, error: (err && err.message) ? err.message : String(err), warnings: warnings };
    }
  }

  function fromTexInner(src, warnings, warn) {
    var pre = preprocess(src);
    var text = pre.text;
    var generated = /Generated by Schematic Designer/.test(src);
    var envs = extractEnvs(text);
    if (!envs.length) {
      if (!looksLikeTex(src) && !/\\(node|draw|path)\b/.test(text)) {
        return { doc: null, error: 'No CircuiTikZ nodes or wires found', warnings: warnings };
      }
      envs = [{ kind: 'circuitikz', opt: '', body: text, start: 0, bodyStart: 0 }];
    }
    var pictures = [];
    var sawNode = false;
    var sawWire = false;
    envs.forEach(function (env, envIndex) {
      var ctx = styleAt(text, env.start);
      var picOpts = parseOptions(env.opt);
      picOpts.forEach(function (o) { if (!o.key) consumeStyle(o.raw, ctx); else consumeStyle(o.key + '=' + o.val, ctx); });
      var base = scopeFromOptions(picOpts);
      var stack = [];
      if (base.ops.length || base.shape) stack.push(base);
      var modHint = hintBefore(pre.hints, 'module', env.start);
      var originHint = null;
      pre.hints.forEach(function (h) {
        if (h.kind === 'origin' && h.at >= env.bodyStart && h.at <= env.bodyStart + env.body.length) originHint = h;
      });
      var nodes = [];
      var polylines = [];
      var named = Object.create(null);
      var netHint = '';
      function here(absIndex) {
        var h = null;
        pre.hints.forEach(function (item) {
          if (item.kind === 'net' && item.at <= absIndex && (!h || item.at >= h.at)) h = item;
        });
        if (h) netHint = h.name;
      }
      function skipForeach(s, i) {
        var depth = 0;
        var groups = 0;
        while (i < s.length) {
          var c = s.charAt(i);
          if (c === '\\') { i += 2; continue; }
          if (c === '{') { depth++; i++; continue; }
          if (c === '}') {
            depth--;
            i++;
            if (depth === 0) {
              groups++;
              if (groups >= 2) return i;
            }
            continue;
          }
          i++;
        }
        return i;
      }
      function parsePath(s, drawIt) {
        var i = 0;
        var current = null;
        var pending = '';
        var toOpts = null;
        function pushPoint(tok) {
          var pt = { tok: tok, stack: stackSnap(stack) };
          if (!pending) {
            if (current && current.pts.length) polylines.push(current);
            current = { pts: [pt], hint: netHint, draw: drawIt };
          } else {
            if (!current) current = { pts: [], hint: netHint, draw: drawIt };
            pt.op = pending;
            pt.toOpts = toOpts;
            current.pts.push(pt);
            pending = '';
            toOpts = null;
          }
        }
        while (i < s.length) {
          i = skipSpace(s, i);
          if (i >= s.length) break;
          if (wordAt(s, i, 'node')) {
            var nd = parseNodeSpec(s, i + 4);
            i = nd.next;
            nd.stack = stackSnap(stack);
            nd.floating = !nd.at;
            nd.after = current && current.pts.length ? current.pts[current.pts.length - 1] : null;
            if (nd.after && nd.content) nd.after.labelText = nd.content;
            nodes.push(nd);
            sawNode = true;
            continue;
          }
          if (wordAt(s, i, 'coordinate')) {
            var cd = parseNodeSpec(s, i + 10);
            i = cd.next;
            cd.stack = stackSnap(stack);
            cd.coordinate = true;
            cd.floating = !cd.at;
            cd.after = current && current.pts.length ? current.pts[current.pts.length - 1] : null;
            nodes.push(cd);
            continue;
          }
          if (s.slice(i, i + 2) === '--') { pending = '--'; i += 2; continue; }
          if (s.slice(i, i + 2) === '-|') { pending = '-|'; i += 2; continue; }
          if (s.slice(i, i + 2) === '|-') { pending = '|-'; i += 2; continue; }
          if (s.slice(i, i + 2) === '..') {
            i += 2;
            var nxt = s.indexOf('..', i);
            if (nxt >= 0) i = nxt + 2;
            continue;
          }
          if (wordAt(s, i, 'to')) {
            i = skipSpace(s, i + 2);
            toOpts = null;
            if (s.charAt(i) === '[') {
              var tb = readDelim(s, i, '[', ']');
              if (tb) { toOpts = tb.inner; i = tb.next; }
            }
            pending = 'to';
            continue;
          }
          if (wordAt(s, i, 'cycle')) {
            i += 5;
            if (current && current.pts.length) {
              current.pts.push({ cycle: true, op: pending || '--' });
              pending = '';
            }
            continue;
          }
          if (wordAt(s, i, 'circle') || wordAt(s, i, 'rectangle') || wordAt(s, i, 'arc') || wordAt(s, i, 'grid') || wordAt(s, i, 'ellipse')) {
            var wlen = /^(circle|rectangle|arc|grid|ellipse)/.exec(s.slice(i))[0].length;
            i = skipSpace(s, i + wlen);
            if (s.charAt(i) === '(') {
              var sk = readDelim(s, i, '(', ')');
              if (sk) i = sk.next;
            }
            pending = '';
            continue;
          }
          if (s.charAt(i) === '(' || s.slice(i, i + 2) === '++' || (s.charAt(i) === '+' && s.charAt(i + 1) === '(')) {
            var tok = parseCoordToken(s, i);
            if (!tok) { i++; continue; }
            i = tok.next;
            pushPoint(tok);
            if (drawIt) sawWire = true;
            continue;
          }
          i++;
        }
        if (current && current.pts.length >= 2 && drawIt) polylines.push(current);
        else if (current && current.pts.length >= 2 && !drawIt) { /* nodes only */ }
      }
      var body = env.body;
      var i = 0;
      while (i < body.length) {
        i = skipSpace(body, i);
        if (i >= body.length) break;
        here(env.bodyStart + i);
        if (body.slice(i, i + 13) === '\\begin{scope}') {
          i += 13;
          var sop = '';
          if (body.charAt(i) === '[') {
            var sb = readDelim(body, i, '[', ']');
            if (sb) { sop = sb.inner; i = sb.next; }
          }
          var fr = scopeFromOptions(parseOptions(sop));
          parseOptions(sop).forEach(function (o) {
            if (!o.key) consumeStyle(o.raw, ctx);
          });
          stack.push(fr);
          continue;
        }
        if (body.slice(i, i + 11) === '\\end{scope}') {
          i += 11;
          if (stack.length) stack.pop();
          continue;
        }
        var cmd = /^\\([A-Za-z]+)/.exec(body.slice(i));
        if (cmd && (cmd[1] === 'ctikzset' || cmd[1] === 'tikzset')) {
          i += cmd[0].length;
          i = skipSpace(body, i);
          if (body.charAt(i) === '{') {
            var cb = readDelim(body, i, '{', '}');
            if (cb) {
              if (cmd[1] === 'ctikzset' || cmd[1] === 'tikzset') applyCtikz(cb.inner, ctx);
              i = cb.next;
            }
          }
          if (body.charAt(i) === ';') i++;
          continue;
        }
        if (cmd && (cmd[1] === 'foreach' || cmd[1] === 'newcommand' || cmd[1] === 'renewcommand' || cmd[1] === 'def')) {
          warn('Skipped \\' + cmd[1]);
          i = skipForeach(body, i + cmd[0].length);
          continue;
        }
        if (cmd && (cmd[1] === 'pic' || cmd[1] === 'matrix')) {
          warn('Skipped \\' + cmd[1]);
        }
        var end = i;
        var b = 0;
        var k = 0;
        var p = 0;
        while (end < body.length) {
          var ch = body.charAt(end);
          if (ch === '\\') { end += 2; continue; }
          if (ch === '{') b++;
          else if (ch === '}') b = Math.max(0, b - 1);
          else if (ch === '[') k++;
          else if (ch === ']') k = Math.max(0, k - 1);
          else if (ch === '(') p++;
          else if (ch === ')') p = Math.max(0, p - 1);
          if (ch === ';' && !b && !k && !p) break;
          end++;
        }
        var stmt = body.slice(i, end);
        i = end < body.length ? end + 1 : end;
        var sm = /^\s*\\([A-Za-z]+)/.exec(stmt);
        if (!sm) continue;
        var name = sm[1];
        var rest = stmt.slice(sm[0].length);
        if (name === 'node' || name === 'coordinate') {
          var nds = parseNodeSpec(rest, 0);
          nds.stack = stackSnap(stack);
          nds.coordinate = name === 'coordinate';
          nds.styleCtx = { style: ctx.style, originCenter: ctx.originCenter };
          nodes.push(nds);
          sawNode = true;
          var extra = rest.slice(nds.next);
          var ei = 0;
          while (ei < extra.length) {
            ei = skipSpace(extra, ei);
            if (!wordAt(extra, ei, 'node')) break;
            var more = parseNodeSpec(extra, ei + 4);
            ei = more.next;
            more.stack = stackSnap(stack);
            more.styleCtx = { style: ctx.style, originCenter: ctx.originCenter };
            more.hostName = nds.name;
            nodes.push(more);
          }
        } else if (name === 'draw' || name === 'path' || name === 'fill' || name === 'filldraw') {
          var ri = 0;
          ri = skipSpace(rest, ri);
          var popts = '';
          if (rest.charAt(ri) === '[') {
            var pb = readDelim(rest, ri, '[', ']');
            if (pb) { popts = pb.inner; ri = pb.next; }
          }
          var drawIt = name === 'draw' || name === 'filldraw';
          if (name === 'path' || name === 'fill') {
            parseOptions(popts).forEach(function (o) { if (o.raw === 'draw' || o.key === 'draw') drawIt = true; });
          }
          parsePath(rest.slice(ri), drawIt);
        } else if (name === 'usepgflibrary' || name === 'usetikzlibrary' || name === 'usepackage') {
          /* ignore */
        } else if (name !== 'begin' && name !== 'end') {
          if (name === 'foreach' || name === 'pic' || name === 'matrix') warn('Skipped \\' + name);
        }
      }
      pictures.push({
        name: modHint ? modHint.name : (envIndex === 0 ? 'top' : ('top_' + (envIndex + 1))),
        origin: originHint,
        nodes: nodes,
        polylines: polylines,
        style: ctx.style,
        originCenter: ctx.originCenter
      });
    });
    if (!sawNode && !sawWire) return { doc: null, error: 'No CircuiTikZ nodes or wires found', warnings: warnings };
    return assemble(pictures, warnings, warn, generated);
  }

  function resolvePictures(pictures, warn) {
    pictures.forEach(function (pic) {
      var byName = Object.create(null);
      var pending = pic.nodes.slice();
      var guard = 0;
      while (pending.length && guard++ < pending.length + 2) {
        var next = [];
        pending.forEach(function (nd) {
          if (nd.at && nd.at.spec && nd.at.spec.ref && !byName[nd.at.spec.ref.name] && !nd.floating) {
            next.push(nd);
            return;
          }
          nd.abs = resolveAt(nd, byName, pic);
          if (nd.name) byName[nd.name] = nd;
        });
        if (next.length === pending.length) {
          next.forEach(function (nd) {
            nd.abs = nd.abs || { x: 0, y: 0 };
            if (nd.name) byName[nd.name] = nd;
          });
          break;
        }
        pending = next;
      }
      pic.byName = byName;
      pic.polylines.forEach(function (pl) {
        var cur = { x: 0, y: 0 };
        var start = null;
        pl.abs = [];
        pl.pts.forEach(function (pt) {
          if (pt.cycle && start) {
            pl.abs.push({ x: start.x, y: start.y, op: pt.op || '--' });
            return;
          }
          var got = resolveTok(pt.tok, pt.stack, cur, byName, warn);
          if (!got) return;
          var pos = got.point;
          if (pt.op === '|-' && pl.abs.length) {
            var prev = pl.abs[pl.abs.length - 1];
            pl.abs.push({ x: prev.x, y: pos.y });
          } else if (pt.op === '-|' && pl.abs.length) {
            var prev2 = pl.abs[pl.abs.length - 1];
            pl.abs.push({ x: pos.x, y: prev2.y });
          }
          var item = { x: pos.x, y: pos.y, bind: got.bind || null };
          if (pt.labelText) item.label = identOf(pt.labelText);
          pl.abs.push(item);
          if (!start) start = item;
          if (!pt.tok || pt.tok.rel !== 'keep') cur = { x: pos.x, y: pos.y };
          if (got.bind && got.bind.anchor && got.bind.anchor !== 'center') cur = { x: pos.x, y: pos.y };
          else if (got.center && (!pt.tok || !pt.tok.rel)) cur = got.center;
          if (pt.toOpts) item.toOpts = pt.toOpts;
        });
      });
    });
  }

  function resolveAt(nd, byName, pic) {
    if (nd.floating && nd.after && nd.after.tok) {
      var fake = resolveTok(nd.after.tok, nd.stack, { x: 0, y: 0 }, byName, function () {});
      return fake ? fake.point : { x: 0, y: 0 };
    }
    if (!nd.at) return { x: 0, y: 0 };
    var got = resolveTok(nd.at, nd.stack, { x: 0, y: 0 }, byName, function () {});
    return got ? got.point : { x: 0, y: 0 };
  }

  function resolveTok(tok, stack, cur, byName, warn) {
    if (!tok || !tok.spec) return null;
    var spec = tok.spec;
    if (spec.bad) { warn('Skipped calc coordinate'); return null; }
    var point = null;
    var bind = null;
    var center = null;
    if (spec.xy) point = applyOps(spec.xy, flatOps(stack, false, false));
    else if (spec.ref) {
      var host = byName[spec.ref.name];
      if (!host) return null;
      var anch = spec.ref.anchor || '';
      if (!anch || anch === 'center') {
        point = host.abs || { x: 0, y: 0 };
        center = point;
        bind = { name: spec.ref.name, anchor: anch || 'center' };
      } else {
        point = pinWorld(host, anch);
        bind = { name: spec.ref.name, anchor: anch };
        center = host.abs || point;
      }
    } else if (spec.inter) {
      var A = resolveTok({ spec: interpretInner(spec.a), rel: '' }, stack, cur, byName, warn);
      var B = resolveTok({ spec: interpretInner(spec.b), rel: '' }, stack, cur, byName, warn);
      if (!A || !B) return null;
      point = spec.inter === '|-' ? { x: A.point.x, y: B.point.y } : { x: B.point.x, y: A.point.y };
    }
    if (!point) return null;
    if (tok.rel) {
      var delta = applyOps(spec.xy || { x: 0, y: 0 }, flatOps(stack, true, false));
      point = { x: cur.x + delta.x, y: cur.y + delta.y };
      bind = null;
    }
    if (spec.shifts && spec.shifts.length) point = applyOps(point, spec.shifts);
    return { point: point, bind: bind, center: center || point };
  }

  function pinWorld(nd, anchorName) {
    var opts = nd._aopts || {};
    var shape = nd._shape || 'ocirc';
    var off = anchor(shape, anchorName, opts) || { x: 0, y: 0 };
    var ash = { x: 0, y: 0 };
    if (nd._anchorOpt && nd._anchorOpt !== 'center') ash = anchor(shape, nd._anchorOpt, opts) || ash;
    var p = { x: off.x - ash.x, y: off.y - ash.y };
    var i;
    for (i = nd._transforms.length - 1; i >= 0; i--) p = applyOps(p, [nd._transforms[i]]);
    p = applyOps(p, flatOps(nd.stack || [], true, true));
    return { x: (nd.abs ? nd.abs.x : 0) + p.x, y: (nd.abs ? nd.abs.y : 0) + p.y };
  }

  function decorateNode(nd, style, originCenter) {
    var info = nd.coordinate ? classifyOptions([]) : classifyOptions(parseOptions(nd.opts || ''));
    if (nd.styleCtx) { style = nd.styleCtx.style; originCenter = nd.styleCtx.originCenter; }
    var shape = info.shape;
    var st = styleOf(shape) || style || 'american';
    var kind = kindOfShape(shape);
    if (!kind && shape === 'schmitt') kind = 'buffer';
    if (!kind && shape === 'invschmitt') kind = 'not';
    nd._shape = shape || '';
    nd._style = st;
    nd._origin = originCenter;
    nd._inputs = info.inputs || (MULTI[kind] ? 2 : 1);
    nd._transforms = info.transforms || [];
    nd._anchorOpt = info.anchorName || '';
    nd._ff = info.ff || {};
    nd._mux = info.mux;
    nd._muxLabels = info.muxLabels || {};
    nd._label = info.label;
    nd._content = nd.content || '';
    nd._nameOpt = info.nameOpt || '';
    nd._kind = kind;
    nd._aopts = {
      style: st,
      inputs: nd._inputs,
      originCenter: originCenter,
      mux: muxObject(info.mux)
    };
    if ((kind === 'schmitt' || shape === 'schmitt') && !/#/.test('')) warnLater(nd, 'schmitt');
    return nd;
  }

  var laterWarnings = [];
  function warnLater(nd, msg) { laterWarnings.push(msg); nd._warn = msg; }

  function muxObject(map) {
    if (!map) return null;
    function n(k, d) { var v = parseFloat(map[k]); return isFinite(v) ? v : d; }
    return { NL: n('NL', 8), NR: n('NR', 1), NB: n('NB', 0), NT: n('NT', 0), w: n('w', 3), Lh: n('Lh', 8), Rh: n('Rh', 6) };
  }

  function shortLines(content) {
    var t = String(content || '').trim();
    var m = /\\shortstack\s*\{([\s\S]*)\}\s*$/.exec(t);
    if (m) t = m[1];
    return t.split(/\\\\/).map(function (line) { return identOf(line); }).filter(Boolean);
  }

  function assemble(pictures, warnings, warn, generated) {
    laterWarnings = [];
    resolvePrepare(pictures, warn);
    resolvePictures(pictures, warn);
    laterWarnings.forEach(function (m) { warn(m === 'schmitt' ? 'Schmitt port imported as a buffer or inverter' : m); });
    var D = lib();
    var doc = D.blank();
    doc.modules = [];
    var seq = 1;
    function nid(prefix) { seq += 1; return prefix + seq; }
    var modules = [];
    pictures.forEach(function (pic) {
      var mod = { id: nid('m'), name: identOf(pic.name) || 'top', parts: [], nets: [] };
      var usedNames = Object.create(null);
      function take(want, type) {
        var idn = identOf(want || '');
        if (idn && !usedNames[idn] && !/^N\d+$/.test(want || '')) {
          usedNames[idn] = 1;
          return idn;
        }
        var nm = D.autoName(mod, type);
        usedNames[nm] = 1;
        return nm;
      }
      var partOfNode = Object.create(null);
      var pinMap = Object.create(null);
      function addPart(type, name, extra) {
        var part = { id: nid('p'), type: type, name: take(name, type), x: 0, y: 0 };
        if (extra) {
          var k;
          for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) part[k] = extra[k];
        }
        mod.parts.push(part);
        usedNames[part.name] = 1;
        return part;
      }
      pic.nodes.forEach(function (nd) {
        if (nd.hostName && !nd._shape) {
          var host = pic.byName[nd.hostName];
          if (host) {
            var lab = identOf(nd._content || '');
            if (lab) host._extra = lab;
          }
          return;
        }
        if (nd.at && nd.at.spec && nd.at.spec.ref && !nd._shape) {
          var host2 = pic.byName[nd.at.spec.ref.name];
          if (host2) {
            var lab2 = identOf(nd._content || '');
            if (lab2) host2._extra = lab2;
          }
          return;
        }
        var kind = nd._kind;
        var shape = nd._shape;
        if (kind === 'schmitt') { kind = 'buffer'; warn('Schmitt port imported as a buffer'); }
        if (kind === 'invschmitt') { kind = 'not'; warn('Inverting Schmitt port imported as a NOT'); }
        if (MULTI[kind] || kind === 'not' || kind === 'buffer') {
          var nIn = nd._inputs || (MULTI[kind] ? 2 : 1);
          pic.polylines.forEach(function (pl) {
            (pl.abs || []).forEach(function (pt) {
              if (!pt.bind || pt.bind.name !== nd.name) return;
              var mm = /^(?:in|bin) (\d+)$/.exec(pt.bind.anchor || '');
              if (mm) nIn = Math.max(nIn, parseInt(mm[1], 10));
            });
          });
          var type = kind === 'buffer' ? 'buf' : kind;
          if (MULTI[type] && nIn === 1) {
            type = INVERTING[type] ? 'not' : 'buf';
            warn('1-input ' + kind.toUpperCase() + ' imported as ' + type.toUpperCase());
          }
          if (MULTI[type] && nIn > 8) {
            var tree = widen(type, nIn);
            var subs = [];
            tree.gates.forEach(function (g, gi) {
              var part = addPart(g.type, gi === tree.root ? (nd.name || nd._nameOpt) : ((nd.name || type) + '_' + (gi + 2)), { inputs: g.fanin.length });
              subs.push(part);
            });
            tree.gates.forEach(function (g, gi) {
              g.fanin.forEach(function (src, idx) {
                if (src.t === 'g') {
                  var net = { id: nid('n'), name: '', pins: [
                    { part: subs[src.i].id, pin: 'Y' },
                    { part: subs[gi].id, pin: inName(idx, g.fanin.length) }
                  ] };
                  mod.nets.push(net);
                }
              });
            });
            partOfNode[nd.name || ('#')] = subs[tree.root];
            nd._part = subs[tree.root];
            nd._subs = subs;
            nd._tree = tree;
            pinMap[nd.name || nd.id] = function (anch) {
              if (anch === 'out' || anch === 'bout') return { part: subs[tree.root].id, pin: 'Y' };
              var m = /^(?:in|bin) (\d+)$/.exec(anch || '');
              var n = m ? parseInt(m[1], 10) : (anch === 'in' || anch === 'bin' ? 1 : 0);
              if (!n) return null;
              var loc = tree.locate[n];
              if (!loc) return null;
              return { part: subs[loc.gate].id, pin: inName(loc.index, tree.gates[loc.gate].fanin.length) };
            };
            return;
          }
          var part = addPart(type, nd.name || nd._nameOpt, MULTI[type] ? { inputs: Math.max(2, Math.min(8, nIn)) } : null);
          nd._part = part;
          partOfNode[nd.name] = part;
          pinMap[nd.name] = function (anch) {
            if (type === 'not' || type === 'buf') {
              if (anch === 'out' || anch === 'bout') return { part: part.id, pin: 'Y' };
              return { part: part.id, pin: 'A' };
            }
            if (anch === 'out' || anch === 'bout') return { part: part.id, pin: 'Y' };
            var m2 = /^(?:in|bin) (\d+)$/.exec(anch || '');
            var idx = m2 ? parseInt(m2[1], 10) : 1;
            return { part: part.id, pin: inName(idx - 1, part.inputs || 2) };
          };
          return;
        }
        if (/^flipflop/.test(shape) || shape === 'latch' || kind === 'flipflop') {
          var which = (/flipflop\s+([A-Za-z]+)/.exec(shape) || [])[1] || '';
          var def = (nd._ff && nd._ff.def) || {};
          var t1 = def.t1 || (which === 'D' || !which ? 'D' : which);
          var simple = !which || which === 'D' || t1 === 'D';
          if (!simple || shape === 'latch' || which === 'T' || which === 'JK' || which === 'SR') {
            var ports = ffBlockPorts(which || 'D', def);
            var partb = addPart('block', nd.name || nd._nameOpt, {
              ref: '', ext: shape === 'latch' ? 'latch' : ('flipflop_' + (which || 'D')), ports: ports
            });
            nd._part = partb;
            nd._ffBlock = true;
            nd._ffPorts = ports;
            warn((shape === 'latch' ? 'Latch' : ('Flip-flop ' + (which || ''))) + ' imported as a module block');
            pinMap[nd.name] = function (anch) {
              var hit = null;
              ports.forEach(function (p) { if (p.anchor === anch) hit = p; });
              if (!hit) return null;
              return { part: partb.id, pin: hit.name };
            };
            return;
          }
          var partf = addPart('dff', nd.name || nd._nameOpt, {
            clkEdge: String(def.n3) === '1' ? 'neg' : 'pos',
            hasRst: false,
            rstEdge: 'pos',
            rstVal: 0
          });
          nd._part = partf;
          nd._dff = true;
          nd._def = def;
          pinMap[nd.name] = function (anch) {
            if (anch === 'pin 1') return { part: partf.id, pin: 'D' };
            if (anch === 'pin 3') return { part: partf.id, pin: 'CLK' };
            if (anch === 'pin 6') return { part: partf.id, pin: 'Q' };
            if (anch === 'pin 4') return { part: partf.id, pin: 'QBAR', virtual: true };
            if (anch === 'down') return { part: partf.id, pin: 'RST' };
            if (anch === 'up') return { part: partf.id, pin: 'SET' };
            return null;
          };
          return;
        }
        if (shape === 'muxdemux' || kind === 'muxdemux') {
          var md = nd._aopts.mux || muxDef(null);
          var labels = nd._muxLabels || {};
          var isMux = md.NL === 2 && md.NR === 1 && (md.NB === 1 || md.NT === 1);
          var swap = String(labels.L1) === '1' && String(labels.L2) === '0';
          if (isMux) {
            var partm = addPart('mux', nd.name || nd._nameOpt, {});
            nd._part = partm;
            pinMap[nd.name] = function (anch) {
              if (anch === 'lpin 1') return { part: partm.id, pin: swap ? 'D1' : 'D0' };
              if (anch === 'lpin 2') return { part: partm.id, pin: swap ? 'D0' : 'D1' };
              if (anch === 'rpin 1') return { part: partm.id, pin: 'Y' };
              if (anch === 'bpin 1' || anch === 'tpin 1') return { part: partm.id, pin: 'S' };
              return null;
            };
            return;
          }
          var ports2 = [];
          var bi;
          for (bi = 1; bi <= md.NL; bi++) ports2.push({ name: identOf(labels['L' + bi]) || ('in' + bi), dir: 'input', anchor: 'lpin ' + bi });
          for (bi = 1; bi <= md.NB; bi++) ports2.push({ name: identOf(labels['B' + bi]) || ('b' + bi), dir: 'input', anchor: 'bpin ' + bi });
          for (bi = 1; bi <= md.NT; bi++) ports2.push({ name: identOf(labels['T' + bi]) || ('t' + bi), dir: 'input', anchor: 'tpin ' + bi });
          for (bi = 1; bi <= md.NR; bi++) ports2.push({ name: identOf(labels['R' + bi]) || ('out' + bi), dir: 'output', anchor: 'rpin ' + bi });
          var lines = shortLines(nd._content);
          var inst = lines.length ? lines[0] : '';
          var ext = lines.length > 1 ? lines[lines.length - 1] : (lines[0] || 'block');
          if (lines.length === 1) inst = '';
          var partk = addPart('block', inst || nd.name || nd._nameOpt, { ref: '', ext: ext || 'block', ports: ports2.map(function (p) { return { name: p.name, dir: p.dir }; }) });
          nd._part = partk;
          nd._blockPorts = ports2;
          nd._ext = ext;
          pinMap[nd.name] = function (anch) {
            var hit = null;
            ports2.forEach(function (p) { if (p.anchor === anch) hit = p; });
            if (!hit) return null;
            return { part: partk.id, pin: hit.name };
          };
          return;
        }
        if (shape === 'vcc' || SUPPLY[shape] === 'c1') {
          nd._part = addPart('c1', nd.name || nd._nameOpt, {});
          pinMap[nd.name] = function () { return { part: nd._part.id, pin: 'Y' }; };
          return;
        }
        if (SUPPLY[shape] === 'c0') {
          nd._part = addPart('c0', nd.name || nd._nameOpt, {});
          pinMap[nd.name] = function () { return { part: nd._part.id, pin: 'Y' }; };
          return;
        }
        if (OPEN_POLE[shape]) {
          nd._port = true;
          var plabel = nd._extra || (nd._label && identOf(nd._label.text)) || '';
          if (!plabel && nd.name && !/^N\d+$/.test(nd.name)) plabel = identOf(nd.name);
          nd._portName = plabel;
          nd._portPos = (nd._label && nd._label.pos) || '';
          nd._part = { id: nid('p'), type: 'in', name: '', x: 0, y: 0, _portNode: nd };
          mod.parts.push(nd._part);
          if (nd.name) pinMap[nd.name] = function () { return { part: nd._part.id, pin: 'POLE' }; };
          return;
        }
        if (shape === 'circ') {
          nd._circ = true;
          return;
        }
        if (shape && !nd.coordinate) warn('Skipped shape ' + shape);
      });
      var groups = connect(pic, pinMap, warn);
      groups.forEach(function (g) {
        var ups = g.pins.filter(function (p) { return p.pin === 'SET'; });
        var downs = g.pins.filter(function (p) { return p.pin === 'RST'; });
        if (ups.length && downs.length) {
          warn('Flip-flop has both set and reset; keeping reset');
          g.pins = g.pins.filter(function (p) { return p.pin !== 'SET'; });
        }
      });
      function pinUsed(part, pin) {
        return groups.some(function (g) {
          var hit = g.pins.some(function (p) { return p.part === part.id && p.pin === pin; });
          return hit && (g.pins.length >= 2 || (g.dangling && g.dangling.length));
        });
      }
      pic.nodes.forEach(function (nd) {
        if (!nd._dff || !nd._part) return;
        var part = nd._part;
        var def = nd._def || {};
        var hasDown = pinUsed(part, 'RST');
        var hasUp = pinUsed(part, 'SET');
        if (hasDown) {
          part.hasRst = true;
          part.rstVal = 0;
          part.rstEdge = (String(def.nd) === '1' || negated(def.td)) ? 'neg' : 'pos';
        } else if (hasUp) {
          part.hasRst = true;
          part.rstVal = 1;
          part.rstEdge = (String(def.nu) === '1' || negated(def.tu)) ? 'neg' : 'pos';
          groups.forEach(function (g) {
            g.pins.forEach(function (p) { if (p.part === part.id && p.pin === 'SET') p.pin = 'SET'; });
          });
        }
      });
      groups.forEach(function (g) {
        var qbars = g.pins.filter(function (p) { return p.pin === 'QBAR'; });
        if (!qbars.length || (g.pins.length < 2 && !(g.dangling && g.dangling.length))) return;
        qbars.forEach(function (qb) {
          var dff = null;
          mod.parts.forEach(function (p) { if (p.id === qb.part) dff = p; });
          if (!dff) return;
          var inv = addPart('not', (dff.name || 'q') + '_n', {});
          inv._near = dff;
          g.pins = g.pins.filter(function (p) { return p !== qb; });
          g.pins.push({ part: inv.id, pin: 'Y' });
          var qnet = null;
          groups.forEach(function (gg) {
            if (gg.pins.some(function (p) { return p.part === dff.id && p.pin === 'Q'; })) qnet = gg;
          });
          if (qnet) qnet.pins.push({ part: inv.id, pin: 'A' });
          else groups.push({ pins: [{ part: dff.id, pin: 'Q' }, { part: inv.id, pin: 'A' }], hint: '', dangling: [] });
          warn('Added a NOT for Q-bar');
        });
      });
      pic.nodes.forEach(function (nd) {
        if (!nd._port || nd._part) return;
        var label = nd._extra || '';
        nd._portName = label;
        nd._portPos = '';
        nd._part = { id: nid('p'), type: 'in', name: '', x: 0, y: 0, _portNode: nd };
        mod.parts.push(nd._part);
      });
      groups.forEach(function (g) {
        g.dangling.forEach(function (end) {
          if (g.pins.some(function (p) { return Math.abs(p.x - end.x) < 0.05 && Math.abs(p.y - end.y) < 0.05; })) return;
          var hasPort = g.pins.some(function (p) {
            var part = null;
            mod.parts.forEach(function (q) { if (q.id === p.part) part = q; });
            return part && part._portNode;
          });
          if (hasPort && g.pins.length) return;
          var label = end.label || '';
          var port = { id: nid('p'), type: 'in', name: '', x: 0, y: 0, _portNode: { abs: end, _portName: label, _portPos: '', _auto: true } };
          mod.parts.push(port);
          g.pins.push({ part: port.id, pin: 'POLE', x: end.x, y: end.y });
          if (label) warn('Added port ' + label);
          else warn('Added a port at an open wire');
        });
      });
      groups.forEach(function (g) {
        var drivers = false;
        var loads = false;
        g.pins.forEach(function (p) {
          var part = null;
          mod.parts.forEach(function (q) { if (q.id === p.part) part = q; });
          if (!part || part._portNode) return;
          if (p.pin === 'Y' || p.pin === 'Q' || (part.type === 'block' && blockDir(part, p.pin) === 'output') || part.type === 'c0' || part.type === 'c1') drivers = true;
          else loads = true;
        });
        var ports = [];
        g.pins.forEach(function (p) {
          var part = null;
          mod.parts.forEach(function (q) { if (q.id === p.part) part = q; });
          if (part && part._portNode) ports.push(part);
        });
        ports.sort(function (a, b) { return (a._portNode.abs.x || 0) - (b._portNode.abs.x || 0); });
        ports.forEach(function (part, idx) {
          var nd = part._portNode;
          var dir = 'in';
          if (drivers) dir = 'out';
          else if (loads) dir = 'in';
          else if (ports.length > 1) dir = idx === 0 ? 'in' : 'out';
          else if (nd._portPos === 'left' || nd._portPos === 'west') dir = 'in';
          else if (nd._portPos === 'right' || nd._portPos === 'east') dir = 'out';
          else dir = nd.abs.x <= picCenter(pic) ? 'in' : 'out';
          part.type = dir === 'out' ? 'out' : 'in';
          var nm = nd._extra || nd._portName || D.autoName(mod, part.type);
          if (usedNames[nm]) nm = D.autoName(mod, part.type);
          part.name = nm;
          usedNames[nm] = 1;
        });
        var real = [];
        g.pins.forEach(function (p) {
          var part = null;
          mod.parts.forEach(function (q) { if (q.id === p.part) part = q; });
          if (!part) return;
          var pin = p.pin;
          if (pin === 'POLE') pin = part.type === 'out' ? 'A' : 'Y';
          if (pin === 'QBAR') return;
          if (part.type === 'dff' && pin === 'RST' && part.rstVal) pin = 'SET';
          if (part.type === 'dff' && p.pin === 'RST' && !part.hasRst) return;
          if (part.type === 'dff' && p.pin === 'SET' && !(part.hasRst && part.rstVal)) return;
          real.push({ part: part.id, pin: pin });
        });
        if (real.length >= 2) {
          var hint = g.hint || '';
          var portHit = real.some(function (r) {
            var part = null;
            mod.parts.forEach(function (q) { if (q.id === r.part && (q.type === 'in' || q.type === 'out')) part = q; });
            return part && part.name === identOf(hint);
          });
          mod.nets.push({ id: nid('n'), name: portHit ? '' : (identOf(hint) || ''), pins: real });
        }
      });
      modules.push(mod);
    });
    var byModName = Object.create(null);
    modules.forEach(function (m) { byModName[m.name] = m.id; });
    modules.forEach(function (m) {
      m.parts.forEach(function (p) {
        if (p.type === 'block' && p.ext && byModName[p.ext]) {
          p.ref = byModName[p.ext];
          p.ext = '';
          p.ports = [];
        }
      });
    });
    placeAll(pictures, modules, generated);
    doc.modules = modules.length ? modules : D.blank().modules;
    doc.seq = seq + 1;
    doc.active = pickTop(doc.modules);
    D.prune(doc);
    return { doc: doc, warnings: warnings };
  }

  function picCenter(pic) {
    var xs = [];
    pic.nodes.forEach(function (nd) { if (nd.abs) xs.push(nd.abs.x); });
    if (!xs.length) return 0;
    xs.sort(function (a, b) { return a - b; });
    return xs[Math.floor(xs.length / 2)];
  }

  function blockDir(part, pin) {
    var hit = 'input';
    (part.ports || []).forEach(function (p) { if (p.name === pin) hit = p.dir; });
    return hit;
  }

  function ffBlockPorts(which, def) {
    var ports = [];
    function add(anchor, name, dir) { ports.push({ anchor: anchor, name: identOf(name) || name, dir: dir }); }
    add('pin 1', (def && def.t1) || 'D', 'input');
    add('pin 2', (def && def.t2) || 'T', 'input');
    add('pin 3', 'CLK', 'input');
    add('pin 6', (def && def.t6) || 'Q', 'output');
    add('pin 5', (def && def.t5) || 'Q5', 'output');
    add('pin 4', 'Qn', 'output');
    add('up', (def && def.tu) || 'SET', 'input');
    add('down', (def && def.td) || 'RST', 'input');
    void which;
    return ports;
  }

  function widen(kind, n) {
    var gates = [];
    var pending = [];
    var i;
    for (i = 1; i <= n; i++) pending.push({ t: 'src', i: i });
    while (pending.length > 8) {
      var take = pending.splice(0, 8);
      var gi = gates.length;
      gates.push({ type: INNER[kind], fanin: take });
      pending.unshift({ t: 'g', i: gi });
    }
    var root = gates.length;
    gates.push({ type: kind, fanin: pending });
    var locate = {};
    gates.forEach(function (g, gi) {
      g.fanin.forEach(function (src, idx) {
        if (src.t === 'src') locate[src.i] = { gate: gi, index: idx };
      });
    });
    return { gates: gates, root: root, locate: locate };
  }

  function connect(pic, pinMap, warn) {
    var parent = Object.create(null);
    function id(k) {
      if (!parent[k]) parent[k] = k;
      var p = k;
      while (parent[p] !== p) p = parent[p];
      var c = k;
      while (parent[c] !== p) { var n = parent[c]; parent[c] = p; c = n; }
      return p;
    }
    function uni(a, b) { parent[id(a)] = id(b); }
    var pins = [];
    function anchorsOf(nd) {
      var part = nd._part;
      if (!part) return [];
      if (nd._port || part._portNode || part.type === 'c0' || part.type === 'c1') return ['center'];
      if (nd._tree) {
        var wide = ['out'];
        var n = nd._inputs || 2;
        var t;
        for (t = 1; t <= n; t++) wide.push('in ' + t);
        return wide;
      }
      if (part.type === 'not' || part.type === 'buf') return ['in', 'out'];
      if (part.type === 'dff') return ['pin 1', 'pin 3', 'pin 6', 'up', 'down', 'pin 4'];
      if (part.type === 'mux') return ['lpin 1', 'lpin 2', 'rpin 1', 'bpin 1', 'tpin 1'];
      if (MULTI[part.type]) {
        var list = ['out'];
        var nIn = part.inputs || 2;
        var iIn;
        for (iIn = 1; iIn <= nIn; iIn++) list.push('in ' + iIn);
        return list;
      }
      if (nd._blockPorts) return nd._blockPorts.map(function (p) { return p.anchor; });
      if (nd._ffPorts) return nd._ffPorts.map(function (p) { return p.anchor; });
      return [];
    }
    function ensurePin(bind) {
      if (!bind || !bind.name) return null;
      var fn = pinMap[bind.name];
      if (!fn) {
        var nd = pic.byName[bind.name];
        if (nd && nd._port) {
          fn = function () { return { part: nd._part.id, pin: 'POLE' }; };
        } else if (nd && (nd._circ || (!nd._shape && !nd._part))) return null;
        else return null;
      }
      var spec = fn(bind.anchor || 'center');
      if (!spec) return null;
      var key = 'pin:' + spec.part + ':' + spec.pin;
      if (!parent[key]) {
        parent[key] = key;
        pins.push({ key: key, part: spec.part, pin: spec.pin, x: 0, y: 0 });
      }
      return key;
    }
    pic.nodes.forEach(function (nd) {
      if (!nd._part) return;
      var fn = (nd.name && pinMap[nd.name]) || null;
      if (!fn && nd._port) fn = function () { return { part: nd._part.id, pin: 'POLE' }; };
      if (!fn) return;
      anchorsOf(nd).forEach(function (anch) {
        var spec = fn(anch);
        if (!spec) return;
        var key = 'pin:' + spec.part + ':' + spec.pin;
        if (parent[key]) return;
        var pos = (spec.pin === 'POLE' || nd._port || (nd._part && (nd._part.type === 'c0' || nd._part.type === 'c1')))
          ? (nd.abs || { x: 0, y: 0 })
          : pinWorld(nd, anch);
        parent[key] = key;
        pins.push({ key: key, part: spec.part, pin: spec.pin, x: pos.x, y: pos.y });
      });
    });
    pic.polylines.forEach(function (pl, idx) {
      var pk = 'wire:' + idx;
      var abs = pl.abs || [];
      abs.forEach(function (pt) {
        if (pt.toOpts) {
          var opts = parseOptions(pt.toOpts);
          var comp = false;
          var poleStart = false;
          var poleEnd = false;
          opts.forEach(function (o) {
            var raw = o.raw.trim();
            if (!raw || raw === 'short') return;
            if (/^[.*osd]?-[.*osd]?$/.test(raw)) {
              if (raw.charAt(0) === 'o' || raw.charAt(0) === 'd' || raw.charAt(0) === '*') poleStart = raw.charAt(0) === 'o' || raw.charAt(0) === 'd';
              if (/[od*]$/.test(raw) && raw.length > 1) poleEnd = raw.charAt(raw.length - 1) !== '*';
              return;
            }
            if (o.key) return;
            if (!IGNORE_OPT[raw]) comp = true;
          });
          if (comp) {
            warn('Skipped a CircuiTikZ bipole');
            pt.cut = true;
          }
          void poleStart;
          void poleEnd;
        }
      });
      var chains = [];
      var cur = abs.length ? [abs[0]] : [];
      var ci;
      for (ci = 1; ci < abs.length; ci++) {
        if (abs[ci].cut) {
          if (cur.length >= 2) chains.push(cur);
          cur = [abs[ci]];
        } else cur.push(abs[ci]);
      }
      if (cur.length >= 2) chains.push(cur);
      pl._subs = [];
      chains.forEach(function (ch, n) {
        var key = pk + ':' + n;
        parent[key] = key;
        ch.forEach(function (pt) {
          if (!pt.bind) return;
          var pinKey = ensurePin(pt.bind);
          if (pinKey) uni(key, pinKey);
        });
        pl._subs.push({ key: key, abs: ch });
      });
      pl._key = pl._subs.length ? pl._subs[0].key : pk;
      if (!pl._subs.length) parent[pk] = pk;
    });
    pins.forEach(function (pin) {
      pic.nodes.forEach(function (nd) {
        if (!nd._part || nd._part.id !== pin.part) return;
        var anch = pin.pin === 'POLE' ? 'center' : reverseAnchor(nd, pin.pin);
        if (!anch && pin.pin !== 'POLE' && pin.pin !== 'QBAR' && pin.pin !== 'RST' && pin.pin !== 'SET') return;
        var pos = pin.pin === 'POLE' || !anch ? (nd.abs || { x: 0, y: 0 }) : pinWorld(nd, anch);
        pin.x = pos.x;
        pin.y = pos.y;
      });
    });
    function near(a, b, tol) { return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol; }
    function onSeg(p, a, b, tol) {
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) return near(p, a, tol);
      var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      if (t < -0.02 || t > 1.02) return false;
      var x = a.x + t * dx;
      var y = a.y + t * dy;
      return Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol;
    }
    function wiresOf(pl) { return pl._subs || []; }
    var wireList = [];
    pic.polylines.forEach(function (pl) {
      wiresOf(pl).forEach(function (w) { wireList.push({ hint: pl.hint, key: w.key, abs: w.abs }); });
    });
    wireList.forEach(function (w) {
      var abs = w.abs;
      if (abs.length < 2) return;
      [abs[0], abs[abs.length - 1]].forEach(function (end) {
        if (end.bind) return;
        pins.forEach(function (pin) {
          var tol = pin.pin === 'POLE' ? 0.12 : 0.05;
          if (near(end, pin, tol)) uni(w.key, pin.key);
        });
      });
    });
    for (var i = 0; i < wireList.length; i++) {
      for (var j = i + 1; j < wireList.length; j++) {
        var A = wireList[i];
        var B = wireList[j];
        if (A.abs.length < 2 || B.abs.length < 2) continue;
        [A.abs[0], A.abs[A.abs.length - 1]].forEach(function (end) {
          if (end.bind) return;
          if ((!B.abs[0].bind && near(end, B.abs[0], 0.05)) || (!B.abs[B.abs.length - 1].bind && near(end, B.abs[B.abs.length - 1], 0.05))) uni(A.key, B.key);
          var s;
          for (s = 0; s < B.abs.length - 1; s++) {
            if (onSeg(end, B.abs[s], B.abs[s + 1], 0.05) && !near(end, B.abs[s], 0.02) && !near(end, B.abs[s + 1], 0.02)) uni(A.key, B.key);
          }
        });
      }
    }
    pic.nodes.forEach(function (nd) {
      if (!nd._circ || !nd.abs) return;
      var hit = [];
      wireList.forEach(function (w) {
        var s;
        for (s = 0; s < w.abs.length - 1; s++) {
          if (onSeg(nd.abs, w.abs[s], w.abs[s + 1], 0.08)) { hit.push(w.key); break; }
        }
      });
      var h;
      for (h = 1; h < hit.length; h++) uni(hit[0], hit[h]);
    });
    var buckets = Object.create(null);
    pins.forEach(function (pin) {
      var r = id(pin.key);
      if (!buckets[r]) buckets[r] = { pins: [], hint: '', dangling: [] };
      buckets[r].pins.push(pin);
    });
    wireList.forEach(function (w) {
      var r = id(w.key);
      if (!buckets[r]) buckets[r] = { pins: [], hint: '', dangling: [] };
      if (w.hint && !buckets[r].hint) buckets[r].hint = w.hint;
      if (w.abs.length < 2) return;
      [w.abs[0], w.abs[w.abs.length - 1]].forEach(function (end) {
        var joined = pins.some(function (pin) { return id(pin.key) === r && near(end, pin, pin.pin === 'POLE' ? 0.12 : 0.05); });
        if (!joined && !end.bind) buckets[r].dangling.push(end);
      });
    });
    var out = [];
    Object.keys(buckets).forEach(function (k) {
      if (buckets[k].pins.length || buckets[k].dangling.length) out.push(buckets[k]);
    });
    return out;
  }

  function reverseAnchor(nd, pin) {
    if (!nd || !nd._part) return '';
    if (nd._dff) {
      if (pin === 'D') return 'pin 1';
      if (pin === 'CLK') return 'pin 3';
      if (pin === 'Q') return 'pin 6';
      if (pin === 'RST') return 'down';
      if (pin === 'SET') return 'up';
    }
    if (nd._part.type === 'mux') {
      if (pin === 'D0') return 'lpin 1';
      if (pin === 'D1') return 'lpin 2';
      if (pin === 'Y') return 'rpin 1';
      if (pin === 'S') return nd._aopts && nd._aopts.mux && nd._aopts.mux.NT === 1 ? 'tpin 1' : 'bpin 1';
    }
    if (nd._part.type === 'not' || nd._part.type === 'buf') return pin === 'Y' ? 'out' : 'in';
    if (MULTI[nd._part.type]) {
      if (pin === 'Y') return 'out';
      var n = nd._part.inputs || 2;
      var i;
      for (i = 0; i < n; i++) if (inName(i, n) === pin) return 'in ' + (i + 1);
    }
    if (nd._blockPorts) {
      var hit = '';
      nd._blockPorts.forEach(function (p) { if (p.name === pin) hit = p.anchor; });
      return hit;
    }
    return 'center';
  }

  function resolvePrepare(pictures, warn) {
    pictures.forEach(function (pic) {
      pic.nodes.forEach(function (nd) {
        decorateNode(nd, pic.style, pic.originCenter);
        if (nd._warn === 'schmitt') warn('Schmitt port imported as a buffer or inverter');
      });
    });
  }

  function placeAll(pictures, modules, generated) {
    var D = lib();
    pictures.forEach(function (pic, idx) {
      var mod = modules[idx];
      if (!mod) return;
      var raw = [];
      pic.nodes.forEach(function (nd) {
        if (!nd._part || nd._part._portNode) return;
        var part = nd._part;
        if (part._near) return;
        var box = logicBox(nd._shape || 'ocirc', nd._aopts || {});
        if (nd._dff) box = logicBox('flipflop D', {});
        var center = nd.abs || { x: 0, y: 0 };
        if (box && part.type !== 'in' && part.type !== 'out' && part.type !== 'c0' && part.type !== 'c1') {
          var local = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
          if (nd._origin) local.x += originDx(nd._style, box.kind, true);
          var i;
          for (i = (nd._transforms || []).length - 1; i >= 0; i--) local = applyOps(local, [nd._transforms[i]]);
          local = applyOps(local, flatOps(nd.stack || [], true, true));
          center = { x: nd.abs.x + local.x, y: nd.abs.y + local.y };
        }
        var fake = { modules: modules };
        var m = D.metrics(part, fake);
        var px = center.x / S;
        var py = -center.y / S;
        raw.push({ part: part, x: px - m.w / 2, y: py - m.h / 2 });
      });
      mod.parts.forEach(function (part) {
        if (!part._portNode) return;
        var pole = part._portNode.abs || { x: 0, y: 0 };
        var px = pole.x / S;
        var py = -pole.y / S;
        var m = D.metrics(part, { modules: modules });
        var pin = null;
        m.pins.forEach(function (q) { if (q.name === (part.type === 'out' ? 'A' : 'Y')) pin = q; });
        raw.push({ part: part, x: px - (pin ? pin.x : 0), y: py - (pin ? pin.y : m.h / 2) });
      });
      if (!raw.length) return;
      var origin = pic.origin;
      if (origin && isFinite(origin.x)) {
        raw.forEach(function (r) {
          r.part.x = snap(r.x + origin.x);
          r.part.y = snap(r.y + origin.y);
        });
      } else {
        var shift = 1;
        var pass;
        for (pass = 0; pass < (generated ? 1 : 4); pass++) {
          var minX = Infinity;
          var minY = Infinity;
          raw.forEach(function (r) {
            var x = r.x * shift;
            var y = r.y * shift;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
          });
          raw.forEach(function (r) {
            r.part.x = snap(r.x * shift - minX + 48);
            r.part.y = snap(r.y * shift - minY + 48);
          });
          if (generated || !overlaps(mod, modules)) break;
          shift *= 1.25;
        }
      }
      mod.parts.forEach(function (part) {
        if (!part._near) return;
        part.x = snap(part._near.x + 96);
        part.y = snap(part._near.y);
      });
      mod.parts.forEach(function (p) { delete p._portNode; delete p._near; });
    });
  }

  function overlaps(mod, modules) {
    var D = lib();
    var boxes = mod.parts.map(function (p) {
      var m = D.metrics(p, { modules: modules || [mod] });
      return { x: p.x, y: p.y, w: m.w, h: m.h };
    });
    var i;
    var j;
    for (i = 0; i < boxes.length; i++) {
      for (j = i + 1; j < boxes.length; j++) {
        var a = boxes[i];
        var b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
      }
    }
    return false;
  }

  function pickTop(modules) {
    var used = Object.create(null);
    modules.forEach(function (m) {
      m.parts.forEach(function (p) { if (p.type === 'block' && p.ref) used[p.ref] = 1; });
    });
    var i;
    for (i = 0; i < modules.length; i++) if (!used[modules[i].id]) return modules[i].id;
    return modules[0].id;
  }

  return {
    STYLES: STYLES,
    toTex: toTex,
    fromTex: fromTex,
    looksLikeTex: looksLikeTex,
    wrapDocument: wrapDocument,
    anchor: anchor
  };
});
