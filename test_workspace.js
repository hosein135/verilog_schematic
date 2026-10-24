'use strict';

var Design = require('./design.js');
var Workspace = require('./workspace.js');

var failed = 0;
function expect(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL ' + msg);
  }
}

var full = Design.example('full');
var deps = Workspace.moduleDeps(full);
var fa = full.modules.filter(function (m) { return m.name === 'full_adder'; })[0];
var ha = full.modules.filter(function (m) { return m.name === 'half_adder'; })[0];
expect(deps[fa.id].length === 1 && deps[fa.id][0] === ha.id, 'full adder depends on half adder');
expect((deps[ha.id] || []).length === 0, 'half adder has no children');
var roots = Workspace.treeRoots(full);
expect(roots.length === 1 && roots[0] === fa.id, 'only the parent is a root');
var used = Workspace.usedBy(full);
expect(used[ha.id] && used[ha.id][0] === fa.id, 'half adder is used by the full adder');

var half = Design.example('half');
var halfRoots = Workspace.treeRoots(half);
expect(halfRoots.length === 1, 'a lone module is a root');

expect(Workspace.deleteModule(full, ha.id, Design), 'delete child');
var parent = Design.moduleById ? null : null;
var fa2 = full.modules.filter(function (m) { return m.id === fa.id; })[0];
var blocks = fa2.parts.filter(function (p) { return p.type === 'block'; });
expect(blocks.length === 2 && blocks.every(function (p) { return !p.ref && p.ext === 'half_adder'; }), 'instances became external');
expect(Workspace.deleteModule(full, fa.id, Design) === false, 'last module stays');

var again = Design.example('full');
var src = again.modules.filter(function (m) { return m.name === 'half_adder'; })[0];
var copy = Workspace.duplicateModule(again, src.id, Design);
expect(copy && copy.id !== src.id, 'duplicate has a new id');
expect(copy.name !== src.name, 'duplicate name is unique');
expect(copy.parts.length === src.parts.length, 'duplicate keeps parts');
expect(copy.parts.every(function (p) {
  return src.parts.every(function (q) { return q.id !== p.id; });
}), 'part ids are new');

var tb = Design.tbTemplate(Design.example('half'), Design.example('half').modules[0].id);
expect(tb.indexOf('half_adder dut') >= 0, 'testbench instantiates the module');
expect(tb.indexOf('$dumpfile') >= 0, 'testbench dumps a vcd');
expect(tb.indexOf('reg a') >= 0 && tb.indexOf('wire s') >= 0, 'ports become regs and wires');
expect(tb.indexOf('for (i = 0; i < 4; i = i + 1)') >= 0, 'half adder sweeps all 4 input combinations\n' + tb);
expect(tb.indexOf('{a, b} = i;') >= 0, 'half adder assigns both inputs');
expect(tb.indexOf('always #5') < 0, 'half adder has no clock');
expect(tb.indexOf('$finish') > tb.indexOf('for (i'), 'half adder finishes after the sweep');

var muxTb = Design.tbTemplate(Design.example('mux'), Design.example('mux').modules[0].id);
expect(muxTb.indexOf('for (i = 0; i < 8; i = i + 1)') >= 0, 'mux sweeps 8 combinations\n' + muxTb);
expect(muxTb.indexOf('{a, b, sel} = i;') >= 0, 'mux assigns a, b, and sel');

var dffTb = Design.tbTemplate(Design.example('dff'), Design.example('dff').modules[0].id);
expect(dffTb.indexOf('always #5 clk = ~clk;') >= 0, 'dff clock free-runs\n' + dffTb);
expect(dffTb.indexOf('reg rst = 1;') >= 0, 'dff reset starts asserted');
expect(dffTb.indexOf('#12;') >= 0, 'dff holds reset across a clock edge');
expect(dffTb.indexOf('for (i = 0; i < 4; i = i + 1)') >= 0, 'dff sweeps d and rst');
expect(dffTb.indexOf('{d, rst} = i;') >= 0, 'dff assigns d and rst');
expect(dffTb.indexOf('rst = 0;') >= 0, 'dff releases reset');
expect(dffTb.indexOf('i < 16') < 0, 'a single flip-flop does not need a long sequence');

var low = Design.example('dff');
low.modules[0].parts.forEach(function (p) { if (p.type === 'dff') p.rstEdge = 'neg'; });
var lowTb = Design.tbTemplate(low, low.modules[0].id);
expect(lowTb.indexOf('reg rst = 0;') >= 0, 'active-low reset starts asserted\n' + lowTb);
expect(lowTb.indexOf('rst = 1;') >= 0, 'active-low reset is released');

var renamed = Design.example('dff');
renamed.modules[0].parts.forEach(function (p) { if (p.name === 'clk') p.name = 'ck'; });
var ckTb = Design.tbTemplate(renamed, renamed.modules[0].id);
expect(ckTb.indexOf('always #5 ck = ~ck;') >= 0, 'a port wired to CLK is a clock\n' + ckTb);
expect(ckTb.indexOf('ck = i') < 0, 'clock is not part of the data sweep');

var namedClk = Design.example('half');
namedClk.modules[0].parts.forEach(function (p) { if (p.id === 'a') p.name = 'clk'; });
var namedTb = Design.tbTemplate(namedClk, namedClk.modules[0].id);
expect(namedTb.indexOf('always #5') < 0, 'a combinational input named clk is not a clock\n' + namedTb);
expect(namedTb.indexOf('{clk, b} = i;') >= 0, 'that input is still swept');

var shift = Design.example('shift');
var shiftTb = Design.tbTemplate(shift, shift.modules[0].id);
expect(shiftTb.indexOf('always #5 clk = ~clk;') >= 0, 'shift clock\n' + shiftTb);
expect(shiftTb.indexOf('{din, rst} = i;') >= 0, 'shift sweeps din and rst');
expect(shiftTb.indexOf('for (i = 0; i < 16; i = i + 1)') >= 0, 'shift walks every 4-bit sequence');
expect(shiftTb.indexOf('din = (i >> 3);') >= 0, 'shift sequence reaches the last stage');

var tied = {
  v: 1, seq: 8, active: 'm1',
  modules: [{
    id: 'm1', name: 'tie',
    parts: [
      { id: 'ck', type: 'in', name: 'clk', x: 0, y: 0 },
      { id: 'z', type: 'c0', name: 'lo', x: 0, y: 80 },
      { id: 'ff', type: 'dff', name: 'ff', x: 160, y: 20, clkEdge: 'pos', hasRst: false, rstEdge: 'pos', rstVal: 0 },
      { id: 'q', type: 'out', name: 'q', x: 320, y: 20 }
    ],
    nets: [
      { id: 'n1', name: '', pins: [{ part: 'z', pin: 'Y' }, { part: 'ff', pin: 'D' }] },
      { id: 'n2', name: '', pins: [{ part: 'ck', pin: 'Y' }, { part: 'ff', pin: 'CLK' }] },
      { id: 'n3', name: '', pins: [{ part: 'ff', pin: 'Q' }, { part: 'q', pin: 'A' }] }
    ]
  }]
};
var tiedTb = Design.tbTemplate(tied, 'm1');
expect(tiedTb.indexOf('repeat (2) #10;') >= 0, 'one flip-flop with no data is clocked twice\n' + tiedTb);
expect(tiedTb.indexOf('for (i') < 0, 'no data vector when the only input is a clock');

var blankTb = Design.tbTemplate(Design.blank(), Design.blank().modules[0].id);
expect(blankTb.indexOf('for (i') < 0, 'empty module has no vectors\n' + blankTb);
expect(blankTb.indexOf('#10;') >= 0, 'empty module still steps time');

var clash = Design.example('half');
clash.modules[0].parts.forEach(function (p) { if (p.id === 'a') p.name = 'i'; });
var clashTb = Design.tbTemplate(clash, clash.modules[0].id);
expect(clashTb.indexOf('integer i2;') >= 0, 'loop variable avoids a port named i\n' + clashTb);
expect(clashTb.indexOf('for (i2 = 0; i2 < 4; i2 = i2 + 1)') >= 0, 'loop uses i2');

var pinned = Workspace.createProject(Design, 'Pin test', Design.example('half'));
Workspace.setSimVerilog(pinned.id, 'module kept;');
pinned.doc.modules[0].name = 'renamed_for_test';
Workspace.saveDrawing(pinned.id, pinned.doc, null);
expect(Workspace.project(pinned.id).simVerilog === 'module kept;', 'saving the schematic keeps the Verilog editor');
expect(Workspace.project(pinned.id).verilogPinned === true, 'Verilog editor stays pinned');

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('workspace ok');
