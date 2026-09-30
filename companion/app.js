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
    toastTimer = setTimeout(() => { t.hidden = true; }, Math.max(2600, message.length * 70));
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
          el('div', { class: 'card-meta', text: [
            job.info && job.info.organization,
            job.info && job.info.shootDate ? 'shoot ' + job.info.shootDate : formatDate(job.created),
            `${p.done} of ${p.total} photographed`,
          ].filter(Boolean).join(' · ') }),
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

  // ------------------------------------------------ GotPhoto card PDFs

  // PDF.js (to read text and render pages) and ZXing (to decode the QR codes)
  // are only loaded when a PDF is imported. Both are bundled with the app.
  let pdfjsLib = null;
  let zxingReady = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = el('script', { src });
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(script);
    });
  }

  async function loadCardLibraries() {
    if (!pdfjsLib) {
      pdfjsLib = await import('./vendor/pdfjs/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
    }
    if (!zxingReady) {
      zxingReady = loadScript('vendor/zxing/zxing-reader.js').then(() => window.ZXingWASM.prepareZXingModule({
        overrides: {
          locateFile: (path, prefix) =>
            path.endsWith('.wasm') ? new URL('vendor/zxing/' + path, location.href).href : prefix + path,
        },
        fireImmediately: true,
      }));
    }
    await zxingReady;
  }

  // Renders a page and returns its QR codes as { text, x, y } centers in page points.
  async function decodePageQRs(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport }).promise;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0;  // free the bitmap early on memory-limited tablets
    const results = await window.ZXingWASM.readBarcodes(image, {
      formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 32,
    });
    return results.filter(r => r.isValid).map(r => {
      const p = r.position;
      const corners = [p.topLeft, p.topRight, p.bottomLeft, p.bottomRight];
      return {
        text: r.text,
        x: corners.reduce((sum, c) => sum + c.x, 0) / 4 / scale,
        y: corners.reduce((sum, c) => sum + c.y, 0) / 4 / scale,
      };
    });
  }

  // Returns { cover, cards } for one page. The cover page (job details) has
  // no cards, so it is never rendered.
  async function readCardPage(page) {
    const base = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.map(it => {
      const [x, y] = base.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { str: it.str, x, y };
    });
    const cards = L.parseCardPage(items);
    if (!cards.length) return { cover: L.parseCoverPage(items), cards };
    // Render at 2x; retry at 3x if any card's QR code wasn't found.
    for (const scale of [2, 3]) {
      if (L.assignLinks(cards, await decodePageQRs(page, scale)) === 0) break;
    }
    return { cover: null, cards };
  }

  function busy(message) {
    $('#busy').hidden = message == null;
    if (message != null) $('#busy-text').textContent = message;
  }

  // Reads GotPhoto card PDFs into a new job (no jobId) or an existing one.
  async function importCardPDFs(files, jobId) {
    files = Array.from(files || []);
    if (!files.length) return;
    const cards = [];
    const pdfs = [];  // { cover, cards } per file
    const failed = [];
    try {
      busy('Loading PDF reader...');
      await loadCardLibraries();
      for (const [fileIndex, file] of files.entries()) {
        let loading, doc;
        try {
          loading = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
          doc = await loading.promise;
        } catch (err) {
          failed.push(file.name);
          continue;
        }
        const pdf = { cover: null, cards: [] };
        for (let p = 1; p <= doc.numPages; p++) {
          busy(`Reading ${files.length > 1 ? `file ${fileIndex + 1} of ${files.length}, ` : ''}page ${p} of ${doc.numPages}...`);
          const page = await doc.getPage(p);
          const result = await readCardPage(page);
          if (result.cover && !pdf.cover) pdf.cover = result.cover;
          pdf.cards.push(...result.cards);
          cards.push(...result.cards);
          page.cleanup();
        }
        if (pdf.cards.length) pdfs.push(pdf);
        await loading.destroy();
      }
    } catch (err) {
      busy(null);
      toast('Could not read the PDF: ' + (err && err.message ? err.message : err));
      return;
    }
    busy(null);

    if (!cards.length) {
      toast(failed.length ? 'Could not open ' + failed.join(', ') : 'No GotPhoto QR cards found in that PDF.');
      return;
    }

    let job = jobId ? findJob(jobId) : null;
    if (!job) {
      const cover = pdfs.map(p => p.cover).find(c => c && c.name);
      const title = cover ? cover.name : files[0].name
        .replace(/\.pdf$/i, '')
        .replace(/^Password_Card_\d+_\d+_\d+_/i, '')
        .replace(/_/g, ' ')
        .trim();
      job = L.createJob(title || 'GotPhoto cards', L.CARD_HEADERS, [], L.cardJobSettings());
      db.jobs.push(job);
    }
    const result = L.addCards(job, cards);
    const warnings = pdfs.map(p => L.addCoverInfo(job, p.cover, p.cards)).filter(Boolean);
    save();

    const noLink = cards.filter(c => !c.link).length;
    const named = cards.filter(c => c.name).length;
    const parts = [`Added ${result.added} card${result.added === 1 ? '' : 's'}`];
    if (named < cards.length) parts.push(`${cards.length - named} without a name`);
    if (result.duplicates) parts.push(`${result.duplicates} already in this job`);
    if (noLink) parts.push(`${noLink} QR code${noLink === 1 ? '' : 's'} could not be read`);
    if (failed.length) parts.push('could not open ' + failed.join(', '));
    toast(parts.join('; ') + '.');
    // Problems that could put the wrong cards in the job stay on screen.
    importWarning = warnings.length ? { jobId: job.id, text: warnings.join('. ') + '.' } : null;

    if (jobId) renderRoster(job);
    else go('roster', { jobId: job.id });
  }

  $('#import-pdf').addEventListener('change', e => {
    const files = e.target.files;
    importCardPDFs(files).finally(() => { e.target.value = ''; });
  });

  $('#add-pdf').addEventListener('change', e => {
    const files = e.target.files;
    closeMenu();
    importCardPDFs(files, route.jobId).finally(() => { e.target.value = ''; });
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

  // Job details from the GotPhoto cover page: organization, shoot date,
  // contact (with tap-to-call / email links) and a card count per PDF.
  function renderJobInfo(job) {
    const panel = $('#job-info');
    const info = job.info;
    panel.hidden = !info;
    if (!info) return;
    $('#job-info-summary').textContent = [info.organization || info.name, info.shootDate && 'Shoot ' + info.shootDate]
      .filter(Boolean).join(' · ') || 'Job details';

    const body = $('#job-info-body');
    body.replaceChildren();
    const row = (label, ...values) => {
      values = values.filter(Boolean);
      if (!values.length) return;
      body.append(el('dt', { text: label }), el('dd', null, values.map(v => typeof v === 'string' ? el('div', { text: v }) : v)));
    };
    const c = info.contact || {};
    const phone = c.phone && el('a', { href: 'tel:' + c.phone.replace(/[^+\d]/g, ''), text: c.phone });
    const email = c.email && el('a', { href: 'mailto:' + c.email, text: c.email });
    row('Job', [info.name, info.jobNumber && !String(info.name || '').includes(info.jobNumber) ? `(${info.jobNumber})` : '']
      .filter(Boolean).join(' '));
    row('Date of shoot', info.shootDate);
    row('Organization', info.organization);
    row('Address', ...(info.address || []));
    row('Contact', c.name, phone, email);
    row('Card PDFs', ...(info.pdfs || []).map(p => {
      const total = p.quantity != null ? p.quantity : p.found;
      const count = (p.quantity != null ? `${p.found} of ${p.quantity}` : `${p.found}`) + (total === 1 ? ' card' : ' cards');
      return `${p.pdf ? 'PDF #' + p.pdf + ': ' : ''}${count}${p.created ? ', created ' + p.created : ''}`;
    }));
  }

  let importWarning = null;  // { jobId, text } from the last card import

  $('#import-warning').addEventListener('click', () => {
    importWarning = null;
    $('#import-warning').hidden = true;
  });

  function renderRoster(job) {
    $('#roster-title').textContent = job.title;
    const warning = $('#import-warning');
    warning.hidden = !(importWarning && importWarning.jobId === job.id);
    if (!warning.hidden) warning.textContent = importWarning.text + ' (Tap to dismiss.)';
    renderJobInfo(job);
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
