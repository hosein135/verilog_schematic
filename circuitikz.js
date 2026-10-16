/* Schematic drawing <-> CircuiTikZ.
   European logic ports, D flip-flops, and muxdemux shapes are the same
   objects the designer already draws. Passive bipoles (R, C, L, ...) from
   a CircuiTikZ-Designer export become labeled blocks. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CircuitTikZ = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var PX = 46;
  var GATES = {
    'and port': 'and',
    'nand port': 'nand',
    'or port': 'or',
    'nor port': 'nor',
    'xor port': 'xor',
    'xnor port': 'xnor',
    'not port': 'not',
    'buffer port': 'buf'
  };

  function inName(i) {
    var names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    return names[i] || ('I' + i);
  }

  function num(n) {
    if (!isFinite(n)) return '0';
    var s = (Math.round(n * 100) / 100).toFixed(2);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : (s || '0');
  }

  function texText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/([&%$#_{}])/g, '\\$1')
      .replace(/\^/g, '\\textasciicircum{}')
      .replace(/~/g, '\\textasciitilde{}');
  }

  function mathLabel(s) {
    var t = String(s == null ? '' : s);
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(t)) return '$' + t + '$';
    return texText(t);
  }

  function nodeName(raw, used) {
    var s = String(raw || 'n').replace(/[^A-Za-z0-9_]/g, '');
    if (!s || /^[0-9]/.test(s)) s = 'n' + s;
    var base = s, i = 2, n = s;
    while (used[n]) { n = base + '_' + i; i++; }
    used[n] = 1;
    return n;
  }

  function byPos(a, b) {
    return a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id));
  }

  function centerOf(part, doc) {
    var m = Design.metrics(part, doc);
    return {
      x: (part.x + m.w / 2) / PX,
      y: -(part.y + m.h / 2) / PX
    };
  }

  function placeAt(part, x, y, doc) {
    var m = Design.metrics(part, doc);
    part.x = Math.round(x * PX - m.w / 2);
    part.y = Math.round(-y * PX - m.h / 2);
  }

  function anchorOf(part, pin, doc) {
    if (part.type === 'in' || part.type === 'out' || part.type === 'c0' || part.type === 'c1') return '';
    if (part.type === 'not' || part.type === 'buf') return pin === 'Y' ? 'out' : 'in';
    if (part.type === 'dff') {
      if (pin === 'D') return 'pin 1';
      if (pin === 'CLK') return 'pin 3';
      if (pin === 'Q') return 'pin 6';
      if (pin === 'RST' || pin === 'SET') return 'pin 2';
    }
    if (part.type === 'mux') {
      if (pin === 'D0') return 'lpin 1';
      if (pin === 'D1') return 'lpin 2';
      if (pin === 'Y') return 'rpin 1';
      if (pin === 'S') return 'bpin 1';
    }
    if (part.type === 'block') return '';
    var pins = Design.pins(part, doc);
    var i;
    for (i = 0; i < pins.length; i++) {
      if (pins[i].name === pin && pins[i].dir === 'in') return 'in ' + (i + 1);
    }
    if (pin === 'Y') return 'out';
    return '';
  }

  function refOf(tikzName, part, pin, doc) {
    if (part.type === 'block') return tikzName + '__' + pin;
    var a = anchorOf(part, pin, doc);
    return a ? (tikzName + '.' + a) : tikzName;
  }

  function toTex(doc) {
    var lines = [];
    lines.push('\\documentclass[border=8pt]{standalone}');
    lines.push('\\usepackage{circuitikz}');
    lines.push('\\usetikzlibrary{calc}');
    lines.push('\\begin{document}');
    lines.push('\\ctikzset{logic ports=european}');
    if (!doc || !doc.modules || !doc.modules.length) {
      lines.push('\\begin{circuitikz}');
      lines.push('\\end{circuitikz}');
      lines.push('\\end{document}');
      lines.push('');
      return lines.join('\n');
    }
    doc.modules.forEach(function (mod) {
      lines.push('% module ' + (mod.name || 'circuit'));
      lines.push('\\begin{circuitikz}');
      var used = Object.create(null);
      var names = Object.create(null);
      var parts = (mod.parts || []).slice().sort(byPos);
      parts.forEach(function (part) {
        names[part.id] = nodeName(part.name, used);
      });
      parts.forEach(function (part) {
        var nm = names[part.id];
        var c = centerOf(part, doc);
        var at = '(' + num(c.x) + ',' + num(c.y) + ')';
        if (part.type === 'in') {
          lines.push('  % SCH port ' + nm + ' in');
          lines.push('  \\node[ocirc, label={left:' + mathLabel(part.name) + '}] (' + nm + ') at ' + at + ' {};');
          return;
        }
        if (part.type === 'out') {
          lines.push('  % SCH port ' + nm + ' out');
          lines.push('  \\node[ocirc, label={right:' + mathLabel(part.name) + '}] (' + nm + ') at ' + at + ' {};');
          return;
        }
        if (part.type === 'c0' || part.type === 'c1') {
          var bit = part.type === 'c1' ? '1' : '0';
          lines.push('  % SCH const ' + nm + ' ' + bit);
          lines.push('  \\node[draw, circle, minimum size=0.55cm, inner sep=0pt] (' + nm + ') at ' + at + ' {' + bit + '};');
          return;
        }
        if (part.type === 'dff') {
          var clk = part.clkEdge === 'neg' ? 'neg' : 'pos';
          var rst = !part.hasRst ? 'none' : (part.rstEdge === 'neg' ? 'neg' : 'pos');
          var val = part.rstVal ? '1' : '0';
          lines.push('  % SCH dff ' + nm + ' clk=' + clk + ' rst=' + rst + ' val=' + val);
          var def = ['t1=D', 'c3=1', 't6=Q'];
          if (part.clkEdge === 'neg') def.push('n3=1');
          if (part.hasRst) {
            def.push(part.rstVal ? 't2=SET' : 't2=RST');
            if (part.rstEdge === 'neg') def.push('n2=1');
          }
          lines.push('  \\node[flipflop, flipflop def={' + def.join(', ') + '}] (' + nm + ') at ' + at + ' {};');
          return;
        }
        if (part.type === 'mux') {
          lines.push('  \\node[muxdemux, muxdemux def={NL=2, NR=1, NB=1, NT=0, w=1.6, Lh=2.8, Rh=1.5}] (' + nm + ') at ' + at + ' {};');
          return;
        }
        if (part.type === 'block') {
          var typeName = Design.blockTypeName(part, doc);
          lines.push('  % SCH block ' + nm + ' ' + (typeName || 'block'));
          var body = texText(part.name || nm);
          if (typeName && typeName !== part.name) body += '\\\\[-2pt]{\\scriptsize ' + texText(typeName) + '}';
          lines.push('  \\node[draw, align=center, minimum width=2.6cm, minimum height=1.8cm] (' + nm + ') at ' + at + ' {' + body + '};');
          var pins = Design.pins(part, doc);
          var left = pins.filter(function (p) { return p.side !== 'r'; });
          var right = pins.filter(function (p) { return p.side === 'r'; });
          function coords(list, west) {
            var i;
            for (i = 0; i < list.length; i++) {
              var frac = (i + 1) / (list.length + 1);
              var side = west ? 'west' : 'east';
              lines.push('  % SCH pin ' + nm + ' ' + list[i].name + ' ' + (west ? 'in' : 'out') + ' ' + num(frac));
              lines.push('  \\coordinate (' + nm + '__' + list[i].name + ') at ($( ' + nm + '.north ' + side + ')!' + num(frac) + '!( ' + nm + '.south ' + side + ')$);');
            }
          }
          coords(left, true);
          coords(right, false);
          return;
        }
        if (part.type === 'not' || part.type === 'buf') {
          var shape = part.type === 'buf' ? 'buffer port' : 'not port';
          lines.push('  \\node[' + shape + '] (' + nm + ') at ' + at + ' {};');
          return;
        }
        var nIn = Math.max(2, Math.min(8, part.inputs || 2));
        lines.push('  \\node[' + part.type + ' port, number inputs=' + nIn + '] (' + nm + ') at ' + at + ' {};');
      });
      var byId = Object.create(null);
      (mod.parts || []).forEach(function (p) { byId[p.id] = p; });
      (mod.nets || []).forEach(function (net) {
        var driver = null;
        var loads = [];
        (net.pins || []).forEach(function (ref) {
          var part = byId[ref.part];
          if (!part || !names[part.id]) return;
          var pins = Design.pins(part, doc);
          var pin = null;
          var i;
          for (i = 0; i < pins.length; i++) if (pins[i].name === ref.pin) pin = pins[i];
          if (!pin) return;
          var end = { part: part, pin: ref.pin };
          if (!driver && (pin.dir === 'out' || pin.dir === 'inout' || part.type === 'in' || part.type === 'c0' || part.type === 'c1')) driver = end;
          else loads.push(end);
        });
        if (!driver) {
          if (!loads.length) return;
          driver = loads.shift();
        }
        loads.forEach(function (load) {
          lines.push('  \\draw (' + refOf(names[driver.part.id], driver.part, driver.pin, doc) + ') -- (' + refOf(names[load.part.id], load.part, load.pin, doc) + ');');
        });
      });
      lines.push('\\end{circuitikz}');
      lines.push('');
    });
    lines.push('\\end{document}');
    lines.push('');
    return lines.join('\n');
  }

  function skipSpace(s, i) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    return i;
  }

  function readDelim(s, i, open, close) {
    if (s.charAt(i) !== open) return null;
    var depth = 0, brace = 0, start = i;
    for (; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\') { i++; continue; }
      if (c === '{') brace++;
      else if (c === '}') brace = Math.max(0, brace - 1);
      else if (!brace && c === open) depth++;
      else if (!brace && c === close) {
        depth--;
        if (depth === 0) return { inner: s.slice(start + 1, i), next: i + 1 };
      }
    }
    return null;
  }

  function readBrace(s, i) {
    return readDelim(s, i, '{', '}');
  }

  function splitComma(s) {
    var out = [], buf = '', brace = 0, bracket = 0, i;
    for (i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\') { buf += c + (s.charAt(i + 1) || ''); i++; continue; }
      if (c === '{') brace++;
      else if (c === '}') brace = Math.max(0, brace - 1);
      else if (!brace && c === '[') bracket++;
      else if (!brace && c === ']') bracket = Math.max(0, bracket - 1);
      if (c === ',' && !brace && !bracket) {
        out.push(buf.trim());
        buf = '';
      } else buf += c;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  function parseOpts(opts) {
    var styles = [];
    var keys = Object.create(null);
    splitComma(opts || '').forEach(function (piece) {
      var eq = piece.indexOf('=');
      if (eq < 0) styles.push(piece.trim());
      else keys[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
    });
    return { styles: styles, keys: keys };
  }

  function unbrace(v) {
    var t = String(v || '').trim();
    if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') return t.slice(1, -1).trim();
    return t;
  }

  function stripMath(v) {
    var t = unbrace(v).trim();
    if (t.charAt(0) === '$' && t.charAt(t.length - 1) === '$') t = t.slice(1, -1);
    t = t.replace(/\\([_&#%$])/g, '$1');
    t = t.replace(/[{}]/g, '');
    return t.trim();
  }

  function parseXY(inner) {
    var m = /^\s*([+-]?\d*\.?\d+)\s*(cm|mm|pt)?\s*,\s*([+-]?\d*\.?\d+)\s*(cm|mm|pt)?/.exec(inner || '');
    if (!m) return null;
    function cm(n, unit) {
      if (unit === 'mm') return n / 10;
      if (unit === 'pt') return n / 28.4527;
      return n;
    }
    return { x: cm(parseFloat(m[1]), m[2]), y: cm(parseFloat(m[3]), m[4]) };
  }

  function coordBefore(src, i) {
    var j = i - 1;
    while (j >= 0 && /\s/.test(src.charAt(j))) j--;
    if (j < 0 || src.charAt(j) !== ')') return null;
    var depth = 0, end = j;
    for (; j >= 0; j--) {
      if (src.charAt(j) === ')') depth++;
      else if (src.charAt(j) === '(') {
        depth--;
        if (depth === 0) return parseXY(src.slice(j + 1, end));
      }
    }
    return null;
  }

  function keywordAt(src, word, from) {
    var i = from || 0;
    while (i < src.length) {
      var j = src.indexOf(word, i);
      if (j < 0) return -1;
      var before = j > 0 ? src.charAt(j - 1) : '';
      var after = src.charAt(j + word.length) || '';
      if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) return j;
      i = j + word.length;
    }
    return -1;
  }

  function parseNodeAt(src, i) {
    var k = skipSpace(src, i + 4);
    var opts = '';
    if (src.charAt(k) === '[') {
      var br = readDelim(src, k, '[', ']');
      if (!br) return null;
      opts = br.inner;
      k = skipSpace(src, br.next);
    }
    var name = '';
    if (src.charAt(k) === '(') {
      var pr = readDelim(src, k, '(', ')');
      if (!pr) return null;
      name = pr.inner.trim();
      k = skipSpace(src, pr.next);
    }
    var x = null, y = null;
    if (src.slice(k, k + 2) === 'at' && !/[A-Za-z]/.test(src.charAt(k + 2) || '')) {
      k = skipSpace(src, k + 2);
      if (src.charAt(k) === '(') {
        var xy = readDelim(src, k, '(', ')');
        if (xy) {
          var p = parseXY(xy.inner);
          if (p) { x = p.x; y = p.y; }
          k = skipSpace(src, xy.next);
        }
      }
    }
    var text = '';
    if (src.charAt(k) === '{') {
      var bd = readBrace(src, k);
      if (bd) {
        text = bd.inner;
        k = bd.next;
      }
    }
    if (x == null) {
      var before = coordBefore(src, i);
      if (before) { x = before.x; y = before.y; }
    }
    return { opts: opts, name: name, x: x, y: y, text: text, next: k };
  }

  function defMap(raw) {
    var map = Object.create(null);
    splitComma(unbrace(raw || '')).forEach(function (piece) {
      var eq = piece.indexOf('=');
      if (eq < 0) return;
      map[piece.slice(0, eq).trim()] = unbrace(piece.slice(eq + 1).trim());
    });
    return map;
  }

  function styleIs(styles, name) {
    var i;
    for (i = 0; i < styles.length; i++) if (styles[i] === name) return true;
    return false;
  }

  function gateType(styles) {
    var i;
    for (i = 0; i < styles.length; i++) if (GATES[styles[i]]) return GATES[styles[i]];
    return '';
  }

  function labelSide(keys) {
    var raw = unbrace(keys.label || '');
    var m = /^(left|right|above|below)\s*:/.exec(raw);
    return m ? m[1] : '';
  }

  function labelValue(keys, text) {
    var fromText = stripMath(text);
    if (fromText) return fromText;
    var raw = unbrace(keys.label || '');
    var m = /^(?:left|right|above|below)\s*:\s*([\s\S]+)$/.exec(raw);
    return m ? stripMath(m[1]) : '';
  }

  function identName(raw, fallback) {
    var s = String(raw || '').replace(/[^A-Za-z0-9_]/g, '');
    if (!s) s = fallback || 'n';
    if (/^[0-9]/.test(s)) s = 'n_' + s;
    return s;
  }

  function parseDrawBody(body) {
    var tokens = [];
    var i = 0;
    while (i < body.length) {
      var c = body.charAt(i);
      if (c === '(') {
        var p = readDelim(body, i, '(', ')');
        if (!p) { i++; continue; }
        tokens.push({ k: 'pt', raw: p.inner.trim() });
        i = p.next;
        continue;
      }
      if (body.slice(i, i + 2) === 'to' && !/[A-Za-z]/.test(body.charAt(i + 2) || '')) {
        var j = skipSpace(body, i + 2);
        if (body.charAt(j) === '[') {
          var br = readDelim(body, j, '[', ']');
          if (br) {
            tokens.push({ k: 'to', spec: br.inner });
            i = br.next;
            continue;
          }
        }
      }
      if (body.slice(i, i + 2) === '--' || body.slice(i, i + 2) === '-|' || body.slice(i, i + 2) === '|-') {
        tokens.push({ k: 'wire' });
        i += 2;
        continue;
      }
      i++;
    }
    return tokens;
  }

  function interpretPoint(raw) {
    var xy = parseXY(raw);
    if (xy) return { kind: 'xy', x: xy.x, y: xy.y, key: 'xy:' + xy.x.toFixed(3) + ',' + xy.y.toFixed(3) };
    var dot = raw.indexOf('.');
    if (dot < 0) return { kind: 'node', name: raw.trim(), anchor: '' };
    return { kind: 'node', name: raw.slice(0, dot).trim(), anchor: raw.slice(dot + 1).trim() };
  }

  function bipoleKind(spec) {
    var m = /^\s*([A-Za-z]+)/.exec(spec || '');
    return m ? m[1] : 'short';
  }

  function bipoleLabel(spec) {
    var m = /(?:^|,)\s*l(?:_|\^)?\s*=\s*(\$[^$]*\$|\{[^}]*\}|[^\s,]+)/.exec(spec || '');
    return m ? stripMath(m[1]) : '';
  }

  function readUntilSemi(src, i) {
    var brace = 0, bracket = 0, paren = 0, start = i;
    for (; i < src.length; i++) {
      var c = src.charAt(i);
      if (c === '\\') { i++; continue; }
      if (c === '{') brace++;
      else if (c === '}') brace = Math.max(0, brace - 1);
      else if (c === '[') bracket++;
      else if (c === ']') bracket = Math.max(0, bracket - 1);
      else if (c === '(') paren++;
      else if (c === ')') paren = Math.max(0, paren - 1);
      else if (c === ';' && !brace && !bracket && !paren) return { inner: src.slice(start, i), next: i + 1 };
    }
    return { inner: src.slice(start), next: src.length };
  }

  function schComments(src) {
    var dirs = [];
    var re = /^%[ \t]*SCH[ \t]+(.+)$/gm;
    var m;
    while ((m = re.exec(src))) dirs.push(m[1].trim());
    return dirs;
  }

  function modulesIn(src) {
    var chunks = [];
    var re = /\\begin\{(circuitikz|tikzpicture)\}/g;
    var m;
    while ((m = re.exec(src))) {
      var endTag = '\\end{' + m[1] + '}';
      var end = src.indexOf(endTag, m.index);
      if (end < 0) end = src.length;
      var before = src.slice(0, m.index);
      var modName = 'circuit';
      var mm = /%[ \t]*module[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*$/m.exec(before.split('\\end{').pop());
      var lines = before.split(/\n/);
      var i;
      for (i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
        var hit = /^%[ \t]*module[ \t]+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[i].trim());
        if (hit) { modName = hit[1]; break; }
      }
      chunks.push({ name: modName, body: src.slice(m.index, end) });
      re.lastIndex = end + endTag.length;
    }
    if (!chunks.length && /\\node|\\draw/.test(src)) chunks.push({ name: 'circuit', body: src });
    return chunks;
  }

  function anchorToPin(part, anchor) {
    var a = String(anchor || '').replace(/\s+/g, ' ').trim();
    if (!a || a === 'center' || a === 'east' || a === 'west' || a === 'north' || a === 'south') {
      if (part.type === 'in' || part.type === 'c0' || part.type === 'c1') return 'Y';
      if (part.type === 'out') return 'A';
      return '';
    }
    if (part.type === 'not' || part.type === 'buf') {
      if (a === 'in' || a === 'in 1') return 'A';
      if (a === 'out') return 'Y';
    }
    if (part.type === 'dff') {
      if (a === 'pin 1' || a === 'D') return 'D';
      if (a === 'pin 3' || a === 'CLK' || a === 'clock') return 'CLK';
      if (a === 'pin 6' || a === 'Q') return 'Q';
      if (a === 'pin 2' || a === 'RST' || a === 'SET') return part.hasRst ? (part.rstVal ? 'SET' : 'RST') : '';
    }
    if (part.type === 'mux') {
      if (a === 'lpin 1' || a === 'L1' || a === 'in 1') return 'D0';
      if (a === 'lpin 2' || a === 'L2' || a === 'in 2') return 'D1';
      if (a === 'rpin 1' || a === 'R1' || a === 'out') return 'Y';
      if (a === 'bpin 1' || a === 'B1') return 'S';
    }
    if (part.type === 'block') {
      var ports = part.ports || [];
      var i;
      for (i = 0; i < ports.length; i++) if (ports[i].name === a) return a;
      return '';
    }
    if (part.type === 'in' || part.type === 'c0' || part.type === 'c1') return 'Y';
    if (part.type === 'out') return 'A';
    var m = /^in (\d+)$/.exec(a);
    if (m) {
      var idx = parseInt(m[1], 10) - 1;
      var pins = Design.pins(part, { modules: [] });
      if (pins[idx] && pins[idx].dir === 'in') return pins[idx].name;
      return inName(idx);
    }
    if (a === 'out') return 'Y';
    return '';
  }

  function fromTex(src) {
    var warnings = [];
    var text = String(src || '');
    var chunks = modulesIn(text);
    var doc = Design.blank();
    doc.modules = [];
    doc.seq = 1;
    if (!chunks.length) {
      warnings.push('No CircuiTikZ picture in that text.');
      doc.modules = Design.blank().modules;
      return { doc: doc, warnings: warnings };
    }
    var nameToId = Object.create(null);
    chunks.forEach(function (chunk, mi) {
      var mod = { id: 'm' + (doc.seq++), name: chunk.name || ('circuit' + (mi + 1)), parts: [], nets: [] };
      if (nameToId[mod.name]) mod.name = mod.name + '_' + (mi + 1);
      nameToId[mod.name] = mod.id;
      var dirs = schComments(chunk.body);
      var notes = Object.create(null);
      dirs.forEach(function (line) {
        var bits = line.split(/\s+/);
        if (bits[0] === 'dff' && bits[1]) notes[bits[1]] = { kind: 'dff', rest: bits.slice(2) };
        if (bits[0] === 'block' && bits[1]) notes[bits[1]] = { kind: 'block', typeName: bits.slice(2).join(' ') };
        if (bits[0] === 'port' && bits[1]) notes[bits[1]] = { kind: 'port', dir: bits[2] || '' };
        if (bits[0] === 'const' && bits[1]) notes[bits[1]] = { kind: 'const', bit: bits[2] };
      });
      var byTikz = Object.create(null);
      var pinAlias = Object.create(null);
      var i = 0;
      while (i < chunk.body.length) {
        var at = keywordAt(chunk.body, 'node', i);
        var atC = keywordAt(chunk.body, 'coordinate', i);
        if (at < 0 && atC < 0) break;
        if (atC >= 0 && (at < 0 || atC < at)) {
          var ck = skipSpace(chunk.body, atC + 'coordinate'.length);
          if (chunk.body.charAt(ck) === '(') {
            var cn = readDelim(chunk.body, ck, '(', ')');
            if (cn) {
              var cname = cn.inner.trim();
              var us = cname.split('__');
              if (us.length === 2 && byTikz[us[0]]) {
                pinAlias[cname] = { part: byTikz[us[0]].id, pin: us[1] };
              }
              i = cn.next;
              continue;
            }
          }
          i = atC + 10;
          continue;
        }
        var node = parseNodeAt(chunk.body, at);
        if (!node) { i = at + 4; continue; }
        i = node.next;
        var parsed = parseOpts(node.opts);
        var gtype = gateType(parsed.styles);
        var tikz = node.name;
        var label = labelValue(parsed.keys, node.text);
        var part = null;
        if (gtype) {
          part = {
            id: 'p' + (doc.seq++),
            type: gtype,
            name: identName(label || tikz, gtype),
            x: 0, y: 0
          };
          if (gtype !== 'not' && gtype !== 'buf') {
            var nIn = parseInt(parsed.keys['number inputs'] || '2', 10);
            if (!nIn || nIn < 2) nIn = 2;
            if (nIn > 8) { warnings.push(part.name + ' has ' + nIn + ' inputs; the drawing keeps 8.'); nIn = 8; }
            part.inputs = nIn;
          }
        } else if (styleIs(parsed.styles, 'flipflop') || styleIs(parsed.styles, 'flipflop D') || (notes[tikz] && notes[tikz].kind === 'dff')) {
          var def = defMap(parsed.keys['flipflop def'] || '');
          var note = notes[tikz] && notes[tikz].kind === 'dff' ? notes[tikz] : null;
          var noteMap = Object.create(null);
          if (note) note.rest.forEach(function (pair) {
            var kv = pair.split('=');
            if (kv.length === 2) noteMap[kv[0]] = kv[1];
          });
          part = {
            id: 'p' + (doc.seq++),
            type: 'dff',
            name: identName(tikz || label, 'dff'),
            x: 0, y: 0,
            clkEdge: (noteMap.clk === 'neg' || def.n3 === '1') ? 'neg' : 'pos',
            hasRst: false,
            rstEdge: 'pos',
            rstVal: 0
          };
          var t2 = stripMath(def.t2 || '');
          if (t2 === 'RST' || t2 === 'SET' || (noteMap.rst && noteMap.rst !== 'none')) {
            part.hasRst = true;
            part.rstVal = (t2 === 'SET' || noteMap.val === '1') ? 1 : 0;
            part.rstEdge = (def.n2 === '1' || noteMap.rst === 'neg') ? 'neg' : 'pos';
          }
          if (styleIs(parsed.styles, 'flipflop SR') || styleIs(parsed.styles, 'flipflop T') || styleIs(parsed.styles, 'flipflop JK')) {
            warnings.push(part.name + ' is imported as a D flip-flop.');
          }
        } else if (styleIs(parsed.styles, 'muxdemux')) {
          part = { id: 'p' + (doc.seq++), type: 'mux', name: identName(tikz || label, 'mux'), x: 0, y: 0 };
          var md = defMap(parsed.keys['muxdemux def'] || '');
          if (md.NL && md.NL !== '2') warnings.push(part.name + ' is a 2-input mux in the drawing.');
        } else if (styleIs(parsed.styles, 'ocirc') || (notes[tikz] && notes[tikz].kind === 'port')) {
          var side = labelSide(parsed.keys);
          var dir = (notes[tikz] && notes[tikz].dir) || (side === 'right' || side === 'below' ? 'out' : 'in');
          var shown = stripMath(label) || tikz || dir;
          if (shown === '0' || shown === '1') {
            part = { id: 'p' + (doc.seq++), type: shown === '1' ? 'c1' : 'c0', name: shown === '1' ? 'hi' : 'lo', x: 0, y: 0 };
          } else {
            part = { id: 'p' + (doc.seq++), type: dir === 'out' ? 'out' : 'in', name: identName(shown, dir === 'out' ? 'y' : 'a'), x: 0, y: 0 };
          }
        } else if (styleIs(parsed.styles, 'circle') || (notes[tikz] && notes[tikz].kind === 'const')) {
          var bit = (notes[tikz] && notes[tikz].bit) || stripMath(node.text) || stripMath(label);
          if (bit === '0' || bit === '1') {
            part = { id: 'p' + (doc.seq++), type: bit === '1' ? 'c1' : 'c0', name: identName(tikz, bit === '1' ? 'hi' : 'lo'), x: 0, y: 0 };
          }
        } else if (styleIs(parsed.styles, 'circ')) {
          if (tikz && node.x != null) pinAlias[tikz] = { xy: 'xy:' + node.x.toFixed(3) + ',' + node.y.toFixed(3) };
          continue;
        } else if (parsed.styles.length === 1 && /^(left|right|above|below)$/.test(parsed.styles[0]) && label) {
          var shown2 = stripMath(label);
          var asOut = parsed.styles[0] === 'right' || parsed.styles[0] === 'below';
          part = { id: 'p' + (doc.seq++), type: asOut ? 'out' : 'in', name: identName(shown2, asOut ? 'y' : 'a'), x: 0, y: 0 };
        } else if (styleIs(parsed.styles, 'draw') || (notes[tikz] && notes[tikz].kind === 'block')) {
          var typeName = (notes[tikz] && notes[tikz].typeName) || '';
          var lines = String(node.text || '').split(/\\\\/);
          var inst = stripMath(lines[0]) || tikz || 'u';
          if (!typeName && lines[1]) typeName = stripMath(lines[1].replace(/\\scriptsize/g, ''));
          part = {
            id: 'p' + (doc.seq++),
            type: 'block',
            name: identName(inst, 'u'),
            x: 0, y: 0,
            ref: '',
            ext: typeName || 'block',
            ports: []
          };
        } else if (parsed.styles.length) {
          warnings.push('Skipped CircuiTikZ node ' + (tikz || parsed.styles[0]) + '.');
        }
        if (!part) continue;
        if (node.x == null) { node.x = 0; node.y = 0; }
        part._tx = node.x;
        part._ty = node.y;
        mod.parts.push(part);
        placeAt(part, node.x, node.y, doc);
        if (tikz) {
          byTikz[tikz] = part;
          if (node.x != null) pinAlias['xy:' + node.x.toFixed(3) + ',' + node.y.toFixed(3)] = { part: part.id, pin: anchorToPin(part, '') || (part.type === 'out' ? 'A' : 'Y') };
        }
      }
      dirs.forEach(function (line) {
        var bits = line.split(/\s+/);
        if (bits[0] !== 'pin') return;
        var owner = byTikz[bits[1]];
        if (!owner || owner.type !== 'block') return;
        owner.ports.push({ name: bits[2], dir: bits[3] === 'out' ? 'output' : 'input', frac: parseFloat(bits[4] || '0') });
      });
      mod.parts.forEach(function (part) {
        if (part.type !== 'block' || !part.ports) return;
        part.ports.sort(function (a, b) {
          var da = a.dir === 'output' ? 1 : 0;
          var db = b.dir === 'output' ? 1 : 0;
          return da - db || a.frac - b.frac;
        });
      });

      var parent = Object.create(null);
      function find(k) {
        if (parent[k] == null) parent[k] = k;
        if (parent[k] !== k) parent[k] = find(parent[k]);
        return parent[k];
      }
      function join(a, b) {
        a = find(a); b = find(b);
        if (a !== b) parent[b] = a;
      }
      function canonPoint(pt) {
        if (!pt) return '';
        if (pt.kind === 'xy') {
          var alias = pinAlias[pt.key];
          if (alias && alias.part) return 'pin:' + alias.part + ':' + alias.pin;
          if (alias && alias.xy) return alias.xy;
          return pt.key;
        }
        if (pinAlias[pt.name] && pinAlias[pt.name].part) return 'pin:' + pinAlias[pt.name].part + ':' + pinAlias[pt.name].pin;
        if (pinAlias[pt.name] && pinAlias[pt.name].xy && !pt.anchor) return pinAlias[pt.name].xy;
        var part = byTikz[pt.name];
        if (!part) return '';
        var pin = anchorToPin(part, pt.anchor);
        if (!pin) return '';
        return 'pin:' + part.id + ':' + pin;
      }
      function pointPos(pt) {
        if (pt.kind === 'xy') return { x: pt.x, y: pt.y };
        var part = byTikz[pt.name];
        if (!part) return null;
        return { x: (part.x) / PX, y: -(part.y) / PX };
      }

      var drawAt = 0;
      while (drawAt < chunk.body.length) {
        var dpos = keywordAt(chunk.body, 'draw', drawAt);
        if (dpos < 0) break;
        var body = readUntilSemi(chunk.body, dpos + 4);
        drawAt = body.next;
        var tokens = parseDrawBody(body.inner);
        var prev = null;
        var mode = '';
        var ti;
        for (ti = 0; ti < tokens.length; ti++) {
          var tok = tokens[ti];
          if (tok.k === 'pt') {
            var pt = interpretPoint(tok.raw);
            if (prev && (mode === 'wire' || mode === 'to')) {
              if (mode === 'to') {
                var kind = bipoleKind(modeSpec);
                if (kind !== 'short') {
                  var p1 = pointPos(prev);
                  var p2 = pointPos(pt);
                  var mx = p1 && p2 ? (p1.x + p2.x) / 2 : (p2 ? p2.x : 0);
                  var my = p1 && p2 ? (p1.y + p2.y) / 2 : (p2 ? p2.y : 0);
                  var block = {
                    id: 'p' + (doc.seq++),
                    type: 'block',
                    name: identName(bipoleLabel(modeSpec) || kind, kind),
                    x: 0, y: 0,
                    ref: '',
                    ext: kind,
                    ports: [{ name: 'a', dir: 'input' }, { name: 'b', dir: 'output' }]
                  };
                  mod.parts.push(block);
                  placeAt(block, mx, my, doc);
                  join(canonPoint(prev) || ('pin:' + block.id + ':a'), 'pin:' + block.id + ':a');
                  join(canonPoint(pt) || ('pin:' + block.id + ':b'), 'pin:' + block.id + ':b');
                  warnings.push(kind + ' ' + block.name + ' is drawn as a two-pin block.');
                } else {
                  var ka = canonPoint(prev), kb = canonPoint(pt);
                  if (ka && kb) join(ka, kb);
                }
              } else {
                var k1 = canonPoint(prev), k2 = canonPoint(pt);
                if (k1 && k2) join(k1, k2);
              }
            }
            prev = pt;
            mode = '';
          } else if (tok.k === 'wire') mode = 'wire';
          else if (tok.k === 'to') { mode = 'to'; var modeSpec = tok.spec; }
        }
      }

      var groups = Object.create(null);
      Object.keys(parent).forEach(function (k) {
        var root = find(k);
        if (k.indexOf('pin:') !== 0) return;
        if (!groups[root]) groups[root] = [];
        groups[root].push(k);
      });
      Object.keys(groups).forEach(function (root) {
        var seen = Object.create(null);
        var pins = [];
        groups[root].forEach(function (k) {
          if (seen[k]) return;
          seen[k] = 1;
          var bits = k.split(':');
          pins.push({ part: bits[1], pin: bits.slice(2).join(':') });
        });
        if (pins.length >= 2) mod.nets.push({ id: 'n' + (doc.seq++), name: '', pins: pins });
      });
      doc.modules.push(mod);
    });
    doc.modules.forEach(function (mod) {
      mod.parts.forEach(function (part) {
        if (part.type !== 'block' || !part.ext) return;
        var id = nameToId[part.ext];
        if (id && id !== mod.id) {
          part.ref = id;
          part.ports = [];
        }
      });
    });
    doc.active = doc.modules[0] ? doc.modules[0].id : 'm1';
    doc.modules.forEach(function (mod) {
      mod.parts.forEach(function (part) {
        if (part._tx == null) return;
        placeAt(part, part._tx, part._ty, doc);
        delete part._tx;
        delete part._ty;
      });
    });
    Design.prune(doc);
    return { doc: doc, warnings: warnings };
  }

  return { toTex: toTex, fromTex: fromTex, PX: PX };
});
