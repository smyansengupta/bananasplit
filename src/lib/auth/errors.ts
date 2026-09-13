/** The requested resource doesn't exist, or the caller has no business knowing it does. */
export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The caller is known (authenticated, often a member) but lacks permission for this action. */
export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
