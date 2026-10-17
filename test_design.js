'use strict';

var Design = typeof require === 'function' ? require('./design.js') : window.Design;
var Sch = typeof require === 'function' ? require('./schematic.js') : window.Schematic;

var failed = 0;
var messages = [];

function expect(cond, msg) {
  if (!cond) {
    failed++;
    messages.push('FAIL ' + msg);
    console.error('FAIL ' + msg);
  }
}

function driverKind(mod, label) {
  var i, j;
  for (i = 0; i < mod.nets.length; i++) {
    if (mod.nets[i].label !== label) continue;
    var pins = mod.nets[i].pins;
    for (j = 0; j < pins.length; j++) {
      if (pins[j].dir === 'out' && pins[j].cell.kind !== 'port' && pins[j].cell.kind !== 'const') return pins[j].cell.kind;
    }
    for (j = 0; j < pins.length; j++) if (pins[j].dir === 'out') return pins[j].cell.kind;
  }
  return null;
}

function cellKind(mod, kind) {
  return mod.cells.filter(function (c) { return c.kind === kind; });
}

function pinLabel(cell, name) {
  var i;
  for (i = 0; i < cell.pins.length; i++) if (cell.pins[i].name === name && cell.pins[i].net) return cell.pins[i].net.label;
  return null;
}

function compile(name, verilog) {
  var c = Sch.compile(verilog);
  expect(c.ok, name + ' compile: ' + (c && c.error ? c.error : '') + '\n' + verilog);
  return c;
}

function direct(name, doc, fn) {
  var v = Design.toVerilog(doc);
  var c = compile(name, v);
  if (!c.ok) return;
  fn(c, v);
}

function roundTrip(name, src, fn) {
  var c = Sch.compile(src);
  expect(c.ok, name + ' src: ' + (c.error || ''));
  if (!c.ok) return;
  c.order.forEach(function (n) { Sch.layout(c.modules[n]); });
  var out = Design.fromCompiled(c);
  var v = Design.toVerilog(out.doc);
  var c2 = compile(name + ' export', v);
  if (!c2.ok) return;
  fn(c, c2, v, out);
}

direct('half', Design.example('half'), function (c, v) {
  expect(c.top === 'half_adder', 'half top ' + c.top);
  var m = c.modules.half_adder;
  expect(driverKind(m, 's') === 'xor', 'half s ' + driverKind(m, 's') + '\n' + v);
  expect(driverKind(m, 'c') === 'and', 'half c ' + driverKind(m, 'c'));
  expect(v.indexOf('xor sum') >= 0, 'half primitive xor');
  expect(v.indexOf('assign') < 0, 'half is not assigns');
});

direct('mux', Design.example('mux'), function (c, v) {
  var m = c.modules.mux2;
  var mx = cellKind(m, 'mux');
  expect(mx.length === 1, 'mux count ' + mx.length + '\n' + v);
  if (mx[0]) {
    expect(pinLabel(mx[0], 'D0') === 'a', 'D0 ' + pinLabel(mx[0], 'D0'));
    expect(pinLabel(mx[0], 'D1') === 'b', 'D1 ' + pinLabel(mx[0], 'D1'));
    expect(pinLabel(mx[0], 'S') === 'sel', 'S ' + pinLabel(mx[0], 'S'));
    expect(pinLabel(mx[0], 'Y') === 'y', 'Y ' + pinLabel(mx[0], 'Y'));
  }
});

direct('dff', Design.example('dff'), function (c, v) {
  var m = c.modules.d_ff;
  expect(cellKind(m, 'dff').length === 1, 'dff count\n' + v);
  expect(driverKind(m, 'q') === 'dff', 'q driver ' + driverKind(m, 'q'));
  var ff = cellKind(m, 'dff')[0];
  var clk = ff.pins.filter(function (p) { return p.name === 'CLK'; })[0];
  var rst = ff.pins.filter(function (p) { return p.name === 'RST'; })[0];
  expect(clk && !clk.bubble, 'clk pos');
  expect(rst && !rst.bubble, 'rst pos ' + (rst && rst.bubble));
  expect(v.indexOf('output reg q') >= 0, 'output reg');
});

direct('shift', Design.example('shift'), function (c, v) {
  var m = c.modules.shiftreg;
  expect(cellKind(m, 'dff').length === 4, 'shift dffs ' + cellKind(m, 'dff').length + '\n' + v);
  expect(driverKind(m, 'q0') === 'dff', 'q0');
  expect(driverKind(m, 'q3') === 'dff', 'q3');
});

direct('full', Design.example('full'), function (c, v) {
  expect(c.top === 'full_adder', 'full top ' + c.top + '\n' + v);
  var m = c.modules.full_adder;
  expect(cellKind(m, 'mod').length === 2, 'mods ' + cellKind(m, 'mod').length);
  expect(driverKind(m, 'cout') === 'or', 'cout ' + driverKind(m, 'cout'));
  expect(cellKind(c.modules.half_adder, 'xor').length === 1, 'child xor');
  expect(v.indexOf('wire s1;') >= 0, 's1 wire\n' + v);
});

(function nandBuf() {
  var doc = {
    v: 1, seq: 10, active: 'm1',
    modules: [{
      id: 'm1', name: 'gates',
      parts: [
        { id: 'a', type: 'in', name: 'a', x: 0, y: 0 },
        { id: 'b', type: 'in', name: 'b', x: 0, y: 80 },
        { id: 'n', type: 'nand', name: 'nd', x: 120, y: 0, inputs: 2 },
        { id: 'u', type: 'buf', name: 'bf', x: 120, y: 100 },
        { id: 'y', type: 'out', name: 'y', x: 280, y: 0 },
        { id: 'z', type: 'out', name: 'z', x: 280, y: 100 }
      ],
      nets: [
        { id: 'n1', name: '', pins: [{ part: 'a', pin: 'Y' }, { part: 'n', pin: 'A' }, { part: 'u', pin: 'A' }] },
        { id: 'n2', name: '', pins: [{ part: 'b', pin: 'Y' }, { part: 'n', pin: 'B' }] },
        { id: 'n3', name: '', pins: [{ part: 'n', pin: 'Y' }, { part: 'y', pin: 'A' }] },
        { id: 'n5', name: '', pins: [{ part: 'u', pin: 'Y' }, { part: 'z', pin: 'A' }] }
      ]
    }]
  };
  direct('nand', doc, function (c, v) {
    var m = c.modules.gates;
    expect(driverKind(m, 'y') === 'nand', 'nand ' + driverKind(m, 'y') + '\n' + v);
    expect(cellKind(m, 'not').length === 0, 'nand is not split');
    expect(driverKind(m, 'z') === 'buf', 'buf ' + driverKind(m, 'z') + '\n' + v);
  });
})();

(function activeLow() {
  var doc = Design.example('dff');
  var ff = doc.modules[0].parts.filter(function (p) { return p.type === 'dff'; })[0];
  ff.clkEdge = 'neg';
  ff.rstEdge = 'neg';
  ff.rstVal = 1;
  doc.modules[0].nets.forEach(function (n) {
    n.pins.forEach(function (r) { if (r.pin === 'RST') r.pin = 'SET'; });
  });
  direct('set', doc, function (c, v) {
    var ffcell = cellKind(c.modules.d_ff, 'dff')[0];
    var clk = ffcell.pins.filter(function (p) { return p.name === 'CLK'; })[0];
    var set = ffcell.pins.filter(function (p) { return p.name === 'SET'; })[0];
    expect(clk && clk.bubble, 'neg clk\n' + v);
    expect(set && set.bubble, 'set bubble ' + (set && set.name));
    expect(v.indexOf('negedge clk') >= 0, 'negedge clk');
    expect(v.indexOf("1'b1") >= 0, 'set value');
  });
})();

(function tiedConst() {
  var doc = {
    v: 1, seq: 8, active: 'm1',
    modules: [{
      id: 'm1', name: 'tie',
      parts: [
        { id: 'a', type: 'in', name: 'a', x: 0, y: 0 },
        { id: 'z', type: 'c0', name: 'lo', x: 0, y: 80 },
        { id: 'g', type: 'and', name: 'g', x: 140, y: 20, inputs: 2 },
        { id: 'y', type: 'out', name: 'y', x: 300, y: 20 },
        { id: 'o', type: 'c1', name: 'hi', x: 0, y: 160 },
        { id: 'p', type: 'out', name: 'p', x: 200, y: 160 }
      ],
      nets: [
        { id: 'n1', name: '', pins: [{ part: 'a', pin: 'Y' }, { part: 'g', pin: 'A' }] },
        { id: 'n2', name: '', pins: [{ part: 'z', pin: 'Y' }, { part: 'g', pin: 'B' }] },
        { id: 'n3', name: '', pins: [{ part: 'g', pin: 'Y' }, { part: 'y', pin: 'A' }] },
        { id: 'n4', name: '', pins: [{ part: 'o', pin: 'Y' }, { part: 'p', pin: 'A' }] }
      ]
    }]
  };
  direct('const', doc, function (c, v) {
    var m = c.modules.tie;
    expect(driverKind(m, 'y') === 'and', 'and kept\n' + v);
    expect(cellKind(m, 'const').length >= 1, 'const cell');
    expect(v.indexOf("assign p = 1'b1") >= 0, 'tied 1\n' + v);
  });
})();

var HA_G = 'module half_adder(input a, input b, output s, output c);\n  xor (s, a, b);\n  and (c, a, b);\nendmodule\n';
var MX = 'module mux2(input a, input b, input sel, output y);\n  assign y = sel ? b : a;\nendmodule\n';
var SR = 'module shiftreg(input wire clk, input wire rst, input wire din, output reg q0, output reg q1, output reg q2, output reg q3);\n  always @(posedge clk or posedge rst) begin\n    if (rst) begin q0 <= 0; q1 <= 0; q2 <= 0; q3 <= 0; end\n    else begin q0 <= din; q1 <= q0; q2 <= q1; q3 <= q2; end\n  end\nendmodule\n';
var FA = 'module half_adder(input a, input b, output s, output c);\n  xor (s, a, b);\n  and (c, a, b);\nendmodule\n' +
  'module full_adder(input a, input b, input cin, output sum, output cout);\n  wire s1, c1, c2;\n' +
  '  half_adder ha1(.a(a), .b(b), .s(s1), .c(c1));\n  half_adder ha2(.a(s1), .b(cin), .s(sum), .c(c2));\n  or (cout, c1, c2);\nendmodule\n';
var CT = 'module counter2(input wire clk, input wire rst, output reg q0, output reg q1);\n  always @(posedge clk or posedge rst) begin\n    if (rst) {q1, q0} <= 2\'b00;\n    else {q1, q0} <= {q1, q0} + 2\'b01;\n  end\nendmodule\n';

roundTrip('import half', HA_G, function (c, c2) {
  var m = c2.modules.half_adder;
  expect(driverKind(m, 's') === 'xor', 'rt s ' + driverKind(m, 's'));
  expect(driverKind(m, 'c') === 'and', 'rt c ' + driverKind(m, 'c'));
});

roundTrip('import mux', MX, function (c, c2) {
  var m = c2.modules.mux2;
  var mx = cellKind(m, 'mux');
  expect(mx.length === 1, 'rt mux ' + mx.length);
  if (mx[0]) {
    expect(pinLabel(mx[0], 'D0') === 'a', 'rt D0 ' + pinLabel(mx[0], 'D0'));
    expect(pinLabel(mx[0], 'D1') === 'b', 'rt D1');
    expect(pinLabel(mx[0], 'S') === 'sel', 'rt S ' + pinLabel(mx[0], 'S'));
  }
});

roundTrip('import shift', SR, function (c, c2) {
  expect(cellKind(c2.modules.shiftreg, 'dff').length === 4, 'rt shift ' + cellKind(c2.modules.shiftreg, 'dff').length);
});

roundTrip('import hier', FA, function (c, c2) {
  expect(c2.top === 'full_adder', 'rt top ' + c2.top);
  expect(cellKind(c2.modules.full_adder, 'mod').length === 2, 'rt mods');
  expect(driverKind(c2.modules.full_adder, 'cout') === 'or', 'rt or ' + driverKind(c2.modules.full_adder, 'cout'));
  expect(cellKind(c2.modules.half_adder, 'xor').length === 1, 'rt child');
});

roundTrip('import count', CT, function (c, c2) {
  var a = c.modules.counter2;
  var b = c2.modules.counter2;
  expect(cellKind(b, 'dff').length === cellKind(a, 'dff').length, 'rt dff ' + cellKind(b, 'dff').length);
  expect(cellKind(b, 'xor').length === cellKind(a, 'xor').length, 'rt xor ' + cellKind(b, 'xor').length + ' vs ' + cellKind(a, 'xor').length);
  expect(cellKind(b, 'not').length === cellKind(a, 'not').length, 'rt not ' + cellKind(b, 'not').length);
});

function imported(src) {
  var c = Sch.compile(src);
  expect(c.ok, 'import compile ' + (c.error || ''));
  if (!c.ok) return null;
  c.order.forEach(function (n) { Sch.layout(c.modules[n]); });
  return Design.fromCompiled(c, { externals: Design.externalStubs(src) });
}

(function netNames() {
  var out = imported(FA);
  if (!out) return;
  var fa = out.doc.modules.filter(function (m) { return m.name === 'full_adder'; })[0];
  var names = {};
  fa.nets.forEach(function (n) { if (n.name) names[n.name] = 1; });
  expect(names.s1 && names.c1 && names.c2, 'kept wire names ' + Object.keys(names).join(','));
})();

function wideSrc(kind, n, yName) {
  var letters = 'abcdefghijklmnopqrstuvwxyz';
  var ins = [];
  var i;
  for (i = 0; i < n; i++) ins.push(letters.charAt(i));
  return 'module wide(input ' + ins.join(', input ') + ', output ' + yName + ');\n  ' +
    kind + ' (' + yName + ', ' + ins.join(', ') + ');\nendmodule\n';
}

function driverPart(mod, outName) {
  var outp = mod.parts.filter(function (p) { return p.type === 'out' && p.name === outName; })[0];
  if (!outp) return null;
  var net = mod.nets.filter(function (n) {
    return n.pins.some(function (r) { return r.part === outp.id; });
  })[0];
  if (!net) return null;
  var hit = null;
  net.pins.forEach(function (r) {
    if (r.pin === 'Y' || r.pin === 'Q') {
      mod.parts.forEach(function (p) { if (p.id === r.part) hit = p; });
    }
  });
  return hit;
}

(function wideGates() {
  [['and', 'and', 'and'], ['nand', 'nand', 'and'], ['xnor', 'xnor', 'xor']].forEach(function (spec) {
    [9, 12].forEach(function (n) {
      var out = imported(wideSrc(spec[0], n, 'y'));
      if (!out) return;
      var mod = out.doc.modules[0];
      var ins = mod.parts.filter(function (p) { return p.type === 'in'; });
      expect(ins.length === n, spec[0] + ' ' + n + ' ports ' + ins.length);
      ins.forEach(function (p) {
        var net = mod.nets.filter(function (nn) {
          return nn.pins.some(function (r) { return r.part === p.id; });
        })[0];
        expect(net && net.pins.length >= 2, spec[0] + ' ' + n + ' connects ' + p.name);
      });
      var root = driverPart(mod, 'y');
      expect(root && root.type === spec[1], spec[0] + ' ' + n + ' root ' + (root && root.type));
      var inner = mod.parts.filter(function (p) { return p.type === spec[2] && (!root || p.id !== root.id); });
      expect(inner.length >= 1, spec[0] + ' ' + n + ' inner ' + spec[2]);
    });
  });
  var one = imported('module one(input a, output y, output z);\n  and (y, a);\n  nand (z, a);\nendmodule\n');
  if (one) {
    var kinds = {};
    one.doc.modules[0].parts.forEach(function (p) { kinds[p.type] = (kinds[p.type] || 0) + 1; });
    expect(kinds.buf === 1, '1-input and is buf ' + JSON.stringify(kinds));
    expect(kinds.not === 1, '1-input nand is not ' + JSON.stringify(kinds));
    expect(!kinds.and && !kinds.nand, '1-input primitives are not gates');
  }
})();

(function reserved() {
  var doc = {
    v: 1, seq: 8, active: 'm1',
    modules: [{
      id: 'm1', name: 'kw',
      parts: [
        { id: 'a', type: 'in', name: 'case', x: 0, y: 0 },
        { id: 'b', type: 'in', name: 'initial', x: 0, y: 40 },
        { id: 'c', type: 'in', name: 'logic', x: 0, y: 80 },
        { id: 'd', type: 'in', name: '$x', x: 0, y: 120 },
        { id: 'y', type: 'out', name: 'y', x: 200, y: 40 }
      ],
      nets: [
        { id: 'n1', name: '', pins: [{ part: 'a', pin: 'Y' }, { part: 'y', pin: 'A' }] }
      ]
    }]
  };
  var v = Design.toVerilog(doc);
  expect(v.indexOf('input case_n') >= 0, 'case_n\n' + v);
  expect(v.indexOf('input initial_n') >= 0, 'initial_n\n' + v);
  expect(v.indexOf('input logic_n') >= 0, 'logic_n\n' + v);
  expect(v.indexOf('input n_$x') >= 0, 'dollar\n' + v);
  expect(Sch.compile(v).ok, 'reserved compiles\n' + v);
})();

function extDoc(blocks) {
  var parts = [{ id: 'a', type: 'in', name: 'a', x: 0, y: 0 }];
  var nets = [];
  var seq = 2;
  blocks.forEach(function (b, i) {
    parts.push({
      id: b.id, type: 'block', name: b.id, x: 160, y: i * 120,
      ref: '', ext: b.ext, ports: b.ports
    });
    b.ports.forEach(function (p) {
      if (p.dir === 'input' && p.name === 'a') {
        nets.push({ id: 'n' + (seq++), name: '', pins: [{ part: 'a', pin: 'Y' }, { part: b.id, pin: 'a' }] });
      }
    });
  });
  return { v: 1, seq: 20, active: 'm1', modules: [{ id: 'm1', name: 'top', parts: parts, nets: nets }] };
}

(function externalStub() {
  var doc = extDoc([{
    id: 'u', ext: 'alu',
    ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }]
  }]);
  var v = Design.toVerilog(doc);
  expect(v.indexOf('External module stub') >= 0, 'stub marker\n' + v);
  expect(Design.externalStubs(v).indexOf('alu') >= 0, 'stub names ' + Design.externalStubs(v).join(','));
  var out = imported(v);
  if (!out) return;
  expect(out.doc.modules.length === 1, 'externals stay out ' + out.doc.modules.length + '\n' + v);
  var block = out.doc.modules[0].parts.filter(function (p) { return p.type === 'block'; })[0];
  expect(block && !block.ref && block.ext === 'alu', 'still external ' + (block && block.ext));
  var pname = (block.ports || []).map(function (p) { return p.name + ':' + p.dir; }).sort().join(',');
  expect(pname === 'a:input,y:output', 'ports ' + pname);
})();

(function portUnion() {
  var doc = extDoc([
    { id: 'u1', ext: 'alu', ports: [{ name: 'a', dir: 'input' }, { name: 'y', dir: 'output' }] },
    { id: 'u2', ext: 'alu', ports: [{ name: 'b', dir: 'input' }, { name: 'z', dir: 'output' }] }
  ]);
  var v = Design.toVerilog(doc);
  var stub = v.slice(v.indexOf('External module stub'));
  expect(stub.indexOf('input a') >= 0 && stub.indexOf('input b') >= 0, 'union inputs\n' + stub);
  expect(stub.indexOf('output y') >= 0 && stub.indexOf('output z') >= 0, 'union outputs\n' + stub);
})();

(function constClock() {
  var doc = {
    v: 1, seq: 8, active: 'm1',
    modules: [{
      id: 'm1', name: 'tieff',
      parts: [
        { id: 'd', type: 'in', name: 'd', x: 0, y: 0 },
        { id: 'z', type: 'c0', name: 'lo', x: 0, y: 80 },
        { id: 'ff', type: 'dff', name: 'ff', x: 160, y: 20, clkEdge: 'pos', hasRst: false, rstEdge: 'pos', rstVal: 0 },
        { id: 'q', type: 'out', name: 'q', x: 320, y: 20 }
      ],
      nets: [
        { id: 'n1', name: '', pins: [{ part: 'd', pin: 'Y' }, { part: 'ff', pin: 'D' }] },
        { id: 'n2', name: '', pins: [{ part: 'z', pin: 'Y' }, { part: 'ff', pin: 'CLK' }] },
        { id: 'n3', name: '', pins: [{ part: 'ff', pin: 'Q' }, { part: 'q', pin: 'A' }] }
      ]
    }]
  };
  var v = Design.toVerilog(doc);
  expect(/assign \w+ = 1'b0;/.test(v), 'const clk assign\n' + v);
  var out = imported(v);
  if (!out) return;
  var mod = out.doc.modules[0];
  var ff = mod.parts.filter(function (p) { return p.type === 'dff'; })[0];
  var c0 = mod.parts.filter(function (p) { return p.type === 'c0'; })[0];
  expect(ff && c0, 'c0 and dff came back');
  if (!ff || !c0) return;
  var joined = mod.nets.some(function (n) {
    var hasC = n.pins.some(function (r) { return r.part === c0.id; });
    var hasK = n.pins.some(function (r) { return r.part === ff.id && r.pin === 'CLK'; });
    return hasC && hasK;
  });
  expect(joined, 'c0 still drives CLK\n' + v);
})();

if (typeof window !== 'undefined') {
  window.__testFailed = failed;
  var out = document.getElementById('out');
  if (out) out.textContent = 'design: ' + (failed ? failed + ' failed' : 'ok') + (messages.length ? '\n' + messages.join('\n') : '');
}
if (typeof process !== 'undefined' && process.exit) {
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('ok');
}
