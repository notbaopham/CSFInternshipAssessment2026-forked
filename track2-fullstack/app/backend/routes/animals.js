const express = require('express');
const router = express.Router();
const { db, withTransaction } = require('../db');
const { handleDbError } = require('../db-errors');

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

router.get('/', (req, res) => {
  const page = req.query.page === undefined ? 0 : parseInteger(req.query.page);
  const limit = req.query.limit === undefined ? 10 : parseInteger(req.query.limit);

  if (page === null || page < 0 || limit === null || limit <= 0 || limit > 100) {
    return res.status(400).json({ error: 'page must be >= 0 and limit must be between 1 and 100' });
  }

  const offset = page * limit;

  const animals = db.prepare(
    'SELECT * FROM animals ORDER BY id ASC LIMIT ? OFFSET ?'
  ).all(limit, offset);

  const result = animals.map(animal => {
    const latestEvent = db.prepare(`
      SELECT * FROM health_events
      WHERE animal_id = ?
      ORDER BY date DESC
      LIMIT 1
    `).get(animal.id);
    return { ...animal, latest_health_event: latestEvent ?? null };
  });

  res.json(result);
});

router.post('/', (req, res) => {
  const { name, tag_number, breed, date_of_birth, paddock_id } = req.body;

  if (!name || !tag_number) {
    return res.status(400).json({ error: 'name and tag_number are required' });
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

    const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(animalId);
    return res.json(animal);
  } catch (err) {
    return handleDbError(res, err);
  }
});

router.get('/:id', (req, res) => {
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
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

    const updated = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
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
  const animal = db.prepare('SELECT * FROM animals WHERE id = ?').get(req.params.id);
  if (!animal) return res.status(404).json({ error: 'Animal not found' });

  const events = db.prepare(
    'SELECT * FROM health_events WHERE animal_id = ? ORDER BY date DESC'
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

  try {
    const result = db.prepare(
      'INSERT INTO health_events (animal_id, event_type, notes, date, vet_name) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.id, event_type, notes ?? null, date, vet_name ?? null);

    const event = db.prepare('SELECT * FROM health_events WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(event);
  } catch (err) {
    return handleDbError(res, err);
  }
});

module.exports = router;
