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

  const paddockId = db.prepare(
    'INSERT INTO paddocks (name, capacity, animal_count) VALUES (?, ?, 0)'
  ).run('North Paddock', 50).lastInsertRowid;

  const insertAnimal = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  );

  const animalWithDobId = insertAnimal.run(
    'Bella',
    'TAG-001',
    'Merino',
    '2021-03-14',
    paddockId
  ).lastInsertRowid;

  const animalNoEventsId = insertAnimal.run(
    'Daisy',
    'TAG-002',
    'Dorper',
    '2020-07-22',
    paddockId
  ).lastInsertRowid;

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 2 WHERE id = ?').run(paddockId);

  const insertEvent = db.prepare(
    'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
  );

  // Create multiple events for Bella.
  insertEvent.run(animalWithDobId, 'checkup', null, '2024-01-15', 'Dr. A');
  insertEvent.run(animalWithDobId, 'vaccination', null, '2024-02-20', 'Dr. B');
  const latestSameDayId = insertEvent.run(animalWithDobId, 'injury', null, '2024-02-20', 'Dr. C').lastInsertRowid;

  seedState = {
    paddockId,
    animalWithDobId,
    animalNoEventsId,
    latestSameDayId,
  };
}

async function get(pathname) {
  const res = await fetch(baseUrl + pathname);
  return { status: res.status, body: await res.json() };
}

test('P2: API normalizes date strings to YYYY-MM-DD', async () => {
  const { status, body } = await get('/animals?page=0&limit=10');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));

  for (const animal of body) {
    if (animal.date_of_birth !== null) {
      assert.match(animal.date_of_birth, /^\d{4}-\d{2}-\d{2}$/);
    }
    if (animal.latest_health_event && animal.latest_health_event.date !== null) {
      assert.match(animal.latest_health_event.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  }

  const single = await get(`/animals/${seedState.animalWithDobId}`);
  assert.equal(single.status, 200);
  assert.equal(single.body.date_of_birth, '2021-03-14');
});

test('P2: latest_health_event selection remains correct after optimization', async () => {
  const { status, body } = await get('/animals?page=0&limit=10');
  assert.equal(status, 200);

  const bella = body.find(a => a.id === seedState.animalWithDobId);
  assert.ok(bella);
  assert.ok(bella.latest_health_event);

  // Same date tie-break uses most recently inserted event (higher id).
  assert.equal(bella.latest_health_event.id, seedState.latestSameDayId);
  assert.equal(bella.latest_health_event.event_type, 'injury');
  assert.equal(bella.latest_health_event.date, '2024-02-20');

  const daisy = body.find(a => a.id === seedState.animalNoEventsId);
  assert.ok(daisy);
  assert.equal(daisy.latest_health_event, null);
});

test('P2: health events endpoint returns normalized dates', async () => {
  const { status, body } = await get(`/animals/${seedState.animalWithDobId}/health-events`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.length >= 2);

  for (const event of body) {
    assert.match(event.date, /^\d{4}-\d{2}-\d{2}$/);
  }

  // Sorted by date DESC, so first should be 2024-02-20.
  assert.equal(body[0].date, '2024-02-20');
});
