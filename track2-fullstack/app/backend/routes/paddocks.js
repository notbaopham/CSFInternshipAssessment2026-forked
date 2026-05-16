const express = require('express');
const router = express.Router();
const { db } = require('../db');

function handleDbError(res, err) {
  const message = String(err && err.message ? err.message : '');
  const code = String(err && err.code ? err.code : '');
  const isConstraint = code.startsWith('SQLITE_CONSTRAINT') || message.includes('SQLITE_CONSTRAINT') || message.includes('constraint failed');
  const isUnique = code.includes('UNIQUE') || message.includes('UNIQUE');
  const isForeignKey = code.includes('FOREIGN KEY') || message.includes('FOREIGN KEY');

  if (isConstraint) {
    if (isUnique) {
      return res.status(409).json({ error: 'Resource already exists' });
    }
    if (isForeignKey) {
      return res.status(404).json({ error: 'Related record not found' });
    }
    return res.status(400).json({ error: 'Constraint violation' });
  }

  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/', (req, res) => {
  const paddocks = db.prepare('SELECT * FROM paddocks').all();
  res.json(paddocks);
});

router.post('/', (req, res) => {
  const { name, capacity } = req.body;
  if (!name || !capacity) {
    return res.status(400).json({ error: 'name and capacity are required' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO paddocks (name, capacity) VALUES (?, ?)'
    ).run(name, capacity);
    const paddock = db.prepare('SELECT * FROM paddocks WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(paddock);
  } catch (err) {
    return handleDbError(res, err);
  }
});

router.get('/:id', (req, res) => {
  const paddock = db.prepare('SELECT * FROM paddocks WHERE id = ?').get(req.params.id);
  if (!paddock) return res.status(404).json({ error: 'Paddock not found' });
  res.json(paddock);
});

module.exports = router;
