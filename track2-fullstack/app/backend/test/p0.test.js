const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmtracker-test-'));
process.env.FARMTRACKER_DB_PATH = path.join(tempDir, 'farmtracker.db');

const app = require('../server');
const { db } = require('../db');

let server;
let baseUrl;
let seedState = {};

before(async () => {
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

beforeEach(() => {
  seedTestData();
});

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedTestData() {
  db.exec('DELETE FROM health_events; DELETE FROM animals; DELETE FROM paddocks;');

  const northId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('North Paddock', 50).lastInsertRowid;

  const southId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('South Paddock', 30).lastInsertRowid;

  const animalId = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  ).run('Bella', 'TAG-001', 'Merino', '2021-03-14', northId).lastInsertRowid;

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(northId);

  seedState = { northId, southId, animalId };
}

function getPaddockCount(id) {
  return db.prepare('SELECT animal_count FROM paddocks WHERE id = ?').get(id).animal_count;
}

async function post(pathname, body) {
  const res = await fetch(baseUrl + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function put(pathname, body) {
  const res = await fetch(baseUrl + pathname, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('P0: moving animal updates paddock counts', async () => {
  const { northId, southId, animalId } = seedState;
  assert.equal(getPaddockCount(northId), 1);
  assert.equal(getPaddockCount(southId), 0);

  const { status } = await put(`/animals/${animalId}`, { paddock_id: southId });
  assert.equal(status, 200);
  assert.equal(getPaddockCount(northId), 0);
  assert.equal(getPaddockCount(southId), 1);
});

test('P0: failed create does not change paddock count', async () => {
  const { northId } = seedState;
  const beforeCount = getPaddockCount(northId);

  const { status } = await post('/animals', {
    name: 'Duplicate Tag',
    tag_number: 'TAG-001',
    paddock_id: northId,
  });

  assert.equal(status, 409);
  assert.equal(getPaddockCount(northId), beforeCount);
});

test('P0: duplicate paddock name returns 409', async () => {
  const { status } = await post('/paddocks', { name: 'North Paddock', capacity: 25 });
  assert.equal(status, 409);
});

test('P0: escapeHtml prevents HTML injection', () => {
  const previousWindow = global.window;
  global.window = {};

  const scriptPath = path.join(__dirname, '..', '..', 'frontend', 'app.js');
  delete require.cache[require.resolve(scriptPath)];
  require(scriptPath);

  const escaped = global.window.escapeHtml('<img src=x onerror="alert(1)"> & test');
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; test');

  if (previousWindow === undefined) {
    delete global.window;
  } else {
    global.window = previousWindow;
  }
});
