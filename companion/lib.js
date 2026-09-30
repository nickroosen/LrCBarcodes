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

  // --------------------------------------------------- GotPhoto card PDFs

  // GotPhoto doesn't export gallery links, but its QR card PDFs contain them.
  // Each card has a rotated ID line "## JOB00003 - #1.2 - XB9C74JN" (job,
  // card number, access code), the access code again, the Code 128 number as
  // spaced digits, and on named cards the subject's name and class printed
  // just above the "Photos of" and "Class/Group/Teacher" labels. The gallery
  // link is only in the QR code, which the app decodes from the rendered page
  // and assigns to the nearest card with assignLinks().

  const CARD_ID = /(JOB\w+)\s*-\s*#\s*([\d.]+)\s*-\s*([A-Z0-9]{4,})/;

  // items: text items on one page, as { str, x, y } in page points with the
  // origin at the top left (y is the text baseline).
  // Returns cards: { job, card, accessCode, name, group, barcode, x, y }.
  function parseCardPage(items) {
    const clean = items
      .map(it => ({ str: String(it.str || '').replace(/\s+/g, ' ').trim(), x: it.x, y: it.y }))
      .filter(it => it.str);
    const photosLabels = clean.filter(it => /^photos of$/i.test(it.str));
    const groupLabels = clean.filter(it => /^class\s*\/\s*group/i.test(it.str));
    const digitLines = clean.filter(it => /^\d(\s\d){7,}$/.test(it.str));

    const nearest = (list, from, filter) => {
      let best = null, bestD = Infinity;
      for (const it of list) {
        if (filter && !filter(it)) continue;
        const d = Math.hypot(it.x - from.x, it.y - from.y);
        if (d < bestD) { best = it; bestD = d; }
      }
      return best;
    };

    const cards = [];
    for (const it of clean) {
      const m = CARD_ID.exec(it.str);
      if (!m) continue;
      const card = { job: m[1], card: m[2], accessCode: m[3], name: '', group: '', barcode: '', x: it.x, y: it.y };

      // Labels belong to this card if they're above the ID line and within
      // one card's height of it.
      const label = nearest(photosLabels, it, l => l.y < it.y && it.y - l.y < 400);
      if (label) {
        const groupLabel = nearest(groupLabels, label, g => Math.abs(g.y - label.y) < 5);
        const splitX = groupLabel ? groupLabel.x : Infinity;
        const band = clean
          .filter(t => t.y < label.y - 3 && label.y - t.y < 40 && t.x >= label.x - 20)
          .sort((a, b) => a.x - b.x);
        card.name = band.filter(t => t.x < splitX - 5).map(t => t.str).join(' ').trim();
        card.group = band.filter(t => t.x >= splitX - 5).map(t => t.str).join(' ').trim();
      }
      const digits = nearest(digitLines, it, d => Math.abs(d.y - it.y) < 150);
      if (digits) card.barcode = digits.str.replace(/\s/g, '');
      cards.push(card);
    }
    return cards;
  }

  // Pairs decoded QR codes ({ text, x, y } centers, in the same page points)
  // with cards on the same page: each QR goes to the nearest card ID line.
  // Sets card.link; returns the number of cards left without one.
  function assignLinks(cards, qrs) {
    const free = qrs.slice();
    for (const card of cards) {
      let bestI = -1, bestD = Infinity;
      free.forEach((q, i) => {
        const d = Math.hypot(q.x - card.x, q.y - card.y);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      card.link = bestI >= 0 && bestD < 350 ? free.splice(bestI, 1)[0].text : '';
    }
    return cards.filter(c => !c.link).length;
  }

  const CARD_HEADERS = ['Name', 'Class', 'Access Code', 'Card', 'Barcode', 'Gallery Link'];

  function cardRow(card) {
    return {
      'Name': card.name,
      'Class': card.group,
      'Access Code': card.accessCode,
      'Card': card.card,
      'Barcode': card.barcode,
      'Gallery Link': card.link || '',
    };
  }

  function cardJobSettings() {
    return {
      nameTemplate: '{Name}',
      fallbackNameTemplate: 'Card {Card} · {Access Code}',  // password cards have no name
      groupColumn: 'Class',
      qrTemplate: '{Gallery Link}',
      walkupTemplate: 'WALKUP-{#} {name}',
      source: 'gotphoto-cards',
    };
  }

  // Adds cards to a job, skipping access codes it already has.
  // Returns { added, duplicates }.
  function addCards(job, cards) {
    const have = new Set(job.subjects.map(s => s.data['Access Code']).filter(Boolean));
    let added = 0, duplicates = 0;
    for (const card of cards) {
      if (have.has(card.accessCode)) { duplicates++; continue; }
      have.add(card.accessCode);
      job.subjects.push({ id: 'c' + card.accessCode, data: cardRow(card), done: null });
      added++;
    }
    for (const h of CARD_HEADERS) if (!job.headers.includes(h)) job.headers.push(h);
    return { added, duplicates };
  }

  // -------------------------------------------------------------- jobs

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  // Resolves display name, group and QR content for a subject.
  function describe(job, subject) {
    const s = job.settings;
    const row = subject.data;
    const name = renderTemplate(s.nameTemplate, row)
      || (s.fallbackNameTemplate ? renderTemplate(s.fallbackNameTemplate, row) : '')
      || '(no name)';
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

  // Case- and accent-insensitive search across name, group, QR content and
  // every roster field (e.g. access code, barcode number).
  function normalize(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function matches(job, subject, query) {
    const q = normalize(query).trim();
    if (!q) return true;
    const d = describe(job, subject);
    const hay = normalize([d.name, d.group, d.qr].concat(Object.values(subject.data)).join(' '));
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
    parseCardPage, assignLinks, addCards, cardJobSettings, CARD_HEADERS,
  };
});
