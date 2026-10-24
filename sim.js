/* Compile and simulate Verilog with the embedded Icarus build, then show a VCD.
   engine.js (from build_standalone.py) supplies the toolchain for a double-clicked page.
   vendor/*.js is the fallback when this folder is served over http. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var factories = {};
  var enginePromise = null;
  var waveWindowBound = false;

  function b64ToU8(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var out = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadEngineScript() {
    if (enginePromise) return enginePromise;
    enginePromise = new Promise(function (resolve) {
      if (typeof window === 'undefined') { resolve(false); return; }
      if (window.VSCH_ENGINE) { resolve(true); return; }
      var s = document.createElement('script');
      s.src = 'engine.js';
      s.onload = function () { resolve(!!window.VSCH_ENGINE); };
      s.onerror = function () { resolve(false); };
      document.body.appendChild(s);
    });
    return enginePromise;
  }

  function loadFactory(name) {
    if (factories[name]) return factories[name];
    factories[name] = loadEngineScript().then(function (embedded) {
      if (embedded && window.VSCH_ENGINE && window.VSCH_ENGINE[name]) {
        var pack = window.VSCH_ENGINE[name];
        var js = new TextDecoder().decode(b64ToU8(pack.js));
        var wasm = b64ToU8(pack.wasm);
        var url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
        return import(url).then(function (mod) {
          return function (opts) {
            return mod.default(Object.assign({
              wasmBinary: wasm.slice(),
              locateFile: function () { return 'embedded.wasm'; }
            }, opts));
          };
        });
      }
      return import('./vendor/' + name + '.js').then(function (mod) {
        return function (opts) {
          return mod.default(Object.assign({
            locateFile: function (path) { return 'vendor/' + path; }
          }, opts));
        };
      });
    });
    return factories[name];
  }

  function sanitize(s) {
    return String(s || '')
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
  }

  function ivlConf(g) {
    return 'basedir:/\n' +
      'module:system.vpi\n' +
      'generation:' + g + '\n' +
      'generation:no-specify\n' +
      'out:/out.vvp\n' +
      'iwidth:32\n' +
      'widthcap:65536\n' +
      'functor:cprop\n' +
      'functor:nodangle\n' +
      'flag:DLL=vvp.tgt\n';
  }

  var NOISE = /system\.vpi|dynamic linking not enabled/;

  function cleanLog(text) {
    return String(text || '').split('\n').filter(function (line) { return !NOISE.test(line); }).join('\n').trim();
  }

  async function preprocessAll(files) {
    var code = [];
    var err = [];
    var init = await loadFactory('ivlpp');
    var m = await init({
      print: function (s) { code.push(s); },
      printErr: function (s) { err.push(s); }
    });
    var args = ['-L'];
    files.forEach(function (f) {
      var src = f.src.endsWith('\n') ? f.src : f.src + '\n';
      m.FS.writeFile('/' + f.name, src);
      args.push('/' + f.name);
    });
    m.callMain(args);
    return { text: code.join('\n') + '\n', err: err.join('\n') };
  }

  async function compile(srcText, g) {
    var err = [];
    var init = await loadFactory('ivl');
    var m = await init({
      print: function () {},
      printErr: function (s) { err.push(s); }
    });
    m.FS.writeFile('/ivl.conf', ivlConf(g));
    m.FS.writeFile('/src.v', srcText);
    m.callMain(['-C/ivl.conf', '--', '/src.v']);
    var vvp = null;
    try { vvp = m.FS.readFile('/out.vvp'); } catch (e) { vvp = null; }
    return { vvp: vvp, err: err.join('\n') };
  }

  async function simulate(bytes) {
    var out = [];
    var init = await loadFactory('vvp');
    var m = await init({
      print: function (s) { out.push(s); },
      printErr: function (s) { out.push(s); }
    });
    m.FS.writeFile('/sim.vvp', bytes);
    m.callMain(['/sim.vvp']);
    var vcd = null;
    try { vcd = m.FS.readFile('/dump.vcd', { encoding: 'utf8' }); } catch (e) { vcd = null; }
    if (!vcd) {
      try {
        var names = m.FS.readdir('/').filter(function (n) { return /\.vcd$/i.test(n); });
        if (names.length) vcd = m.FS.readFile('/' + names[0], { encoding: 'utf8' });
      } catch (e2) { vcd = null; }
    }
    return { out: out.join('\n'), vcd: vcd };
  }

  async function run(designSrc, tbSrc, generation) {
    var g = generation || '2005';
    var d0 = String(designSrc || '');
    var t0 = String(tbSrc || '');
    if (!d0.trim()) return { ok: false, log: 'The Verilog editor is empty.', vcd: '' };
    if (!t0.trim()) return { ok: false, log: 'The testbench is empty.', vcd: '' };
    var d = sanitize(d0);
    var t = sanitize(t0);
    var notes = [];
    if (d !== d0 || t !== t0) notes.push('Normalized non-breaking spaces or smart quotes in the source.');
    var pp = await preprocessAll([{ name: 'design.v', src: d }, { name: 'testbench.v', src: t }]);
    if (pp.err.trim()) notes.push(cleanLog(pp.err));
    var c = await compile(pp.text, g);
    if (!c.vvp) {
      var fail = cleanLog(c.err) || 'Compilation failed.';
      return { ok: false, log: notes.concat([fail]).filter(Boolean).join('\n'), vcd: '' };
    }
    var warn = cleanLog(c.err);
    if (warn) notes.push(warn);
    var s = await simulate(c.vvp);
    if (s.out && s.out.trim()) notes.push(s.out.trim());
    if (!s.vcd) {
      notes.push('No waveform. The testbench needs $dumpfile("dump.vcd"); and $dumpvars(0, tb);');
      return { ok: false, log: notes.filter(Boolean).join('\n\n'), vcd: '' };
    }
    return { ok: true, log: notes.filter(Boolean).join('\n\n'), vcd: s.vcd };
  }

  function parseVCD(text) {
    var vars = {};
    var order = [];
    var scope = [];
    var time = 0;
    var defs = true;
    String(text || '').split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (defs) {
        if (line.indexOf('$scope') === 0) { scope.push(line.split(/\s+/)[2]); return; }
        if (line.indexOf('$upscope') === 0) { scope.pop(); return; }
        if (line.indexOf('$var') === 0) {
          var p = line.split(/\s+/);
          var width = parseInt(p[2], 10);
          var id = p[3];
          var nm = p[4];
          var range = (p[5] && p[5].charAt(0) === '[') ? ' ' + p[5] : '';
          var full = (scope.length ? scope.join('.') + '.' : '') + nm + range;
          if (!vars[id]) {
            vars[id] = { name: full, width: width, vals: [] };
            order.push(id);
          }
          return;
        }
        if (line.indexOf('$enddefinitions') === 0) defs = false;
        return;
      }
      if (line.charAt(0) === '#') { time = parseInt(line.slice(1), 10); return; }
      if (line.charAt(0) === '$') return;
      var id2;
      var val;
      if ('bBrR'.indexOf(line.charAt(0)) >= 0) {
        var sp = line.indexOf(' ');
        val = line.slice(1, sp);
        id2 = line.slice(sp + 1).trim();
      } else {
        val = line.charAt(0);
        id2 = line.slice(1).trim();
      }
      if (vars[id2]) {
        var a = vars[id2].vals;
        if (!a.length || a[a.length - 1][1] !== val) a.push([time, val]);
      }
    });
    var tm = String(text || '').match(/\$timescale\s+(\d+)\s*(s|ms|us|ns|ps|fs)/);
    var exp = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 };
    var tsSec = tm ? parseInt(tm[1], 10) * Math.pow(10, exp[tm[2]]) : null;
    return { vars: vars, order: order, tmax: time || 1, tsSec: tsSec };
  }

  function binToHex(b) {
    if (/[xz]/i.test(b)) return /x/i.test(b) ? 'x' : 'z';
    var s = b;
    while (s.length % 4) s = '0' + s;
    var h = '';
    var i;
    for (i = 0; i < s.length; i += 4) h += parseInt(s.substr(i, 4), 2).toString(16);
    return '0x' + h.replace(/^0+(?=.)/, '');
  }

  function valAt(v, t) {
    var cur = 'x';
    var i;
    for (i = 0; i < v.vals.length; i++) {
      if (v.vals[i][0] <= t) cur = v.vals[i][1];
      else break;
    }
    return cur;
  }

  function niceStep(span) {
    var raw = span / 8;
    var p = Math.pow(10, Math.floor(Math.log10(raw) || 0));
    var f = raw / p;
    var n = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return Math.max(1, Math.round(n * p));
  }

  function fmtVal(v, raw) {
    return v.width === 1 ? raw : (/[xz]/i.test(raw) ? raw : binToHex(raw));
  }

  function fmtTime(session, raw) {
    raw = Math.round(raw);
    var tsSec = session.model && session.model.tsSec;
    if (!tsSec) return '' + raw;
    if (raw === 0) return '0';
    var sec = raw * tsSec;
    var units = [['s', 1], ['ms', 1e-3], ['us', 1e-6], ['ns', 1e-9], ['ps', 1e-12], ['fs', 1e-15]];
    var i;
    for (i = 0; i < units.length; i++) {
      var v = sec / units[i][1];
      var r = Math.round(v);
      if (r !== 0 && Math.abs(v - r) <= 1e-6 * Math.abs(v)) return r + ' ' + units[i][0];
    }
    return Math.round(sec / 1e-15) + ' fs';
  }

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    var k;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildWaveSvg(session, width, heightHint) {
    var model = session.model;
    if (!model) return null;
    var order = (session.selOrder || []).filter(function (id) { return model.vars[id]; });
    if (!order.length) return null;
    var labelW = 180;
    var rowH = 36;
    var top = 12;
    var padR = 16;
    var W = Math.max(560, width || 960);
    var plotX = labelW;
    var plotW = W - plotX - padR;
    var tmax = model.tmax;
    var vw = (session.viewSpan == null || session.viewSpan >= tmax) ? tmax : session.viewSpan;
    if (session.viewSpan == null || session.viewSpan >= tmax) session.view0 = 0;
    session.view0 = Math.max(0, Math.min(Math.max(0, tmax - vw), session.view0 || 0));
    var px = plotW / vw;
    function X(t) { return plotX + (t - session.view0) * px; }
    var H = heightHint || (top + order.length * rowH + 34);
    session.geom = { plotX: plotX, plotW: plotW, vw: vw, view0: session.view0, tmax: tmax };
    var svg = svgEl('svg', { width: String(W), height: String(H) });
    var defs = svgEl('defs', {}, svg);
    var cp = svgEl('clipPath', { id: 'vcdpc' }, defs);
    svgEl('rect', { x: plotX, y: 0, width: plotW, height: H }, cp);
    var G = svgEl('g', { 'clip-path': 'url(#vcdpc)' }, svg);
    svgEl('line', { x1: plotX, y1: 0, x2: plotX, y2: top + order.length * rowH + 2, stroke: '#e2e6ec' }, svg);
    order.forEach(function (id, i) {
      var v = model.vars[id];
      var y = top + i * rowH;
      var hi = y + 6;
      var lo = y + rowH - 10;
      var mid = y + rowH / 2;
      var label = svgEl('text', { x: 8, y: mid + 4, fill: '#15191f', 'font-size': 12, 'font-family': 'Consolas, ui-monospace, monospace' }, svg);
      label.textContent = v.name;
      var vals = v.vals.length ? v.vals.slice() : [[0, 'x']];
      if (vals[0][0] > 0) vals.unshift([0, 'x']);
      var k;
      for (k = 0; k < vals.length; k++) {
        var t0 = vals[k][0];
        var val = vals[k][1];
        var t1 = (k + 1 < vals.length) ? vals[k + 1][0] : tmax;
        if (t1 < session.view0 || t0 > session.view0 + vw) continue;
        var x0 = X(t0);
        var x1 = X(t1);
        var bad = /[xz]/i.test(val);
        var isX = /x/i.test(val);
        var wv = Math.max(0, x1 - x0);
        if (v.width === 1) {
          if (bad) svgEl('rect', { x: x0, y: hi, width: wv, height: lo - hi, fill: isX ? '#15191f' : '#9aa3af', opacity: isX ? 0.85 : 0.45 }, G);
          else {
            var yy = val === '1' ? hi : lo;
            svgEl('line', { x1: x0, y1: yy, x2: x1, y2: yy, stroke: '#15191f', 'stroke-width': 1.6 }, G);
            if (k > 0) svgEl('line', { x1: x0, y1: hi, x2: x0, y2: lo, stroke: '#15191f', 'stroke-width': 1, opacity: 0.65 }, G);
          }
        } else if (bad) {
          svgEl('rect', { x: x0 + 1, y: hi, width: Math.max(0, wv - 2), height: lo - hi, fill: isX ? '#15191f' : '#9aa3af', opacity: isX ? 0.8 : 0.45 }, G);
        } else {
          svgEl('line', { x1: x0 + 2, y1: hi, x2: x1 - 2, y2: hi, stroke: '#15191f', 'stroke-width': 1.3 }, G);
          svgEl('line', { x1: x0 + 2, y1: lo, x2: x1 - 2, y2: lo, stroke: '#15191f', 'stroke-width': 1.3 }, G);
          svgEl('line', { x1: x0, y1: mid, x2: x0 + 2, y2: hi, stroke: '#15191f', 'stroke-width': 1.3 }, G);
          svgEl('line', { x1: x0, y1: mid, x2: x0 + 2, y2: lo, stroke: '#15191f', 'stroke-width': 1.3 }, G);
          if (x1 - x0 > 28) {
            var hex = svgEl('text', {
              x: (x0 + x1) / 2, y: mid + 4, fill: '#15191f', 'font-size': 11,
              'text-anchor': 'middle', 'font-family': 'Consolas, ui-monospace, monospace'
            }, G);
            hex.textContent = fmtVal(v, val);
          }
        }
      }
    });
    var ay = top + order.length * rowH + 16;
    svgEl('line', { x1: plotX, y1: ay, x2: plotX + plotW, y2: ay, stroke: '#e2e6ec' }, svg);
    var step = niceStep(vw);
    var t;
    for (t = Math.ceil(session.view0 / step) * step; t <= session.view0 + vw + 1e-9; t += step) {
      var x = X(t);
      svgEl('line', { x1: x, y1: ay - 3, x2: x, y2: ay + 3, stroke: '#aab2bd' }, svg);
      var tick = svgEl('text', {
        x: x, y: ay + 15, fill: '#677083', 'font-size': 10, 'text-anchor': 'middle',
        'font-family': 'Consolas, ui-monospace, monospace'
      }, svg);
      tick.textContent = fmtTime(session, t);
    }
    if (session.curT != null) {
      var ct = Math.max(0, Math.min(tmax, Math.round(session.curT)));
      if (ct >= session.view0 && ct <= session.view0 + vw) {
        svgEl('line', { x1: X(ct), y1: top - 4, x2: X(ct), y2: ay, stroke: '#1d6fe0', 'stroke-width': 1 }, svg);
      }
      order.forEach(function (id, i) {
        var v = model.vars[id];
        var y = top + i * rowH;
        var mark = svgEl('text', {
          x: plotX - 8, y: y + rowH / 2 + 4, fill: '#1d6fe0', 'font-size': 11,
          'text-anchor': 'end', 'font-weight': 650, 'font-family': 'Consolas, ui-monospace, monospace'
        }, svg);
        mark.textContent = fmtVal(v, valAt(v, ct));
      });
    }
    return svg;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderWave(plot, session) {
    if (!plot) return null;
    clearNode(plot);
    if (!session.model) {
      var empty = document.createElement('div');
      empty.className = 'vcd-empty';
      empty.textContent = 'Generate a VCD to see the waveform.';
      plot.appendChild(empty);
      session.geom = null;
      return null;
    }
    var order = (session.selOrder || []).filter(function (id) { return session.model.vars[id]; });
    if (!order.length) {
      var none = document.createElement('div');
      none.className = 'vcd-empty';
      none.textContent = 'Tick signals on the left to plot them.';
      plot.appendChild(none);
      session.geom = null;
      return null;
    }
    var svg = buildWaveSvg(session, Math.max(560, plot.clientWidth - 4));
    if (svg) plot.appendChild(svg);
    return svg;
  }

  function renderSigs(sigs, session, onChange) {
    if (!sigs) return;
    clearNode(sigs);
    if (!session.model) return;
    var head = document.createElement('div');
    head.className = 'vcd-sighead';
    var title = document.createElement('span');
    title.textContent = 'Signals';
    var links = document.createElement('span');
    var all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'all';
    var none = document.createElement('button');
    none.type = 'button';
    none.textContent = 'none';
    all.addEventListener('click', function () {
      session.selOrder = session.model.order.slice();
      onChange('list');
    });
    none.addEventListener('click', function () {
      session.selOrder = [];
      onChange('list');
    });
    links.appendChild(all);
    links.appendChild(document.createTextNode(' · '));
    links.appendChild(none);
    head.appendChild(title);
    head.appendChild(links);
    sigs.appendChild(head);
    session.model.order.forEach(function (id, i) {
      var v = session.model.vars[id];
      var label = document.createElement('label');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = (session.selOrder || []).indexOf(id) >= 0;
      box.addEventListener('change', function () {
        var k = session.selOrder.indexOf(id);
        if (box.checked) { if (k < 0) session.selOrder.push(id); }
        else if (k >= 0) session.selOrder.splice(k, 1);
        onChange('check');
      });
      label.appendChild(box);
      label.appendChild(document.createTextNode(' ' + v.name));
      sigs.appendChild(label);
      void i;
    });
  }

  function bindWave(plot, session, onChange) {
    if (!plot || plot._vcdBound) {
      session.plot = plot || session.plot;
      return;
    }
    plot._vcdBound = true;
    session.plot = plot;
    plot.addEventListener('wheel', function (e) {
      if (!session.geom || session.plot !== plot) return;
      e.preventDefault();
      var geom = session.geom;
      var x = e.clientX - plot.getBoundingClientRect().left;
      var tm = geom.view0 + (x - geom.plotX) / geom.plotW * geom.vw;
      var f = e.deltaY < 0 ? 0.8 : 1.25;
      var minS = Math.max(1, geom.tmax / 100000);
      var nw = Math.max(minS, Math.min(geom.tmax, geom.vw * f));
      if (nw >= geom.tmax) { session.viewSpan = null; session.view0 = 0; }
      else {
        session.viewSpan = nw;
        session.view0 = Math.max(0, Math.min(geom.tmax - nw, tm - (x - geom.plotX) / geom.plotW * nw));
      }
      onChange();
    }, { passive: false });
    plot.addEventListener('mousedown', function (e) {
      if (!session.geom) return;
      session.drag = { x: e.clientX, v0: session.geom.view0, moved: false };
    });
    if (!waveWindowBound) {
      waveWindowBound = true;
      window.addEventListener('mousemove', function (e) {
        if (!session.drag || !session.geom) return;
        var dx = e.clientX - session.drag.x;
        if (Math.abs(dx) > 4) session.drag.moved = true;
        if (session.drag.moved) {
          session.view0 = Math.max(0, Math.min(session.geom.tmax - session.geom.vw, session.drag.v0 - dx / session.geom.plotW * session.geom.vw));
          onChange();
        }
      });
      window.addEventListener('mouseup', function (e) {
        if (!session.drag) return;
        if (!session.drag.moved && session.geom && session.plot) {
          var x = e.clientX - session.plot.getBoundingClientRect().left;
          var t = session.geom.view0 + (x - session.geom.plotX) / session.geom.plotW * session.geom.vw;
          session.curT = Math.max(0, Math.min(session.geom.tmax, t));
          onChange();
        }
        session.drag = null;
      });
      window.addEventListener('resize', function () {
        if (session.model && session.mode === 'wave') onChange();
      });
    }
  }

  function waveformSvg(session, width) {
    var svg = buildWaveSvg(session, width || 960);
    if (!svg) return null;
    svg.setAttribute('xmlns', NS);
    var bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', svg.getAttribute('width') || '100%');
    bg.setAttribute('height', svg.getAttribute('height') || '100%');
    bg.setAttribute('fill', '#ffffff');
    svg.insertBefore(bg, svg.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  }

  function markerLabel(session) {
    if (!session.model || session.curT == null) return '';
    return 'Marker ' + fmtTime(session, session.curT);
  }

  function rangeLabel(session) {
    if (!session.geom) return '';
    return fmtTime(session, Math.round(session.geom.view0)) + ' – ' + fmtTime(session, Math.round(session.geom.view0 + session.geom.vw));
  }

  return {
    run: run,
    parseVCD: parseVCD,
    renderWave: renderWave,
    renderSigs: renderSigs,
    bindWave: bindWave,
    waveformSvg: waveformSvg,
    markerLabel: markerLabel,
    rangeLabel: rangeLabel
  };
});
