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

module.exports = { handleDbError };
