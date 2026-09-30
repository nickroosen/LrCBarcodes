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

// Text items as PDF.js reports them for a GotPhoto card page (two cards per
// A4 page, second card 411pt lower). Positions copied from a real export;
// names and codes are made up.
function cardPage(cards) {
  const items = [];
  cards.forEach((c, i) => {
    const dy = i * 411;
    items.push(
      { str: 'Photos of', x: 179, y: 87 + dy },
      { str: 'Class/Group/Teacher', x: 393, y: 87 + dy },
      { str: 'Visit your photographer\'s online shop', x: 86, y: 113 + dy },
      { str: 'studio.gotphoto.com', x: 82, y: 134 + dy },
      { str: c.code, x: 82, y: 187 + dy },
      { str: `## JOB00003 - #${c.card} - ${c.code}`, x: 364, y: 275 + dy },
      { str: c.digits.split('').join(' '), x: 431, y: 332 + dy },
    );
    if (c.name) items.push({ str: c.name, x: 218, y: 67 + dy });
    if (c.group) items.push({ str: c.group, x: 459, y: 67 + dy });
  });
  return items;
}

test('parses named GotPhoto cards, two per page', () => {
  const cards = lib.parseCardPage(cardPage([
    { card: '1.1', code: 'QX7K2M9P', digits: '111122223333444', name: 'Ava Martínez', group: 'Bluebells' },
    { card: '1.2', code: 'RT5N8B2W', digits: '555566667777888', name: 'Noah O\'Connor', group: 'Shooting Stars' },
  ]));
  assert.equal(cards.length, 2);
  assert.deepEqual(
    cards.map(({ job, card, accessCode, name, group, barcode }) => ({ job, card, accessCode, name, group, barcode })), [
      { job: 'JOB00003', card: '1.1', accessCode: 'QX7K2M9P', name: 'Ava Martínez', group: 'Bluebells', barcode: '111122223333444' },
      { job: 'JOB00003', card: '1.2', accessCode: 'RT5N8B2W', name: 'Noah O\'Connor', group: 'Shooting Stars', barcode: '555566667777888' },
    ]);
});

test('parses blank password cards and ignores the cover page', () => {
  const cards = lib.parseCardPage(cardPage([{ card: '2.1', code: 'ZZ11YY22', digits: '999988887777666' }]));
  assert.equal(cards[0].name, '');
  assert.equal(cards[0].group, '');
  assert.equal(cards[0].accessCode, 'ZZ11YY22');
  assert.deepEqual(lib.parseCardPage([{ str: 'Password Cards', x: 34, y: 75 }, { str: 'Quantity: 4', x: 34, y: 140 }]), []);
});

test('assigns each decoded QR to the nearest card', () => {
  const cards = lib.parseCardPage(cardPage([
    { card: '1.1', code: 'AAAA1111', digits: '111111111111111', name: 'A', group: 'G' },
    { card: '1.2', code: 'BBBB2222', digits: '222222222222222', name: 'B', group: 'G' },
  ]));
  // QR centers sit left of and below each ID line (about 300, 335 on the first card).
  const missing = lib.assignLinks(cards, [
    { text: 'https://studio.gotphoto.com/gc/second/', x: 300, y: 746 },
    { text: 'https://studio.gotphoto.com/gc/first/', x: 300, y: 335 },
  ]);
  assert.equal(missing, 0);
  assert.equal(cards[0].link, 'https://studio.gotphoto.com/gc/first/');
  assert.equal(cards[1].link, 'https://studio.gotphoto.com/gc/second/');

  const lone = lib.parseCardPage(cardPage([{ card: '1.1', code: 'CCCC3333', digits: '333333333333333' }]));
  assert.equal(lib.assignLinks(lone, []), 1, 'reports cards whose QR could not be read');
});

test('card jobs: names fall back to the card number, duplicates are skipped', () => {
  const job = lib.createJob('Picture day', lib.CARD_HEADERS, [], lib.cardJobSettings(), 0);
  const cards = lib.parseCardPage(cardPage([
    { card: '1.1', code: 'AAAA1111', digits: '111111111111111', name: 'Ava Martínez', group: 'Bluebells' },
    { card: '2.1', code: 'BBBB2222', digits: '222222222222222' },
  ]));
  lib.assignLinks(cards, [{ text: 'https://s.gotphoto.com/gc/a/', x: 300, y: 335 }, { text: 'https://s.gotphoto.com/gc/b/', x: 300, y: 746 }]);
  assert.deepEqual(lib.addCards(job, cards), { added: 2, duplicates: 0 });
  assert.deepEqual(lib.addCards(job, cards), { added: 0, duplicates: 2 });
  assert.deepEqual(lib.describe(job, job.subjects[0]), { name: 'Ava Martínez', group: 'Bluebells', qr: 'https://s.gotphoto.com/gc/a/' });
  assert.equal(lib.describe(job, job.subjects[1]).name, 'Card 2.1 · BBBB2222');
  assert.ok(lib.matches(job, job.subjects[1], 'bbbb2222'), 'search finds access codes');
  assert.ok(lib.matches(job, job.subjects[0], 'AAAA1111'), 'also on named cards');
  assert.ok(lib.matches(job, job.subjects[0], '111111111111111'), 'and barcode numbers');
  const exported = lib.parseCSV(lib.exportCSV(job)).rows[0];
  assert.equal(exported['Access Code'], 'AAAA1111');
  assert.equal(exported['Gallery Link'], 'https://s.gotphoto.com/gc/a/');
  assert.equal(exported['Barcode'], '111111111111111');
});
