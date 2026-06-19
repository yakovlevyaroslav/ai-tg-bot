function escapeCell(value) {
  if (value == null) {
    return '';
  }

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** Строит CSV (UTF-8 с BOM для Excel) */
export function buildCsv(columns, rows) {
  const header = columns.map((col) => escapeCell(col.label)).join(',');
  const body = rows.map((row) =>
    columns.map((col) => escapeCell(row[col.key])).join(','),
  );
  return `\uFEFF${[header, ...body].join('\n')}\n`;
}

export function csvFilename(base, filters = {}) {
  const stamp = new Date().toISOString().slice(0, 10);
  const parts = [base, stamp];

  if (filters.dateFrom && filters.dateTo) {
    parts.push(`${filters.dateFrom}_${filters.dateTo}`);
  } else if (filters.days === 0) {
    parts.push('all');
  } else if (filters.days) {
    parts.push(`${filters.days}d`);
  }

  return `${parts.join('_')}.csv`;
}
