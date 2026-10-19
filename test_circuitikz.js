'use strict';

var Design = typeof require === 'function' ? require('./design.js') : window.Design;
var Sch = typeof require === 'function' ? require('./schematic.js') : window.Schematic;
var CircuiTikZ = typeof require === 'function' ? require('./circuitikz.js') : window.CircuiTikZ;

var ctFailed = 0;
var ctMessages = [];

function expect(cond, msg) {
  if (!cond) {
    ctFailed++;
    ctMessages.push('FAIL ' + msg);
    console.error('FAIL ' + msg);
  }
}

function close(a, b, eps) {
  return Math.abs(a - b) <= (eps == null ? 0.0002 : eps);
}

function anchorClose(shape, name, opts, x, y) {
  var p = CircuiTikZ.anchor(shape, name, opts);
  expect(p && close(p.x, x) && close(p.y, y), shape + ' ' + name + ' ' + (p && p.x) + ',' + (p && p.y));
}

anchorClose('american and port', 'in 1', { inputs: 3 }, -1.386, 0.373333);
anchorClose('american and port', 'in 2', { inputs: 3 }, -1.386, 0);
anchorClose('american and port', 'out', { inputs: 2 }, 0.154, 0);
anchorClose('european not port', 'in', {}, -1.764, 0);
anchorClose('ieeestd buffer port', 'out', {}, 0.8769, 0);
anchorClose('flipflop D', 'pin 1', {}, -1.12, 0.84);
anchorClose('flipflop D', 'pin 6', {}, 1.12, 0.84);
anchorClose('flipflop D', 'down', {}, 0, -1.54);
anchorClose('muxdemux', 'lpin 1', { mux: { NL: 2, NR: 1, NB: 1, NT: 0, w: 1.5, Lh: 2.5, Rh: 1.5 } }, -0.7, 0.35);
anchorClose('muxdemux', 'lpin 2', { mux: { NL: 2, NR: 1, NB: 1, NT: 0, w: 1.5, Lh: 2.5, Rh: 1.5 } }, -0.7, -0.35);
anchorClose('muxdemux', 'rpin 1', { mux: { NL: 2, NR: 1, NB: 1, NT: 0, w: 1.5, Lh: 2.5, Rh: 1.5 } }, 0.7, 0);
anchorClose('muxdemux', 'bpin 1', { mux: { NL: 2, NR: 1, NB: 1, NT: 0, w: 1.5, Lh: 2.5, Rh: 1.5 } }, 0, -0.84);

function balanced(src) {
  var n = 0;
  var i;
  for (i = 0; i < src.length; i++) {
    if (src.charAt(i) === '\\') { i++; continue; }
    if (src.charAt(i) === '{') n++;
    else if (src.charAt(i) === '}') n--;
    if (n < 0) return false;
  }
  return n === 0;
}

function netSig(doc) {
  return doc.modules.map(function (m) {
    var nm = {};
    m.parts.forEach(function (p) { nm[p.id] = p.name; });
    return m.name + '{' + m.nets.map(function (n) {
      return (n.name || '-') + ':' + n.pins.map(function (r) { return nm[r.part] + '.' + r.pin; }).sort().join('+');
    }).sort().join(' | ') + '}';
  }).join(' ;; ');
}

function posOk(a, b) {
  var bad = [];
  a.modules.forEach(function (m, i) {
    var o = b.modules[i];
    var by = {};
    o.parts.forEach(function (p) { by[p.name] = p; });
    m.parts.forEach(function (p) {
      var q = by[p.name];
      if (!q) { bad.push('missing ' + p.name); return; }
      if (Math.abs(p.x - q.x) > 8 || Math.abs(p.y - q.y) > 8) bad.push(p.name);
      if (p.type !== q.type) bad.push('type ' + p.name);
      if ((p.type === 'and' || p.type === 'or' || p.type === 'xor' || p.type === 'nand' || p.type === 'nor' || p.type === 'xnor') && (p.inputs || 2) !== (q.inputs || 2)) bad.push('inputs ' + p.name);
      if (p.type === 'dff') {
        if (p.clkEdge !== q.clkEdge || !!p.hasRst !== !!q.hasRst || (p.hasRst && (p.rstEdge !== q.rstEdge || p.rstVal !== q.rstVal))) bad.push('dff ' + p.name);
      }
    });
  });
  return bad;
}

['american', 'european', 'ieeestd'].forEach(function (style) {
  ['half', 'mux', 'dff', 'shift', 'full'].forEach(function (ex) {
    var doc = Design.example(ex);
    var out = CircuiTikZ.toTex(doc, { style: style, scope: 'all' });
    var tex = out.tex;
    expect(tex.indexOf('\\documentclass') >= 0, ex + ' class');
    expect(balanced(tex), ex + ' ' + style + ' braces');
    expect(tex.indexOf('\\begin{circuitikz}') >= 0, ex + ' env');
    var draws = (tex.match(/\\draw /g) || []).length;
    var links = 0;
    doc.modules.forEach(function (m) {
      (m.nets || []).forEach(function (n) { if (n.pins && n.pins.length >= 2) links += n.pins.length - 1; });
    });
    expect(draws === links, ex + ' ' + style + ' draws ' + draws + ' vs ' + links);
    if (style === 'american' && ex === 'half') {
      expect(tex.indexOf('american xor port') >= 0 && tex.indexOf('american and port') >= 0, 'half shapes');
    }
    if (style === 'european' && ex === 'mux') expect(tex.indexOf('muxdemux') >= 0 && tex.indexOf('NL=2') >= 0, 'mux def');
    if (style === 'ieeestd' && ex === 'dff') {
      expect(tex.indexOf('flipflop D') >= 0 && tex.indexOf('td=RST') >= 0, 'dff def\n' + tex);
    }
    var back = CircuiTikZ.fromTex(tex);
    expect(!back.error && back.doc, ex + ' ' + style + ' import ' + (back.error || ''));
    if (!back.doc) return;
    expect(netSig(doc) === netSig(back.doc), ex + ' ' + style + ' nets\n' + netSig(doc) + '\n' + netSig(back.doc));
    var moved = posOk(doc, back.doc);
    expect(!moved.length, ex + ' ' + style + ' pos ' + moved.join(','));
    var v1 = Design.toVerilog(doc);
    var v2 = Design.toVerilog(back.doc);
    var c1 = Sch.compile(v1);
    var c2 = Sch.compile(v2);
    expect(c1.ok && c2.ok, ex + ' verilog');
    if (c1.ok && c2.ok) {
      expect(c1.top === c2.top, ex + ' top ' + c2.top);
      c1.order.forEach(function (name) {
        var ka = {};
        var kb = {};
        (c1.modules[name].cells || []).forEach(function (cell) { ka[cell.kind] = (ka[cell.kind] || 0) + 1; });
        (c2.modules[name].cells || []).forEach(function (cell) { kb[cell.kind] = (kb[cell.kind] || 0) + 1; });
        Object.keys(ka).forEach(function (k) {
          expect(ka[k] === kb[k], ex + ' ' + name + ' ' + k + ' ' + ka[k] + ' vs ' + kb[k]);
        });
      });
    }
  });
});

(function activeLow() {
  var doc = Design.example('dff');
  var ff = doc.modules[0].parts.filter(function (p) { return p.type === 'dff'; })[0];
  ff.clkEdge = 'neg';
  ff.rstEdge = 'neg';
  ff.rstVal = 1;
  doc.modules[0].nets.forEach(function (n) {
    n.pins.forEach(function (r) { if (r.pin === 'RST') r.pin = 'SET'; });
  });
  var tex = CircuiTikZ.toTex(doc).tex;
  expect(tex.indexOf('n3=1') >= 0 && tex.indexOf('tu=SET') >= 0 && tex.indexOf('nu=1') >= 0, 'low set\n' + tex);
  var back = CircuiTikZ.fromTex(tex);
  var q = back.doc.modules[0].parts.filter(function (p) { return p.type === 'dff'; })[0];
  expect(q && q.clkEdge === 'neg' && q.hasRst && q.rstVal === 1 && q.rstEdge === 'neg', 'low round ' + JSON.stringify(q));
})();

(function designerSnippet() {
  var inn = CircuiTikZ.anchor('american and port', 'in 1', { inputs: 2 });
  var outp = CircuiTikZ.anchor('american and port', 'out', { inputs: 2 });
  var rx = -inn.y;
  var ry = inn.x;
  var tex = [
    '\\begin{tikzpicture}[transform shape]',
    '\\node[american and port] (N1) at (0,0){} node[anchor=west] at (N1.text){$y$};',
    '\\node[ocirc, label={left:a}] (A) at (' + inn.x + ', ' + inn.y + ') {};',
    '\\draw (' + inn.x + ', ' + inn.y + ') -- (N1.in 1);',
    '\\draw (N1.out) -- (' + (outp.x + 3) + ', ' + outp.y + ');',
    '\\node[american and port, rotate=90, xscale=-1] (N2) at (6,0) {};',
    '\\draw (' + (6 + rx) + ', ' + ry + ') -- ++(0,-0.6);',
    '\\end{tikzpicture}'
  ].join('\n');
  var back = CircuiTikZ.fromTex(tex);
  expect(!back.error, 'designer ' + (back.error || ''));
  if (!back.doc) return;
  var parts = back.doc.modules[0].parts;
  expect(parts.filter(function (p) { return p.type === 'and'; }).length === 2, 'two ands ' + parts.map(function (p) { return p.type; }).join(','));
  var sig = netSig(back.doc);
  expect(sig.indexOf('a.Y') >= 0, 'designer port\n' + sig);
})();

(function junctions() {
  function cross(dot) {
    return [
      '\\begin{circuitikz}',
      '\\node[ocirc, label={left:a}] (a) at (0,0) {};',
      '\\node[ocirc, label={right:b}] (b) at (2,0) {};',
      '\\node[ocirc, label={below:c}] (c) at (1,-1) {};',
      '\\node[ocirc, label={above:d}] (d) at (1,1) {};',
      '\\draw (a) -- (b);',
      '\\draw (c) -- (d);',
      dot ? '\\node[circ] at (1,0) {};' : '',
      '\\end{circuitikz}'
    ].join('\n');
  }
  var withDot = CircuiTikZ.fromTex(cross(true));
  var plain = CircuiTikZ.fromTex(cross(false));
  expect(withDot.doc && withDot.doc.modules[0].nets.length === 1, 'circ joins ' + (withDot.doc && withDot.doc.modules[0].nets.length));
  expect(plain.doc && plain.doc.modules[0].nets.length === 2, 'crossing stays open ' + (plain.doc && plain.doc.modules[0].nets.length));
})();

(function handwritten() {
  var euro = CircuiTikZ.fromTex('\\ctikzset{logic ports=european}\n\\begin{circuitikz}\n\\node[and port] (g) at (0,0) {};\n\\node[ocirc, label={left:a}] (a) at (-4,0) {};\n\\draw (a) -- (g.in 1);\n\\end{circuitikz}\n');
  expect(euro.doc && euro.doc.modules[0].parts.some(function (p) { return p.type === 'and'; }), 'euro and');
  var ep = CircuiTikZ.anchor('european and port', 'in 1', { inputs: 2 });
  var geom = CircuiTikZ.fromTex('\\ctikzset{logic ports=european}\n\\begin{circuitikz}\n\\node[and port] (g) at (0,0) {};\n\\draw (' + ep.x + ', ' + ep.y + ') -- ++(-1,0);\n\\end{circuitikz}\n');
  expect(geom.doc && netSig(geom.doc).indexOf('.A') >= 0, 'euro geometry\n' + (geom.doc && netSig(geom.doc)));
  var scope = CircuiTikZ.fromTex('\\begin{circuitikz}\n\\begin{scope}[shift={(1,2)}]\n\\node[ocirc, label={left:a}] (a) at (0,0) {};\n\\end{scope}\n\\node[american and port] (g) at (4,2) {};\n\\draw (1,2) -- (g.in 1);\n\\end{circuitikz}\n');
  expect(scope.doc && netSig(scope.doc).indexOf('a.Y') >= 0 && netSig(scope.doc).indexOf('.A') >= 0, 'scope\n' + (scope.doc && netSig(scope.doc)));
  var qn = CircuiTikZ.fromTex('\\begin{circuitikz}\n\\node[flipflop D] (ff) at (0,0) {};\n\\node[ocirc, label={right:qn}] (qn) at (3,-0.84) {};\n\\draw (ff.pin 4) -- (qn);\n\\node[ocirc, label={right:q}] (q) at (3,0.84) {};\n\\draw (ff.pin 6) -- (q);\n\\end{circuitikz}\n');
  expect(qn.doc && qn.doc.modules[0].parts.some(function (p) { return p.type === 'not'; }), 'qbar not');
  var sr = CircuiTikZ.fromTex('\\begin{circuitikz}\n\\node[flipflop D, add async SR, flipflop def={td=RST, nd=1}] (ff) at (0,0) {};\n\\node[ocirc, label={left:rst}] (rst) at (0,-3) {};\n\\draw (rst) -- (ff.down);\n\\end{circuitikz}\n');
  var ff = sr.doc && sr.doc.modules[0].parts.filter(function (p) { return p.type === 'dff'; })[0];
  expect(ff && ff.hasRst && ff.rstEdge === 'neg' && !ff.rstVal, 'async sr ' + JSON.stringify(ff));
  var pole = CircuiTikZ.fromTex('\\begin{circuitikz}\n\\node[american buffer port] (b) at (0,0) {};\n\\draw (b.out) to[short, -o] ++(2,0) node[right] {$y$};\n\\end{circuitikz}\n');
  expect(pole.doc && pole.doc.modules[0].parts.some(function (p) { return p.type === 'out' && p.name === 'y'; }), 'pole label ' + (pole.doc && pole.doc.modules[0].parts.map(function (p) { return p.type + p.name; }).join(',')));
})();

(function errors() {
  var empty = CircuiTikZ.fromTex('hello world');
  expect(empty.doc === null && empty.error, 'empty ' + empty.error);
  var loop = CircuiTikZ.fromTex('\\foreach \\i in {1,2} { \\node[american and port] (a) at (0,\\i) {}; }');
  expect(loop.warnings && loop.warnings.join(' ').indexOf('foreach') >= 0, 'foreach warn ' + (loop.warnings || []).join(','));
  var shape = CircuiTikZ.fromTex('\\begin{circuitikz}\n\\node[nmos] (q) at (0,0) {};\n\\node[american and port] (g) at (3,0) {};\n\\end{circuitikz}\n');
  expect(shape.doc && shape.warnings.join(' ').indexOf('nmos') >= 0, 'nmos warn');
  expect(!CircuiTikZ.looksLikeTex('module m; endmodule'), 'verilog is not tex');
  expect(!CircuiTikZ.looksLikeTex('{"modules":[]}'), 'json is not tex');
  expect(CircuiTikZ.looksLikeTex('% comment\n\\begin{circuitikz}\n\\end{circuitikz}\n'), 'tex env');
  expect(CircuiTikZ.wrapDocument('\\node[and port] at (0,0) {};').indexOf('\\begin{circuitikz}') >= 0, 'wrap bare');
  expect(CircuiTikZ.wrapDocument('\\documentclass{article}\n\\begin{document}x\\end{document}').indexOf('\\documentclass{article}') === 0, 'wrap keeps class');
})();

(function halfLanes() {
  var tex = CircuiTikZ.toTex(Design.example('half')).tex;
  function trunkX(name) {
    var m = new RegExp('% net: ' + name + '\\n([\\s\\S]*?)(?=\\n  % net:|\\n\\\\end\\{circuitikz\\})').exec(tex);
    expect(!!m, 'half net ' + name);
    if (!m) return null;
    var best = null;
    var draws = m[1].match(/\\draw[\s\S]*?;/g) || [];
    draws.forEach(function (d) {
      var pts = [];
      var re = /\(([+-]?\d*\.?\d+),\s*([+-]?\d*\.?\d+)\)/g;
      var c;
      while ((c = re.exec(d))) pts.push({ x: parseFloat(c[1]), y: parseFloat(c[2]) });
      var i;
      for (i = 1; i < pts.length; i++) {
        var dy = Math.abs(pts[i].y - pts[i - 1].y);
        if (Math.abs(pts[i].x - pts[i - 1].x) > 0.02 || dy < 0.3) continue;
        if (!best || dy > best.dy) best = { x: pts[i].x, dy: dy };
      }
    });
    return best;
  }
  var a = trunkX('a');
  var b = trunkX('b');
  expect(a && b && Math.abs(a.x - b.x) > 0.3, 'half trunks a=' + (a && a.x) + ' b=' + (b && b.x));
})();

if (typeof window !== 'undefined') {
  window.__testFailed = (window.__testFailed || 0) + ctFailed;
  var out = document.getElementById('out');
  var line = 'circuitikz: ' + (ctFailed ? ctFailed + ' failed' : 'ok') + (ctMessages.length ? '\n' + ctMessages.join('\n') : '');
  if (out) out.textContent = out.textContent + '\n' + line;
}
if (typeof process !== 'undefined' && process.exit) {
  if (ctFailed) {
    console.error(ctFailed + ' failed');
    process.exit(1);
  }
  console.log('ok');
}
