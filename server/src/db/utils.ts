/**
 * Convert an exec result (columns + values arrays, the shape both sql.js and the
 * node:sqlite compatibility layer return) to an array of objects.
 */
export function resultToObjects(
  result: { columns: string[]; values: unknown[][] }[],
): Record<string, unknown>[] {
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}
