/* Projects and modules, stored in the browser. No account and no server.
   A project is one drawing (every module, its wires, and its testbench).
   Hierarchy is which module instantiates which, the same idea as Jade's module_deps:
   a module with children is a tree root, and an unused leaf is a root too. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Workspace = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var KEY = 'vsch-workspace-v1';
  var LEGACY_DOC = 'verilog-schematic-designer-v1';
  var cache = null;

  function storage() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (err) { /* private mode or node */ }
    return null;
  }

  function blankWs() {
    return { v: 1, activeProject: '', projects: [] };
  }

  function read() {
    if (cache) return cache;
    cache = blankWs();
    var store = storage();
    if (!store) return cache;
    try {
      var raw = store.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.projects) cache = parsed;
      }
    } catch (err) { cache = blankWs(); }
    if (!cache.projects) cache.projects = [];
    return cache;
  }

  function write() {
    var store = storage();
    if (!store || !cache) return;
    try { store.setItem(KEY, JSON.stringify(cache)); } catch (err) { /* quota */ }
  }

  function pid() {
    return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function project(id) {
    var ws = read();
    var i;
    for (i = 0; i < ws.projects.length; i++) if (ws.projects[i].id === id) return ws.projects[i];
    return null;
  }

  function current() {
    var ws = read();
    return project(ws.activeProject) || ws.projects[0] || null;
  }

  function setActive(id) {
    var ws = read();
    if (!project(id)) return null;
    ws.activeProject = id;
    write();
    return project(id);
  }

  function moduleById(doc, id) {
    var i;
    if (!doc || !doc.modules) return null;
    for (i = 0; i < doc.modules.length; i++) if (doc.modules[i].id === id) return doc.modules[i];
    return null;
  }

  function names(doc) {
    var map = {};
    (doc && doc.modules || []).forEach(function (m) { map[m.id] = m.name || m.id; });
    return map;
  }

  function signature(doc) {
    return JSON.stringify((doc && doc.modules || []).map(function (m) {
      return { id: m.id, name: m.name, parts: m.parts || [], nets: m.nets || [] };
    }));
  }

  var sigs = {};

  function remember(id, doc) {
    sigs[id] = signature(doc);
  }

  /* id -> [child module ids], each child once, sorted by name. */
  function moduleDeps(doc) {
    var ids = {};
    var deps = {};
    var label = names(doc);
    (doc && doc.modules || []).forEach(function (m) {
      ids[m.id] = 1;
      deps[m.id] = [];
    });
    (doc && doc.modules || []).forEach(function (mod) {
      var seen = {};
      (mod.parts || []).forEach(function (part) {
        if (part.type !== 'block' || !part.ref || !ids[part.ref] || part.ref === mod.id) return;
        if (seen[part.ref]) return;
        seen[part.ref] = 1;
        deps[mod.id].push(part.ref);
      });
      deps[mod.id].sort(function (a, b) {
        return String(label[a] || a).localeCompare(String(label[b] || b), undefined, { sensitivity: 'base' });
      });
    });
    return deps;
  }

  function usedBy(doc) {
    var deps = moduleDeps(doc);
    var map = {};
    var label = names(doc);
    Object.keys(deps).forEach(function (parent) {
      deps[parent].forEach(function (child) {
        if (!map[child]) map[child] = [];
        if (map[child].indexOf(parent) < 0) map[child].push(parent);
      });
    });
    Object.keys(map).forEach(function (id) {
      map[id].sort(function (a, b) {
        return String(label[a] || a).localeCompare(String(label[b] || b), undefined, { sensitivity: 'base' });
      });
    });
    return map;
  }

  /* Roots: modules that instantiate something, then unused leaves. Same split Jade uses. */
  function treeRoots(doc) {
    var deps = moduleDeps(doc);
    var referenced = {};
    var label = names(doc);
    Object.keys(deps).forEach(function (parent) {
      deps[parent].forEach(function (child) { referenced[child] = 1; });
    });
    var withChildren = [];
    var orphans = [];
    (doc && doc.modules || []).forEach(function (m) {
      var kids = deps[m.id] || [];
      if (kids.length) withChildren.push(m.id);
      else if (!referenced[m.id]) orphans.push(m.id);
    });
    function cmp(a, b) {
      return String(label[a] || a).localeCompare(String(label[b] || b), undefined, { sensitivity: 'base' });
    }
    withChildren.sort(cmp);
    orphans.sort(cmp);
    return withChildren.concat(orphans);
  }

  function uniqueName(doc, base, exceptId) {
    var name = String(base == null ? '' : base).trim() || 'mod';
    var used = {};
    (doc.modules || []).forEach(function (m) {
      if (m.id !== exceptId) used[m.name] = 1;
    });
    if (!used[name]) return name;
    var i = 2;
    var stem = name;
    while (used[stem + i]) i++;
    return stem + i;
  }

  function touch(p) {
    p.updated = Date.now();
    write();
  }

  function makeProject(name, doc, view) {
    var item = {
      id: pid(),
      name: name || 'Project',
      doc: doc,
      view: view || null,
      simVerilog: '',
      updated: Date.now()
    };
    return item;
  }

  function ensure(Design) {
    var ws = read();
    if (ws.projects.length) {
      if (!project(ws.activeProject)) {
        ws.activeProject = ws.projects[0].id;
        write();
      }
      remember(ws.activeProject, project(ws.activeProject).doc);
      return ws;
    }
    var doc = null;
    var view = null;
    var store = storage();
    if (store) {
      try {
        var raw = store.getItem(LEGACY_DOC);
        if (raw) {
          var saved = JSON.parse(raw);
          if (saved && saved.doc && saved.doc.modules) {
            doc = saved.doc;
            view = saved.view || null;
          } else if (saved && saved.modules) doc = saved;
        }
      } catch (err) { doc = null; }
    }
    var simVerilog = '';
    var legacyTb = '';
    var legacyDesign = '';
    if (store) {
      try { legacyTb = store.getItem('vsch-tb') || ''; } catch (err2) { legacyTb = ''; }
      try { legacyDesign = store.getItem('vsch-design') || ''; } catch (err3) { legacyDesign = ''; }
    }
    if (!doc) {
      doc = Design ? Design.example('half') : { v: 1, seq: 1, active: 'm1', modules: [{ id: 'm1', name: 'top', parts: [], nets: [] }] };
    }
    if (Design && Design.prune) Design.prune(doc);
    var title = 'Drawing';
    if (doc.modules && doc.modules.length === 1 && doc.modules[0].name) title = doc.modules[0].name;
    else if (doc.modules && doc.modules.length > 1) title = 'Drawing';
    if (!doc && legacyDesign) title = 'Simulator';
    var item = makeProject(title, doc, view);
    if (legacyTb && doc.modules && doc.modules.length) {
      var active = moduleById(doc, doc.active) || doc.modules[0];
      if (active && !active.tb) active.tb = legacyTb;
    }
    if (Design && legacyDesign) {
      var generated = '';
      try { generated = Design.toVerilog(doc); } catch (err4) { generated = ''; }
      if (legacyDesign !== generated) item.simVerilog = legacyDesign;
    } else if (!Design && legacyDesign) item.simVerilog = legacyDesign;
    ws.projects.push(item);
    ws.activeProject = item.id;
    remember(item.id, item.doc);
    write();
    return ws;
  }

  function createProject(Design, name, doc) {
    var ws = read();
    var body = doc || (Design ? Design.blank() : { v: 1, seq: 1, active: 'm1', modules: [{ id: 'm1', name: 'top', parts: [], nets: [] }] });
    if (Design && Design.prune) Design.prune(body);
    var item = makeProject(uniqueProjectName(name || 'Project'), body, null);
    ws.projects.push(item);
    ws.activeProject = item.id;
    remember(item.id, item.doc);
    write();
    return item;
  }

  function uniqueProjectName(name) {
    var ws = read();
    var used = {};
    ws.projects.forEach(function (p) { used[p.name] = 1; });
    var base = String(name || 'Project').trim() || 'Project';
    if (!used[base]) return base;
    var i = 2;
    while (used[base + ' ' + i]) i++;
    return base + ' ' + i;
  }

  function renameProject(id, name) {
    var item = project(id);
    if (!item) return null;
    item.name = String(name || '').trim() || item.name;
    touch(item);
    return item;
  }

  function deleteProject(id) {
    var ws = read();
    var next = ws.projects.filter(function (p) { return p.id !== id; });
    if (next.length === ws.projects.length) return false;
    ws.projects = next;
    if (ws.activeProject === id) ws.activeProject = next.length ? next[0].id : '';
    write();
    return true;
  }

  function duplicateProject(id) {
    var item = project(id);
    if (!item) return null;
    var copy = JSON.parse(JSON.stringify(item));
    copy.id = pid();
    copy.name = uniqueProjectName(item.name + ' copy');
    copy.updated = Date.now();
    read().projects.push(copy);
    read().activeProject = copy.id;
    remember(copy.id, copy.doc);
    write();
    return copy;
  }

  function exportProject(id) {
    var item = project(id);
    if (!item) return null;
    return {
      kind: 'verilog-schematic-project',
      v: 1,
      name: item.name,
      doc: item.doc,
      view: item.view || null,
      simVerilog: item.simVerilog || '',
      verilogPinned: !!item.verilogPinned
    };
  }

  function importProject(data, Design) {
    if (!data || !data.doc || !data.doc.modules) return null;
    var doc = JSON.parse(JSON.stringify(data.doc));
    if (Design && Design.prune) Design.prune(doc);
    var item = createProject(Design, data.name || 'Imported', doc);
    item.view = data.view || null;
    item.simVerilog = data.simVerilog || '';
    item.verilogPinned = !!data.verilogPinned;
    remember(item.id, item.doc);
    write();
    return item;
  }

  function saveDrawing(id, doc, view) {
    var item = project(id);
    if (!item || !doc) return;
    sigs[id] = signature(doc);
    item.doc = doc;
    if (view) item.view = view;
    item.updated = Date.now();
    read().activeProject = id;
    write();
  }

  function setSimVerilog(id, text) {
    var item = project(id);
    if (!item) return;
    item.simVerilog = text == null ? '' : String(text);
    item.verilogPinned = true;
    item.updated = Date.now();
    write();
  }

  function setTestbench(projectId, moduleId, text) {
    var item = project(projectId);
    if (!item) return;
    var mod = moduleById(item.doc, moduleId);
    if (!mod) return;
    mod.tb = text == null ? '' : String(text);
    item.updated = Date.now();
    write();
  }

  function setActiveModule(projectId, moduleId) {
    var item = project(projectId);
    if (!item || !moduleById(item.doc, moduleId)) return;
    item.doc.active = moduleId;
    item.updated = Date.now();
    read().activeProject = projectId;
    write();
  }

  function addModule(doc, Design) {
    var id = Design.uid(doc, 'm');
    var mod = { id: id, name: uniqueName(doc, 'mod'), parts: [], nets: [], tb: '' };
    doc.modules.push(mod);
    doc.active = id;
    if (Design.prune) Design.prune(doc);
    return mod;
  }

  function renameModule(doc, id, name) {
    var mod = moduleById(doc, id);
    if (!mod) return null;
    mod.name = uniqueName(doc, name, id);
    return mod;
  }

  function deleteModule(doc, id, Design) {
    if (!doc || !doc.modules || doc.modules.length < 2) return false;
    var mod = moduleById(doc, id);
    if (!mod) return false;
    var ports = [];
    if (Design && Design.blockPorts) {
      ports = Design.blockPorts({ type: 'block', ref: id, ports: [] }, doc).map(function (p) {
        return { name: p.name, dir: p.dir };
      });
    }
    doc.modules.forEach(function (m) {
      (m.parts || []).forEach(function (part) {
        if (part.type === 'block' && part.ref === id) {
          part.ref = '';
          part.ext = mod.name || 'block';
          part.ports = ports.map(function (port) { return { name: port.name, dir: port.dir }; });
        }
      });
    });
    doc.modules = doc.modules.filter(function (m) { return m.id !== id; });
    if (doc.active === id) doc.active = doc.modules[0].id;
    if (Design && Design.prune) Design.prune(doc);
    return true;
  }

  function duplicateModule(doc, id, Design) {
    var mod = moduleById(doc, id);
    if (!mod || !Design) return null;
    var copy = JSON.parse(JSON.stringify(mod));
    copy.id = Design.uid(doc, 'm');
    copy.name = uniqueName(doc, (mod.name || 'mod') + '_copy');
    var map = {};
    (copy.parts || []).forEach(function (part) {
      var old = part.id;
      part.id = Design.uid(doc, 'p');
      map[old] = part.id;
    });
    (copy.nets || []).forEach(function (net) {
      net.id = Design.uid(doc, 'n');
      (net.pins || []).forEach(function (pin) {
        if (map[pin.part]) pin.part = map[pin.part];
      });
    });
    doc.modules.push(copy);
    if (Design.prune) Design.prune(doc);
    return copy;
  }

  return {
    KEY: KEY,
    read: read,
    write: write,
    project: project,
    current: current,
    setActive: setActive,
    moduleById: moduleById,
    names: names,
    moduleDeps: moduleDeps,
    usedBy: usedBy,
    treeRoots: treeRoots,
    uniqueName: uniqueName,
    ensure: ensure,
    createProject: createProject,
    renameProject: renameProject,
    deleteProject: deleteProject,
    duplicateProject: duplicateProject,
    exportProject: exportProject,
    importProject: importProject,
    saveDrawing: saveDrawing,
    setSimVerilog: setSimVerilog,
    setTestbench: setTestbench,
    setActiveModule: setActiveModule,
    addModule: addModule,
    renameModule: renameModule,
    deleteModule: deleteModule,
    duplicateModule: duplicateModule
  };
});
