/*
 * LrC Barcodes companion: shows a subject's QR code full-screen so it can be
 * photographed before the subject, as an alternative to printed cards.
 * All data lives in localStorage on this device.
 *
 * Roster values are only ever inserted with textContent, never as HTML.
 */
(function () {
  'use strict';

  const L = window.CompanionLib;
  const STORAGE_KEY = 'lrcb-companion-v1';

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  // ------------------------------------------------------------ storage

  let db = { jobs: [] };
  let storageOK = true;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) db = JSON.parse(raw);
      if (!db || !Array.isArray(db.jobs)) db = { jobs: [] };
    } catch (e) {
      storageOK = false;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      storageOK = true;
    } catch (e) {
      storageOK = false;
      toast('Could not save. Storage may be full or disabled.');
    }
    $('#storage-warning').hidden = storageOK;
  }

  function findJob(id) {
    return db.jobs.find(j => j.id === id);
  }

  // ---------------------------------------------------------- helpers

  function $(sel) { return document.querySelector(sel); }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const child of children || []) if (child) node.append(child);
    return node;
  }

  let toastTimer;
  function toast(message) {
    const t = $('#toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  // ------------------------------------------------------- navigation

  // Views are pushed onto browser history so the Android back button / swipe
  // back behaves as expected.
  let route = { view: 'home' };
  let pendingImport = null;   // { title, headers, rows } between file pick and save
  let editingJobId = null;
  let filter = 'todo';

  function go(view, params, replace) {
    route = Object.assign({ view }, params || {});
    if (replace) history.replaceState(route, '');
    else history.pushState(route, '');
    render();
  }

  function back() {
    if (history.state && history.state.view !== 'home') history.back();
    else go('home', null, true);
  }

  window.addEventListener('popstate', e => {
    route = e.state || { view: 'home' };
    render();
  });

  function render() {
    for (const v of document.querySelectorAll('.view')) v.hidden = true;
    closeMenu();
    releaseWakeLock();
    const job = route.jobId ? findJob(route.jobId) : null;
    if (route.view !== 'home' && route.view !== 'setup' && !job) route = { view: 'home' };
    if (route.view === 'setup' && !pendingImport && !editingJobId) route = { view: 'home' };

    switch (route.view) {
      case 'setup': renderSetup(); break;
      case 'roster': renderRoster(job); break;
      case 'qr': renderQR(job); break;
      case 'walkup': renderWalkup(job); break;
      default: renderHome();
    }
    $('#view-' + route.view).hidden = false;
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="back"]')) back();
  });

  // -------------------------------------------------------------- home

  function renderHome() {
    const list = $('#job-list');
    list.replaceChildren();
    const jobs = db.jobs.slice().sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    for (const job of jobs) {
      const p = L.progress(job);
      const pct = p.total ? Math.round(100 * p.done / p.total) : 0;
      const bar = el('div', { class: 'progress' }, [el('div')]);
      bar.firstChild.style.width = pct + '%';
      list.append(el('li', null, [
        el('button', { class: 'card', onclick: () => go('roster', { jobId: job.id }) }, [
          el('div', { class: 'card-title', text: job.title }),
          el('div', { class: 'card-meta', text: `${p.done} of ${p.total} photographed · ${formatDate(job.created)}` }),
          bar,
        ]),
      ]));
    }
    $('#no-jobs').hidden = jobs.length > 0;
    $('#storage-warning').hidden = storageOK;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $('#install-hint').hidden = !!standalone;
  }

  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = L.parseCSV(await file.text());
    } catch (err) {
      toast('Could not read that file.');
      return;
    }
    if (!parsed.headers.length || !parsed.rows.length) {
      toast('That file has no rows. Is it a CSV with a header row?');
      return;
    }
    pendingImport = { title: file.name.replace(/\.[^.]+$/, ''), headers: parsed.headers, rows: parsed.rows };
    editingJobId = null;
    go('setup');
  });

  $('#new-blank').addEventListener('click', () => {
    pendingImport = {
      title: 'Job ' + formatDate(new Date().toISOString()),
      headers: ['Name', 'Group'],
      rows: [],
      settings: { nameTemplate: '{Name}', groupColumn: 'Group', qrTemplate: 'WALKUP-{#} {name}',
                  walkupTemplate: 'WALKUP-{#} {name}', source: 'blank' },
    };
    editingJobId = null;
    go('setup');
  });

  // ------------------------------------------------------------- setup

  let activeTemplateInput = null;

  function setupSource() {
    if (editingJobId) {
      const job = findJob(editingJobId);
      return { title: job.title, headers: job.headers, rows: job.subjects.map(s => s.data), settings: job.settings };
    }
    return pendingImport;
  }

  function renderSetup() {
    const src = setupSource();
    const settings = src.settings || L.detectSettings(src.headers, src.rows);
    $('#setup-heading').textContent = editingJobId ? 'Job settings' : 'New job';
    $('#setup-title').value = src.title;
    $('#setup-name').value = settings.nameTemplate;
    $('#setup-qr').value = settings.qrTemplate;
    $('#setup-walkup').value = settings.walkupTemplate;

    const group = $('#setup-group');
    group.replaceChildren(el('option', { value: '', text: 'None' }),
      ...src.headers.map(h => el('option', { value: h, text: h })));
    group.value = settings.groupColumn || '';

    const detected = $('#setup-detected');
    if (!editingJobId && src.rows.length) {
      detected.hidden = false;
      detected.textContent = (settings.source === 'gotphoto' ? 'GotPhoto roster detected. ' : '')
        + `${src.rows.length} subjects, ${src.headers.length} columns. Check the fields below, then Save.`;
    } else {
      detected.hidden = true;
    }

    const chips = $('#setup-columns');
    chips.replaceChildren(...src.headers.map(h =>
      el('button', { class: 'chip', type: 'button', text: h, onclick: () => insertColumn(h) })));
    activeTemplateInput = $('#setup-qr');
    updateSetupPreview();
  }

  function insertColumn(header) {
    const input = activeTemplateInput || $('#setup-qr');
    const token = `{${header}}`;
    const start = input.selectionStart != null ? input.selectionStart : input.value.length;
    const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    updateSetupPreview();
  }

  function readSetupSettings() {
    return {
      nameTemplate: $('#setup-name').value.trim() || '{name}',
      groupColumn: $('#setup-group').value,
      qrTemplate: $('#setup-qr').value.trim(),
      walkupTemplate: $('#setup-walkup').value.trim() || 'WALKUP-{#} {name}',
      source: (setupSource().settings || {}).source,
    };
  }

  function updateSetupPreview() {
    const src = setupSource();
    const settings = readSetupSettings();
    const probe = { settings, headers: src.headers };
    const list = $('#setup-preview');
    list.replaceChildren();
    const sample = src.rows.slice(0, 3).map((data, i) => ({ id: 'r' + i, data }));
    sample.push({ id: 'w1', data: {}, walkup: 1 });
    for (const s of sample) {
      const d = L.describe(probe, s.walkup ? { ...s, data: sampleWalkupData(src.headers, settings) } : s);
      list.append(el('li', null, [
        el('div', { text: (s.walkup ? 'Walk-up example: ' : '') + d.name + (d.group ? ' · ' + d.group : '') }),
        el('div', { class: 'qr-line', text: d.qr ? 'QR: ' + d.qr : 'QR: (empty; check the template)' }),
      ]));
    }
    $('#setup-save').disabled = !settings.qrTemplate;
  }

  function sampleWalkupData(headers, settings) {
    const data = {};
    for (const h of L.templateColumns(settings.nameTemplate, headers)) data[h] = h.match(/last|sur|nach/i) ? 'Lee' : 'Sam';
    if (settings.groupColumn) data[settings.groupColumn] = 'Team A';
    return data;
  }

  for (const input of document.querySelectorAll('[data-template]')) {
    input.addEventListener('focus', () => { activeTemplateInput = input; });
    input.addEventListener('input', updateSetupPreview);
  }
  $('#setup-group').addEventListener('change', updateSetupPreview);

  $('#setup-save').addEventListener('click', () => {
    const settings = readSetupSettings();
    if (!settings.qrTemplate) { toast('Enter what the QR code should contain.'); return; }
    const title = $('#setup-title').value.trim() || 'Untitled job';
    let job;
    if (editingJobId) {
      job = findJob(editingJobId);
      job.title = title;
      job.settings = settings;
    } else {
      const src = pendingImport;
      job = L.createJob(title, src.headers, src.rows, settings);
      db.jobs.push(job);
    }
    save();
    pendingImport = null;
    editingJobId = null;
    // Replace the setup entry so Back from the roster goes home, not to setup.
    go('roster', { jobId: job.id }, true);
  });

  // ------------------------------------------------------------ roster

  function renderRoster(job) {
    $('#roster-title').textContent = job.title;
    const query = $('#search').value;

    const counts = { todo: 0, done: 0, all: job.subjects.length };
    for (const s of job.subjects) counts[s.done ? 'done' : 'todo']++;
    for (const b of document.querySelectorAll('.segmented button')) {
      b.setAttribute('aria-selected', String(b.dataset.filter === filter));
      b.querySelector('span').textContent = counts[b.dataset.filter];
    }

    const visible = job.subjects.filter(s =>
      (filter === 'all' || (filter === 'done') === !!s.done) && L.matches(job, s, query));

    // Group by team/class in order of first appearance.
    const groups = new Map();
    for (const s of visible) {
      const d = L.describe(job, s);
      const key = d.group || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ s, d });
    }

    const list = $('#subject-list');
    list.replaceChildren();
    const showHeadings = groups.size > 1 || (groups.size === 1 && !groups.has(''));
    for (const [group, items] of groups) {
      if (showHeadings) list.append(el('div', { class: 'group-title', text: group || 'No group' }));
      for (const { s, d } of items) {
        list.append(el('button', {
          class: 'subject' + (s.done ? ' done' : ''),
          onclick: () => go('qr', { jobId: job.id, subjectId: s.id }),
        }, [
          el('div', { class: 'subject-main' }, [
            el('div', { class: 'subject-name', text: d.name }),
            el('div', { class: 'subject-sub', text: s.done ? 'Photographed ' + formatTime(s.done) : d.qr }),
          ]),
          s.walkup ? el('span', { class: 'tag', text: 'Walk-up' }) : null,
          el('span', { class: 'check', 'aria-label': s.done ? 'Photographed' : 'Not photographed' }),
        ]));
      }
    }

    const empty = $('#no-subjects');
    empty.hidden = visible.length > 0;
    if (!visible.length) {
      empty.textContent = query ? `No one matches "${query}". Add them as a walk-up?`
        : filter === 'todo' ? (job.subjects.length ? 'Everyone has been photographed.' : 'No subjects yet. Add walk-ups with the button below.')
        : filter === 'done' ? 'No one has been photographed yet.' : 'No subjects yet.';
    }
  }

  $('#search').addEventListener('input', () => {
    const job = findJob(route.jobId);
    if (job) renderRoster(job);
  });

  for (const b of document.querySelectorAll('.segmented button')) {
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      renderRoster(findJob(route.jobId));
    });
  }

  $('#add-walkup').addEventListener('click', () => go('walkup', { jobId: route.jobId }));

  // Menu
  function closeMenu() {
    $('#roster-menu').hidden = true;
    $('#roster-menu-btn').setAttribute('aria-expanded', 'false');
  }
  $('#roster-menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('#roster-menu');
    menu.hidden = !menu.hidden;
    $('#roster-menu-btn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#roster-menu')) closeMenu();
  });

  $('#menu-export').addEventListener('click', () => {
    const job = findJob(route.jobId);
    const csv = L.exportCSV(job);
    const name = job.title.replace(/[\\/:*?"<>|]+/g, '-') + ' - results.csv';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
    closeMenu();
    // On phones and tablets the share sheet is the easiest way to get the file
    // to email, AirDrop or Files; elsewhere, download it.
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ files: [file], title: name }).catch(() => {});
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('#menu-settings').addEventListener('click', () => {
    editingJobId = route.jobId;
    pendingImport = null;
    go('setup', { jobId: route.jobId });
  });

  $('#menu-delete').addEventListener('click', () => {
    const job = findJob(route.jobId);
    const p = L.progress(job);
    if (!confirm(`Delete "${job.title}"? ${p.done} of ${p.total} photographed. Export the results first if you need them.`)) return;
    db.jobs = db.jobs.filter(j => j.id !== job.id);
    save();
    go('home', null, true);
  });

  // ---------------------------------------------------------------- QR

  function qrSVG(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const size = n + quiet * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', size);
    bg.setAttribute('height', size);
    bg.setAttribute('fill', '#fff');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000');
    svg.append(bg, path);
    return svg;
  }

  function renderQR(job) {
    const subject = job.subjects.find(s => s.id === route.subjectId);
    if (!subject) { go('roster', { jobId: job.id }, true); return; }
    const d = L.describe(job, subject);
    $('#qr-name').textContent = d.name;
    $('#qr-group').textContent = d.group;
    $('#qr-text').textContent = d.qr;
    const box = $('#qr-code');
    box.setAttribute('aria-label', 'QR code for ' + d.name);
    box.replaceChildren();
    if (d.qr) {
      try {
        box.append(qrSVG(d.qr));
      } catch (err) {
        box.append(el('p', { text: 'This content is too long for a QR code.' }));
      }
    } else {
      box.append(el('p', { text: 'Nothing to encode. Check the QR template in Job settings.' }));
    }
    const p = L.progress(job);
    $('#qr-counter').textContent = `${p.done}/${p.total}`;
    $('#qr-done').hidden = !!subject.done;
    $('#qr-done-info').hidden = !subject.done;
    $('#qr-done-time').textContent = subject.done ? 'Photographed ' + formatTime(subject.done) : '';
    requestWakeLock();
  }

  $('#qr-done').addEventListener('click', () => {
    const job = findJob(route.jobId);
    const subject = job.subjects.find(s => s.id === route.subjectId);
    subject.done = new Date().toISOString();
    save();
    toast(L.describe(job, subject).name + ' marked as photographed');
    // Back to the roster with a fresh search, ready for the next subject.
    $('#search').value = '';
    back();
  });

  $('#qr-undo').addEventListener('click', () => {
    const job = findJob(route.jobId);
    const subject = job.subjects.find(s => s.id === route.subjectId);
    subject.done = null;
    save();
    renderQR(job);
  });

  // Keep the screen on while a QR code is showing.
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported or denied; not critical */ }
  }
  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && route.view === 'qr') requestWakeLock();
  });

  // ----------------------------------------------------------- walk-up

  function walkupFields(job) {
    const s = job.settings;
    const fields = L.templateColumns(s.nameTemplate, job.headers);
    if (s.groupColumn && !fields.includes(s.groupColumn)) fields.push(s.groupColumn);
    for (const h of L.templateColumns(s.walkupTemplate, job.headers)) if (!fields.includes(h)) fields.push(h);
    return fields.length ? fields : ['Name'];
  }

  function renderWalkup(job) {
    const form = $('#walkup-form');
    form.replaceChildren();
    const fields = walkupFields(job);
    const groups = [...new Set(job.subjects.map(s => L.describe(job, s).group).filter(Boolean))];
    const listId = 'walkup-groups';
    fields.forEach((h, i) => {
      const input = el('input', { type: 'text', name: h, autocomplete: 'off' });
      if (h === job.settings.groupColumn) input.setAttribute('list', listId);
      input.addEventListener('input', () => updateWalkupPreview(job));
      form.append(el('label', { class: 'field' }, [el('span', { text: h }), input]));
      if (i === 0) setTimeout(() => input.focus(), 50);
    });
    form.append(el('datalist', { id: listId }, groups.map(g => el('option', { value: g }))));
    // Lets the keyboard's Go/Enter key submit a form with several fields.
    form.append(el('button', { type: 'submit', class: 'visually-hidden', tabindex: '-1', text: 'Add' }));
    // Prefill the name from the search that found no one.
    const query = $('#search').value.trim();
    if (query && fields.length) form.elements[0].value = query;
    updateWalkupPreview(job);
  }

  function walkupData() {
    const data = {};
    for (const input of $('#walkup-form').querySelectorAll('input')) data[input.name] = input.value.trim();
    return data;
  }

  function updateWalkupPreview(job) {
    const probe = { id: 'w', data: walkupData(), walkup: (job.walkups || 0) + 1 };
    $('#walkup-preview').textContent = L.describe(job, probe).qr;
  }

  function addWalkup() {
    const job = findJob(route.jobId);
    const data = walkupData();
    if (!Object.values(data).some(Boolean)) { toast('Enter a name first.'); return; }
    const subject = L.addWalkup(job, data);
    save();
    $('#search').value = '';
    go('qr', { jobId: job.id, subjectId: subject.id }, true);
  }

  $('#walkup-save').addEventListener('click', addWalkup);
  $('#walkup-form').addEventListener('submit', e => { e.preventDefault(); addWalkup(); });

  // -------------------------------------------------------------- init

  load();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  history.replaceState({ view: 'home' }, '');
  render();
})();
