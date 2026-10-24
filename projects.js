/* Project list and design hierarchy. Talks to Workspace only. */
(function () {
  'use strict';

  var expanded = {};
  var modalMode = null;
  var modalModule = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, parent) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    if (parent) parent.appendChild(node);
    return node;
  }

  function ws() { return Workspace.ensure(Design); }

  function current() {
    var data = ws();
    return Workspace.project(data.activeProject);
  }

  function say(text) { $('msg').textContent = text || ''; }

  function editorHref(projectId, moduleId) {
    return 'designer.html?project=' + encodeURIComponent(projectId) +
      '&module=' + encodeURIComponent(moduleId) + '&aspect=schematic';
  }

  function countModules(doc) {
    return (doc && doc.modules) ? doc.modules.length : 0;
  }

  function renderProjects() {
    var data = ws();
    var host = $('projectList');
    host.innerHTML = '';
    if (!data.projects.length) {
      el('div', { class: 'empty', text: 'No projects yet.' }, host);
      return;
    }
    data.projects.forEach(function (item) {
      var b = el('button', { type: 'button', class: 'prow' + (item.id === data.activeProject ? ' on' : '') }, host);
      el('strong', { text: item.name || 'Project' }, b);
      var n = countModules(item.doc);
      el('span', { text: n + (n === 1 ? ' module' : ' modules') }, b);
      b.addEventListener('click', function () {
        Workspace.setActive(item.id);
        $('search').value = '';
        say('');
        render();
      });
    });
  }

  function matches(name, q) {
    if (!q) return true;
    return String(name || '').toLowerCase().indexOf(q) >= 0;
  }

  function subtreeMatches(doc, deps, id, q, seen) {
    if (seen[id]) return false;
    seen[id] = 1;
    var mod = Workspace.moduleById(doc, id);
    if (mod && matches(mod.name, q)) return true;
    var kids = deps[id] || [];
    var i;
    for (i = 0; i < kids.length; i++) if (subtreeMatches(doc, deps, kids[i], q, seen)) return true;
    return false;
  }

  function renderNode(doc, deps, id, path, host, q) {
    var mod = Workspace.moduleById(doc, id);
    if (!mod) return;
    var kids = deps[id] || [];
    var cycle = path.indexOf(id) >= 0;
    var key = path.concat(id).join('/');
    if (expanded[key] == null) expanded[key] = true;
    var open = expanded[key] && !cycle && kids.length;
    var li = el('li', { class: 'node' }, host);
    var card = el('div', { class: 'card' }, li);
    if (kids.length && !cycle) {
      var twist = el('button', { type: 'button', class: 'twist' + (open ? ' open' : ''), title: open ? 'Collapse' : 'Expand', text: '▸' }, card);
      twist.addEventListener('click', function () {
        expanded[key] = !expanded[key];
        renderTree();
      });
    } else el('span', { class: 'twist-spacer' }, card);
    el('span', { class: 'symbol', text: String(mod.name || '?').slice(0, 1).toUpperCase() }, card);
    var body = el('div', { class: 'body' }, card);
    var name = el('button', { type: 'button', class: 'name', text: mod.name || 'module' }, body);
    if (cycle) el('span', { class: 'badge', text: 'Cycle' }, body);
    var sub = kids.length
      ? (kids.length + (kids.length === 1 ? ' submodule' : ' submodules'))
      : (path.length ? 'Leaf module' : 'Standalone module');
    var used = Workspace.usedBy(doc)[id] || [];
    if (used.length) {
      var labels = Workspace.names(doc);
      sub += ' · used by ' + used.map(function (uid) { return labels[uid] || uid; }).join(', ');
    }
    el('div', { class: 'sub', text: sub }, body);
    var acts = el('div', { class: 'acts' }, card);
    function act(label, fn) {
      var b = el('button', { type: 'button', text: label }, acts);
      b.addEventListener('click', fn);
    }
    var project = current();
    name.addEventListener('click', function () {
      location.href = editorHref(project.id, id);
    });
    act('Open', function () { location.href = editorHref(project.id, id); });
    act('Rename', function () { openModal('module', mod); });
    act('Duplicate', function () {
      Workspace.duplicateModule(doc, id, Design);
      Workspace.saveDrawing(project.id, doc, project.view);
      say('Duplicated ' + (mod.name || 'module') + '.');
      render();
    });
    act('Delete', function () {
      if (doc.modules.length < 2) { say('A project keeps at least one module.'); return; }
      if (!window.confirm('Delete module "' + (mod.name || 'module') + '"? Instances of it become external blocks.')) return;
      Workspace.deleteModule(doc, id, Design);
      Workspace.saveDrawing(project.id, doc, project.view);
      say('');
      render();
    });
    if (open) {
      var ul = el('ul', { class: 'kids' }, li);
      kids.forEach(function (child) {
        renderNode(doc, deps, child, path.concat(id), ul, q);
      });
    }
  }

  function renderTree() {
    var project = current();
    var tree = $('tree');
    tree.innerHTML = '';
    $('openEditor').href = project ? editorHref(project.id, project.doc.active || (project.doc.modules[0] && project.doc.modules[0].id) || '') : 'designer.html';
    $('projectTitle').textContent = project ? project.name : 'No project';
    var buttons = ['newModule', 'renProject', 'dupProject', 'expProject', 'delProject'];
    buttons.forEach(function (id) { $(id).disabled = !project; });
    if (!project) {
      el('div', { class: 'empty', text: 'Create a project to add modules.' }, tree);
      return;
    }
    var doc = project.doc;
    var q = $('search').value.trim().toLowerCase();
    var deps = Workspace.moduleDeps(doc);
    var roots = Workspace.treeRoots(doc).filter(function (id) {
      if (!q) return true;
      return subtreeMatches(doc, deps, id, q, {});
    });
    if (!roots.length) {
      el('div', { class: 'empty', text: q ? 'No module matches that search.' : 'This project has no modules.' }, tree);
      return;
    }
    roots.forEach(function (id) { renderNode(doc, deps, id, [], tree, q); });
  }

  function render() {
    renderProjects();
    renderTree();
  }

  function openModal(mode, mod) {
    modalMode = mode;
    modalModule = mod || null;
    var project = current();
    $('modalTitle').textContent = mode === 'project' ? 'Rename project' : (mode === 'newProject' ? 'New project' : 'Rename module');
    $('modalText').textContent = mode === 'newProject'
      ? 'The new project starts with an empty module named top.'
      : 'Names inside one project stay unique.';
    $('modalInput').value = mode === 'project' ? (project ? project.name : '') : (mode === 'module' && mod ? mod.name : '');
    $('modal').hidden = false;
    setTimeout(function () { $('modalInput').focus(); $('modalInput').select(); }, 20);
  }

  function closeModal() {
    $('modal').hidden = true;
    modalMode = null;
    modalModule = null;
  }

  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 800);
  }

  $('newProject').addEventListener('click', function () { openModal('newProject'); });
  $('renProject').addEventListener('click', function () { if (current()) openModal('project'); });
  $('newModule').addEventListener('click', function () {
    var project = current();
    if (!project) return;
    var mod = Workspace.addModule(project.doc, Design);
    Workspace.saveDrawing(project.id, project.doc, project.view);
    say('');
    location.href = editorHref(project.id, mod.id);
  });
  $('dupProject').addEventListener('click', function () {
    var project = current();
    if (!project) return;
    Workspace.duplicateProject(project.id);
    say('Duplicated the project.');
    render();
  });
  $('delProject').addEventListener('click', function () {
    var project = current();
    if (!project) return;
    if (!window.confirm('Delete project "' + project.name + '" from this browser?')) return;
    Workspace.deleteProject(project.id);
    say('');
    render();
  });
  $('expProject').addEventListener('click', function () {
    var project = current();
    if (!project) return;
    var data = Workspace.exportProject(project.id);
    var safe = String(project.name || 'project').replace(/[^\w.-]+/g, '_');
    download(safe + '.json', JSON.stringify(data, null, 2));
  });
  $('impProject').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () {
    var file = $('file').files && $('file').files[0];
    $('file').value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ''));
        if (data && data.modules && !data.doc) data = { name: file.name.replace(/\.json$/i, ''), doc: data };
        var item = Workspace.importProject(data, Design);
        if (!item) { say('That file is not a project drawing.'); return; }
        say('Imported ' + item.name + '.');
        render();
      } catch (err) { say('Could not read that file.'); }
    };
    reader.readAsText(file);
  });
  $('search').addEventListener('input', renderTree);
  $('modalCancel').addEventListener('click', closeModal);
  $('modal').addEventListener('pointerdown', function (e) { if (e.target === $('modal')) closeModal(); });
  $('nameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var project = current();
    var value = $('modalInput').value;
    if (modalMode === 'newProject') {
      Workspace.createProject(Design, value || 'Project');
      closeModal();
      say('');
      render();
      return;
    }
    if (!project) { closeModal(); return; }
    if (modalMode === 'project') Workspace.renameProject(project.id, value);
    if (modalMode === 'module' && modalModule) {
      Workspace.renameModule(project.doc, modalModule.id, value);
      Workspace.saveDrawing(project.id, project.doc, project.view);
    }
    closeModal();
    say('');
    render();
  });

  render();
})();
