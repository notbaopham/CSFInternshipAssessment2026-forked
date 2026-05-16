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

  const insertAnimal = db.prepare(
    'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
  );

  const animalIds = [];
  for (let index = 1; index <= 12; index += 1) {
    const id = insertAnimal.run(
      `Animal ${index}`,
      `TAG-${String(index).padStart(3, '0')}`,
      'Merino',
      '2021-03-14',
      index <= 6 ? northId : southId
    ).lastInsertRowid;
    animalIds.push(id);
  }

  db.prepare('UPDATE paddocks SET animal_count = animal_count + 6 WHERE id = ?').run(northId);
  db.prepare('UPDATE paddocks SET animal_count = animal_count + 6 WHERE id = ?').run(southId);

  seedState = { northId, southId, animalIds };
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

test('P1: pagination uses page numbers', async () => {
  const { status: firstStatus, body: firstPage } = await get('/animals?page=0&limit=5');
  const { status: secondStatus, body: secondPage } = await get('/animals?page=1&limit=5');

  assert.equal(firstStatus, 200);
  assert.equal(secondStatus, 200);
  assert.equal(firstPage.length, 5);
  assert.equal(secondPage.length, 5);

  const firstIds = new Set(firstPage.map(animal => animal.id));
  secondPage.forEach(animal => {
    assert.ok(!firstIds.has(animal.id));
  });
});

test('P1: pagination is deterministic', async () => {
  const { status, body } = await get('/animals?page=0&limit=5');
  assert.equal(status, 200);

  const ids = body.map(animal => animal.id);
  const sorted = [...ids].sort((a, b) => a - b);
  assert.deepEqual(ids, sorted);
});

test('P1: pagination validation rejects invalid values', async () => {
  const badPage = await get('/animals?page=-1&limit=5');
  const badLimit = await get('/animals?page=0&limit=0');

  assert.equal(badPage.status, 400);
  assert.equal(badLimit.status, 400);
});

test('P1: paddock validations and status codes', async () => {
  const badCapacity = await post('/paddocks', { name: 'Bad', capacity: 0 });
  assert.equal(badCapacity.status, 400);

  const badPaddock = await post('/animals', {
    name: 'Bad Paddock',
    tag_number: 'TAG-999',
    paddock_id: 999999,
  });
  assert.equal(badPaddock.status, 404);

  const goodPaddock = await post('/animals', {
    name: 'Good Paddock',
    tag_number: 'TAG-998',
    paddock_id: seedState.northId,
  });
  assert.equal(goodPaddock.status, 201);
});
