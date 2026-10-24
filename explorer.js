/* Design-area file tree. One module, several files, grouped the way Jade groups them:
   gui (drawing), rtl (source), sim (run results). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Explorer = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TREE = [
    {
      folder: 'gui',
      files: [
        { id: 'schematic', ext: '.sch' },
        { id: 'icon', ext: '.ico' }
      ]
    },
    {
      folder: 'rtl',
      files: [
        { id: 'verilog', ext: '.v' },
        { id: 'testbench', ext: '_tb.v' }
      ]
    },
    {
      folder: 'sim',
      files: [
        { id: 'vcd', ext: '.vcd' }
      ]
    }
  ];

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function render(host, opts) {
    if (!host) return;
    opts = opts || {};
    var closed = opts.closed || {};
    host.innerHTML = '';
    TREE.forEach(function (group) {
      var folder = el('div', 'ex-folder');
      var head = el('button', 'ex-folder-h');
      head.type = 'button';
      head.textContent = group.folder;
      var body = el('div', 'ex-files');
      var shut = !!closed[group.folder];
      if (shut) {
        body.hidden = true;
        head.classList.add('shut');
      }
      head.addEventListener('click', function () {
        body.hidden = !body.hidden;
        head.classList.toggle('shut', body.hidden);
        if (opts.onToggle) opts.onToggle(group.folder, body.hidden);
      });
      group.files.forEach(function (file) {
        var row = el('button', 'ex-file' + (opts.active === file.id ? ' on' : ''));
        row.type = 'button';
        var name = el('span', 'ex-name');
        name.textContent = file.label || opts.moduleName || 'module';
        var ext = el('span', 'ex-ext');
        ext.textContent = file.ext;
        row.appendChild(name);
        row.appendChild(ext);
        row.addEventListener('click', function () {
          if (opts.onOpen) opts.onOpen(file.id);
        });
        body.appendChild(row);
      });
      folder.appendChild(head);
      folder.appendChild(body);
      host.appendChild(folder);
    });
  }

  function hierarchy(host, opts) {
    if (!host) return;
    opts = opts || {};
    host.innerHTML = '';
    var title = el('div', 'ex-hier-title');
    title.textContent = 'Hierarchy';
    host.appendChild(title);
    var kids = (opts.deps && opts.deps[opts.active]) || [];
    var names = opts.names || {};
    if (!kids.length) {
      var empty = el('div', 'ex-hier-empty');
      empty.textContent = 'No submodule instances in this module.';
      host.appendChild(empty);
    } else {
      kids.forEach(function (id) {
        var b = el('button', 'ex-hier-item');
        b.type = 'button';
        b.textContent = names[id] || id;
        b.addEventListener('click', function () {
          if (opts.onOpen) opts.onOpen(id);
        });
        host.appendChild(b);
      });
    }
    var used = (opts.usedBy && opts.usedBy[opts.active]) || [];
    if (used.length) {
      var line = el('div', 'ex-hier-used');
      line.textContent = 'Used by ' + used.map(function (id) { return names[id] || id; }).join(', ');
      host.appendChild(line);
    }
  }

  return { tree: TREE, render: render, hierarchy: hierarchy };
});
