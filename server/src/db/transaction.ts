import type { Database } from 'sql.js';

const depthMap = new WeakMap<Database, number>();

function setDepth(db: Database, depth: number): void {
  if (depth === 0) {
    depthMap.delete(db);
    return;
  }

  depthMap.set(db, depth);
}

export function withTransaction<T>(db: Database, fn: () => T): T {
  const depth = depthMap.get(db) ?? 0;
  const isNested = depth > 0;
  const savepointName = `sp_${depth}`;

  if (isNested) {
    db.run(`SAVEPOINT ${savepointName}`);
  } else {
    db.run('BEGIN');
  }

  setDepth(db, depth + 1);

  try {
    const result = fn();

    if (isNested) {
      db.run(`RELEASE ${savepointName}`);
    } else {
      db.run('COMMIT');
    }

    setDepth(db, depth);
    return result;
  } catch (error) {
    try {
      if (isNested) {
        db.run(`ROLLBACK TO ${savepointName}`);
        db.run(`RELEASE ${savepointName}`);
      } else {
        db.run('ROLLBACK');
      }
    } finally {
      setDepth(db, depth);
    }

    throw error;
  }
}
