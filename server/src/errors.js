export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Please log in') => new HttpError(401, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);
export const notFound = (msg = 'Not found', details) => new HttpError(404, msg, details);
export const conflict = (msg, details) => new HttpError(409, msg, details);

/** Parses input with a zod schema or throws a 400 with field errors. */
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw badRequest(Object.values(fields)[0] || 'Invalid input', fields);
}

// Express 5 forwards rejected promises to the error handler, so async handlers need no wrapper.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, fields: err.details });
  }
  if (err?.code === '23505') return res.status(409).json({ error: 'Already exists' }); // unique_violation
  if (err?.code === '22P02') return res.status(404).json({ error: 'Not found' }); // malformed uuid in URL
  if (err?.code === '23514') return res.status(400).json({ error: 'Invalid value' }); // check_violation
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image must be under 8 MB' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}
