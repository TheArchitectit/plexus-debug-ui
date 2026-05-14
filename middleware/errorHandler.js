export function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  const isClientError = status >= 400 && status < 500;
  const message = isClientError
    ? (err.message || 'Bad request')
    : 'Internal server error';
  res.status(status).json({ error: message, partial: err.partial || false });
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
