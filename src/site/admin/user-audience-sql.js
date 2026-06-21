export function appendStartPayloadFilters({ filters, params, clauses, alias = 'u' }) {
  if (filters.hasStartPayload === 'yes') {
    clauses.push(`(
      COALESCE(${alias}.start_payload, '') <> ''
      OR EXISTS (SELECT 1 FROM user_start_payloads usp WHERE usp.user_id = ${alias}.id)
    )`);
  } else if (filters.hasStartPayload === 'no') {
    clauses.push(`(
      COALESCE(${alias}.start_payload, '') = ''
      AND NOT EXISTS (SELECT 1 FROM user_start_payloads usp WHERE usp.user_id = ${alias}.id)
    )`);
  }

  if (filters.startPayload) {
    params.push(`%${filters.startPayload}%`);
    const idx = params.length;
    clauses.push(`(
      ${alias}.start_payload ILIKE $${idx}
      OR EXISTS (
        SELECT 1 FROM user_start_payloads usp
        WHERE usp.user_id = ${alias}.id AND usp.payload ILIKE $${idx}
      )
    )`);
  }
}

export function parseStartPayloadFilters(query = {}) {
  return {
    startPayload: String(query.start_payload ?? '').trim(),
    hasStartPayload: ['yes', 'no'].includes(query.has_start_payload) ? query.has_start_payload : '',
  };
}
