// Shared, sanitized error types for the response codes the operation contracts define
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

export class InsufficientStockError extends Error {
  constructor(remaining) {
    super('Not enough stock remaining.');
    this.name = 'InsufficientStockError';
    this.code = 'insufficient_stock';
    this.detail = { remaining };
  }
}

// The `ambiguous` code the operation contract reserves for exactly this case (TASKS.md /
// D-082): a destructive operation whose safety depends on a classification the bridge cannot
// prove without data it doesn't have (INGREDIENT_DB). Fail safe rather than guess — see
// operations/inventory.js's classifyStaple().
export class AmbiguousError extends Error {
  constructor(message, detail) {
    super(message || 'Cannot safely determine how to apply this operation.');
    this.name = 'AmbiguousError';
    this.code = 'ambiguous';
    this.detail = detail;
  }
}

// A request body that failed to even parse as JSON — distinct from a well-formed JSON body that
// fails domain/schema validation (ValidationError, 422). TASK-065's contract requires malformed
// JSON specifically to be 400.
export class MalformedBodyError extends Error {
  constructor(message) {
    super(message || 'Request body must be valid JSON.');
    this.name = 'MalformedBodyError';
    this.code = 'validation_failed';
  }
}
