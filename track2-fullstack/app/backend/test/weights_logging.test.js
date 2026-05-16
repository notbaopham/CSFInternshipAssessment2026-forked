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
  db.exec('DELETE FROM weights; DELETE FROM health_events; DELETE FROM animals; DELETE FROM paddocks;');

  const paddockId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('North Paddock', 50).lastInsertRowid;

  const animalId = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  ).run('Bella', 'TAG-001', 'Merino', '2021-03-14', paddockId).lastInsertRowid;

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?').run(paddockId);

  seedState = { paddockId, animalId };
}

async function get(pathname) {
  const res = await fetch(baseUrl + pathname);
  return { status: res.status, body: await res.json() };
}

async function post(pathname, body) {
  const res = await fetch(baseUrl + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function del(pathname) {
  const res = await fetch(baseUrl + pathname, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

function getWeightsRowCount(animalId) {
  return db.prepare('SELECT COUNT(*) AS count FROM weights WHERE animal_id = ?').get(animalId).count;
}

// --- Acceptance Criteria: happy path ---

test('Acceptance: POST /api/animals/:id/weights creates a weight record and returns 201', async () => {
  const { animalId } = seedState;

  const created = await post(`/animals/${animalId}/weights`, {
    weight_kg: 45.2,
    date: '2024-11-15',
    notes: 'Post-shearing weigh-in',
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.animal_id, animalId);
  assert.equal(created.body.weight_kg, 45.2);
  assert.equal(created.body.date, '2024-11-15');
  assert.equal(created.body.notes, 'Post-shearing weigh-in');

  // Data Model: required fields exist and types look sane.
  assert.equal(typeof created.body.id, 'number');
  assert.equal(typeof created.body.animal_id, 'number');
  assert.equal(typeof created.body.weight_kg, 'number');
  assert.equal(typeof created.body.date, 'string');

  assert.equal(getWeightsRowCount(animalId), 1);
});

// --- Acceptance Criteria: validation/errors ---

test('Acceptance: POST /api/animals/:id/weights returns 422 if weight_kg is missing or non-positive', async () => {
  const { animalId } = seedState;

  const missing = await post(`/animals/${animalId}/weights`, {
    date: '2024-11-15',
  });
  assert.equal(missing.status, 422);

  const zero = await post(`/animals/${animalId}/weights`, {
    weight_kg: 0,
    date: '2024-11-15',
  });
  assert.equal(zero.status, 422);

  const negative = await post(`/animals/${animalId}/weights`, {
    weight_kg: -1,
    date: '2024-11-15',
  });
  assert.equal(negative.status, 422);
});

test('Acceptance: POST /api/animals/:id/weights returns 404 if animal does not exist', async () => {
  const res = await post('/animals/999999/weights', {
    weight_kg: 12.5,
    date: '2024-11-15',
  });
  assert.equal(res.status, 404);
});

// --- Form / input-shape correctness (good practices) ---

test('Form: POST /api/animals/:id/weights requires a valid YYYY-MM-DD date', async () => {
  const { animalId } = seedState;

  const missingDate = await post(`/animals/${animalId}/weights`, {
    weight_kg: 10.1,
  });
  assert.equal(missingDate.status, 400);

  const badDate = await post(`/animals/${animalId}/weights`, {
    weight_kg: 10.1,
    date: '2024-02-30',
  });
  assert.equal(badDate.status, 400);
});

test('Form: POST /api/animals/:id/weights allows notes to be omitted (notes null)', async () => {
  const { animalId } = seedState;

  const created = await post(`/animals/${animalId}/weights`, {
    weight_kg: 33.3,
    date: '2024-06-01',
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.notes, null);
});

test('Form: POST /api/animals/:id/weights rejects non-string notes', async () => {
  const { animalId } = seedState;

  const res = await post(`/animals/${animalId}/weights`, {
    weight_kg: 33.3,
    date: '2024-06-01',
    notes: 123,
  });

  assert.equal(res.status, 400);
});

test('Form: POST /api/animals/:id/weights accepts numeric weight_kg strings', async () => {
  const { animalId } = seedState;

  const res = await post(`/animals/${animalId}/weights`, {
    weight_kg: '55.5',
    date: '2024-07-01',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.weight_kg, 55.5);
});

// --- Acceptance Criteria: listing + ordering ---

test('Acceptance: GET /api/animals/:id/weights returns all records ordered by date descending', async () => {
  const { animalId } = seedState;

  const listEmpty = await get(`/animals/${animalId}/weights`);
  assert.equal(listEmpty.status, 200);
  assert.deepEqual(listEmpty.body, []);

  const a = await post(`/animals/${animalId}/weights`, { weight_kg: 40, date: '2024-01-01' });
  const b = await post(`/animals/${animalId}/weights`, { weight_kg: 41, date: '2024-02-01' });
  const c = await post(`/animals/${animalId}/weights`, { weight_kg: 42, date: '2024-02-01' });

  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(c.status, 201);

  const list = await get(`/animals/${animalId}/weights`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 3);

  const dates = list.body.map(row => row.date);
  assert.deepEqual(dates, ['2024-02-01', '2024-02-01', '2024-01-01']);

  // Same-day records should be newest-first (id desc), so first two IDs are descending.
  const sameDayIds = list.body.slice(0, 2).map(row => row.id);
  assert.ok(sameDayIds[0] > sameDayIds[1]);

  // Date values should be normalized to YYYY-MM-DD.
  list.body.forEach(row => assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/));
});

test('Acceptance: GET /api/animals/:id/weights returns 404 if animal does not exist', async () => {
  const res = await get('/animals/999999/weights');
  assert.equal(res.status, 404);
});

// --- Data model correctness: FK cascade ---

test('Data Model: deleting an animal cascades to weights', async () => {
  const { animalId } = seedState;

  const created = await post(`/animals/${animalId}/weights`, { weight_kg: 10.5, date: '2024-03-01' });
  assert.equal(created.status, 201);
  assert.equal(getWeightsRowCount(animalId), 1);

  const deleted = await del(`/animals/${animalId}`);
  assert.equal(deleted.status, 200);
  assert.equal(getWeightsRowCount(animalId), 0);
});
