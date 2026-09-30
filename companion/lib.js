/*
 * Pure logic for the LrC Barcodes companion app: CSV parsing, column detection,
 * templates and export. No DOM access, so it can be tested with Node
 * (tests/companion.test.js). Exposed as window.CompanionLib in the browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CompanionLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- CSV

  // Picks the delimiter that splits the header line into the most columns.
  // GotPhoto and European spreadsheet exports often use ';'.
  function detectDelimiter(text) {
    const firstLine = text.split(/\r\n|\n|\r/, 1)[0] || '';
    let best = ',', bestCount = 0;
    for (const d of [',', ';', '\t']) {
      let count = 0, inQuotes = false;
      for (const ch of firstLine) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === d && !inQuotes) count++;
      }
      if (count > bestCount) { best = d; bestCount = count; }
    }
    return best;
  }

  // RFC 4180 parser: quoted fields, escaped quotes, embedded newlines, BOM.
  // Returns { headers: [...], rows: [ {header: value} ] }. Blank lines are skipped.
  function parseCSV(text, delimiter) {
    text = String(text || '').replace(/^﻿/, '');
    delimiter = delimiter || detectDelimiter(text);
    const records = [];
    let record = [], field = '', inQuotes = false, i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
      if (ch === delimiter) { record.push(field); field = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        record.push(field); field = '';
        records.push(record); record = [];
        i += (ch === '\r' && text[i + 1] === '\n') ? 2 : 1;
        continue;
      }
      field += ch; i++;
    }
    if (field !== '' || record.length) { record.push(field); records.push(record); }

    const nonEmpty = records.filter(r => r.some(v => v.trim() !== ''));
    if (!nonEmpty.length) return { headers: [], rows: [] };

    // Make headers unique and non-empty.
    const seen = {};
    const headers = nonEmpty[0].map((h, idx) => {
      let name = h.trim() || `Column ${idx + 1}`;
      if (seen[name]) name = `${name} (${++seen[name]})`;
      else seen[name] = 1;
      return name;
    });
    const rows = nonEmpty.slice(1).map(r => {
      const row = {};
      headers.forEach((h, idx) => { row[h] = (r[idx] || '').trim(); });
      return row;
    });
    return { headers, rows };
  }

  function csvEscape(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) lines.push(headers.map(h => csvEscape(row[h])).join(','));
    return lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------- templates

  // Replaces {Column Name} with the row's value (header match is
  // case-insensitive) and {name}, {group}, {#} with the supplied extras when
  // no column of that name exists. Unknown placeholders become ''.
  function renderTemplate(template, row, extras) {
    row = row || {};
    extras = extras || {};
    const lower = {};
    for (const key of Object.keys(row)) lower[key.toLowerCase()] = row[key];
    return String(template || '').replace(/\{([^{}]+)\}/g, (_, key) => {
      const k = key.trim().toLowerCase();
      if (k in lower && lower[k] !== '') return lower[k];
      if (k in extras) return extras[k];
      return '';
    }).replace(/\s+/g, ' ').trim();
  }

  // Column names referenced by a template, as they appear in `headers`.
  function templateColumns(template, headers) {
    const out = [];
    String(template || '').replace(/\{([^{}]+)\}/g, (_, key) => {
      const h = headers.find(x => x.toLowerCase() === key.trim().toLowerCase());
      if (h && !out.includes(h)) out.push(h);
      return '';
    });
    return out;
  }

  // ---------------------------------------------------- column detection

  const PATTERNS = {
    first: /^(first|given|fore)[\s_-]*name$|^vorname$|^first$/i,
    last: /^(last|family|sur)[\s_-]*name$|^surname$|^nachname$|^last$/i,
    full: /^(full[\s_-]*)?name$|^(subject|student|player|athlete|child|participant)([\s_-]*name)?$/i,
    group: /team|class|group|grade|homeroom|teacher|klasse|gruppe|squad|division|roster/i,
    id: /(^|[\s_-])(id|code|barcode|qr|number|no|nr|access)([\s_-]|$)|^(id|code|barcode|qr)/i,
  };

  function findHeader(headers, pattern) {
    return headers.find(h => pattern.test(h.trim()));
  }

  // Share of non-empty values in `column` that look like web links.
  function urlShare(rows, column) {
    let urls = 0, total = 0;
    for (const row of rows) {
      const v = row[column];
      if (!v) continue;
      total++;
      if (/^https?:\/\//i.test(v)) urls++;
    }
    return total ? urls / total : 0;
  }

  // Suggests job settings for an imported roster.
  function detectSettings(headers, rows) {
    const first = findHeader(headers, PATTERNS.first);
    const last = findHeader(headers, PATTERNS.last);
    const full = findHeader(headers, PATTERNS.full);
    let nameTemplate;
    if (first && last) nameTemplate = `{${first}} {${last}}`;
    else if (full) nameTemplate = `{${full}}`;
    else if (first) nameTemplate = `{${first}}`;
    else nameTemplate = headers.length ? `{${headers[0]}}` : '{name}';

    const group = findHeader(headers, PATTERNS.group) || '';

    // QR content: prefer a column of links (GotPhoto gallery links), then an
    // ID/code column, then the name.
    let qrTemplate = '';
    const linkColumns = headers
      .map(h => ({ h, share: urlShare(rows, h), gotphoto: rows.some(r => /gotphoto/i.test(r[h] || '')) }))
      .filter(c => c.share >= 0.8)
      .sort((a, b) => (b.gotphoto - a.gotphoto) || (b.share - a.share));
    if (linkColumns.length) qrTemplate = `{${linkColumns[0].h}}`;
    else {
      const id = headers.find(h => PATTERNS.id.test(h.trim()) && h !== group);
      qrTemplate = id ? `{${id}}` : nameTemplate;
    }

    return {
      nameTemplate,
      groupColumn: group,
      qrTemplate,
      walkupTemplate: 'WALKUP-{#} {name}',
      source: linkColumns.some(c => c.gotphoto) ? 'gotphoto' : 'csv',
    };
  }

  // -------------------------------------------------------------- jobs

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  // Resolves display name, group and QR content for a subject.
  function describe(job, subject) {
    const s = job.settings;
    const row = subject.data;
    const name = renderTemplate(s.nameTemplate, row) || '(no name)';
    const group = s.groupColumn ? (row[s.groupColumn] || '') : '';
    const extras = { name, group, '#': subject.walkup ? pad(subject.walkup, 3) : '' };
    const template = subject.walkup ? s.walkupTemplate : s.qrTemplate;
    const qr = renderTemplate(template, row, extras);
    return { name, group, qr };
  }

  function createJob(title, headers, rows, settings, now) {
    return {
      id: 'j' + (now || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6),
      title: title || 'Untitled job',
      created: new Date(now || Date.now()).toISOString(),
      headers: headers.slice(),
      settings: Object.assign({}, settings),
      subjects: rows.map((data, i) => ({ id: 'r' + i, data, done: null })),
      walkups: 0,
    };
  }

  // Adds a subject who isn't on the roster. `data` holds column values.
  function addWalkup(job, data) {
    job.walkups = (job.walkups || 0) + 1;
    for (const key of Object.keys(data)) {
      if (!job.headers.includes(key)) job.headers.push(key);
    }
    const subject = { id: 'w' + job.walkups, data: Object.assign({}, data), done: null, walkup: job.walkups };
    job.subjects.push(subject);
    return subject;
  }

  // Case- and accent-insensitive search across name, group and QR content.
  function normalize(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function matches(job, subject, query) {
    const q = normalize(query).trim();
    if (!q) return true;
    const d = describe(job, subject);
    const hay = normalize([d.name, d.group, d.qr].join(' '));
    return q.split(/\s+/).every(term => hay.includes(term));
  }

  function progress(job) {
    const done = job.subjects.filter(s => s.done).length;
    return { done, total: job.subjects.length };
  }

  // Roster columns plus what happened on the day.
  function exportCSV(job) {
    const headers = job.headers.concat(['QR Content', 'Photographed', 'Photographed At', 'Walk-up']);
    const rows = job.subjects.map(subject => {
      const d = describe(job, subject);
      return Object.assign({}, subject.data, {
        'QR Content': d.qr,
        'Photographed': subject.done ? 'Yes' : 'No',
        'Photographed At': subject.done || '',
        'Walk-up': subject.walkup ? 'Yes' : 'No',
      });
    });
    return toCSV(headers, rows);
  }

  return {
    detectDelimiter, parseCSV, toCSV,
    renderTemplate, templateColumns,
    detectSettings, describe, createJob, addWalkup, matches, progress, exportCSV,
  };
});
