/* Drawing -> Verilog, the reverse of schematic.js.
   Gates are emitted as primitives so NAND/NOR/XNOR/BUF stay those symbols
   (a "~(a & b)" assign would come back as AND plus NOT).
   A mux is "assign y = s ? d1 : d0". A flip-flop is an always block.
   Module blocks are instances. The result is meant to compile with Schematic.compile. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Design = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MULTI = { and: 1, nand: 1, or: 1, nor: 1, xor: 1, xnor: 1 };
  var KEY = Object.create(null);
  /* IEEE 1364-2005 keywords, then the IEEE 1800-2012 ones: the simulator can
     run iverilog -g2012, which reserves them too. */
  (
    'always and assign automatic begin buf bufif0 bufif1 case casex casez cell cmos config ' +
    'deassign default defparam design disable edge else end endcase endconfig endfunction ' +
    'endgenerate endmodule endprimitive endspecify endtable endtask event for force forever ' +
    'fork function generate genvar highz0 highz1 if ifnone incdir include initial inout input ' +
    'instance integer join large liblist library localparam macromodule medium module nand ' +
    'negedge nmos nor noshowcancelled not notif0 notif1 or output parameter pmos posedge ' +
    'primitive pull0 pull1 pulldown pullup pulsestyle_ondetect pulsestyle_onevent rcmos real ' +
    'realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 scalared showcancelled ' +
    'signed small specify specparam strong0 strong1 supply0 supply1 table task time tran ' +
    'tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use uwire vectored wait wand ' +
    'weak0 weak1 while wire wor xnor xor ' +
    'accept_on alias always_comb always_ff always_latch assert assume before bind bins binsof ' +
    'bit break byte chandle checker class clocking const constraint context continue cover ' +
    'covergroup coverpoint cross dist do endchecker endclass endclocking endgroup endinterface ' +
    'endpackage endprogram endproperty endsequence enum eventually expect export extends extern ' +
    'final first_match foreach forkjoin global iff ignore_bins illegal_bins implements implies ' +
    'import inside int interconnect interface intersect join_any join_none let local logic ' +
    'longint matches modport nettype new nexttime null package packed priority program property ' +
    'protected pure rand randc randcase randsequence ref reject_on restrict return s_always ' +
    's_eventually s_nexttime s_until s_until_with sequence shortint shortreal soft solve static ' +
    'string strong struct super sync_accept_on sync_reject_on tagged this throughout ' +
    'timeprecision timeunit type typedef union unique unique0 until until_with untyped var ' +
    'virtual void wait_order weak wildcard with within'
  ).split(' ').forEach(function (k) { KEY[k] = 1; });
  var INNER = { and: 'and', nand: 'and', or: 'or', nor: 'or', xor: 'xor', xnor: 'xor' };
  var INVERTING = { nand: 1, nor: 1, xnor: 1 };
  var STUB_NOTE = '// External module stub (no logic). Replace with the real module.';

  var EXAMPLES = [
    ['half', 'Half adder'],
    ['full', 'Full adder'],
    ['mux', '2:1 mux'],
    ['shift', 'Shift register'],
    ['dff', 'D flip-flop'],
    ['blank', 'Blank']
  ];

  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function uid(doc, prefix) {
    doc.seq = (doc.seq || 0) + 1;
    return prefix + doc.seq;
  }

  function moduleById(doc, id) {
    var i;
    if (!doc || !doc.modules) return null;
    for (i = 0; i < doc.modules.length; i++) if (doc.modules[i].id === id) return doc.modules[i];
    return null;
  }

  function inName(i, n) {
    var names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    if (n === 1) return 'A';
    return names[i] || ('I' + i);
  }

  function ident(raw) {
    var s = String(raw == null ? '' : raw).trim();
    s = s.replace(/[^A-Za-z0-9_$]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) return '';
    if (/^[0-9$]/.test(s)) s = 'n_' + s;
    return s;
  }

  function blockTypeName(part, doc) {
    if (part && part.ref) {
      var m = moduleById(doc, part.ref);
      if (m && m.name) return m.name;
    }
    return (part && part.ext) || 'block';
  }

  function blockPorts(part, doc) {
    if (!part) return [];
    if (part.ref) {
      var mod = moduleById(doc, part.ref);
      if (mod) {
        return mod.parts.filter(function (p) { return p.type === 'in' || p.type === 'out'; })
          .slice()
          .sort(function (a, b) { return a.y - b.y || a.x - b.x || String(a.name).localeCompare(String(b.name)); })
          .map(function (p) {
            return { name: p.name || 'p', dir: p.type === 'in' ? 'input' : 'output', partId: p.id };
          });
      }
    }
    return (part.ports || []).map(function (p) {
      return { name: p.name || 'p', dir: p.dir === 'output' ? 'output' : (p.dir === 'inout' ? 'inout' : 'input') };
    });
  }

  function pinsOf(part, doc) {
    var t = part.type;
    var list, i, n, ports, ins, outs;
    if (t === 'in') return [{ name: 'Y', dir: 'out', side: 'r' }];
    if (t === 'out') return [{ name: 'A', dir: 'in', side: 'l' }];
    if (t === 'c0' || t === 'c1') return [{ name: 'Y', dir: 'out', side: 'r' }];
    if (t === 'not' || t === 'buf') {
      return [
        { name: 'A', dir: 'in', side: 'l' },
        { name: 'Y', dir: 'out', side: 'r' }
      ];
    }
    if (t === 'mux') {
      return [
        { name: 'D0', dir: 'in', side: 'l' },
        { name: 'D1', dir: 'in', side: 'l' },
        { name: 'Y', dir: 'out', side: 'r' },
        { name: 'S', dir: 'in', side: 'b' }
      ];
    }
    if (t === 'dff') {
      list = [{ name: 'D', dir: 'in', side: 'l' }];
      if (part.hasRst) list.push({ name: part.rstVal ? 'SET' : 'RST', dir: 'in', side: 'l' });
      list.push({ name: 'Q', dir: 'out', side: 'r' });
      list.push({ name: 'CLK', dir: 'in', side: 'b' });
      return list;
    }
    if (t === 'block') {
      ports = blockPorts(part, doc);
      ins = [];
      outs = [];
      for (i = 0; i < ports.length; i++) {
        var dir = ports[i].dir === 'output' ? 'out' : (ports[i].dir === 'inout' ? 'inout' : 'in');
        var pin = { name: String(ports[i].name || 'p'), dir: dir, side: dir === 'out' ? 'r' : 'l' };
        if (dir === 'out') outs.push(pin);
        else ins.push(pin);
      }
      return ins.concat(outs);
    }
    n = Math.max(2, Math.min(8, part.inputs || 2));
    list = [];
    for (i = 0; i < n; i++) list.push({ name: inName(i, n), dir: 'in', side: 'l' });
    list.push({ name: 'Y', dir: 'out', side: 'r' });
    return list;
  }

  function metrics(part, doc) {
    var spec = pinsOf(part, doc);
    var nL = 0, nR = 0, nB = 0, i, w, h, n, lw;
    for (i = 0; i < spec.length; i++) {
      if (spec[i].side === 'l') nL++;
      else if (spec[i].side === 'r') nR++;
      else nB++;
    }
    if (part.type === 'in' || part.type === 'out') {
      w = Math.max(44, 8 * String(part.name || '').length + 18);
      h = 26;
    } else if (part.type === 'c0' || part.type === 'c1') {
      w = 28;
      h = 28;
    } else if (part.type === 'block') {
      lw = Math.max(String(part.name || '').length, String(blockTypeName(part, doc)).length);
      n = Math.max(nL, nR, 1);
      w = Math.max(112, Math.min(220, 7 * lw + 36));
      h = Math.max(52, 18 + n * 16);
    } else {
      n = Math.max(nL, nR, 1);
      w = part.type === 'dff' ? 76 : 68;
      h = Math.max(48, 14 + n * 16);
      if (nB) h += 6;
    }
    var L = [], R = [], B = [];
    for (i = 0; i < spec.length; i++) {
      var q = { name: spec[i].name, dir: spec[i].dir, side: spec[i].side, x: 0, y: 0 };
      if (q.side === 'r') R.push(q);
      else if (q.side === 'b') B.push(q);
      else L.push(q);
    }
    for (i = 0; i < L.length; i++) { L[i].x = 0; L[i].y = (i + 1) * h / (L.length + 1); }
    for (i = 0; i < R.length; i++) { R[i].x = w; R[i].y = (i + 1) * h / (R.length + 1); }
    for (i = 0; i < B.length; i++) { B[i].y = h; B[i].x = (i + 1) * w / (B.length + 1); }
    return { w: w, h: h, pins: L.concat(R, B) };
  }

  function autoName(mod, type) {
    var used = Object.create(null);
    var i;
    for (i = 0; i < mod.parts.length; i++) used[mod.parts[i].name] = 1;
    var letters, k, base, name, n;
    if (type === 'in') {
      letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
      for (k = 0; k < letters.length; k++) if (!used[letters[k]]) return letters[k];
    }
    if (type === 'out') {
      letters = ['y', 'z', 's', 'c'];
      for (k = 0; k < letters.length; k++) if (!used[letters[k]]) return letters[k];
    }
    base = {
      in: 'in', out: 'y', c0: 'lo', c1: 'hi', block: 'u', dff: 'dff', mux: 'mux',
      not: 'inv', buf: 'buf'
    }[type] || type || 'u';
    name = base;
    n = 1;
    while (used[name]) { n++; name = base + n; }
    return name;
  }

  function freshPart(doc, moduleId, type, x, y) {
    var mod = moduleById(doc, moduleId);
    var part = {
      id: uid(doc, 'p'),
      type: type,
      x: x,
      y: y,
      name: mod ? autoName(mod, type) : (type || 'u')
    };
    if (MULTI[type]) part.inputs = 2;
    if (type === 'dff') {
      part.clkEdge = 'pos';
      part.hasRst = false;
      part.rstEdge = 'pos';
      part.rstVal = 0;
    }
    if (type === 'block') {
      part.ref = '';
      part.ext = 'block';
      part.ports = [
        { name: 'a', dir: 'input' },
        { name: 'y', dir: 'output' }
      ];
    }
    return part;
  }

  function normalizePart(part) {
    if (!part.name) part.name = part.type || 'u';
    if (MULTI[part.type]) {
      var n = part.inputs || 2;
      if (n < 2) n = 2;
      if (n > 8) n = 8;
      part.inputs = n;
    }
    if (part.type === 'dff') {
      if (part.clkEdge !== 'neg') part.clkEdge = 'pos';
      if (part.rstEdge !== 'neg') part.rstEdge = 'pos';
      part.rstVal = part.rstVal ? 1 : 0;
      part.hasRst = !!part.hasRst;
    }
    if (part.type === 'block') {
      if (!part.ref) part.ref = '';
      if (!part.ext) part.ext = 'block';
      if (!part.ports) part.ports = [];
    }
  }

  function prune(doc) {
    if (!doc.modules) doc.modules = [];
    doc.modules.forEach(function (mod) {
      if (!mod.parts) mod.parts = [];
      if (!mod.nets) mod.nets = [];
      var map = Object.create(null);
      mod.parts.forEach(function (p) { normalizePart(p); map[p.id] = p; });
      var owner = Object.create(null);
      mod.nets.forEach(function (net) {
        if (!net.pins) net.pins = [];
        if (net.name == null) net.name = '';
        var seen = Object.create(null);
        net.pins = net.pins.filter(function (ref) {
          var p = map[ref.part];
          if (!p) return false;
          var ok = pinsOf(p, doc).some(function (pin) { return pin.name === ref.pin; });
          if (!ok) return false;
          var k = ref.part + '.' + ref.pin;
          if (seen[k] || owner[k]) return false;
          seen[k] = 1;
          owner[k] = 1;
          return true;
        });
      });
      mod.nets = mod.nets.filter(function (n) { return n.pins.length >= 2; });
    });
    if (!moduleById(doc, doc.active) && doc.modules[0]) doc.active = doc.modules[0].id;
    return doc;
  }

  function blank() {
    return {
      v: 1,
      seq: 1,
      active: 'm1',
      modules: [{ id: 'm1', name: 'top', parts: [], nets: [] }]
    };
  }

  function P(id, type, name, x, y, extra) {
    var p = { id: id, type: type, name: name, x: x, y: y };
    var k;
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
    return p;
  }

  function N(id, pins, name) {
    return {
      id: id,
      name: name || '',
      pins: pins.map(function (s) {
        var i = s.indexOf('.');
        return { part: s.slice(0, i), pin: s.slice(i + 1) };
      })
    };
  }

  function dff(id, name, x, y, rst) {
    return P(id, 'dff', name, x, y, {
      clkEdge: 'pos', hasRst: !!rst, rstEdge: 'pos', rstVal: 0
    });
  }

  function example(name) {
    if (name === 'blank') return blank();
    if (name === 'half') {
      return {
        v: 1, seq: 40, active: 'm1',
        modules: [{
          id: 'm1', name: 'half_adder',
          parts: [
            P('a', 'in', 'a', 48, 64),
            P('b', 'in', 'b', 48, 164),
            P('sx', 'xor', 'sum', 230, 48),
            P('ca', 'and', 'carry', 230, 156),
            P('s', 'out', 's', 460, 64),
            P('c', 'out', 'c', 460, 172)
          ],
          nets: [
            N('n1', ['a.Y', 'sx.A', 'ca.A']),
            N('n2', ['b.Y', 'sx.B', 'ca.B']),
            N('n3', ['sx.Y', 's.A']),
            N('n4', ['ca.Y', 'c.A'])
          ]
        }]
      };
    }
    if (name === 'full') {
      var half = example('half').modules[0];
      half.id = 'ha';
      return {
        v: 1, seq: 40, active: 'fa',
        modules: [
          half,
          {
            id: 'fa', name: 'full_adder',
            parts: [
              P('a', 'in', 'a', 36, 48),
              P('b', 'in', 'b', 36, 112),
              P('cin', 'in', 'cin', 36, 188),
              P('ha1', 'block', 'ha1', 200, 40, { ref: 'ha', ext: '', ports: [] }),
              P('ha2', 'block', 'ha2', 430, 40, { ref: 'ha', ext: '', ports: [] }),
              P('oc', 'or', 'carry', 680, 150),
              P('sum', 'out', 'sum', 880, 56),
              P('cout', 'out', 'cout', 880, 168)
            ],
            nets: [
              N('na', ['a.Y', 'ha1.a']),
              N('nb', ['b.Y', 'ha1.b']),
              N('nc', ['cin.Y', 'ha2.b']),
              N('ns', ['ha1.s', 'ha2.a'], 's1'),
              N('n1', ['ha1.c', 'oc.A'], 'c1'),
              N('n2', ['ha2.c', 'oc.B'], 'c2'),
              N('ny', ['ha2.s', 'sum.A']),
              N('no', ['oc.Y', 'cout.A'])
            ]
          }
        ]
      };
    }
    if (name === 'mux') {
      return {
        v: 1, seq: 20, active: 'm1',
        modules: [{
          id: 'm1', name: 'mux2',
          parts: [
            P('a', 'in', 'a', 48, 40),
            P('b', 'in', 'b', 48, 112),
            P('sel', 'in', 'sel', 48, 196),
            P('mx', 'mux', 'mux', 250, 52),
            P('y', 'out', 'y', 470, 78)
          ],
          nets: [
            N('n0', ['a.Y', 'mx.D0']),
            N('n1', ['b.Y', 'mx.D1']),
            N('ns', ['sel.Y', 'mx.S']),
            N('ny', ['mx.Y', 'y.A'])
          ]
        }]
      };
    }
    if (name === 'dff') {
      return {
        v: 1, seq: 20, active: 'm1',
        modules: [{
          id: 'm1', name: 'd_ff',
          parts: [
            P('d', 'in', 'd', 48, 78),
            P('rst', 'in', 'rst', 48, 150),
            P('clk', 'in', 'clk', 200, 230),
            dff('ff', 'ff', 250, 64, true),
            P('q', 'out', 'q', 490, 86)
          ],
          nets: [
            N('nd', ['d.Y', 'ff.D']),
            N('nr', ['rst.Y', 'ff.RST']),
            N('nk', ['clk.Y', 'ff.CLK']),
            N('nq', ['ff.Q', 'q.A'])
          ]
        }]
      };
    }
    if (name === 'shift') {
      return {
        v: 1, seq: 30, active: 'm1',
        modules: [{
          id: 'm1', name: 'shiftreg',
          parts: [
            P('clk', 'in', 'clk', 36, 36),
            P('rst', 'in', 'rst', 36, 250),
            P('din', 'in', 'din', 36, 112),
            dff('d0', 'd0', 190, 88, true),
            dff('d1', 'd1', 370, 88, true),
            dff('d2', 'd2', 550, 88, true),
            dff('d3', 'd3', 730, 88, true),
            P('q0', 'out', 'q0', 190, 230),
            P('q1', 'out', 'q1', 370, 230),
            P('q2', 'out', 'q2', 550, 230),
            P('q3', 'out', 'q3', 730, 230)
          ],
          nets: [
            N('nk', ['clk.Y', 'd0.CLK', 'd1.CLK', 'd2.CLK', 'd3.CLK']),
            N('nr', ['rst.Y', 'd0.RST', 'd1.RST', 'd2.RST', 'd3.RST']),
            N('nd', ['din.Y', 'd0.D']),
            N('n0', ['d0.Q', 'd1.D', 'q0.A']),
            N('n1', ['d1.Q', 'd2.D', 'q1.A']),
            N('n2', ['d2.Q', 'd3.D', 'q2.A']),
            N('n3', ['d3.Q', 'q3.A'])
          ]
        }]
      };
    }
    return example('half');
  }

  function safeLabel(raw) {
    var original = String(raw == null ? '' : raw).trim();
    var s = original.replace(/\[(\d+)\]/g, '_$1').replace(/\[|\]/g, '');
    var id = ident(s);
    if (!id) id = 'p';
    return { name: id, changed: id !== original };
  }

  function inputCount(cell) {
    var n = 0;
    (cell.pins || []).forEach(function (p) { if (p.dir === 'in') n++; });
    return n;
  }

  /* A drawn gate has at most 8 inputs. A wider one becomes a tree whose inner
     gates use the non-inverting kind, so the root keeps the original logic. */
  function gateTree(cell) {
    var level = [];
    var out = null;
    (cell.pins || []).forEach(function (p) {
      if (p.dir === 'in') level.push(p.net);
      else if (p.dir === 'out' && !out) out = p.net;
    });
    var inner = [];
    var depth = 0;
    var k = 0;
    function gate(id, kind, name, nets, outNet) {
      var pins = nets.map(function (n, j) { return { name: inName(j, nets.length), dir: 'in', net: n }; });
      pins.push({ name: 'Y', dir: 'out', net: outNet });
      return { id: id, kind: kind, name: name, pins: pins };
    }
    while (level.length > 8) {
      var groups = Math.ceil(level.length / 8);
      var next = [];
      var start = 0, g;
      depth++;
      for (g = 0; g < groups; g++) {
        var size = Math.floor(level.length / groups) + (g < level.length % groups ? 1 : 0);
        var net = { id: 'tree_' + cell.id + '_' + k, label: '', isConst: false };
        k++;
        var c = gate(cell.id + '_' + k, INNER[cell.kind], cell.name + '_' + k, level.slice(start, start + size), net);
        c.level = depth;
        c.row = g - (groups - 1) / 2;
        inner.push(c);
        next.push(net);
        start += size;
      }
      level = next;
    }
    var root = gate(cell.id, cell.kind, cell.name, level, out);
    root.x = cell.x;
    root.y = cell.y;
    inner.forEach(function (c) {
      if (typeof cell.x !== 'number' || typeof cell.y !== 'number') return;
      c.x = cell.x - 120 * (depth - c.level + 1);
      c.y = Math.max(0, cell.y + c.row * 80);
    });
    return inner.concat([root]);
  }

  function emptyModule(mod) {
    return (mod.cells || []).every(function (c) { return c.kind === 'port'; });
  }

  /* opts.externals: names of modules that are only stubs for external blocks
     (Design.externalStubs of the source). Their instances stay external. */
  function fromCompiled(compiled, opts) {
    var warnings = [];
    var doc = blank();
    doc.modules = [];
    if (!compiled || !compiled.ok) {
      warnings.push((compiled && compiled.error) || 'Verilog did not compile');
      doc.modules = blank().modules;
      return { doc: doc, warnings: warnings };
    }
    var seq = 1;
    var idByName = Object.create(null);
    var order = compiled.order && compiled.order.length ? compiled.order.slice() : Object.keys(compiled.modules || {});
    var pendingRef = [];
    var GATE = { and: 1, nand: 1, or: 1, nor: 1, xor: 1, xnor: 1, not: 1, buf: 1 };
    var stubs = Object.create(null);
    ((opts && opts.externals) || []).forEach(function (n) { stubs[n] = 1; });

    order.forEach(function (modName) {
      var src = compiled.modules[modName];
      if (!src) return;
      if (stubs[modName] && modName !== compiled.top && emptyModule(src)) return;
      var modId = 'm' + (seq++);
      idByName[src.name || modName] = modId;
      var usedNames = Object.create(null);
      function uniq(raw, fallback) {
        var base = safeLabel(raw).name || fallback || 'p';
        if (safeLabel(raw).changed && raw) warnings.push(src.name + ': renamed ' + raw + ' to ' + base);
        var n = base, i = 2;
        while (usedNames[n]) { n = base + '_' + i; i++; }
        usedNames[n] = 1;
        return n;
      }
      var parts = [];
      var cellPart = Object.create(null);
      var gi = 0;
      var cells = [];
      (src.cells || []).forEach(function (cell) {
        var nIn = inputCount(cell);
        if (!MULTI[cell.kind] || nIn <= 8) {
          cells.push(cell);
          return;
        }
        var tree = gateTree(cell);
        warnings.push(src.name + ': ' + cell.kind.toUpperCase() + ' ' + cell.name + ' has ' + nIn +
          ' inputs and is drawn as ' + tree.length + ' gates (8 inputs at most)');
        cells = cells.concat(tree);
      });
      cells.forEach(function (cell) {
        var x = typeof cell.x === 'number' ? cell.x : 40 + (gi % 6) * 150;
        var y = typeof cell.y === 'number' ? cell.y : 40 + Math.floor(gi / 6) * 110;
        var part = null;
        if (cell.kind === 'port') {
          if (cell.dir === 'inout') warnings.push('Inout ' + cell.name + ' imported as an output');
          part = {
            id: 'p' + (seq++),
            type: cell.dir === 'input' ? 'in' : 'out',
            name: uniq(cell.name, cell.dir === 'input' ? 'in' : 'y'),
            x: x, y: y
          };
        } else if (GATE[cell.kind]) {
          var nIn = inputCount(cell);
          var type = cell.kind;
          if (MULTI[type] && nIn === 1) {
            type = INVERTING[type] ? 'not' : 'buf';
            warnings.push(src.name + ': 1-input ' + cell.kind.toUpperCase() + ' ' + cell.name + ' imported as ' + type.toUpperCase());
          }
          part = {
            id: 'p' + (seq++),
            type: type,
            name: uniq(cell.name, type),
            x: x, y: y,
            inputs: MULTI[type] ? Math.max(2, Math.min(8, nIn || 2)) : 1
          };
        } else if (cell.kind === 'const') {
          part = {
            id: 'p' + (seq++),
            type: cell.value ? 'c1' : 'c0',
            name: cell.value ? 'hi' : 'lo',
            x: x, y: y
          };
          uniq(part.name, 'c');
        } else if (cell.kind === 'mux') {
          part = { id: 'p' + (seq++), type: 'mux', name: uniq(cell.name, 'mux'), x: x, y: y };
        } else if (cell.kind === 'dff') {
          var hasRst = false, rstVal = 0, rstEdge = 'pos', clkEdge = 'pos';
          (cell.pins || []).forEach(function (p) {
            if (p.name === 'CLK' && p.bubble) clkEdge = 'neg';
            if (p.name === 'RST' || p.name === 'SET') {
              hasRst = true;
              rstVal = p.name === 'SET' ? 1 : 0;
              rstEdge = p.bubble ? 'neg' : 'pos';
            }
          });
          part = {
            id: 'p' + (seq++),
            type: 'dff',
            name: uniq(cell.name, 'dff'),
            x: x, y: y,
            clkEdge: clkEdge, hasRst: hasRst, rstEdge: rstEdge, rstVal: rstVal
          };
        } else if (cell.kind === 'mod' || cell.kind === 'op' || cell.kind === 'proc') {
          var ports = [];
          (cell.pins || []).forEach(function (p, idx) {
            var nm = safeLabel(p.name || ('p' + idx)).name;
            ports.push({ name: nm, dir: p.dir === 'out' ? 'output' : 'input' });
          });
          part = {
            id: 'p' + (seq++),
            type: 'block',
            name: uniq(cell.name, 'u'),
            x: x, y: y,
            ref: '',
            ext: cell.typeName || cell.kind || 'block',
            ports: ports
          };
          if (cell.kind === 'mod') pendingRef.push({ part: part, typeName: cell.typeName });
          else warnings.push((cell.typeName || cell.kind) + ' ' + (cell.name || '') + ' imported as a module stub. The original expression is not reconstructed.');
        } else {
          warnings.push('Skipped ' + (cell.kind || 'cell') + ' ' + (cell.name || ''));
        }
        if (part) {
          parts.push(part);
          cellPart[cell.id] = part;
          gi++;
        }
      });
      var nets = [];
      var seen = Object.create(null);
      cells.forEach(function (cell) {
        var part = cellPart[cell.id];
        if (!part) return;
        (cell.pins || []).forEach(function (pin) {
          if (!pin.net) return;
          var pname = '';
          if (part.type === 'in') pname = 'Y';
          else if (part.type === 'out') pname = 'A';
          else if (part.type === 'c0' || part.type === 'c1') pname = 'Y';
          else if (part.type === 'block') pname = safeLabel(pin.name || 'p').name;
          else pname = pin.name;
          if (!pinsOf(part, doc).some(function (sp) { return sp.name === pname; })) return;
          var bucket = seen[pin.net.id];
          if (!bucket) {
            var label = !pin.net.isConst && pin.net.label ? safeLabel(pin.net.label).name : '';
            bucket = { id: 'n' + (seq++), name: label, pins: [] };
            seen[pin.net.id] = bucket;
            nets.push(bucket);
          }
          if (!bucket.pins.some(function (r) { return r.part === part.id && r.pin === pname; })) {
            bucket.pins.push({ part: part.id, pin: pname });
          }
        });
      });
      var partById = Object.create(null);
      parts.forEach(function (p) { partById[p.id] = p; });
      nets.forEach(function (net) {
        var onPort = net.pins.some(function (r) {
          var t = partById[r.part].type;
          return t === 'in' || t === 'out';
        });
        if (onPort) net.name = '';
      });
      doc.modules.push({ id: modId, name: src.name || modName, parts: parts, nets: nets });
    });

    pendingRef.forEach(function (item) {
      var id = item.typeName && idByName[item.typeName];
      if (id) {
        item.part.ref = id;
        item.part.ext = '';
        item.part.ports = [];
      }
    });
    if (!doc.modules.length) doc.modules = blank().modules;
    doc.seq = seq + 1;
    doc.active = (compiled.top && idByName[compiled.top]) || doc.modules[0].id;
    prune(doc);
    (compiled.warnings || []).forEach(function (w) { if (w) warnings.push(String(w)); });
    return { doc: doc, warnings: warnings };
  }

  function byPos(a, b) {
    return a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id));
  }

  function report(doc) {
    try {
      return reportInner(doc);
    } catch (err) {
      return {
        verilog: '',
        issues: [{ level: 'error', msg: (err && err.message) ? err.message : String(err) }],
        labels: {}
      };
    }
  }

  function reportInner(doc) {
    var issues = [];
    var labels = {};
    if (!doc || !doc.modules || !doc.modules.length) {
      return { verilog: '', issues: [{ level: 'error', msg: 'No module in the drawing' }], labels: labels };
    }
    var modUsed = Object.create(null);
    function takeGlobal(raw, fallback, ctx) {
      var want = ident(raw);
      var base = want || ident(fallback) || 'top';
      if (KEY[base]) base = base + '_n';
      var n = base, i = 2;
      while (modUsed[n]) { n = base + '_' + i; i++; }
      modUsed[n] = 1;
      if (ctx && raw && n !== String(raw).trim()) {
        issues.push({ level: 'warn', msg: 'Module "' + raw + '" is named ' + n + ' in Verilog', moduleId: ctx.moduleId });
      }
      return n;
    }
    doc.modules.forEach(function (mod) {
      var used = Object.create(null);
      Object.keys(KEY).forEach(function (k) { used[k] = 1; });
      function take(raw, fallback, ctx) {
        var want = ident(raw);
        var base = want || ident(fallback) || 'n';
        if (KEY[base]) base = base + '_n';
        var n = base, i = 2;
        while (used[n]) { n = base + '_' + i; i++; }
        used[n] = 1;
        if (ctx && raw && n !== String(raw).trim()) {
          issues.push({
            level: 'warn',
            msg: (ctx.what || 'Name') + ' "' + raw + '" is ' + n + ' in Verilog',
            moduleId: mod.id,
            partId: ctx.partId || '',
            netId: ctx.netId || ''
          });
        }
        return n;
      }
      var vname = takeGlobal(mod.name, 'top', { moduleId: mod.id });
      var portParts = mod.parts.filter(function (p) { return p.type === 'in' || p.type === 'out'; }).slice().sort(function (a, b) {
        var da = a.type === 'in' ? 0 : 1;
        var db = b.type === 'in' ? 0 : 1;
        return da - db || a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id));
      });
      var portList = portParts.map(function (p) {
        var nm = take(p.name, p.type === 'in' ? 'in' : 'y', { what: 'Port', partId: p.id });
        return { partId: p.id, vname: nm, dir: p.type === 'in' ? 'input' : 'output', reg: false };
      });
      var portNames = Object.create(null);
      var portsByPart = Object.create(null);
      portList.forEach(function (p) {
        portNames[p.vname] = 1;
        portsByPart[p.partId] = p;
      });
      labels[mod.id] = {
        vname: vname,
        used: used,
        take: take,
        portList: portList,
        portNames: portNames,
        portsByPart: portsByPart,
        ports: {},
        nets: {},
        inst: {}
      };
      portList.forEach(function (p) { labels[mod.id].ports[p.partId] = p.vname; });
    });

    var defined = Object.create(null);
    doc.modules.forEach(function (mod) { defined[labels[mod.id].vname] = mod; });

    var externals = Object.create(null);
    var chunks = [];
    var done = Object.create(null);
    var visiting = Object.create(null);

    function emitOne(mod) {
      if (!mod || done[mod.id]) return;
      if (visiting[mod.id]) {
        issues.push({ level: 'warn', msg: 'Module ' + (mod.name || '') + ' instantiates itself', moduleId: mod.id });
        return;
      }
      visiting[mod.id] = 1;
      mod.parts.forEach(function (p) {
        if (p.type === 'block' && p.ref && p.ref !== mod.id) emitOne(moduleById(doc, p.ref));
        if (p.type === 'block' && p.ref === mod.id) {
          issues.push({ level: 'warn', msg: 'Module instantiates itself', moduleId: mod.id, partId: p.id });
        }
      });
      visiting[mod.id] = 0;
      done[mod.id] = 1;
      chunks.push(emitModule(mod));
    }

    function emitModule(mod) {
      var lab = labels[mod.id];
      var take = lab.take;
      var byId = Object.create(null);
      mod.parts.forEach(function (p) { byId[p.id] = p; });
      var specCache = Object.create(null);
      function spec(part) {
        if (!specCache[part.id]) specCache[part.id] = pinsOf(part, doc);
        return specCache[part.id];
      }
      var pinAt = Object.create(null);
      function pinOf(part, name) {
        var list = spec(part), i;
        for (i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
        return null;
      }

      var nets = (mod.nets || []).filter(function (net) {
        var n = 0;
        (net.pins || []).forEach(function (ref) {
          var p = byId[ref.part];
          if (p && pinOf(p, ref.pin)) n++;
        });
        return n >= 2;
      });

      var infos = [];
      nets.forEach(function (net) {
        var drivers = [];
        (net.pins || []).forEach(function (ref) {
          var part = byId[ref.part];
          if (!part) return;
          var pin = pinOf(part, ref.pin);
          if (!pin) return;
          if (pin.dir === 'out' || pin.dir === 'inout') drivers.push({ part: part, pin: pin.name });
        });
        var logic = drivers.filter(function (d) {
          return d.part.type !== 'in' && d.part.type !== 'c0' && d.part.type !== 'c1';
        });
        var consts = drivers.filter(function (d) { return d.part.type === 'c0' || d.part.type === 'c1'; });
        var ins = drivers.filter(function (d) { return d.part.type === 'in'; });
        var outPorts = [];
        var inPorts = [];
        (net.pins || []).forEach(function (ref) {
          var slot = lab.portsByPart[ref.part];
          if (!slot) return;
          if (slot.dir === 'output') outPorts.push(slot);
          else inPorts.push(slot);
        });
        if (drivers.length > 1) {
          issues.push({
            level: 'error',
            msg: 'Net has ' + drivers.length + ' drivers',
            moduleId: mod.id,
            netId: net.id
          });
        }
        var reg = logic.some(function (d) { return d.part.type === 'dff' && d.pin === 'Q'; });
        var info = {
          net: net,
          drivers: drivers,
          logic: logic,
          consts: consts,
          ins: ins,
          outPorts: outPorts,
          inPorts: inPorts,
          kind: reg ? 'reg' : 'wire',
          expr: null,
          vname: null,
          defer: false
        };
        if (!logic.length && consts.length && !ins.length) {
          info.kind = 'const';
          info.expr = consts[0].part.type === 'c1' ? "1'b1" : "1'b0";
        }
        infos.push(info);
        lab.nets[net.id] = info;
      });

      function netKey(info) {
        var best = 1e9, x = 1e9, part = null;
        (info.net.pins || []).forEach(function (ref) {
          var p = byId[ref.part];
          if (!p) return;
          if (p.y < best || (p.y === best && p.x < x)) { best = p.y; x = p.x; part = p; }
        });
        return { y: best, x: x, id: part ? String(part.id) : info.net.id };
      }
      infos.sort(function (a, b) {
        var ka = netKey(a), kb = netKey(b);
        return ka.y - kb.y || ka.x - kb.x || String(ka.id).localeCompare(String(kb.id));
      });

      infos.forEach(function (info) {
        if (info.kind === 'const') return;
        if (info.logic.length) {
          if (info.outPorts.length) {
            info.vname = info.outPorts[0].vname;
            info.expr = info.vname;
            if (info.kind === 'reg') info.outPorts[0].reg = true;
          } else if (ident(info.net.name)) {
            info.vname = take(info.net.name, 'n', { what: 'Net', netId: info.net.id });
            info.expr = info.vname;
          } else info.defer = true;
          return;
        }
        if (info.ins.length) {
          info.kind = 'port-in';
          info.vname = info.inPorts.length ? info.inPorts[0].vname : info.ins[0].part && lab.ports[info.ins[0].part.id];
          if (!info.vname) info.vname = lab.ports[info.ins[0].part.id];
          info.expr = info.vname;
          return;
        }
        if (info.outPorts.length) {
          info.vname = info.outPorts[0].vname;
          info.expr = info.vname;
          issues.push({
            level: 'warn',
            msg: 'Output ' + info.vname + ' has no driver',
            moduleId: mod.id,
            partId: info.outPorts[0].partId,
            netId: info.net.id
          });
          return;
        }
        if (ident(info.net.name)) {
          info.vname = take(info.net.name, 'n', { what: 'Net', netId: info.net.id });
          info.expr = info.vname;
          issues.push({ level: 'warn', msg: 'Net ' + info.vname + ' has no driver', moduleId: mod.id, netId: info.net.id });
        } else {
          info.defer = true;
          info._undriven = true;
        }
      });

      var pinNet = Object.create(null);
      infos.forEach(function (info) {
        (info.net.pins || []).forEach(function (ref) {
          pinNet[ref.part + '.' + ref.pin] = info;
        });
      });

      function exprOf(part, pinName) {
        var info = pinNet[part.id + '.' + pinName];
        return info ? info.expr : null;
      }

      mod.parts.slice().sort(byPos).forEach(function (part) {
        if (MULTI[part.type] || part.type === 'not' || part.type === 'buf' || part.type === 'block') {
          var inst = take(part.name, part.type || 'u', { what: 'Instance', partId: part.id });
          lab.inst[part.id] = inst;
        }
      });

      infos.forEach(function (info) {
        if (!info.defer) return;
        info.vname = take(info.net.name, 'n', info.net.name ? { what: 'Net', netId: info.net.id } : null);
        info.expr = info.vname;
        if (info._undriven) {
          issues.push({ level: 'warn', msg: 'Net ' + info.vname + ' has no driver', moduleId: mod.id, netId: info.net.id });
        }
      });

      var wires = [];
      var regs = [];
      var seenDecl = Object.create(null);
      function declareWire(n) {
        if (!n || seenDecl[n] || lab.portNames[n]) return;
        seenDecl[n] = 1;
        wires.push(n);
      }
      function declareReg(n) {
        if (!n || seenDecl[n] || lab.portNames[n]) return;
        seenDecl[n] = 1;
        regs.push(n);
      }
      infos.forEach(function (info) {
        if (!info.vname || lab.portNames[info.vname]) return;
        if (info.kind === 'reg') declareReg(info.vname);
        else if (info.kind === 'wire' || info.kind === 'port-in') declareWire(info.vname);
      });

      mod.parts.forEach(function (part) {
        spec(part).forEach(function (pin) {
          if (pinNet[part.id + '.' + pin.name]) return;
          if (part.type === 'in' || part.type === 'c0' || part.type === 'c1') return;
          if (part.type === 'out') {
            issues.push({ level: 'warn', msg: 'Output ' + (lab.ports[part.id] || part.name) + ' is not connected', moduleId: mod.id, partId: part.id });
            return;
          }
          if (pin.dir === 'out') {
            issues.push({ level: 'warn', msg: part.name + ' output ' + pin.name + ' is open', moduleId: mod.id, partId: part.id });
            return;
          }
          if (part.type === 'dff' && (pin.name === 'CLK' || pin.name === 'RST' || pin.name === 'SET')) {
            issues.push({
              level: pin.name === 'CLK' ? 'error' : 'warn',
              msg: part.name + ' ' + pin.name + ' is open',
              moduleId: mod.id,
              partId: part.id
            });
            return;
          }
          var msg = part.name + ' input ' + pin.name + ' is open';
          if (part.type === 'mux' && pin.name === 'S') msg = part.name + ' select is open, so the viewer drops the mux and keeps D0';
          else if (part.type !== 'block') msg += ' and exports as 0';
          issues.push({ level: 'warn', msg: msg, moduleId: mod.id, partId: part.id });
        });
      });

      combLoop(mod, byId, spec, pinNet, issues);

      var assigns = [];
      var gates = [];
      var always = [];
      var insts = [];
      var dffGroups = [];

      infos.forEach(function (info) {
        if (info.kind === 'const') {
          info.outPorts.forEach(function (p) {
            assigns.push('  assign ' + p.vname + ' = ' + info.expr + ';');
          });
          return;
        }
        if (info.kind === 'port-in') {
          info.outPorts.forEach(function (p) {
            assigns.push('  assign ' + p.vname + ' = ' + info.expr + ';');
          });
          return;
        }
        if (info.logic.length && info.outPorts.length > 1) {
          var src = info.expr;
          info.outPorts.slice(1).forEach(function (p) {
            assigns.push('  assign ' + p.vname + ' = ' + src + ';');
          });
        }
      });

      function isIdent(e) { return !!e && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(e); }

      function tie(part, pinName, fallback) {
        var e = exprOf(part, pinName);
        if (e) return e;
        return fallback;
      }

      var ties = Object.create(null);
      function constEdge(part, pinName, value) {
        issues.push({
          level: 'warn',
          msg: part.name + ' ' + pinName + ' is tied to constant ' + (value === "1'b1" ? '1' : '0'),
          moduleId: mod.id,
          partId: part.id
        });
        if (!ties[value]) {
          ties[value] = take('', value === "1'b1" ? 'tie1' : 'tie0');
          declareWire(ties[value]);
          assigns.push('  assign ' + ties[value] + ' = ' + value + ';');
        }
        return ties[value];
      }
      function isConst(e) { return e === "1'b0" || e === "1'b1"; }

      mod.parts.slice().sort(byPos).forEach(function (part) {
        var t = part.type;
        if (MULTI[t] || t === 'not' || t === 'buf') {
          var y = exprOf(part, 'Y');
          if (!y) {
            y = take('', 'open');
            declareWire(y);
          }
          var ins = spec(part).filter(function (p) { return p.dir === 'in'; });
          var args = [y].concat(ins.map(function (p) { return tie(part, p.name, "1'b0"); }));
          gates.push('  ' + t + ' ' + lab.inst[part.id] + ' (' + args.join(', ') + ');');
          return;
        }
        if (t === 'mux') {
          var my = exprOf(part, 'Y');
          if (!my) {
            my = take('', 'open');
            declareWire(my);
          }
          var d0 = tie(part, 'D0', "1'b0");
          var d1 = tie(part, 'D1', "1'b0");
          var sel = tie(part, 'S', "1'b0");
          assigns.push('  assign ' + my + ' = ' + sel + ' ? ' + d1 + ' : ' + d0 + ';');
          return;
        }
        if (t === 'dff') {
          var q = exprOf(part, 'Q');
          if (!q) {
            q = take('', 'q');
            declareReg(q);
          }
          var d = tie(part, 'D', "1'b0");
          var clk = exprOf(part, 'CLK');
          if (isConst(clk)) clk = constEdge(part, 'CLK', clk);
          else if (!isIdent(clk)) {
            clk = take('', 'open_clk');
            declareWire(clk);
          }
          var rst = null;
          if (part.hasRst) {
            var rpin = part.rstVal ? 'SET' : 'RST';
            var rexpr = exprOf(part, rpin);
            if (isConst(rexpr)) rexpr = constEdge(part, rpin, rexpr);
            else if (!isIdent(rexpr)) {
              rexpr = take('', 'open_rst');
              declareWire(rexpr);
            }
            rst = {
              expr: rexpr,
              edge: part.rstEdge === 'neg' ? 'neg' : 'pos',
              val: part.rstVal ? "1'b1" : "1'b0",
              low: part.rstEdge === 'neg'
            };
          }
          var key = (part.clkEdge === 'neg' ? 'neg' : 'pos') + '|' + clk + '|' +
            (rst ? (rst.edge + '|' + rst.expr + '|' + rst.val) : 'none');
          var grp = null;
          var gi;
          for (gi = 0; gi < dffGroups.length; gi++) if (dffGroups[gi].key === key) grp = dffGroups[gi];
          if (!grp) {
            grp = { key: key, clkEdge: part.clkEdge === 'neg' ? 'neg' : 'pos', clk: clk, rst: rst, items: [] };
            dffGroups.push(grp);
          }
          grp.items.push({ q: q, d: d, y: part.y, x: part.x });
          return;
        }
        if (t === 'block') {
          var modn, childLab, ports, conns;
          if (part.ref && labels[part.ref]) {
            modn = labels[part.ref].vname;
            childLab = labels[part.ref];
            ports = blockPorts(part, doc);
            conns = ports.map(function (p) {
              var emitted = (childLab.ports && p.partId && childLab.ports[p.partId]) || ident(p.name) || 'p';
              var ex = exprOf(part, p.name);
              return '.' + emitted + '(' + (ex || '') + ')';
            });
          } else {
            modn = ident(part.ext) || 'block';
            if (KEY[modn]) modn = modn + '_n';
            var ext = null;
            if (!defined[modn]) {
              if (!externals[modn]) {
                externals[modn] = { name: modn, ports: [], seen: Object.create(null), moduleId: mod.id, partId: part.id };
              }
              ext = externals[modn];
            }
            var bound = Object.create(null);
            var dup = [];
            conns = [];
            blockPorts(part, doc).forEach(function (p) {
              var emitted = ident(p.name) || 'p';
              if (KEY[emitted]) emitted = emitted + '_n';
              if (bound[emitted]) {
                dup.push(emitted);
                return;
              }
              bound[emitted] = 1;
              if (ext && !ext.seen[emitted]) {
                ext.seen[emitted] = 1;
                ext.ports.push({ name: emitted, dir: p.dir });
              }
              var ex = exprOf(part, String(p.name || 'p'));
              conns.push('.' + emitted + '(' + (ex || '') + ')');
            });
            if (dup.length) {
              issues.push({
                level: 'error',
                msg: part.name + ' has more than one port named ' + dup.join(', ') + '; only one is connected',
                moduleId: mod.id,
                partId: part.id
              });
            }
          }
          var inst = lab.inst[part.id] || take(part.name, 'u', { what: 'Instance', partId: part.id });
          lab.inst[part.id] = inst;
          insts.push('  ' + modn + ' ' + inst + ' (' + conns.join(', ') + ');');
        }
      });

      dffGroups.forEach(function (grp) {
        grp.items.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
        var sens = (grp.clkEdge === 'neg' ? 'negedge ' : 'posedge ') + grp.clk;
        if (grp.rst) sens += ' or ' + (grp.rst.edge === 'neg' ? 'negedge ' : 'posedge ') + grp.rst.expr;
        var lines = [];
        lines.push('  always @(' + sens + ') begin');
        if (grp.rst) {
          var cond = grp.rst.low ? ('!' + grp.rst.expr) : grp.rst.expr;
          lines.push('    if (' + cond + ') begin');
          grp.items.forEach(function (it) { lines.push('      ' + it.q + ' <= ' + grp.rst.val + ';'); });
          lines.push('    end else begin');
          grp.items.forEach(function (it) { lines.push('      ' + it.q + ' <= ' + it.d + ';'); });
          lines.push('    end');
        } else {
          grp.items.forEach(function (it) { lines.push('    ' + it.q + ' <= ' + it.d + ';'); });
        }
        lines.push('  end');
        always.push(lines.join('\n'));
      });

      var portLines = lab.portList.map(function (p) {
        if (p.dir === 'input') return '  input ' + p.vname;
        if (p.reg) return '  output reg ' + p.vname;
        return '  output ' + p.vname;
      });
      var text = '';
      if (!portLines.length) text = 'module ' + lab.vname + ';\n';
      else text = 'module ' + lab.vname + ' (\n' + portLines.join(',\n') + '\n);\n';
      wires.forEach(function (w) { text += '  wire ' + w + ';\n'; });
      regs.forEach(function (w) { text += '  reg ' + w + ';\n'; });
      var blocks = [];
      if (assigns.length) blocks.push(assigns.join('\n'));
      if (gates.length) blocks.push(gates.join('\n'));
      if (always.length) blocks.push(always.join('\n\n'));
      if (insts.length) blocks.push(insts.join('\n'));
      if (blocks.length) {
        if (wires.length || regs.length) text += '\n';
        text += blocks.join('\n\n') + '\n';
      }
      text += 'endmodule\n';
      return text;
    }

    doc.modules.forEach(function (mod) { emitOne(mod); });

    Object.keys(externals).forEach(function (name) {
      var ext = externals[name];
      var ports = ext.ports.map(function (p) {
        return '  ' + (p.dir === 'output' ? 'output ' : 'input ') + p.name;
      });
      var stub = STUB_NOTE + '\n';
      if (!ports.length) stub += 'module ' + ext.name + ';\nendmodule\n';
      else stub += 'module ' + ext.name + ' (\n' + ports.join(',\n') + '\n);\nendmodule\n';
      chunks.push(stub);
      issues.push({
        level: 'warn',
        msg: 'External module ' + ext.name + ' is emitted as an empty stub',
        moduleId: ext.moduleId,
        partId: ext.partId
      });
    });

    var verilog = '// Drawn schematic, for the Verilog schematic viewer.\n' + chunks.join('\n');
    return { verilog: verilog, issues: issues, labels: labels };
  }

  function combLoop(mod, byId, spec, pinNet, issues) {
    var graph = Object.create(null);
    function add(a, b) {
      if (!graph[a]) graph[a] = [];
      graph[a].push(b);
    }
    (mod.nets || []).forEach(function (net) {
      var drivers = [];
      var loads = [];
      (net.pins || []).forEach(function (ref) {
        var part = byId[ref.part];
        if (!part) return;
        if (part.type === 'dff' || part.type === 'in' || part.type === 'c0' || part.type === 'c1') return;
        var list = spec(part);
        var pin = null;
        var i;
        for (i = 0; i < list.length; i++) if (list[i].name === ref.pin) pin = list[i];
        if (!pin) return;
        if (pin.dir === 'out') drivers.push(part.id);
        else loads.push(part.id);
      });
      drivers.forEach(function (d) {
        loads.forEach(function (l) { add(d, l); });
      });
    });
    var color = Object.create(null);
    var hit = false;
    function dfs(n) {
      if (color[n] === 1) { hit = true; return; }
      if (color[n] === 2) return;
      color[n] = 1;
      (graph[n] || []).forEach(dfs);
      color[n] = 2;
    }
    Object.keys(graph).forEach(function (n) { if (!color[n]) dfs(n); });
    if (hit) issues.push({ level: 'warn', msg: 'Combinational loop', moduleId: mod.id });
  }

  function toVerilog(doc) {
    return report(doc).verilog;
  }

  function externalStubs(src) {
    var note = STUB_NOTE.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    var re = new RegExp(note + '[^\\n]*\\n\\s*module\\s+([A-Za-z_][A-Za-z0-9_$]*)', 'g');
    var names = [];
    var m;
    var text = String(src == null ? '' : src);
    while ((m = re.exec(text))) names.push(m[1]);
    return names;
  }

  return {
    MULTI: MULTI,
    EXAMPLES: EXAMPLES,
    clone: clone,
    uid: uid,
    moduleById: moduleById,
    pins: pinsOf,
    metrics: metrics,
    blockPorts: blockPorts,
    blockTypeName: blockTypeName,
    autoName: autoName,
    freshPart: freshPart,
    prune: prune,
    blank: blank,
    example: example,
    fromCompiled: fromCompiled,
    externalStubs: externalStubs,
    report: report,
    toVerilog: toVerilog,
    ident: ident
  };
});
