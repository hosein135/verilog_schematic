/* Standalone Verilog -> schematic.
   Interaction follows naja-schematic (hierarchy, gate symbols, trace-to-driver,
   click a hollow pin to grow the net). This file does not use the naja runtime. */
(function (root) {
  'use strict';

  var DIRS = { input: 1, output: 1, inout: 1 };
  var NETS = { wire: 1, reg: 1, logic: 1, integer: 1, tri: 1, wand: 1, wor: 1, supply0: 1, supply1: 1, bit: 1 };
  var PRIMS = { and: 1, nand: 1, or: 1, nor: 1, xor: 1, xnor: 1, buf: 1, not: 1, bufif0: 1, bufif1: 1, notif0: 1, notif1: 1 };
  var PAIRS = { '<=': 1, '>=': 1, '==': 1, '!=': 1, '&&': 1, '||': 1, '<<': 1, '>>': 1, '**': 1, '~&': 1, '~|': 1, '~^': 1, '^~': 1 };
  var MAXW = 8;
  var E = null;

  function lex(src, warnings) {
    var tokens = [];
    var i = 0, line = 1, col = 1;
    function push(t, v, pos, l, c, end) {
      tokens.push({ t: t, v: v, pos: pos, end: end, line: l, col: c });
    }
    while (i < src.length) {
      var c = src.charAt(i);
      if (c === '\n') { i++; line++; col = 1; continue; }
      if (c === '\r' || c === ' ' || c === '\t') { i++; col++; continue; }
      var pos = i, l = line, co = col;
      if (c === '/' && src.charAt(i + 1) === '/') {
        while (i < src.length && src.charAt(i) !== '\n') i++;
        continue;
      }
      if (c === '/' && src.charAt(i + 1) === '*') {
        i += 2; col += 2;
        while (i < src.length && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) {
          if (src.charAt(i) === '\n') { line++; col = 1; i++; }
          else { i++; col++; }
        }
        i += 2; col += 2;
        continue;
      }
      if (c === '`') {
        i++; col++;
        var name = '';
        while (i < src.length && /[A-Za-z0-9_$]/.test(src.charAt(i))) {
          name += src.charAt(i); i++; col++;
        }
        if (name === 'include') warnings.push('`include is not loaded (line ' + l + ')');
        while (i < src.length && src.charAt(i) !== '\n') { i++; col++; }
        continue;
      }
      if (c === '\\') {
        i++; col++;
        var esc = '';
        while (i < src.length && src.charAt(i) !== ' ' && src.charAt(i) !== '\t' && src.charAt(i) !== '\n' && src.charAt(i) !== '\r') {
          esc += src.charAt(i); i++; col++;
        }
        if (src.charAt(i) === ' ' || src.charAt(i) === '\t') { i++; col++; }
        push('id', esc, pos, l, co, i);
        continue;
      }
      if (c === '"') {
        i++; col++;
        var s = '';
        while (i < src.length && src.charAt(i) !== '"' && src.charAt(i) !== '\n') {
          if (src.charAt(i) === '\\') { s += src.charAt(i + 1) || ''; i += 2; col += 2; continue; }
          s += src.charAt(i); i++; col++;
        }
        if (src.charAt(i) === '"') { i++; col++; }
        push('str', s, pos, l, co, i);
        continue;
      }
      if (/[0-9]/.test(c) || (c === "'" && /[bBoOdDhH]/.test(src.charAt(i + 1) || ''))) {
        var num = '';
        if (/[0-9]/.test(c)) {
          while (i < src.length && /[0-9_]/.test(src.charAt(i))) { num += src.charAt(i); i++; col++; }
        }
        if (src.charAt(i) === "'") {
          num += "'"; i++; col++;
          if (src.charAt(i) === 's' || src.charAt(i) === 'S') { num += src.charAt(i); i++; col++; }
          if (i < src.length) { num += src.charAt(i); i++; col++; }
          while (i < src.length && /[0-9a-fA-FxXzZ_]/.test(src.charAt(i))) { num += src.charAt(i); i++; col++; }
        }
        push('num', num, pos, l, co, i);
        continue;
      }
      var tri = src.substr(i, 3);
      var pair = src.substr(i, 2);
      if (tri === '===' || tri === '!==' || tri === '<<<' || tri === '>>>') {
        push('op', tri, pos, l, co, i + 3); i += 3; col += 3; continue;
      }
      if (PAIRS[pair]) { push('op', pair, pos, l, co, i + 2); i += 2; col += 2; continue; }
      if ('()[]{},.;:#@=+-*/%&|^~!?'.indexOf(c) >= 0) {
        push('op', c, pos, l, co, i + 1); i++; col++; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var id = '';
        while (i < src.length && /[A-Za-z0-9_$]/.test(src.charAt(i))) { id += src.charAt(i); i++; col++; }
        push('id', id, pos, l, co, i);
        continue;
      }
      i++; col++;
    }
    return tokens;
  }

  function parseDesign(src) {
    var warnings = [];
    var tokens = lex(src, warnings);
    var p = 0;
    function peek(n) { return tokens[p + (n || 0)]; }
    function val(n) { var t = peek(n); return t ? t.v : ''; }
    function eof() { return p >= tokens.length; }
    function at(v) { return val() === v; }
    function next() { return tokens[p++] || null; }
    function eat(v) { if (at(v)) return next(); return null; }
    function error(msg) {
      var t = peek() || tokens[tokens.length - 1] || { line: 1, v: '' };
      throw new Error(msg + ' (line ' + t.line + ', near "' + (t.v || 'end') + '")');
    }
    function need(v) { if (!eat(v)) error('Expected "' + v + '"'); }
    function atId() { var t = peek(); return !!(t && t.t === 'id'); }
    function needId() { if (!atId()) error('Expected a name'); return next(); }
    function tag(node, t0, t1) {
      if (t0) { node.line = t0.line; node.pos = t0.pos; }
      node.end = t1 ? t1.end : (t0 ? t0.end : node.pos);
      return node;
    }
    function skipGroup(open, close) {
      if (!at(open)) return;
      var d = 0;
      while (!eof()) {
        if (at(open)) d++;
        else if (at(close)) d--;
        next();
        if (d === 0) return;
      }
    }
    function skipAttr() {
      while (at('(') && val(1) === '*') {
        next(); next();
        while (!eof() && !(at('*') && val(1) === ')')) next();
        if (at('*')) next();
        if (at(')')) next();
      }
    }
    function skipTo(word) {
      var depth = 0;
      while (!eof()) {
        if (at(word) && depth === 0) { next(); return; }
        if (at('begin')) depth++;
        else if (at('end')) { if (depth) depth--; }
        else if (at(word)) depth--;
        next();
      }
    }
    function resync() {
      var d = 0;
      while (!eof() && !at('endmodule')) {
        if (at('begin')) d++;
        else if (at('end')) {
          if (d === 0) { next(); return; }
          d--;
        } else if (d === 0 && at(';')) { next(); return; }
        next();
      }
    }

    function parseExpr() { return parseTernary(); }
    function bin(op, a, b, t0) {
      return tag({ k: 'bin', op: op, a: a, b: b }, t0 || a, b);
    }
    function parseTernary() {
      var c = parseLor();
      if (eat('?')) {
        var t0 = c;
        var t = parseTernary();
        need(':');
        var f = parseTernary();
        return tag({ k: 'tri', c: c, t: t, f: f }, t0, f);
      }
      return c;
    }
    function parseLor() { return parseBin(parseLand, ['||']); }
    function parseLand() { return parseBin(parseBor, ['&&']); }
    function parseBor() { return parseBin(parseXor, ['|']); }
    function parseXor() { return parseBin(parseBand, ['^', '~^', '^~']); }
    function parseBand() { return parseBin(parseEq, ['&']); }
    function parseEq() { return parseBin(parseRel, ['==', '!=', '===', '!==']); }
    function parseRel() { return parseBin(parseShift, ['<', '>', '<=', '>=']); }
    function parseShift() { return parseBin(parseAdd, ['<<', '>>', '<<<', '>>>']); }
    function parseAdd() { return parseBin(parseMul, ['+', '-']); }
    function parseMul() { return parseBin(parseUnary, ['*', '/', '%']); }
    function parseBin(nextFn, ops) {
      var e = nextFn();
      while (ops.indexOf(val()) >= 0) {
        var op = next().v;
        var r = nextFn();
        e = bin(op, e, r, e);
      }
      return e;
    }
    function parseUnary() {
      var ops = { '~': 1, '!': 1, '&': 1, '|': 1, '^': 1, '~&': 1, '~|': 1, '~^': 1, '^~': 1, '+': 1, '-': 1 };
      if (ops[val()]) {
        var t0 = next();
        var a = parseUnary();
        return tag({ k: 'un', op: t0.v, a: a }, t0, a);
      }
      return parsePrimary();
    }
    function parsePrimary() {
      if (eat('(')) {
        var e = parseExpr();
        need(')');
        return parsePost(e);
      }
      if (at('{')) return parsePost(parseBrace());
      if (peek() && peek().t === 'num') {
        var t = next();
        return parsePost(numNode(t));
      }
      if (atId()) {
        var t0 = needId();
        var name = t0.v;
        if (at('.')) {
          while (eat('.')) {
            if (!atId()) break;
            name = next().v;
          }
          warnings.push('hierarchical name drawn as "' + name + '" (line ' + t0.line + ')');
        }
        return parsePost(tag({ k: 'id', name: name }, t0, t0));
      }
      error('Expected an expression');
    }
    function parsePost(base) {
      while (at('[')) {
        var t0 = next();
        var a = parseExpr();
        if (eat(':')) {
          var b = parseExpr();
          var t1 = peek();
          need(']');
          base = tag({ k: 'slice', name: base.name || '', base: base, msb: a, lsb: b }, base, t1);
        } else {
          var t2 = peek();
          need(']');
          base = tag({ k: 'index', name: base.name || '', base: base, index: a }, base, t2);
        }
      }
      return base;
    }
    function parseBrace() {
      var t0 = need('{');
      var first = parseExpr();
      if (at('{')) {
        need('{');
        var body = parseExpr();
        need('}');
        var t1 = need('}');
        return tag({ k: 'repl', n: first, body: body }, t0, t1);
      }
      var parts = [first];
      while (eat(',')) parts.push(parseExpr());
      return tag({ k: 'concat', parts: parts }, t0, need('}'));
    }
    function numNode(tok) {
      var s = String(tok.v).replace(/_/g, '');
      var m = /^(\d*)'([sS])?([bBoOdDhH])([0-9a-fA-FxXzZ]+)$/.exec(s);
      if (!m) {
        var value = parseInt(s, 10);
        if (isNaN(value)) value = 0;
        return tag({ k: 'num', unsized: true, value: value, width: null, bits: null }, tok, tok);
      }
      var width = m[1] ? parseInt(m[1], 10) : null;
      var base = m[3].toLowerCase();
      var digits = m[4].toLowerCase();
      var bits = [];
      var di, v, b;
      if (base === 'b') {
        for (di = digits.length - 1; di >= 0; di--) bits.push(digits.charAt(di) === '1' ? 1 : 0);
      } else if (base === 'h') {
        for (di = digits.length - 1; di >= 0; di--) {
          v = parseInt(digits.charAt(di), 16);
          if (isNaN(v)) v = 0;
          for (b = 0; b < 4; b++) bits.push((v >> b) & 1);
        }
      } else if (base === 'o') {
        for (di = digits.length - 1; di >= 0; di--) {
          v = parseInt(digits.charAt(di), 8);
          if (isNaN(v)) v = 0;
          for (b = 0; b < 3; b++) bits.push((v >> b) & 1);
        }
      } else {
        v = parseInt(digits, 10) || 0;
        var ww = width || bitsNeeded(v);
        for (b = 0; b < ww; b++) { bits.push(v & 1); v = Math.floor(v / 2); }
      }
      if (width) {
        while (bits.length < width) bits.push(0);
        bits = bits.slice(0, width);
      } else width = bits.length;
      var ival = 0;
      for (b = 0; b < bits.length && b < 30; b++) if (bits[b]) ival += (1 << b);
      return tag({ k: 'num', unsized: false, width: width, bits: bits, value: ival }, tok, tok);
    }
    function parseRange() {
      if (!eat('[')) return null;
      var a = parseExpr();
      var b = a;
      if (eat(':')) b = parseExpr();
      need(']');
      return { msb: a, lsb: b };
    }
    function parseLhs() {
      if (at('{')) {
        var t0 = need('{');
        var parts = [];
        do { parts.push(parseLhs()); } while (eat(','));
        return tag({ k: 'concat', parts: parts }, t0, need('}'));
      }
      var t0 = needId();
      var node = tag({ k: 'id', name: t0.v }, t0, t0);
      if (eat('[')) {
        var a = parseExpr();
        if (eat(':')) {
          var b = parseExpr();
          var t1 = peek();
          need(']');
          return tag({ k: 'slice', name: t0.v, msb: a, lsb: b }, t0, t1);
        }
        var t2 = peek();
        need(']');
        return tag({ k: 'index', name: t0.v, index: a }, t0, t2);
      }
      return node;
    }
    function parseStmt() {
      if (eat('begin')) {
        if (eat(':')) { if (atId()) next(); }
        var stmts = [];
        while (!eof() && !at('end') && !at('endmodule')) stmts.push(parseStmt());
        eat('end');
        return { k: 'block', stmts: stmts };
      }
      if (at('if')) {
        var t0 = next();
        need('(');
        var cond = parseExpr();
        need(')');
        var thenS = parseStmt();
        var els = null;
        if (eat('else')) els = parseStmt();
        return tag({ k: 'if', cond: cond, then: thenS, els: els }, t0, els || thenS);
      }
      if (at('case') || at('casex') || at('casez')) {
        var t1 = next();
        var depth = 1;
        while (!eof() && depth) {
          if (at('case') || at('casex') || at('casez')) depth++;
          else if (at('endcase')) { depth--; next(); if (!depth) break; continue; }
          next();
        }
        return tag({ k: 'opaque' }, t1, t1);
      }
      if (at('for') || at('while') || at('forever') || at('repeat') || at('fork')) {
        var t2 = next();
        resync();
        return tag({ k: 'opaque' }, t2, t2);
      }
      var lineTok = peek();
      var lhs = parseLhs();
      if (at('<=') || at('=')) {
        var op = next().v;
        var rhs = parseExpr();
        var semi = eat(';');
        return tag({ k: 'asg', op: op, lhs: lhs, rhs: rhs }, lineTok, rhs);
      }
      error('Expected an assignment');
    }
    function parseSens() {
      var list = [];
      function one() {
        var edge = null;
        if (eat('posedge')) edge = 'pos';
        else if (eat('negedge')) edge = 'neg';
        else if (eat('*')) { list.push({ edge: 'any' }); return; }
        if (!atId()) return;
        list.push({ edge: edge || 'level', name: next().v });
      }
      if (eat('(')) {
        if (at('*')) { next(); list.push({ edge: 'any' }); }
        else {
          do { one(); } while (eat('or') || eat(','));
        }
        need(')');
      } else one();
      return list;
    }
    function parseAlways() {
      var t0 = next();
      var kind = t0.v;
      var sens = [];
      if (eat('@')) sens = parseSens();
      else if (kind === 'always_comb' || kind === 'always_latch') sens = [{ edge: 'any' }];
      var body = parseStmt();
      return tag({ k: 'always', akind: kind, sens: sens, body: body }, t0, t0);
    }
    function parseDecl() {
      var t0 = peek();
      var dir = null, kind = 'wire';
      if (DIRS[val()]) dir = next().v;
      if (NETS[val()]) kind = next().v;
      if (at('signed') || at('unsigned')) next();
      var range = at('[') ? parseRange() : null;
      var names = [];
      do {
        var id = needId();
        var init = null;
        if (eat('=')) init = parseExpr();
        names.push({ name: id.v, init: init, line: id.line });
      } while (eat(','));
      need(';');
      return tag({ k: 'decl', dir: dir, kind: kind, range: range, names: names }, t0, t0);
    }
    function parseParamItem() {
      var t0 = next();
      if (at('signed') || at('integer') || at('logic') || at('wire') || at('reg')) next();
      var range = at('[') ? parseRange() : null;
      var items = [];
      while (atId()) {
        var id = next();
        var expr = null;
        if (eat('=')) expr = parseExpr();
        items.push({ name: id.v, expr: expr, line: id.line });
        if (!eat(',')) break;
      }
      eat(';');
      return tag({ k: 'param', items: items, range: range }, t0, t0);
    }
    function parseConns() {
      need('(');
      var conns = [];
      var named = false;
      if (!at(')')) {
        if (at('.')) named = true;
        while (!eof() && !at(')')) {
          if (named) {
            need('.');
            var pn = needId();
            need('(');
            var ex = null;
            if (!at(')')) ex = parseExpr();
            need(')');
            conns.push({ port: pn.v, expr: ex, line: pn.line });
          } else {
            var t0 = peek();
            conns.push({ port: null, expr: parseExpr(), line: t0 ? t0.line : 0 });
          }
          if (!eat(',')) break;
        }
      }
      need(')');
      return { conns: conns, named: named };
    }
    function parseInst(typeTok) {
      if (eat('#')) {
        if (at('(')) skipGroup('(', ')');
        else if (!eof()) next();
      }
      var name = null;
      if (atId()) name = next().v;
      if (at('[')) {
        next();
        while (!eof() && !at(']')) next();
        eat(']');
      }
      var bag = parseConns();
      need(';');
      var isGate = !!PRIMS[typeTok.v];
      return tag({
        k: isGate ? 'gate' : 'inst',
        type: typeTok.v,
        name: name,
        conns: bag.conns,
        named: bag.named,
      }, typeTok, typeTok);
    }
    function parseItem() {
      skipAttr();
      if (at('parameter') || at('localparam')) return parseParamItem();
      if (DIRS[val()] || NETS[val()]) return parseDecl();
      if (at('assign')) {
        var t0 = next();
        if (eat('#')) { if (at('(')) skipGroup('(', ')'); else if (!eof()) next(); }
        var lhs = parseLhs();
        need('=');
        var rhs = parseExpr();
        need(';');
        return tag({ k: 'assign', lhs: lhs, rhs: rhs }, t0, rhs);
      }
      if (at('always') || at('always_comb') || at('always_ff') || at('always_latch')) return parseAlways();
      if (at('initial')) {
        var t1 = next();
        resync();
        return tag({ k: 'skip', warn: 'initial blocks are not drawn' }, t1, t1);
      }
      if (at('generate')) {
        var t2 = next();
        while (!eof() && !at('endgenerate') && !at('endmodule')) next();
        eat('endgenerate');
        return tag({ k: 'skip', warn: 'generate blocks are not drawn' }, t2, t2);
      }
      if (at('function') || at('task') || at('specify')) {
        var t3 = next();
        var close = t3.v === 'function' ? 'endfunction' : t3.v === 'task' ? 'endtask' : 'endspecify';
        while (!eof() && !at(close) && !at('endmodule')) next();
        eat(close);
        return tag({ k: 'skip', warn: t3.v + ' blocks are not drawn' }, t3, t3);
      }
      if (at('defparam') || at('genvar')) {
        var t4 = next();
        while (!eof() && !at(';') && !at('endmodule')) next();
        eat(';');
        return tag({ k: 'skip', warn: '' }, t4, t4);
      }
      if (atId()) return parseInst(next());
      error('Unsupported module item');
    }
    function parsePortList() {
      var ports = [];
      if (at(')')) return ports;
      if (!DIRS[val()]) {
        do {
          var id = needId();
          ports.push({ name: id.v, dir: null, kind: 'wire', range: null, line: id.line });
        } while (eat(','));
        return ports;
      }
      while (!eof() && !at(')')) {
        if (!DIRS[val()]) break;
        var dir = next().v;
        var kind = 'wire';
        if (NETS[val()]) kind = next().v;
        if (at('signed') || at('unsigned')) next();
        var range = at('[') ? parseRange() : null;
        while (!eof() && !at(')')) {
          var id = needId();
          ports.push({ name: id.v, dir: dir, kind: kind, range: range, line: id.line });
          if (!eat(',')) break;
          if (DIRS[val()]) break;
        }
      }
      return ports;
    }
    function parseHeaderParams(params) {
      if (!eat('#')) return;
      need('(');
      while (!eof() && !at(')')) {
        if (at('parameter') || at('localparam')) next();
        if (at('signed') || at('integer') || NETS[val()]) next();
        if (at('[')) parseRange();
        if (atId() && val(1) === '=') {
          var name = next().v;
          eat('=');
          var ex = parseExpr();
          var n = evalConst(ex, params);
          if (n != null) params[name] = n;
        } else if (!eof() && !at(')')) {
          next();
        } else break;
        eat(',');
      }
      need(')');
    }
    function parseModule() {
      var t0 = need('module');
      var id = needId();
      var params = {};
      parseHeaderParams(params);
      var ports = [];
      if (eat('(')) {
        ports = parsePortList();
        need(')');
      }
      need(';');
      var items = [];
      while (!eof() && !at('endmodule')) {
        var before = p;
        try {
          skipAttr();
          if (at('endmodule')) break;
          var item = parseItem();
          if (item && item.k === 'skip') {
            if (item.warn) warnings.push(item.warn + ' (line ' + (item.line || t0.line) + ')');
          } else if (item) items.push(item);
        } catch (err) {
          warnings.push(err.message);
          if (p <= before) p = before + 1;
          resync();
        }
        if (p <= before) p++;
      }
      eat('endmodule');
      return { name: id.v, line: id.line, ports: ports, params: params, items: items };
    }

    var modules = [];
    while (!eof()) {
      skipAttr();
      if (at('module')) modules.push(parseModule());
      else next();
    }
    return { modules: modules, warnings: warnings, src: src };
  }

  function bitsNeeded(v) {
    v = Math.abs(v | 0);
    var n = 1;
    while (v > 1 && n < 30) { v = Math.floor(v / 2); n++; }
    return n;
  }
  function evalConst(expr, params) {
    if (!expr) return null;
    if (expr.k === 'num') return expr.value | 0;
    if (expr.k === 'id') {
      if (params && Object.prototype.hasOwnProperty.call(params, expr.name)) return params[expr.name] | 0;
      return null;
    }
    if (expr.k === 'un') {
      var a = evalConst(expr.a, params);
      if (a == null) return null;
      if (expr.op === '-') return -a;
      if (expr.op === '+') return a;
      if (expr.op === '~') return ~a;
      if (expr.op === '!') return a ? 0 : 1;
      return null;
    }
    if (expr.k === 'bin') {
      var x = evalConst(expr.a, params);
      var y = evalConst(expr.b, params);
      if (x == null || y == null) return null;
      if (expr.op === '+') return x + y;
      if (expr.op === '-') return x - y;
      if (expr.op === '*') return x * y;
      if (expr.op === '/') return y ? (x / y) | 0 : null;
      if (expr.op === '<<') return x << y;
      if (expr.op === '>>') return x >> y;
      return null;
    }
    return null;
  }
  function rangeNums(range, params) {
    if (!range) return null;
    var m = evalConst(range.msb, params);
    var l = evalConst(range.lsb, params);
    if (m == null || l == null) return { width: 1, msb: null, lsb: null };
    return { width: Math.abs(m - l) + 1, msb: m, lsb: l };
  }

  function findNet(n) {
    var r = n;
    while (r && r.alias) r = r.alias;
    while (n && n.alias && n.alias !== r) {
      var nx = n.alias;
      n.alias = r;
      n = nx;
    }
    return r;
  }
  function rebind(drop, keep) {
    drop = findNet(drop);
    keep = findNet(keep);
    if (drop === keep) return keep;
    var i;
    for (i = 0; i < drop.pins.length; i++) {
      drop.pins[i].net = keep;
      keep.pins.push(drop.pins[i]);
    }
    drop.pins = [];
    drop.alias = keep;
    if (drop.label && drop.label !== keep.label) {
      keep.also.push(drop.label);
    }
    return keep;
  }
  function alias(src, dst) {
    src = findNet(src);
    dst = findNet(dst);
    if (src === dst) return dst;
    if (src.isConst && !dst.isConst) return rebind(dst, src);
    if (dst.isConst && !src.isConst) return rebind(src, dst);
    if (src.isConst && dst.isConst) return src;
    return rebind(src, dst);
  }
  function uniq(base) {
    base = String(base || 'u').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
    if (!base) base = 'u';
    var n = base, i = 2;
    while (E.used[n]) { n = base + '_' + i; i++; }
    E.used[n] = 1;
    return n;
  }
  function addPin(cell, name, dir, side, net) {
    var pin = { id: E.pinSeq++, name: name, dir: dir, side: side, net: null, cell: cell, bubble: false };
    cell.pins.push(pin);
    if (net) {
      net = findNet(net);
      pin.net = net;
      net.pins.push(pin);
    }
    return pin;
  }
  function freshNet(label) {
    var n = { id: E.netSeq++, label: label || '', pins: [], alias: null, constVal: null, isConst: false, bus: false, width: 1, also: [] };
    E.mod.nets.push(n);
    return n;
  }
  function freshBus(width) {
    var n = freshNet('');
    n.bus = true;
    n.width = width;
    return n;
  }
  function constNet(bit) {
    var key = bit ? '1' : '0';
    if (!E.constN[key]) {
      var n = freshNet(bit ? "1'b1" : "1'b0");
      n.isConst = true;
      n.constVal = bit ? 1 : 0;
      var cell = {
        id: E.mod.nextId++, kind: 'const', name: bit ? '1' : '0', typeName: bit ? "1'b1" : "1'b0",
        line: 0, detail: n.label, pins: [], value: bit ? 1 : 0
      };
      addPin(cell, 'Y', 'out', 'r', n);
      E.mod.cells.push(cell);
      E.used[cell.name] = 1;
      E.constN[key] = n;
    }
    return findNet(E.constN[key]);
  }
  function constOf(n) {
    if (!n) return null;
    n = findNet(n);
    return n.constVal == null ? null : n.constVal;
  }
  function bitIndex(sym, i) {
    if (sym.msb == null) return i;
    if (sym.msb >= sym.lsb) return sym.lsb + i;
    return sym.lsb - i;
  }
  function bitOffset(sym, idx) {
    if (sym.msb == null) return 0;
    if (sym.msb >= sym.lsb) return idx - sym.lsb;
    return sym.lsb - idx;
  }
  function symOf(name) {
    var s = E.mod.symbols[name];
    if (!s) {
      s = { name: name, dir: null, kind: 'wire', width: 1, msb: null, lsb: null, line: 0 };
      E.mod.symbols[name] = s;
    }
    return s;
  }
  function bitNet(sym, i) {
    var key = sym.name + '#' + i;
    var n = E.netKey[key];
    if (!n) {
      var label = sym.width > 1 ? (sym.name + '[' + bitIndex(sym, i) + ']') : sym.name;
      n = freshNet(label);
      E.netKey[key] = n;
    }
    return findNet(n);
  }
  function busNet(sym) {
    var key = sym.name + '#bus';
    var n = E.netKey[key];
    if (!n) {
      n = freshNet(sym.name + '[' + sym.msb + ':' + sym.lsb + ']');
      n.bus = true;
      n.width = sym.width;
      E.netKey[key] = n;
    }
    return findNet(n);
  }
  function loadId(name) {
    var sym = symOf(name);
    if (sym.width > MAXW) return [busNet(sym)];
    var arr = [];
    var i;
    for (i = 0; i < sym.width; i++) arr.push(bitNet(sym, i));
    return arr;
  }
  function fitNets(nets, w) {
    if (w == null) return nets;
    if (nets.length === 1 && nets[0] && nets[0].bus) return nets;
    if (nets.length === w) return nets;
    if (nets.length > w) return nets.slice(0, w);
    var o = nets.slice();
    while (o.length < w) o.push(constNet(0));
    return o;
  }
  function nat1(expr) {
    if (!expr) return 1;
    if (expr.k === 'num' && expr.unsized) return bitsNeeded(expr.value);
    if (expr.k === 'num') return expr.width || 1;
    if (expr.k === 'id') return symOf(expr.name).width;
    if (expr.k === 'index') return 1;
    if (expr.k === 'slice') {
      var m = evalConst(expr.msb, E.mod.params);
      var l = evalConst(expr.lsb, E.mod.params);
      if (m == null || l == null) return 1;
      return Math.abs(m - l) + 1;
    }
    if (expr.k === 'concat') {
      var s = 0, i;
      for (i = 0; i < expr.parts.length; i++) s += nat1(expr.parts[i]);
      return s || 1;
    }
    if (expr.k === 'repl') {
      var n = evalConst(expr.n, E.mod.params) || 1;
      return n * nat1(expr.body);
    }
    if (expr.k === 'un') {
      if (expr.op === '~' || expr.op === '+' || expr.op === '-') return nat1(expr.a);
      return 1;
    }
    if (expr.k === 'bin') {
      if (expr.op === '==' || expr.op === '!=' || expr.op === '===' || expr.op === '!==' ||
          expr.op === '<' || expr.op === '>' || expr.op === '<=' || expr.op === '>=' ||
          expr.op === '&&' || expr.op === '||') return 1;
      return Math.max(nat1(expr.a), nat1(expr.b));
    }
    if (expr.k === 'tri') return Math.max(nat1(expr.t), nat1(expr.f));
    return 1;
  }
  function inName(i, n) {
    var names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    if (n === 1) return 'A';
    return names[i] || ('I' + i);
  }
  function makeGate(kind, inputs, outNet, line, name) {
    var hint = E.nameHint && outNet && !outNet.label ? (kind + '_' + E.nameHint) : '';
    var auto = (outNet && outNet.label) ? (kind + '_' + outNet.label) : (hint || kind);
    var cell = {
      id: E.mod.nextId++,
      kind: kind,
      name: uniq(name || auto),
      typeName: kind.toUpperCase(),
      line: line || E.lineHint || 0,
      detail: E.detailHint || '',
      pins: []
    };
    var i;
    for (i = 0; i < inputs.length; i++) addPin(cell, inName(i, inputs.length), 'in', 'l', inputs[i]);
    addPin(cell, 'Y', 'out', 'r', outNet);
    E.mod.cells.push(cell);
    return findNet(outNet);
  }
  function spawn(kind, inputs, line) {
    return makeGate(kind, inputs, freshNet(''), line, null);
  }
  function makeMux(d0, d1, sel, out, line) {
    var cell = {
      id: E.mod.nextId++, kind: 'mux', name: uniq('mux'), typeName: 'MUX',
      line: line || E.lineHint || 0, detail: E.detailHint || '', pins: []
    };
    addPin(cell, 'D0', 'in', 'l', d0);
    addPin(cell, 'D1', 'in', 'l', d1);
    var s = addPin(cell, 'S', 'in', 'b', sel);
    s.bubble = false;
    addPin(cell, 'Y', 'out', 'r', out);
    E.mod.cells.push(cell);
    return findNet(out);
  }
  function makeDff(opts) {
    var cell = {
      id: E.mod.nextId++, kind: 'dff', name: uniq(opts.name || 'dff'), typeName: 'DFF',
      line: opts.line || 0, detail: opts.detail || '', pins: []
    };
    addPin(cell, 'D', 'in', 'l', opts.d);
    if (opts.rst) {
      var rp = addPin(cell, opts.rstVal === 1 ? 'SET' : 'RST', 'in', 'l', opts.rst);
      rp.bubble = !!opts.rstBubble;
    }
    var ck = addPin(cell, 'CLK', 'in', 'b', opts.clk);
    ck.bubble = !!opts.clkBubble;
    addPin(cell, 'Q', 'out', 'r', opts.q);
    E.mod.cells.push(cell);
    return cell;
  }
  function makeOp(text, inputs, width, line) {
    var shown = text || 'logic';
    if (shown.length > 28) shown = shown.slice(0, 26) + '..';
    var cell = {
      id: E.mod.nextId++, kind: 'op', name: uniq(shown.length <= 14 ? shown : 'logic'),
      typeName: 'OP', line: line || 0, detail: text || '', pins: []
    };
    var seen = {};
    var u = [];
    var i;
    for (i = 0; i < inputs.length; i++) {
      if (!inputs[i]) continue;
      var n = findNet(inputs[i]);
      if (seen[n.id]) continue;
      seen[n.id] = 1;
      u.push(n);
    }
    for (i = 0; i < u.length; i++) addPin(cell, inName(i, u.length), 'in', 'l', u[i]);
    var outs = [];
    if (width > MAXW) {
      var b = freshBus(width);
      addPin(cell, 'Y', 'out', 'r', b);
      outs.push(b);
    } else {
      var w = Math.max(1, width || 1);
      for (i = 0; i < w; i++) {
        var o = freshNet('');
        addPin(cell, w > 1 ? ('Y' + i) : 'Y', 'out', 'r', o);
        outs.push(o);
      }
    }
    E.mod.cells.push(cell);
    return outs;
  }
  function invert(n, line) {
    var c = constOf(n);
    if (c === 0) return constNet(1);
    if (c === 1) return constNet(0);
    return spawn('not', [n], line);
  }
  function foldBits(op, bits, line) {
    var vars = [];
    var i, c;
    if (op === '&') {
      for (i = 0; i < bits.length; i++) {
        c = constOf(bits[i]);
        if (c === 0) return constNet(0);
        if (c === 1) continue;
        vars.push(bits[i]);
      }
      if (!vars.length) return constNet(1);
      if (vars.length === 1) return vars[0];
      return spawn('and', vars, line);
    }
    if (op === '|') {
      for (i = 0; i < bits.length; i++) {
        c = constOf(bits[i]);
        if (c === 1) return constNet(1);
        if (c === 0) continue;
        vars.push(bits[i]);
      }
      if (!vars.length) return constNet(0);
      if (vars.length === 1) return vars[0];
      return spawn('or', vars, line);
    }
    if (op === '^') {
      var inv = 0;
      for (i = 0; i < bits.length; i++) {
        c = constOf(bits[i]);
        if (c === 0) continue;
        if (c === 1) { inv ^= 1; continue; }
        vars.push(bits[i]);
      }
      var n;
      if (!vars.length) n = constNet(0);
      else if (vars.length === 1) n = vars[0];
      else n = spawn('xor', vars, line);
      if (inv) n = invert(n, line);
      return n;
    }
    if (op === '~^' || op === '^~') {
      var n2 = foldBits('^', bits, line);
      return invert(n2, line);
    }
    return spawn(op, bits, line);
  }
  function flatten(expr, op) {
    if (expr && expr.k === 'bin' && expr.op === op) return flatten(expr.a, op).concat(flatten(expr.b, op));
    return [expr];
  }
  function srcSlice(node) {
    if (!node || node.pos == null || !E.src) return '';
    var b = node.end == null ? node.pos : node.end;
    return E.src.slice(node.pos, b).replace(/\s+/g, ' ').trim();
  }
  function elabNum(expr, width) {
    var w = width || (expr.unsized ? bitsNeeded(expr.value) : (expr.width || 1));
    if (w > MAXW) {
      var bus = freshBus(w);
      bus.isConst = true;
      bus.constVal = expr.value | 0;
      bus.label = expr.unsized ? String(expr.value) : (expr.width + "'b");
      return [bus];
    }
    var bits = [];
    var v, i;
    if (expr.unsized) {
      v = expr.value | 0;
      for (i = 0; i < w; i++) { bits.push(v & 1); v = Math.floor(v / 2); }
    } else {
      bits = (expr.bits || []).slice();
      while (bits.length < w) bits.push(0);
      bits = bits.slice(0, w);
    }
    return bits.map(function (b) { return constNet(b ? 1 : 0); });
  }
  function elabExpr(expr, width) {
    if (!expr) return fitNets([constNet(0)], width || 1);
    if (expr.k === 'num') return elabNum(expr, width);
    if (expr.k === 'id') {
      var nets = loadId(expr.name);
      if (nets.length === 1 && nets[0].bus) return nets;
      return fitNets(nets, width);
    }
    if (expr.k === 'index') {
      var all = loadId(expr.name);
      if (all.length === 1 && all[0].bus) return all;
      var idx = evalConst(expr.index, E.mod.params);
      var sym = symOf(expr.name);
      var bit = 0;
      if (idx != null) bit = bitOffset(sym, idx);
      if (bit < 0 || bit >= all.length) bit = 0;
      return fitNets([all[bit]], width);
    }
    if (expr.k === 'slice') {
      var idn = loadId(expr.name);
      var m = evalConst(expr.msb, E.mod.params);
      var l = evalConst(expr.lsb, E.mod.params);
      var sym2 = symOf(expr.name);
      if (m == null || l == null || (idn.length === 1 && idn[0].bus)) return fitNets(idn, width);
      var i0 = bitOffset(sym2, l);
      var i1 = bitOffset(sym2, m);
      var step = i1 >= i0 ? 1 : -1;
      var out = [];
      var guard = 0;
      for (var ii = i0; ii !== i1 + step && guard < 64; ii += step) {
        guard++;
        if (idn[ii]) out.push(idn[ii]);
      }
      return fitNets(out.length ? out : idn, width);
    }
    if (expr.k === 'concat') {
      var acc = [];
      for (var ci = expr.parts.length - 1; ci >= 0; ci--) acc = acc.concat(elabExpr(expr.parts[ci], null));
      if (width > MAXW) return [packBus(acc, width)];
      return fitNets(acc, width);
    }
    if (expr.k === 'repl') {
      var times = evalConst(expr.n, E.mod.params) || 0;
      var body = elabExpr(expr.body, null);
      var rep = [];
      var ri;
      for (ri = 0; ri < times && rep.length < 64; ri++) rep = rep.concat(body);
      if (width > MAXW) return [packBus(rep, width)];
      return fitNets(rep, width);
    }
    if (expr.k === 'un') return fitNets(elabUnary(expr, width), width);
    if (expr.k === 'bin') return fitNets(elabBin(expr, width), width);
    if (expr.k === 'tri') return fitNets(elabTri(expr, width), width);
    return fitNets(makeOp(srcSlice(expr) || 'logic', [], width || 1, expr.line), width || 1);
  }
  function packBus(bits, width) {
    var b = freshBus(width || bits.length || 1);
    return b;
  }
  function elabUnary(expr, width) {
    var line = expr.line;
    if (expr.op === '~') {
      var w = width || nat1(expr.a);
      if (w > MAXW) return makeOp(srcSlice(expr) || '~', elabExpr(expr.a, null), w, line);
      var a = elabExpr(expr.a, w);
      return a.map(function (n) { return invert(n, line); });
    }
    if (expr.op === '!' ) {
      var an = elabExpr(expr.a, null);
      var r = an.length === 1 ? an[0] : foldBits('|', an, line);
      return [invert(r, line)];
    }
    if (expr.op === '+' ) return elabExpr(expr.a, width);
    if (expr.op === '-' ) {
      return makeOp(srcSlice(expr) || '-', elabExpr(expr.a, null), width || nat1(expr.a), line);
    }
    var src = elabExpr(expr.a, null);
    if (src.length === 1 && src[0].bus) return makeOp(srcSlice(expr) || expr.op, src, 1, line);
    var base = expr.op;
    var inv = false;
    if (base === '~&') { base = '&'; inv = true; }
    else if (base === '~|') { base = '|'; inv = true; }
    else if (base === '~^' || base === '^~') { base = '^'; inv = true; }
    var red = foldBits(base === '&' || base === '|' || base === '^' ? base : '|', src, line);
    if (inv) red = invert(red, line);
    return [red];
  }
  function elabBin(expr, width) {
    var line = expr.line;
    var op = expr.op;
    if (op === '&&' || op === '||') {
      var aa = elabExpr(expr.a, null);
      var bb = elabExpr(expr.b, null);
      var a1 = aa.length === 1 ? aa[0] : foldBits('|', aa, line);
      var b1 = bb.length === 1 ? bb[0] : foldBits('|', bb, line);
      return [foldBits(op === '&&' ? '&' : '|', [a1, b1], line)];
    }
    if (op === '==' || op === '!=' || op === '===' || op === '!==') {
      var wq = Math.max(nat1(expr.a), nat1(expr.b));
      if (wq > MAXW) return makeOp(srcSlice(expr) || op, elabExpr(expr.a, null).concat(elabExpr(expr.b, null)), 1, line);
      var qa = fitNets(elabExpr(expr.a, wq), wq);
      var qb = fitNets(elabExpr(expr.b, wq), wq);
      var eqs = [];
      var i;
      for (i = 0; i < wq; i++) eqs.push(foldBits('^', [qa[i], qb[i]], line));
      var any = foldBits('|', eqs, line);
      var eq = invert(any, line);
      if (op === '!=' || op === '!==') eq = invert(eq, line);
      return [eq];
    }
    if (op === '&' || op === '|' || op === '^' || op === '~^' || op === '^~') {
      var parts = (op === '&' || op === '|' || op === '^') ? flatten(expr, op) : [expr.a, expr.b];
      var w = width || 1;
      var natw = 1;
      for (var pi = 0; pi < parts.length; pi++) natw = Math.max(natw, nat1(parts[pi]));
      if (!width) w = natw;
      if (w > MAXW) {
        var ins = [];
        for (var pj = 0; pj < parts.length; pj++) ins = ins.concat(elabExpr(parts[pj], null));
        return makeOp(srcSlice(expr) || op, ins, w, line);
      }
      var el = parts.map(function (part) { return fitNets(elabExpr(part, w), w); });
      var outs = [];
      for (var b = 0; b < w; b++) {
        var bits = el.map(function (arr) { return arr[b]; });
        if (op === '~^' || op === '^~') outs.push(invert(foldBits('^', bits, line), line));
        else outs.push(foldBits(op, bits, line));
      }
      return outs;
    }
    if (op === '+') {
      var wa = width || Math.max(nat1(expr.a), nat1(expr.b));
      if (wa > MAXW) {
        return makeOp(srcSlice(expr) || '+', elabExpr(expr.a, null).concat(elabExpr(expr.b, null)), wa, line);
      }
      var av = fitNets(elabExpr(expr.a, wa), wa);
      var bv = fitNets(elabExpr(expr.b, wa), wa);
      return ripple(av, bv, wa, line);
    }
    var ins2 = elabExpr(expr.a, null).concat(elabExpr(expr.b, null));
    return makeOp(srcSlice(expr) || op, ins2, width || 1, line);
  }
  function ripple(a, b, w, line) {
    var carry = constNet(0);
    var sums = [];
    var i;
    for (i = 0; i < w; i++) {
      var axb = foldBits('^', [a[i], b[i]], line);
      var sum = foldBits('^', [axb, carry], line);
      sums.push(sum);
      if (i < w - 1) {
        var ab = foldBits('&', [a[i], b[i]], line);
        var ac = foldBits('&', [a[i], carry], line);
        var bc = foldBits('&', [b[i], carry], line);
        carry = foldBits('|', [ab, ac, bc], line);
      }
    }
    return sums;
  }
  function elabTri(expr, width) {
    var line = expr.line;
    var w = width || Math.max(nat1(expr.t), nat1(expr.f));
    var selN = elabExpr(expr.c, null);
    var sel = selN.length === 1 ? selN[0] : foldBits('|', selN, line);
    var sc = constOf(sel);
    if (w > MAXW) {
      var ins = [sel].concat(elabExpr(expr.t, null), elabExpr(expr.f, null));
      return makeOp(srcSlice(expr) || 'mux', ins, w, line);
    }
    var t = fitNets(elabExpr(expr.t, w), w);
    var f = fitNets(elabExpr(expr.f, w), w);
    if (sc === 1) return t;
    if (sc === 0) return f;
    var outs = [];
    var i;
    for (i = 0; i < w; i++) {
      var o = freshNet('');
      makeMux(f[i], t[i], sel, o, line);
      outs.push(o);
    }
    return outs;
  }
  function elabLhs(lhs) {
    if (!lhs) return [];
    if (lhs.k === 'id') return loadId(lhs.name);
    if (lhs.k === 'index') return elabExpr(lhs, 1);
    if (lhs.k === 'slice') return elabExpr(lhs, null);
    if (lhs.k === 'concat') {
      var acc = [];
      var i;
      for (i = lhs.parts.length - 1; i >= 0; i--) acc = acc.concat(elabLhs(lhs.parts[i]));
      return acc;
    }
    return elabExpr(lhs, null);
  }
  function elabAssign(lhs, rhs, line) {
    var prevH = E.nameHint, prevD = E.detailHint, prevL = E.lineHint;
    E.lineHint = line || (lhs && lhs.line) || 0;
    E.detailHint = srcSlice(rhs) || '';
    if (lhs && (lhs.k === 'id' || lhs.k === 'index' || lhs.k === 'slice')) E.nameHint = lhs.name;
    var tgts = elabLhs(lhs);
    var w = (tgts.length === 1 && tgts[0].bus) ? tgts[0].width : tgts.length;
    var srcs = elabExpr(rhs, w);
    var n = Math.max(tgts.length, srcs.length);
    if (tgts.length === 1 && srcs.length === 1) n = 1;
    else n = Math.min(tgts.length, srcs.length);
    var i;
    for (i = 0; i < n; i++) {
      if (findNet(srcs[i]) !== findNet(tgts[i])) alias(srcs[i], tgts[i]);
    }
    E.nameHint = prevH;
    E.detailHint = prevD;
    E.lineHint = prevL;
  }
  function collectAsg(stmt) {
    if (!stmt) return null;
    if (stmt.k === 'asg') return [stmt];
    if (stmt.k === 'block') {
      var out = [];
      var i;
      for (i = 0; i < stmt.stmts.length; i++) {
        if (stmt.stmts[i].k !== 'asg') return null;
        out.push(stmt.stmts[i]);
      }
      return out;
    }
    return null;
  }
  function unwrap(stmt) {
    var s = stmt;
    while (s && s.k === 'block' && s.stmts.length === 1) s = s.stmts[0];
    return s;
  }
  function condSignal(expr) {
    if (!expr) return null;
    if (expr.k === 'id') return expr.name;
    if (expr.k === 'un' && (expr.op === '!' || expr.op === '~')) return condSignal(expr.a);
    return null;
  }
  function condLow(expr) {
    return !!(expr && expr.k === 'un' && (expr.op === '!' || expr.op === '~'));
  }
  function lhsKey(lhs) {
    if (!lhs) return '';
    if (lhs.k === 'id') return lhs.name;
    if (lhs.k === 'index') return lhs.name + '[' + (evalConst(lhs.index, E.mod.params)) + ']';
    if (lhs.k === 'slice') return lhs.name + '[' + evalConst(lhs.msb, E.mod.params) + ':' + evalConst(lhs.lsb, E.mod.params) + ']';
    if (lhs.k === 'concat') return '{' + lhs.parts.map(lhsKey).join(',') + '}';
    return srcSlice(lhs);
  }
  function tryComb(body) {
    var asgs = collectAsg(body);
    if (asgs) {
      asgs.forEach(function (a) { elabAssign(a.lhs, a.rhs, a.line); });
      return true;
    }
    var top = unwrap(body);
    if (top && top.k === 'if') {
      var t = collectAsg(top.then);
      var e = top.els ? collectAsg(top.els) : [];
      if (!t) return false;
      if (e == null) return false;
      var i, j;
      for (i = 0; i < t.length; i++) {
        var other = null;
        for (j = 0; j < e.length; j++) if (lhsKey(e[j].lhs) === lhsKey(t[i].lhs)) other = e[j];
        if (other) elabAssign(t[i].lhs, { k: 'tri', c: top.cond, t: t[i].rhs, f: other.rhs, line: t[i].line, pos: t[i].pos, end: other.end || t[i].end }, t[i].line);
        else elabAssign(t[i].lhs, t[i].rhs, t[i].line);
      }
      return true;
    }
    return false;
  }
  function walkIds(node, into) {
    if (!node) return;
    if (node.k === 'id' && node.name) into[node.name] = 1;
    ['a', 'b', 'c', 't', 'f', 'n', 'body', 'index', 'msb', 'lsb', 'base', 'lhs', 'rhs', 'cond'].forEach(function (k) {
      if (node[k]) walkIds(node[k], into);
    });
    if (node.parts) node.parts.forEach(function (p) { walkIds(p, into); });
    if (node.stmts) node.stmts.forEach(function (p) { walkIds(p, into); });
    if (node.then) walkIds(node.then, into);
    if (node.els) walkIds(node.els, into);
  }
  function makeProc(item) {
    var text = srcSlice(item);
    if (text.length > 42) text = text.slice(0, 40) + '..';
    var written = {};
    var read = {};
    function walkStmt(st) {
      if (!st) return;
      if (st.k === 'asg') {
        walkIds(st.lhs, written);
        walkIds(st.rhs, read);
        return;
      }
      if (st.k === 'block') { st.stmts.forEach(walkStmt); return; }
      if (st.k === 'if') {
        walkIds(st.cond, read);
        walkStmt(st.then);
        walkStmt(st.els);
        return;
      }
      walkIds(st, read);
    }
    walkStmt(item.body);
    var cell = {
      id: E.mod.nextId++, kind: 'proc', name: uniq('always'), typeName: 'ALWAYS',
      line: item.line || 0, detail: srcSlice(item.body) || text, pins: []
    };
    var name;
    for (name in read) if (Object.prototype.hasOwnProperty.call(read, name) && !written[name]) {
      loadId(name).forEach(function (n, i) {
        var sym = symOf(name);
        var lab = sym.width > 1 ? name + '[' + bitIndex(sym, i) + ']' : name;
        addPin(cell, lab, 'in', 'l', n);
      });
    }
    for (name in written) if (Object.prototype.hasOwnProperty.call(written, name)) {
      loadId(name).forEach(function (n, i) {
        var sym = symOf(name);
        var lab = sym.width > 1 ? name + '[' + bitIndex(sym, i) + ']' : name;
        addPin(cell, lab, 'out', 'r', n);
      });
    }
    (item.sens || []).forEach(function (s) {
      if (s.name && !read[s.name] && !written[s.name]) {
        var n = loadId(s.name)[0];
        var pin = addPin(cell, s.name, 'in', 'b', n);
        if (s.edge === 'neg') pin.bubble = true;
      }
    });
    E.mod.cells.push(cell);
  }
  function elabAlways(item) {
    var sens = item.sens || [];
    var edges = sens.filter(function (s) { return s.edge === 'pos' || s.edge === 'neg'; });
    var comb = item.akind === 'always_comb' || sens.some(function (s) { return s.edge === 'any'; }) || (!edges.length && item.akind !== 'always_ff');
    if (comb) {
      if (!tryComb(item.body)) makeProc(item);
      return;
    }
    var top = unwrap(item.body);
    var clk = edges[0];
    var reset = null;
    var data = null;
    if (top && top.k === 'if') {
      var cn = condSignal(top.cond);
      var rstAsg = collectAsg(top.then);
      var dataAsg = top.els ? collectAsg(top.els) : null;
      if (cn && rstAsg && dataAsg) {
        var inSens = null;
        var i;
        for (i = 0; i < edges.length; i++) if (edges[i].name === cn) inSens = edges[i];
        if (inSens) {
          reset = { name: cn, low: condLow(top.cond), edge: inSens, asg: rstAsg };
          for (i = 0; i < edges.length; i++) if (edges[i] !== inSens) clk = edges[i];
          data = dataAsg;
        } else {
          data = dataAsg.map(function (a) {
            var ra = null;
            var j;
            for (j = 0; j < rstAsg.length; j++) if (lhsKey(rstAsg[j].lhs) === lhsKey(a.lhs)) ra = rstAsg[j];
            if (!ra) return a;
            return {
              k: 'asg', lhs: a.lhs, line: a.line, pos: a.pos, end: a.end,
              rhs: { k: 'tri', c: top.cond, t: ra.rhs, f: a.rhs, line: a.line, pos: a.pos, end: a.end }
            };
          });
        }
      }
    }
    if (!data) {
      var plain = collectAsg(item.body);
      if (!plain) { makeProc(item); return; }
      data = plain;
    }
    if (!clk || !clk.name) { makeProc(item); return; }
    var clkNet = loadId(clk.name)[0];
    data.forEach(function (asg) {
      var tgts = elabLhs(asg.lhs);
      var prev = E.detailHint;
      E.detailHint = srcSlice(asg.rhs) || '';
      E.lineHint = asg.line || item.line || 0;
      var w = tgts.length;
      var srcs = elabExpr(asg.rhs, w);
      var rsts = null;
      if (reset) {
        var ra = null;
        var j;
        for (j = 0; j < reset.asg.length; j++) if (lhsKey(reset.asg[j].lhs) === lhsKey(asg.lhs)) ra = reset.asg[j];
        if (ra) rsts = elabExpr(ra.rhs, w);
      }
      var bi;
      for (bi = 0; bi < tgts.length; bi++) {
        var d = srcs[bi] || constNet(0);
        var rstNet = null, bubble = false, val = null;
        if (rsts && rsts[bi]) {
          var rv = constOf(rsts[bi]);
          if (rv === 0 || rv === 1) {
            rstNet = loadId(reset.name)[0];
            bubble = reset.low || (reset.edge && reset.edge.edge === 'neg');
            val = rv;
          } else {
            var sel = loadId(reset.name)[0];
            var mid = freshNet('');
            makeMux(d, rsts[bi], sel, mid, asg.line);
            d = mid;
          }
        }
        var qlab = tgts[bi].label || ('q' + bi);
        makeDff({
          d: d, q: tgts[bi], clk: clkNet, clkBubble: clk.edge === 'neg',
          rst: rstNet, rstBubble: bubble, rstVal: val,
          line: asg.line || item.line, detail: srcSlice(asg) || (qlab + ' <= ' + (E.detailHint || 'd')),
          name: 'dff_' + qlab
        });
      }
      E.detailHint = prev;
    });
  }
  function hookPort(cell, port, expr, line) {
    var dir = port.dir || 'input';
    var side = dir === 'input' ? 'l' : 'r';
    var pdir = dir === 'input' ? 'in' : (dir === 'inout' ? 'inout' : 'out');
    var w = port.width || 1;
    if (!expr) {
      if (w > MAXW) addPin(cell, port.name, pdir, side, freshBus(w));
      else if (w <= 1) addPin(cell, port.name, pdir, side, freshNet(''));
      else {
        var bi;
        for (bi = 0; bi < w; bi++) addPin(cell, port.name + '[' + bitIndex(port, bi) + ']', pdir, side, freshNet(''));
      }
      return;
    }
    if (w > MAXW) {
      var wide = elabExpr(expr, w);
      addPin(cell, port.name, pdir, side, wide[0]);
      return;
    }
    var nets = fitNets(elabExpr(expr, w), w);
    if (w <= 1) addPin(cell, port.name, pdir, side, nets[0]);
    else {
      var k;
      for (k = 0; k < nets.length; k++) addPin(cell, port.name + '[' + bitIndex(port, k) + ']', pdir, side, nets[k]);
    }
  }
  function elabInst(item) {
    var child = E.mods[item.type] || null;
    var cell = {
      id: E.mod.nextId++, kind: 'mod', name: uniq(item.name || item.type), typeName: item.type,
      line: item.line || 0, detail: item.type, pins: [], child: child ? item.type : null
    };
    var ports = child ? child.ports : [];
    if (item.named) {
      var seen = {};
      item.conns.forEach(function (c) {
        var port = null;
        var i;
        for (i = 0; i < ports.length; i++) if (ports[i].name === c.port) port = ports[i];
        if (!port) port = { name: c.port, dir: 'input', width: 1, msb: null, lsb: null };
        seen[port.name] = 1;
        hookPort(cell, port, c.expr, c.line);
      });
      ports.forEach(function (port) {
        if (!seen[port.name]) hookPort(cell, port, null, item.line);
      });
    } else {
      item.conns.forEach(function (c, i) {
        var port = ports[i] || { name: 'p' + i, dir: i === 0 ? 'output' : 'input', width: 1, msb: null, lsb: null };
        hookPort(cell, port, c.expr, c.line);
      });
    }
    E.mod.cells.push(cell);
  }
  function elabGate(item) {
    var kind = item.type;
    var conns = item.conns || [];
    if (!conns.length) return;
    if (kind === 'not' || kind === 'buf') {
      var inNets = elabExpr(conns[conns.length - 1].expr, null);
      var oi;
      for (oi = 0; oi < conns.length - 1; oi++) {
        var outNets = elabExpr(conns[oi].expr, null);
        if ((outNets[0] && outNets[0].bus) || (inNets[0] && inNets[0].bus)) {
          var made = makeOp(kind, inNets.concat(outNets), (outNets[0] && outNets[0].width) || 1, item.line);
          if (made[0] && outNets[0] && findNet(made[0]) !== findNet(outNets[0])) alias(made[0], outNets[0]);
          continue;
        }
        var w = Math.min(MAXW, Math.max(outNets.length, inNets.length, 1));
        var ins = fitNets(inNets, w);
        var outs = fitNets(outNets, w);
        var b;
        for (b = 0; b < w; b++) makeGate(kind, [ins[b]], outs[b], item.line, item.name);
      }
      return;
    }
    var outN = elabExpr(conns[0].expr, null);
    if (outN[0] && outN[0].bus) {
      var allIn = [];
      var ci;
      for (ci = 1; ci < conns.length; ci++) allIn = allIn.concat(elabExpr(conns[ci].expr, null));
      var box = makeOp(kind, allIn, outN[0].width || 1, item.line);
      if (box[0] && findNet(box[0]) !== findNet(outN[0])) alias(box[0], outN[0]);
      return;
    }
    var w2 = outN.length || 1;
    var groups = [];
    for (var gi = 1; gi < conns.length; gi++) groups.push(fitNets(elabExpr(conns[gi].expr, w2), w2));
    var bit;
    for (bit = 0; bit < w2; bit++) {
      var bits = groups.map(function (g) { return g[bit]; });
      makeGate(kind, bits, outN[bit], item.line, item.name);
    }
  }
  function addPorts(mod) {
    mod.ports.forEach(function (sym) {
      if (sym.dir !== 'input' && sym.dir !== 'output' && sym.dir !== 'inout') sym.dir = 'inout';
      if (sym.width > MAXW) {
        var cell = portCell(sym, sym.name);
        var dir = sym.dir === 'input' ? 'out' : 'in';
        var side = sym.dir === 'input' ? 'r' : 'l';
        addPin(cell, '', dir, side, busNet(sym));
        mod.cells.push(cell);
        return;
      }
      var i;
      for (i = 0; i < sym.width; i++) {
        var label = sym.width > 1 ? (sym.name + '[' + bitIndex(sym, i) + ']') : sym.name;
        var cell2 = portCell(sym, label);
        var dir2 = sym.dir === 'input' ? 'out' : (sym.dir === 'inout' ? 'inout' : 'in');
        var side2 = sym.dir === 'input' ? 'r' : 'l';
        addPin(cell2, '', dir2, side2, bitNet(sym, i));
        mod.cells.push(cell2);
      }
    });
  }
  function portCell(sym, label) {
    return {
      id: E.mod.nextId++, kind: 'port', name: label, typeName: (sym.dir || 'port').toUpperCase(),
      line: sym.line || 0, detail: (sym.dir || 'net') + ' ' + label, pins: [], dir: sym.dir || 'inout'
    };
  }
  function rebuild(mod) {
    var i, j;
    for (i = 0; i < mod.nets.length; i++) mod.nets[i].pins = [];
    for (i = 0; i < mod.cells.length; i++) {
      var pins = mod.cells[i].pins;
      for (j = 0; j < pins.length; j++) {
        if (!pins[j].net) continue;
        pins[j].net = findNet(pins[j].net);
        pins[j].net.pins.push(pins[j]);
      }
    }
    mod.nets = mod.nets.filter(function (n) { return !n.alias; });
  }
  function prune(mod) {
    rebuild(mod);
    mod.cells = mod.cells.filter(function (c) {
      if (c.kind !== 'const') return true;
      var y = null;
      var i;
      for (i = 0; i < c.pins.length; i++) if (c.pins[i].dir === 'out') y = c.pins[i];
      if (!y || !y.net) return false;
      var loads = 0;
      for (i = 0; i < y.net.pins.length; i++) if (y.net.pins[i] !== y) loads++;
      return loads > 0;
    });
    rebuild(mod);
  }

  function newMod(ast) {
    return {
      name: ast.name, line: ast.line, ports: [], params: {}, symbols: {}, items: ast.items,
      cells: [], nets: [], warnings: [], nextId: 1
    };
  }
  function applyPorts(mod, ports) {
    ports.forEach(function (p) {
      var width = 1, msb = null, lsb = null;
      if (p.kind === 'integer') { width = 32; msb = 31; lsb = 0; }
      else if (p.range) {
        var rn = rangeNums(p.range, mod.params);
        width = rn.width; msb = rn.msb; lsb = rn.lsb;
      }
      var sym = { name: p.name, dir: p.dir || null, kind: p.kind || 'wire', width: width, msb: msb, lsb: lsb, line: p.line || 0 };
      mod.symbols[p.name] = sym;
      mod.ports.push(sym);
    });
  }
  function applyDecl(mod, item) {
    var rn = null;
    if (item.kind === 'integer') rn = { width: 32, msb: 31, lsb: 0 };
    else if (item.range) rn = rangeNums(item.range, mod.params);
    item.names.forEach(function (n) {
      var sym = mod.symbols[n.name];
      if (!sym) {
        sym = {
          name: n.name, dir: null, kind: item.kind || 'wire',
          width: rn ? rn.width : 1, msb: rn ? rn.msb : null, lsb: rn ? rn.lsb : null, line: n.line
        };
        mod.symbols[n.name] = sym;
      } else {
        if (item.dir) sym.dir = item.dir;
        if (rn) { sym.width = rn.width; sym.msb = rn.msb; sym.lsb = rn.lsb; }
        if (item.kind) sym.kind = item.kind;
      }
    });
  }
  function shellOf(ast) {
    var mod = newMod(ast);
    var k;
    for (k in ast.params) if (Object.prototype.hasOwnProperty.call(ast.params, k)) mod.params[k] = ast.params[k];
    applyPorts(mod, ast.ports);
    ast.items.forEach(function (item) {
      if (item.k === 'param') {
        item.items.forEach(function (it) {
          var v = evalConst(it.expr, mod.params);
          if (v != null) mod.params[it.name] = v;
        });
      } else if (item.k === 'decl') applyDecl(mod, item);
    });
    return mod;
  }
  function elabBody(mod, mods, src) {
    E = {
      mod: mod, mods: mods, src: src, used: {}, constN: {}, netKey: {},
      netSeq: 1, pinSeq: 1, nameHint: '', detailHint: '', lineHint: 0
    };
    addPorts(mod);
    mod.items.forEach(function (item) {
      if (item.k === 'decl') {
        item.names.forEach(function (n) {
          if (n.init) elabAssign({ k: 'id', name: n.name, line: n.line, pos: item.pos, end: item.end }, n.init, n.line);
        });
      } else if (item.k === 'assign') elabAssign(item.lhs, item.rhs, item.line);
      else if (item.k === 'always') elabAlways(item);
      else if (item.k === 'gate') elabGate(item);
      else if (item.k === 'inst') elabInst(item);
    });
    prune(mod);
    E = null;
    return mod;
  }

  function sizeCell(c) {
    var nL = 0, nR = 0, nB = 0, i;
    for (i = 0; i < c.pins.length; i++) {
      if (c.pins[i].side === 'l') nL++;
      else if (c.pins[i].side === 'r') nR++;
      else nB++;
    }
    if (c.kind === 'port') {
      c.w = Math.max(44, 8 * String(c.name).length + 18);
      c.h = 26;
      return;
    }
    if (c.kind === 'const') { c.w = 28; c.h = 28; return; }
    var n = Math.max(nL, nR, 1);
    if (c.kind === 'mod' || c.kind === 'proc' || c.kind === 'op') {
      var lw = Math.max(String(c.name || '').length, String(c.typeName || '').length, String(c.detail || '').length);
      c.w = Math.max(112, Math.min(220, 7 * lw + 36));
      c.h = Math.max(52, 18 + n * 16);
      return;
    }
    c.w = c.kind === 'dff' ? 76 : 68;
    c.h = Math.max(48, 14 + n * 16);
    if (nB) c.h += 6;
  }
  function rankOf(c, visible) {
    if (c.kind === 'const') return 0;
    if (c.kind === 'port' && c.dir === 'input') return 0;
    if (c._rank != null) return c._rank;
    if (c._visiting) return 0;
    c._visiting = true;
    var pins = c.kind === 'dff' ? c.pins.filter(function (p) { return p.name === 'D'; }) : c.pins.filter(function (p) { return p.dir === 'in'; });
    var m = 0;
    var i, j;
    for (i = 0; i < pins.length; i++) {
      var net = pins[i].net;
      if (!net) continue;
      for (j = 0; j < net.pins.length; j++) {
        var op = net.pins[j];
        if (op.dir !== 'out' && op.dir !== 'inout') continue;
        if (!op.cell || op.cell === c) continue;
        if (visible && !visible[op.cell.id]) continue;
        m = Math.max(m, rankOf(op.cell, visible));
      }
    }
    c._visiting = false;
    c._rank = m + 1;
    return c._rank;
  }
  function bary(groups) {
    var pass, g, i;
    for (pass = 0; pass < 6; pass++) {
      var leftToRight = pass % 2 === 0;
      var seq = [];
      for (g = 0; g < groups.length; g++) seq.push(leftToRight ? g : (groups.length - 1 - g));
      var index = {};
      for (g = 0; g < groups.length; g++) {
        for (i = 0; i < groups[g].length; i++) index[groups[g][i].id] = i;
      }
      for (var si = 0; si < seq.length; si++) {
        var grp = groups[seq[si]];
        var allowed = {};
        var prev, pi, pj;
        for (prev = 0; prev < si; prev++) {
          var pg = groups[seq[prev]];
          for (i = 0; i < pg.length; i++) allowed[pg[i].id] = index[pg[i].id];
        }
        for (i = 0; i < grp.length; i++) {
          var c = grp[i];
          var ns = [];
          for (pi = 0; pi < c.pins.length; pi++) {
            var net = c.pins[pi].net;
            if (!net) continue;
            for (pj = 0; pj < net.pins.length; pj++) {
              var other = net.pins[pj].cell;
              if (other && allowed[other.id] != null) ns.push(allowed[other.id]);
            }
          }
          if (ns.length) {
            var sum = 0;
            for (pi = 0; pi < ns.length; pi++) sum += ns[pi];
            c._bary = sum / ns.length;
          } else if (c._bary == null) c._bary = i;
        }
        grp.sort(function (a, b) { return a._bary - b._bary || a.line - b.line || a.id - b.id; });
        for (i = 0; i < grp.length; i++) index[grp[i].id] = i;
      }
    }
  }
  function placePins(cell) {
    var L = [], R = [], B = [], i;
    for (i = 0; i < cell.pins.length; i++) {
      var p = cell.pins[i];
      if (p.side === 'r') R.push(p);
      else if (p.side === 'b') B.push(p);
      else L.push(p);
    }
    for (i = 0; i < L.length; i++) { L[i].x = cell.x; L[i].y = cell.y + (i + 1) * cell.h / (L.length + 1); }
    for (i = 0; i < R.length; i++) { R[i].x = cell.x + cell.w; R[i].y = cell.y + (i + 1) * cell.h / (R.length + 1); }
    for (i = 0; i < B.length; i++) { B[i].y = cell.y + cell.h; B[i].x = cell.x + (i + 1) * cell.w / (B.length + 1); }
  }
  function routeNet(net, lane, bottom) {
    var pins = [];
    var i;
    for (i = 0; i < net.pins.length; i++) if (net.pins[i].x != null) pins.push(net.pins[i]);
    if (pins.length < 2) return null;
    var srcs = pins.filter(function (p) { return p.dir === 'out' || p.dir === 'inout'; });
    if (!srcs.length) srcs = [pins[0]];
    var src = srcs[0];
    for (i = 1; i < srcs.length; i++) if (srcs[i].x > src.x) src = srcs[i];
    var forward = [], back = [];
    for (i = 0; i < pins.length; i++) {
      if (pins[i] === src) continue;
      if (pins[i].dir !== 'out' && pins[i].x < src.x - 4) back.push(pins[i]);
      else forward.push(pins[i]);
    }
    var trunkX = src.x + 18;
    if (forward.length) {
      var minF = forward[0].x;
      for (i = 1; i < forward.length; i++) minF = Math.min(minF, forward[i].x);
      var maxS = src.x;
      for (i = 0; i < srcs.length; i++) maxS = Math.max(maxS, srcs[i].x);
      if (minF > maxS + 24) trunkX = maxS + 16 + (lane % 5) * Math.min(10, (minF - maxS - 28) / 5);
      else trunkX = maxS + 16 + (lane % 4) * 8;
      if (trunkX > minF - 10) trunkX = (maxS + minF) / 2;
    }
    var segs = [];
    var dots = [];
    var ys = [];
    var attach = [src].concat(forward);
    for (i = 0; i < attach.length; i++) {
      var p = attach[i];
      segs.push([p.x, p.y, trunkX, p.y]);
      ys.push(p.y);
      if (pins.length >= 3) dots.push([trunkX, p.y]);
    }
    if (ys.length >= 2) segs.push([trunkX, Math.min.apply(null, ys), trunkX, Math.max.apply(null, ys)]);
    for (i = 0; i < back.length; i++) {
      var bp = back[i];
      var yf = bottom + 16 + (lane + i) * 12;
      var xL = bp.x - 12;
      segs.push([bp.x, bp.y, xL, bp.y]);
      segs.push([xL, bp.y, xL, yf]);
      segs.push([xL, yf, trunkX, yf]);
      var topY = ys.length ? Math.min.apply(null, ys) : bp.y;
      segs.push([trunkX, yf, trunkX, topY]);
    }
    return { net: net, segs: segs, dots: dots, feeds: back.length, bus: !!net.bus, label: net.label || '' };
  }
  function layout(mod, visibleSet) {
    var visible = null;
    if (visibleSet) {
      visible = {};
      if (typeof visibleSet.forEach === 'function' && typeof visibleSet.has === 'function') {
        visibleSet.forEach(function (id) { visible[id] = 1; });
      }
    }
    var cells = [];
    var i;
    for (i = 0; i < mod.cells.length; i++) {
      var c = mod.cells[i];
      c._rank = null;
      c._visiting = false;
      c._bary = null;
      var pi;
      for (pi = 0; pi < c.pins.length; pi++) { c.pins[pi].x = null; c.pins[pi].y = null; }
      if (!visible || visible[c.id]) cells.push(c);
    }
    var inputs = [], outputs = [], mids = [];
    for (i = 0; i < cells.length; i++) {
      var c2 = cells[i];
      if (c2.kind === 'port' && c2.dir === 'input') inputs.push(c2);
      else if (c2.kind === 'port') outputs.push(c2);
      else mids.push(c2);
    }
    mids.forEach(function (c3) { c3.rank = rankOf(c3, visible); });
    var ranks = [];
    mids.forEach(function (c3) { if (ranks.indexOf(c3.rank) < 0) ranks.push(c3.rank); });
    ranks.sort(function (a, b) { return a - b; });
    var groups = [inputs];
    ranks.forEach(function (r) {
      groups.push(mids.filter(function (c3) { return c3.rank === r; }));
    });
    groups.push(outputs);
    groups.forEach(function (g) {
      g.sort(function (a, b) { return a.line - b.line || a.id - b.id; });
    });
    bary(groups);
    var cols = [];
    var x = 24;
    groups.forEach(function (g) {
      if (!g.length) return;
      g.forEach(sizeCell);
      var w = 0;
      g.forEach(function (c3) { w = Math.max(w, c3.w); });
      g.forEach(function (c3) { c3.x = x; });
      x += w + 78;
      cols.push(g);
    });
    var heights = cols.map(function (g) {
      var h = 0;
      g.forEach(function (c3) { h += c3.h; });
      return h + Math.max(0, g.length - 1) * 34;
    });
    var maxH = 40;
    heights.forEach(function (h) { maxH = Math.max(maxH, h); });
    cols.forEach(function (g, gi) {
      var y = 28 + (maxH - heights[gi]) / 2;
      g.forEach(function (c3) {
        c3.y = y;
        y += c3.h + 34;
      });
    });
    cells.forEach(placePins);
    var bottom = 0;
    cells.forEach(function (c3) { bottom = Math.max(bottom, c3.y + c3.h); });
    var routes = [];
    var lane = 0;
    var seen = {};
    cells.forEach(function (c3) {
      c3.pins.forEach(function (p) {
        if (!p.net || seen[p.net.id]) return;
        seen[p.net.id] = 1;
        var r = routeNet(p.net, lane, bottom);
        if (r) {
          routes.push(r);
          lane += 1 + (r.feeds || 0);
        }
      });
    });
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    function add(x, y) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    cells.forEach(function (c3) {
      add(c3.x, c3.y);
      add(c3.x + c3.w, c3.y + c3.h + 16);
    });
    routes.forEach(function (r) {
      r.segs.forEach(function (s) { add(s[0], s[1]); add(s[2], s[3]); });
    });
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 240; y1 = 80; }
    mod.bbox = { x: x0 - 20, y: y0 - 20, w: (x1 - x0) + 40, h: (y1 - y0) + 48 };
    mod.routes = routes;
    mod.placed = cells;
    return mod;
  }

  function svgEl(name, attrs, parent) {
    var NS = 'http://www.w3.org/2000/svg';
    var e = document.createElementNS(NS, name);
    var k;
    for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function drawSymbol(g, c) {
    var w = c.w, h = c.h;
    var bubble = c.kind === 'nand' || c.kind === 'nor' || c.kind === 'xnor';
    var inset = bubble ? 12 : 0;
    if (c.kind === 'and' || c.kind === 'nand') {
      var x0 = 3, y0 = 3, x1 = w - 3 - inset, y1 = h - 3;
      var r = Math.min((y1 - y0) / 2, (x1 - x0) * 0.72);
      var ax = x1 - r;
      svgEl('path', {
        d: 'M ' + x0 + ' ' + y0 + ' H ' + ax + ' A ' + r + ' ' + r + ' 0 0 1 ' + ax + ' ' + y1 + ' H ' + x0 + ' Z',
        fill: '#fff', stroke: '#243044', 'stroke-width': 1.6
      }, g);
    } else if (c.kind === 'or' || c.kind === 'nor' || c.kind === 'xor' || c.kind === 'xnor') {
      var ox0 = 8, oy0 = 3, ox1 = w - 3 - inset, oy1 = h - 3, om = h / 2;
      svgEl('path', {
        d: 'M ' + ox0 + ' ' + oy0 +
          ' Q ' + (ox0 + 16) + ' ' + om + ' ' + ox0 + ' ' + oy1 +
          ' Q ' + (ox0 + (ox1 - ox0) * 0.62) + ' ' + oy1 + ' ' + ox1 + ' ' + om +
          ' Q ' + (ox0 + (ox1 - ox0) * 0.62) + ' ' + oy0 + ' ' + ox0 + ' ' + oy0 + ' Z',
        fill: '#fff', stroke: '#243044', 'stroke-width': 1.6
      }, g);
      if (c.kind === 'xor' || c.kind === 'xnor') {
        svgEl('path', {
          d: 'M ' + (ox0 - 5) + ' ' + oy0 + ' Q ' + (ox0 + 10) + ' ' + om + ' ' + (ox0 - 5) + ' ' + oy1,
          fill: 'none', stroke: '#243044', 'stroke-width': 1.5
        }, g);
      }
    } else if (c.kind === 'not' || c.kind === 'buf') {
      var nx1 = c.kind === 'not' ? w - 14 : w - 4;
      svgEl('path', {
        d: 'M 6 5 L ' + nx1 + ' ' + (h / 2) + ' L 6 ' + (h - 5) + ' Z',
        fill: '#fff', stroke: '#243044', 'stroke-width': 1.6
      }, g);
      if (c.kind === 'not') svgEl('circle', { cx: w - 7, cy: h / 2, r: 5, fill: '#fff', stroke: '#243044', 'stroke-width': 1.5 }, g);
    } else if (c.kind === 'dff') {
      svgEl('rect', { x: 2, y: 2, width: w - 4, height: h - 4, rx: 2, fill: '#fff8ec', stroke: '#243044', 'stroke-width': 1.6 }, g);
      svgEl('text', { x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#15191f' }, g).textContent = 'FF';
    } else if (c.kind === 'mux') {
      svgEl('path', {
        d: 'M 3 3 L ' + (w - 3) + ' ' + (h * 0.22) + ' L ' + (w - 3) + ' ' + (h * 0.78) + ' L 3 ' + (h - 3) + ' Z',
        fill: '#f7f2fc', stroke: '#243044', 'stroke-width': 1.6
      }, g);
      svgEl('text', { x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#15191f' }, g).textContent = 'MUX';
    } else if (c.kind === 'const') {
      svgEl('rect', { x: 2, y: 2, width: w - 4, height: h - 4, rx: 6, fill: '#eef1f5', stroke: '#243044', 'stroke-width': 1.6 }, g);
      svgEl('text', { x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#15191f' }, g).textContent = c.value ? '1' : '0';
    } else if (c.kind === 'port') {
      var fill = c.dir === 'input' ? '#e7f0fc' : '#e5f6ec';
      svgEl('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 5, fill: fill, stroke: '#243044', 'stroke-width': 1.3 }, g);
      svgEl('text', { x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#15191f' }, g).textContent = c.name;
    } else {
      var dashed = c.kind === 'mod' ? '5 3' : null;
      svgEl('rect', {
        x: 2, y: 2, width: w - 4, height: h - 4, rx: 3,
        fill: c.kind === 'mod' ? '#f3f6fb' : '#fff', stroke: '#243044', 'stroke-width': 1.6, 'stroke-dasharray': dashed
      }, g);
      svgEl('text', { x: 10, y: 18, 'font-size': 12, 'font-weight': 700, fill: '#15191f' }, g).textContent = c.name;
      var sub = c.kind === 'mod' ? c.typeName : (c.detail || c.typeName || '');
      if (sub && sub !== c.name) {
        svgEl('text', { x: 10, y: 34, 'font-size': 11, fill: '#677083' }, g).textContent = sub.length > 28 ? sub.slice(0, 26) + '..' : sub;
      }
      if (c.kind === 'mod' && c.child) {
        var gx = w - 18, gy = 8;
        var glyph = svgEl('g', { 'data-act': 'open' }, g);
        svgEl('rect', { x: gx, y: gy, width: 12, height: 12, fill: '#fff', stroke: '#1d6fe0', 'stroke-width': 1.2 }, glyph);
        svgEl('rect', { x: gx + 3, y: gy + 3, width: 6, height: 6, fill: '#1d6fe0' }, glyph);
      }
    }
    if (bubble) svgEl('circle', { cx: w - 6, cy: h / 2, r: 5, fill: '#fff', stroke: '#243044', 'stroke-width': 1.5 }, g);
    if (c.kind !== 'port' && c.kind !== 'mod' && c.kind !== 'proc' && c.kind !== 'op' && c.kind !== 'const') {
      svgEl('text', {
        x: w / 2, y: h + 13, 'text-anchor': 'middle', 'font-size': 11, fill: '#677083'
      }, g).textContent = c.name;
    }
    c.pins.forEach(function (p) {
      if (!p.bubble && p.name !== 'CLK') return;
      var lx = p.x - c.x, ly = p.y - c.y;
      if (p.name === 'CLK') {
        svgEl('path', {
          d: 'M ' + (lx - 5) + ' ' + (ly - 1) + ' L ' + (lx + 5) + ' ' + (ly - 1) + ' L ' + lx + ' ' + (ly - 9) + ' Z',
          fill: '#243044'
        }, g);
      }
      if (p.bubble) {
        var cx = lx, cy = ly;
        if (p.side === 'l') cx = lx + 5;
        else if (p.side === 'r') cx = lx - 5;
        else cy = ly - 5;
        svgEl('circle', { cx: cx, cy: cy, r: 4, fill: '#fff', stroke: '#243044', 'stroke-width': 1.3 }, g);
      }
    });
  }
  function traceColors(ui, id, key) {
    var cols = [];
    (ui.traces || []).forEach(function (t) {
      var bag = key === 'nets' ? t.nets : t.cells;
      if (bag && bag[id]) cols.push(t.color);
    });
    return cols;
  }
  function draw(mod, ui) {
    ui = ui || {};
    layout(mod, ui.visible || null);
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    var b = mod.bbox;
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('data-bbox', [b.x, b.y, b.w, b.h].join(','));
    var vp = svgEl('g', {
      id: 'vp',
      transform: 'translate(' + (ui.panX || 0) + ' ' + (ui.panY || 0) + ') scale(' + (ui.zoom || 1) + ')'
    }, svg);
    (mod.routes || []).forEach(function (r) {
      var d = '';
      r.segs.forEach(function (s) {
        if (Math.abs(s[0] - s[2]) < 0.4 && Math.abs(s[1] - s[3]) < 0.4) return;
        d += 'M ' + s[0].toFixed(1) + ' ' + s[1].toFixed(1) + ' L ' + s[2].toFixed(1) + ' ' + s[3].toFixed(1) + ' ';
      });
      if (!d) return;
      var cols = traceColors(ui, r.net.id, 'nets');
      svgEl('path', { d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 10, 'data-nid': r.net.id }, vp);
      svgEl('path', {
        d: d, fill: 'none', stroke: cols.length ? cols[0] : '#5c6778',
        'stroke-width': r.bus ? 3.2 : (cols.length ? 2.3 : 1.45),
        'stroke-linecap': 'square', 'data-nid': r.net.id
      }, vp);
      if (cols.length > 1) {
        svgEl('path', {
          d: d, fill: 'none', stroke: cols[1], 'stroke-width': 1.6,
          'stroke-dasharray': '7 5', 'data-nid': r.net.id
        }, vp);
      }
      r.dots.forEach(function (dot) {
        svgEl('circle', { cx: dot[0], cy: dot[1], r: 2.4, fill: cols.length ? cols[0] : '#243044', 'data-nid': r.net.id }, vp);
      });
      var title = r.net.label || '';
      if (r.net.also && r.net.also.length) title = (title ? title + ' ' : '') + r.net.also.join(' ');
      if (title) {
        var mid = r.segs[0];
        var te = svgEl('text', {
          x: (mid[0] + mid[2]) / 2, y: Math.min(mid[1], mid[3]) - 4,
          'font-size': 10, fill: '#8b95a3', 'data-nid': r.net.id
        }, vp);
        te.textContent = title.length > 18 ? '' : title;
      }
    });
    (mod.placed || []).forEach(function (c) {
      var g = svgEl('g', { transform: 'translate(' + c.x + ' ' + c.y + ')', 'data-cid': c.id }, vp);
      drawSymbol(g, c);
      var hit = svgEl('rect', {
        x: 0, y: 0, width: c.w, height: c.h, fill: 'transparent', 'data-cid': c.id
      }, g);
      var cols = traceColors(ui, c.id, 'cells');
      var sel = ui.selected && ui.selected.type === 'cell' && ui.selected.id === c.id;
      if (sel || cols.length) {
        svgEl('rect', {
          x: -3, y: -3, width: c.w + 6, height: c.h + 6, rx: 4, fill: 'none',
          stroke: sel ? '#1d6fe0' : cols[0], 'stroke-width': sel ? 2 : 1.7,
          'pointer-events': 'none'
        }, g);
      }
      var tip = document.createElementNS(NS, 'title');
      tip.textContent = (c.typeName || c.kind) + ' ' + c.name + (c.detail ? ' — ' + c.detail : '') + (c.line ? '  line ' + c.line : '');
      g.appendChild(tip);
      c.pins.forEach(function (p) {
        var placed = 0, total = p.net ? p.net.pins.length : 0;
        if (p.net) p.net.pins.forEach(function (q) { if (q.x != null) placed++; });
        var open = placed < 2 || placed < total;
        svgEl('circle', {
          cx: p.x - c.x, cy: p.y - c.y, r: 3.2,
          fill: open ? '#fff' : '#243044', stroke: '#243044', 'stroke-width': 1.2,
          'data-pid': p.id, 'data-nid': p.net ? p.net.id : '', 'data-cid': c.id, 'data-open': open ? '1' : '0'
        }, g);
        if (c.kind === 'mod' || c.kind === 'proc' || c.kind === 'op' || c.kind === 'dff' || c.kind === 'mux') {
          if (p.name && p.side !== 'b') {
            var tx = p.side === 'r' ? c.w - 8 : 8;
            var anchor = p.side === 'r' ? 'end' : 'start';
            svgEl('text', {
              x: tx, y: (p.y - c.y) + 3, 'text-anchor': anchor, 'font-size': 9, fill: '#677083',
              'pointer-events': 'none'
            }, g).textContent = p.name;
          }
        }
      });
      if (hit) { /* hit rect stays in the group */ }
    });
    return svg;
  }
  function fit(mod, vw, vh) {
    var b = mod.bbox || { x: 0, y: 0, w: 300, h: 160 };
    var z = Math.min((vw - 28) / b.w, (vh - 28) / b.h);
    if (!isFinite(z) || z <= 0) z = 1;
    z = Math.max(0.2, Math.min(1.7, z));
    return {
      zoom: z,
      panX: (vw - b.w * z) / 2 - b.x * z,
      panY: (vh - b.h * z) / 2 - b.y * z
    };
  }
  function traceFrom(net) {
    var acc = { nets: {}, cells: {} };
    function walk(n, depth) {
      if (!n || depth > 500 || acc.nets[n.id]) return;
      n = findNet(n);
      if (acc.nets[n.id]) return;
      acc.nets[n.id] = 1;
      var i;
      for (i = 0; i < n.pins.length; i++) {
        var p = n.pins[i];
        if (p.dir !== 'out' && p.dir !== 'inout') continue;
        if (!p.cell) continue;
        acc.cells[p.cell.id] = 1;
        if (p.cell.kind === 'port' || p.cell.kind === 'dff' || p.cell.kind === 'const') continue;
        var j;
        for (j = 0; j < p.cell.pins.length; j++) {
          var ip = p.cell.pins[j];
          if (ip.dir !== 'in') continue;
          if (ip.name === 'CLK' || ip.name === 'RST' || ip.name === 'SET') continue;
          if (ip.net) walk(ip.net, depth + 1);
        }
      }
    }
    if (net) walk(net, 0);
    return acc;
  }
  function pickTop(order, modules) {
    var used = {};
    order.forEach(function (name) {
      modules[name].cells.forEach(function (c) {
        if (c.kind === 'mod' && c.typeName) used[c.typeName] = 1;
      });
    });
    var cand = order.filter(function (n) { return !used[n]; });
    if (!cand.length) cand = order.slice();
    var dut = cand.filter(function (n) { return !/^tb$|testbench|^test/i.test(n); });
    var pool = dut.length ? dut : cand;
    return pool[pool.length - 1];
  }
  function compile(src) {
    try {
      var parsed = parseDesign(String(src || ''));
      if (!parsed.modules.length) {
        return { ok: false, error: 'No Verilog module in the Verilog tab.', warnings: parsed.warnings, modules: {}, order: [], top: null };
      }
      var shells = {};
      var order = [];
      parsed.modules.forEach(function (ast) {
        shells[ast.name] = shellOf(ast);
        order.push(ast.name);
      });
      order.forEach(function (name) { elabBody(shells[name], shells, parsed.src); });
      var warnings = parsed.warnings.slice();
      order.forEach(function (name) {
        shells[name].warnings.forEach(function (w) { warnings.push(name + ': ' + w); });
      });
      return { ok: true, error: null, warnings: warnings, modules: shells, order: order, top: pickTop(order, shells) };
    } catch (err) {
      return { ok: false, error: (err && err.message) ? err.message : String(err), warnings: [], modules: {}, order: [], top: null };
    }
  }
  function cellKind(mod, kind) {
    return mod.cells.filter(function (c) { return c.kind === kind; });
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
  function pinLabel(cell, name) {
    var i;
    for (i = 0; i < cell.pins.length; i++) if (cell.pins[i].name === name && cell.pins[i].net) return cell.pins[i].net.label;
    return null;
  }
  function selfTest() {
    var failures = [];
    function expect(cond, msg) { if (!cond) failures.push(msg); }
    var HA_G = 'module half_adder(input a, input b, output s, output c);\n  xor (s, a, b);\n  and (c, a, b);\nendmodule\n';
    var HA_D = 'module half_adder(input a, input b, output s, output c);\n  assign s = a ^ b;\n  assign c = a & b;\nendmodule\n';
    var HA_B = 'module half_adder(input a, input b, output reg s, output reg c);\n  always @(*) begin\n    s = a ^ b;\n    c = a & b;\n  end\nendmodule\n';
    var SR = 'module shiftreg(input wire clk, input wire rst, input wire din, output reg q0, output reg q1, output reg q2, output reg q3);\n  always @(posedge clk or posedge rst) begin\n    if (rst) begin q0 <= 0; q1 <= 0; q2 <= 0; q3 <= 0; end\n    else begin q0 <= din; q1 <= q0; q2 <= q1; q3 <= q2; end\n  end\nendmodule\n';
    var CT = 'module counter2(input wire clk, input wire rst, output reg q0, output reg q1);\n  always @(posedge clk or posedge rst) begin\n    if (rst) {q1, q0} <= 2\'b00;\n    else {q1, q0} <= {q1, q0} + 2\'b01;\n  end\nendmodule\n';
    var MX = 'module mux2(input a, input b, input sel, output y);\n  assign y = sel ? b : a;\nendmodule\n';
    var FA = 'module half_adder(input a, input b, output s, output c);\n  xor (s, a, b);\n  and (c, a, b);\nendmodule\n' +
      'module full_adder(input a, input b, input cin, output sum, output cout);\n  wire s1, c1, c2;\n' +
      '  half_adder ha1(.a(a), .b(b), .s(s1), .c(c1));\n  half_adder ha2(.a(s1), .b(cin), .s(sum), .c(c2));\n  or (cout, c1, c2);\nendmodule\n';
    var WD = 'module wide(input [15:0] a, input [15:0] b, output [15:0] y);\n  assign y = a & b;\nendmodule\n';

    function check(name, src, fn) {
      var d = compile(src);
      expect(d.ok, name + ' compile: ' + (d.error || ''));
      if (!d.ok) return;
      var mod = d.modules[d.top];
      try { layout(mod, null); }
      catch (err) { failures.push(name + ' layout ' + err.message); return; }
      expect(mod.bbox && mod.bbox.w > 10, name + ' bbox');
      fn(d, mod);
    }
    check('gate', HA_G, function (d, mod) {
      expect(d.top === 'half_adder', 'gate top');
      expect(driverKind(mod, 's') === 'xor', 'gate s is xor, got ' + driverKind(mod, 's'));
      expect(driverKind(mod, 'c') === 'and', 'gate c is and, got ' + driverKind(mod, 'c'));
      expect(cellKind(mod, 'port').length === 4, 'gate ports');
      var xor = cellKind(mod, 'xor')[0];
      var sp = null, cp = null, pi;
      for (pi = 0; pi < mod.cells.length; pi++) {
        if (mod.cells[pi].kind === 'port' && mod.cells[pi].name === 's') sp = mod.cells[pi];
        if (mod.cells[pi].kind === 'port' && mod.cells[pi].name === 'c') cp = mod.cells[pi];
      }
      expect(sp && cp && Math.abs(sp.y - xor.y) < Math.abs(cp.y - xor.y), 'sum port sits beside the xor');
    });
    check('data', HA_D, function (d, mod) {
      expect(driverKind(mod, 's') === 'xor', 'data s');
      expect(driverKind(mod, 'c') === 'and', 'data c');
    });
    check('beh', HA_B, function (d, mod) {
      expect(driverKind(mod, 's') === 'xor', 'beh s ' + driverKind(mod, 's'));
      expect(driverKind(mod, 'c') === 'and', 'beh c ' + driverKind(mod, 'c'));
    });
    check('shift', SR, function (d, mod) {
      expect(cellKind(mod, 'dff').length === 4, 'shift dffs ' + cellKind(mod, 'dff').length);
      var xs = cellKind(mod, 'dff').map(function (c) { return c.x; });
      var sorted = xs.slice().sort(function (a, b) { return a - b; });
      expect(xs.join(',') === sorted.join(','), 'shift left to right ' + xs.join(','));
    });
    check('count', CT, function (d, mod) {
      expect(cellKind(mod, 'dff').length === 2, 'count dff ' + cellKind(mod, 'dff').length);
      expect(cellKind(mod, 'not').length === 1, 'count not ' + cellKind(mod, 'not').length);
      expect(cellKind(mod, 'xor').length === 1, 'count xor ' + cellKind(mod, 'xor').length);
    });
    check('mux', MX, function (d, mod) {
      var m = cellKind(mod, 'mux');
      expect(m.length === 1, 'mux count ' + m.length);
      if (m[0]) {
        expect(pinLabel(m[0], 'D0') === 'a', 'mux D0 ' + pinLabel(m[0], 'D0'));
        expect(pinLabel(m[0], 'D1') === 'b', 'mux D1 ' + pinLabel(m[0], 'D1'));
        expect(pinLabel(m[0], 'S') === 'sel', 'mux S ' + pinLabel(m[0], 'S'));
        expect(pinLabel(m[0], 'Y') === 'y', 'mux Y ' + pinLabel(m[0], 'Y'));
      }
    });
    check('hier', FA, function (d, mod) {
      expect(d.top === 'full_adder', 'hier top ' + d.top);
      expect(cellKind(mod, 'mod').length === 2, 'hier mods');
      expect(driverKind(mod, 'cout') === 'or', 'hier or ' + driverKind(mod, 'cout'));
      expect(cellKind(d.modules.half_adder, 'xor').length === 1, 'child xor');
    });
    check('wide', WD, function (d, mod) {
      expect(cellKind(mod, 'port').length === 3, 'wide ports ' + cellKind(mod, 'port').length);
      expect(mod.cells.length <= 6, 'wide not bit-blasted ' + mod.cells.length);
    });
    var bad = compile('this is not verilog');
    expect(!bad.ok, 'bad source rejected');
    return { ok: failures.length === 0, failures: failures, count: 8 };
  }

  var api = {
    compile: compile,
    layout: layout,
    draw: draw,
    fit: fit,
    traceFrom: traceFrom,
    selfTest: selfTest
  };
  root.Schematic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
