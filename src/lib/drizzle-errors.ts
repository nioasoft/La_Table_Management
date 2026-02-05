/**
 * Utility to extract the actual PostgreSQL error from Drizzle ORM's wrapped errors.
 *
 * Drizzle 0.44.x wraps PG errors so that `error.message` contains the SQL query text
 * ("Failed query: <sql>") while the actual PG error (duplicate key, connection terminated, etc.)
 * is buried in the `.cause` chain. This helper walks that chain to find the real error.
 */

export interface DatabaseError {
  message: string;
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/**
 * Walk the error cause chain to extract the actual PostgreSQL error.
 * Returns a normalized DatabaseError with the PG error code, constraint name, etc.
 */
export function getDatabaseError(error: unknown): DatabaseError {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  // Walk the cause chain to find the actual PG error
  let current: unknown = error;
  while (current instanceof Error) {
    // pg DatabaseError has a `code` property (e.g., '23505' for unique violation)
    const pgError = current as Error & {
      code?: string;
      constraint?: string;
      detail?: string;
      table?: string;
    };

    if (pgError.code && /^\d{5}$/.test(pgError.code)) {
      return {
        message: pgError.message,
        code: pgError.code,
        constraint: pgError.constraint,
        detail: pgError.detail,
        table: pgError.table,
      };
    }

    current = (current as Error & { cause?: unknown }).cause;
  }

  // No PG error found in the chain - return the original error message
  return { message: error.message };
}

/**
 * Check if the database error is a unique constraint violation (PG code 23505)
 */
export function isUniqueViolation(error: unknown): boolean {
  return getDatabaseError(error).code === "23505";
}

/**
 * Check if the database error indicates a connection issue
 * (connection terminated, timeout, refused, etc.)
 */
export function isConnectionError(error: unknown): boolean {
  const dbError = getDatabaseError(error);
  const connectionCodes = [
    "08000", // connection_exception
    "08003", // connection_does_not_exist
    "08006", // connection_failure
    "57P01", // admin_shutdown
    "57P03", // cannot_connect_now
  ];

  if (dbError.code && connectionCodes.includes(dbError.code)) {
    return true;
  }

  // Also check for common connection error messages when no PG code is available
  const connectionPatterns = [
    "connection terminated",
    "Connection terminated",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "timeout expired",
  ];

  return connectionPatterns.some((pattern) => dbError.message.includes(pattern));
}
