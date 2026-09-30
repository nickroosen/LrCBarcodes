// Tests for companion/lib.js.   Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../companion/lib.js');

test('parses quoted fields, escaped quotes, newlines, BOM and CRLF', () => {
  const csv = '﻿First Name,Last Name,Note\r\n"Jamal","O\'Brien","says ""hi"""\r\nZoë,"Núñez, Jr.","two\nlines"\r\n\r\n';
  const { headers, rows } = lib.parseCSV(csv);
  assert.deepEqual(headers, ['First Name', 'Last Name', 'Note']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { 'First Name': 'Jamal', 'Last Name': "O'Brien", Note: 'says "hi"' });
  assert.deepEqual(rows[1], { 'First Name': 'Zoë', 'Last Name': 'Núñez, Jr.', Note: 'two\nlines' });
});

test('detects semicolon and tab delimiters', () => {
  assert.equal(lib.detectDelimiter('Vorname;Nachname;Klasse\nA;B;C'), ';');
  assert.equal(lib.detectDelimiter('a\tb\tc'), '\t');
  assert.equal(lib.detectDelimiter('"a;b",c,d'), ',');
  assert.deepEqual(lib.parseCSV('Vorname;Nachname\nAnna;Müller').rows, [{ Vorname: 'Anna', Nachname: 'Müller' }]);
});

test('makes duplicate and blank headers unique, pads short rows', () => {
  const { headers, rows } = lib.parseCSV('Name,Name,\nA\n');
  assert.deepEqual(headers, ['Name', 'Name (2)', 'Column 3']);
  assert.deepEqual(rows[0], { Name: 'A', 'Name (2)': '', 'Column 3': '' });
});

test('export round-trips through the parser', () => {
  const headers = ['Name', 'Note'];
  const rows = [{ Name: 'A, "B"', Note: 'x\ny' }];
  assert.deepEqual(lib.parseCSV(lib.toCSV(headers, rows)).rows, rows);
});

test('renders templates case-insensitively with extras', () => {
  const row = { 'First Name': 'Ana', Team: 'U12 Red', Number: '7' };
  assert.equal(lib.renderTemplate('{first name} {Missing} #{number}', row), 'Ana #7');
  assert.equal(lib.renderTemplate('{Team}-{Number}', row), 'U12 Red-7');
  assert.equal(lib.renderTemplate('WALKUP-{#} {name}', {}, { '#': '003', name: 'Sam Lee' }), 'WALKUP-003 Sam Lee');
  assert.deepEqual(lib.templateColumns('{first name} {Team} {nope}', Object.keys(row)), ['First Name', 'Team']);
});

test('detects a GotPhoto-style roster', () => {
  const { headers, rows } = lib.parseCSV(
    'First Name;Last Name;Class;Access Code;Gallery Link\n' +
    'Ana;Diaz;Room 4;ZFC98L4W;https://studio.gotphoto.com/gc/abc/\n' +
    'Ben;Ng;Room 4;QWE12345;https://studio.gotphoto.com/gc/def/\n');
  const s = lib.detectSettings(headers, rows);
  assert.equal(s.nameTemplate, '{First Name} {Last Name}');
  assert.equal(s.groupColumn, 'Class');
  assert.equal(s.qrTemplate, '{Gallery Link}');
  assert.equal(s.source, 'gotphoto');
});

test('falls back to an ID column, then the name', () => {
  let p = lib.parseCSV('Player,Team,Player ID\nSam,Hawks,H-07\n');
  let s = lib.detectSettings(p.headers, p.rows);
  assert.equal(s.nameTemplate, '{Player}');
  assert.equal(s.groupColumn, 'Team');
  assert.equal(s.qrTemplate, '{Player ID}');

  p = lib.parseCSV('Name,Squad\nSam,Blue\n');
  s = lib.detectSettings(p.headers, p.rows);
  assert.equal(s.qrTemplate, '{Name}');
  assert.equal(s.source, 'csv');
});

test('jobs: describe, walk-ups, search, progress and export', () => {
  const p = lib.parseCSV('First,Last,Team,Link\nZoë,Núñez,Hawks,https://x.gotphoto.com/gc/1/\nBen,Ng,Owls,https://x.gotphoto.com/gc/2/\n');
  const job = lib.createJob('Spring league', p.headers, p.rows, lib.detectSettings(p.headers, p.rows), 0);

  assert.deepEqual(lib.describe(job, job.subjects[0]),
    { name: 'Zoë Núñez', group: 'Hawks', qr: 'https://x.gotphoto.com/gc/1/' });

  const w = lib.addWalkup(job, { First: 'Sam', Last: 'Lee', Team: 'Owls' });
  assert.deepEqual(lib.describe(job, w), { name: 'Sam Lee', group: 'Owls', qr: 'WALKUP-001 Sam Lee' });
  const w2 = lib.addWalkup(job, { First: 'Kai', Last: '', Team: '' });
  assert.equal(lib.describe(job, w2).qr, 'WALKUP-002 Kai');

  assert.ok(lib.matches(job, job.subjects[0], 'zoe nunez'), 'accent-insensitive');
  assert.ok(lib.matches(job, job.subjects[0], 'hawks'));
  assert.ok(!lib.matches(job, job.subjects[1], 'hawks'));
  assert.ok(lib.matches(job, job.subjects[1], ''));

  job.subjects[0].done = '2026-10-01T09:30:00.000Z';
  assert.deepEqual(lib.progress(job), { done: 1, total: 4 });

  const exported = lib.parseCSV(lib.exportCSV(job));
  assert.deepEqual(exported.headers, ['First', 'Last', 'Team', 'Link', 'QR Content', 'Photographed', 'Photographed At', 'Walk-up']);
  assert.equal(exported.rows[0].Photographed, 'Yes');
  assert.equal(exported.rows[0]['Photographed At'], '2026-10-01T09:30:00.000Z');
  assert.equal(exported.rows[2]['QR Content'], 'WALKUP-001 Sam Lee');
  assert.equal(exported.rows[2]['Walk-up'], 'Yes');
  assert.equal(exported.rows[2].Link, '');
});
