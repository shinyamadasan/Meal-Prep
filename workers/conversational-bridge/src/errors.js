// Shared, sanitized error types for the four response codes the operation contract defines
// that aren't already covered by auth.js (UnauthorizedError) or firestore.js
// (RevisionConflictError, InfrastructureError). Every error here carries only what's safe to
// hand back to the caller — no stack traces, no secrets, ever (index.js enforces that boundary).

export class NotFoundError extends Error {
  constructor(message) {
    super(message || 'Record not found.');
    this.name = 'NotFoundError';
    this.code = 'not_found';
  }
}

export class ValidationError extends Error {
  constructor(message, detail) {
    super(message || 'Request failed validation.');
    this.name = 'ValidationError';
    this.code = 'validation_failed';
    this.detail = detail;
  }
}

export class InsufficientServingsError extends Error {
  constructor(remaining) {
    super('Not enough servings remaining.');
    this.name = 'InsufficientServingsError';
    this.code = 'insufficient_servings';
    this.detail = { remaining };
  }
}
