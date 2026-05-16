const express = require('express');
const router = express.Router();
const { db, withTransaction } = require('../db');
const { handleDbError } = require('../db-errors');

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

router.get('/', (req, res) => {
  const page = req.query.page === undefined ? 0 : parseInteger(req.query.page);
  const limit = req.query.limit === undefined ? 10 : parseInteger(req.query.limit);

  if (page === null || page < 0 || limit === null || limit <= 0 || limit > 100) {
    return res.status(400).json({ error: 'page must be >= 0 and limit must be between 1 and 100' });
  }

  const offset = page * limit;

  const animals = db.prepare(`
    WITH latest_events AS (
      SELECT
        he.id,
        he.animal_id,
        he.event_type,
        he.notes,
        strftime('%Y-%m-%d', he.date) AS date,
        he.vet_name,
        ROW_NUMBER() OVER (
          PARTITION BY he.animal_id
          ORDER BY he.date DESC, he.id DESC
        ) AS row_num
      FROM health_events he
    )
    SELECT
      a.id,
      a.name,
      a.tag_number,
      a.breed,
      strftime('%Y-%m-%d', a.date_of_birth) AS date_of_birth,
      a.paddock_id,
      le.id AS latest_event_id,
      le.animal_id AS latest_event_animal_id,
      le.event_type AS latest_event_type,
      le.notes AS latest_event_notes,
      le.date AS latest_event_date,
      le.vet_name AS latest_event_vet_name
    FROM animals a
    LEFT JOIN latest_events le
      ON le.animal_id = a.id
      AND le.row_num = 1
    ORDER BY a.id ASC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const result = animals.map(({ 
    latest_event_id,
    latest_event_animal_id,
    latest_event_type,
    latest_event_notes,
    latest_event_date,
    latest_event_vet_name,
    ...animal
  }) => {
    const latestEvent = latest_event_id
      ? {
          id: latest_event_id,
          animal_id: latest_event_animal_id,
          event_type: latest_event_type,
          notes: latest_event_notes,
          date: latest_event_date,
          vet_name: latest_event_vet_name,
        }
      : null;
    return { ...animal, latest_health_event: latestEvent };
  });

  res.json(result);
});

router.post('/', (req, res) => {
  const { name, tag_number, breed, date_of_birth, paddock_id } = req.body;

  if (!name || !tag_number) {
    return res.status(400).json({ error: 'name and tag_number are required' });
  }

  if (date_of_birth !== undefined && date_of_birth !== null && !isValidIsoDate(date_of_birth)) {
    return res.status(400).json({ error: 'date_of_birth must be in YYYY-MM-DD format' });
  }

  const normalizedPaddockId = paddock_id === undefined || paddock_id === null
    ? null
    : parseInteger(paddock_id);

  if (paddock_id !== undefined && paddock_id !== null && (normalizedPaddockId === null || normalizedPaddockId <= 0)) {
    return res.status(400).json({ error: 'paddock_id must be a positive integer' });
  }

  if (normalizedPaddockId !== null) {
    const paddock = db.prepare('SELECT id FROM paddocks WHERE id = ?').get(normalizedPaddockId);
    if (!paddock) {
      return res.status(404).json({ error: 'Paddock not found' });
    }
  }

  try {
    let animalId;
    withTransaction(() => {
      const result = db.prepare(
        'INSERT INTO animals (name, tag_number, breed, date_of_birth, paddock_id) VALUES (?, ?, ?, ?, ?)'
      ).run(name, tag_number, breed ?? null, date_of_birth ?? null, normalizedPaddockId);
      animalId = result.lastInsertRowid;

      if (normalizedPaddockId) {
        db.prepare(
          'UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?'
        ).run(normalizedPaddockId);
      }
    });

    const animal = db.prepare(`
      SELECT id, name, tag_number, breed, strftime('%Y-%m-%d', date_of_birth) AS date_of_birth, paddock_id
      FROM animals WHERE id = ?
    `).get(animalId);
    return res.status(201).json(animal);
  } catch (err) {
    return handleDbError(res, err);
  }
});

router.get('/:id', (req, res) => {
  const animal = db.prepare(`
    SELECT id, name, tag_number, breed, strftime('%Y-%m-%d', date_of_birth) AS date_of_birth, paddock_id
    FROM animals WHERE id = ?
  `).get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });
  res.json(animal);
});

router.put('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  let normalizedPaddockId = animal.paddock_id;
  if ('paddock_id' in req.body) {
    if (req.body.paddock_id === null) {
      normalizedPaddockId = null;
    } else {
      const parsed = parseInteger(req.body.paddock_id);
      if (parsed === null || parsed <= 0) {
        return res.status(400).json({ error: 'paddock_id must be a positive integer' });
      }
      const paddock = db.prepare('SELECT id FROM paddocks WHERE id = ?').get(parsed);
      if (!paddock) {
        return res.status(404).json({ error: 'Paddock not found' });
      }
      normalizedPaddockId = parsed;
    }
  }

  const updates = {
    name:          req.body.name          ?? animal.name,
    tag_number:    req.body.tag_number    ?? animal.tag_number,
    breed:         req.body.breed         ?? animal.breed,
    date_of_birth: req.body.date_of_birth ?? animal.date_of_birth,
    paddock_id:    normalizedPaddockId,
  };

  if ('date_of_birth' in req.body && req.body.date_of_birth !== null) {
    if (!isValidIsoDate(req.body.date_of_birth)) {
      return res.status(400).json({ error: 'date_of_birth must be in YYYY-MM-DD format' });
    }
  }

  try {
    withTransaction(() => {
      db.prepare(`
        UPDATE animals
        SET name = ?, tag_number = ?, breed = ?, date_of_birth = ?, paddock_id = ?
        WHERE id = ?
      `).run(updates.name, updates.tag_number, updates.breed, updates.date_of_birth, updates.paddock_id, req.params.id);

      if (updates.paddock_id !== animal.paddock_id) {
        if (animal.paddock_id) {
          db.prepare(
            'UPDATE paddocks SET animal_count = animal_count - 1 WHERE id = ?'
          ).run(animal.paddock_id);
        }
        if (updates.paddock_id) {
          db.prepare(
            'UPDATE paddocks SET animal_count = animal_count + 1 WHERE id = ?'
          ).run(updates.paddock_id);
        }
      }
    });

    const updated = db.prepare(`
      SELECT id, name, tag_number, breed, strftime('%Y-%m-%d', date_of_birth) AS date_of_birth, paddock_id
      FROM animals WHERE id = ?
    `).get(req.params.id);
    return res.json(updated);
  } catch (err) {
    return handleDbError(res, err);
  }
});

router.delete('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  try {
    withTransaction(() => {
      const deleteResult = db.prepare('DELETE FROM animals WHERE id = ?').run(req.params.id);

      if (deleteResult.changes && animal.paddock_id) {
        db.prepare(
          'UPDATE paddocks SET animal_count = animal_count - 1 WHERE id = ?'
        ).run(animal.paddock_id);
      }
    });
    return res.json({ message: 'deleted' });
  } catch (err) {
    return handleDbError(res, err);
  }
});

router.get('/:id/health-events', (req, res) => {
  const animal = db.prepare('SELECT id FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const events = db.prepare(
    `SELECT id, animal_id, event_type, notes, strftime('%Y-%m-%d', date) AS date, vet_name
     FROM health_events
     WHERE animal_id = ?
     ORDER BY date DESC`
  ).all(req.params.id);
  res.json(events);
});

router.post('/:id/health-events', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const { event_type, notes, date, vet_name } = req.body;
  if (!event_type || !date) {
    return res.status(400).json({ error: 'event_type and date are required' });
  }

  if (!isValidIsoDate(date)) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  try {
    const result = db.prepare(
      'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.id, event_type, notes ?? null, date, vet_name ?? null);

    const event = db.prepare(
      `SELECT id, animal_id, event_type, notes, strftime('%Y-%m-%d', date) AS date, vet_name
       FROM health_events WHERE id = ?`
    ).get(result.lastInsertRowid);
    return res.status(201).json(event);
  } catch (err) {
    return handleDbError(res, err);
  }
});

router.post('/:id/weights', (req, res) => {
  const { weight_kg, date, notes } = req.body;

  const parsedWeight = parseNumber(weight_kg);
  if (parsedWeight === null || parsedWeight <= 0) {
    return res.status(422).json({ error: 'weight_kg must be a positive number' });
  }

  if (!date) {
    return res.status(400).json({ error: 'date is required' });
  }
  if (!isValidIsoDate(date)) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return res.status(400).json({ error: 'notes must be a string' });
  }

  try {
    let weightId;
    withTransaction(() => {
      const animal = db.prepare('SELECT id FROM animals WHERE id = ?').get(req.params.id);
      if (!animal) {
        const err = new Error('Animal not found');
        err.statusCode = 404;
        throw err;
      }

      const result = db.prepare(
        'INSERT INTO weights (animal_id, weight_kg, date, notes) VALUES (?, ?, ?, ?)'
      ).run(req.params.id, parsedWeight, date, notes ?? null);

      weightId = result.lastInsertRowid;
    });

    const weight = db.prepare(
      `SELECT id, animal_id, weight_kg, strftime('%Y-%m-%d', date) AS date, notes
       FROM weights
       WHERE id = ?`
    ).get(weightId);

    return res.status(201).json(weight);
  } catch (err) {
    if (err && err.statusCode === 404) {
      return res.status(404).json({ error: 'Animal not found' });
    }
    return handleDbError(res, err);
  }
});

router.get('/:id/weights', (req, res) => {
  const animal = db.prepare('SELECT id FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const weights = db.prepare(
    `SELECT id, animal_id, weight_kg, strftime('%Y-%m-%d', date) AS date, notes
     FROM weights
     WHERE animal_id = ?
     ORDER BY date DESC, id DESC`
  ).all(req.params.id);

  return res.json(weights);
});

module.exports = router;
