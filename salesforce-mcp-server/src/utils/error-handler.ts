import { CircuitOpenError } from '../guardrails/circuit-breaker.js';
import { normalizeError, normalizeException } from './response-normalizer.js';
import type { NormalizedError } from '../types/salesforce.js';

/**
 * Central error translator — maps thrown errors to normalised RFC-7807 envelopes.
 * Call from every tool's catch block.
 */
export function handleToolError(err: unknown, correlationId: string): NormalizedError {
  // Circuit open — 503
  if (err instanceof CircuitOpenError) {
    return normalizeError('CIRCUIT_BREAKER_OPEN', err.message, {
      status: 503,
      detail: 'The Salesforce connection is temporarily unavailable. Retry after the reset timeout.',
      correlationId,
    });
  }

  if (err instanceof Error) {
    const sfErr = err as Error & {
      errorCode?: string;
      statusCode?: number;
      status?: number;
      fields?: string[];
    };

    // SOQL validation
    if (sfErr.errorCode === 'QUERY_INJECTION_DETECTED' || sfErr.errorCode === 'QUERY_COMPLEXITY_EXCEEDED') {
      return normalizeError(sfErr.errorCode, err.message, { status: 400, correlationId });
    }

    // Salesforce API errors
    if (sfErr.errorCode) {
      const status = mapSfErrorCodeToStatus(sfErr.errorCode);
      return normalizeError(sfErr.errorCode, err.message, {
        status,
        detail: sfErr.fields?.length ? `Fields: ${sfErr.fields.join(', ')}` : undefined,
        correlationId,
      });
    }

    // Auth errors
    if (err.message.includes('authentication') || err.message.includes('INVALID_SESSION_ID')) {
      return normalizeError('AUTH_ERROR', 'Authentication failed or session expired', {
        status: 401,
        detail: err.message,
        correlationId,
      });
    }

    // Connectivity / timeout
    if (
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ECONNRESET') ||
      err.message.includes('ENOTFOUND')
    ) {
      return normalizeError('CONNECTIVITY_ERROR', 'Could not reach Salesforce', {
        status: 503,
        detail: err.message,
        correlationId,
      });
    }
  }

  return normalizeException(err, correlationId);
}

function mapSfErrorCodeToStatus(errorCode: string): number {
  const map: Record<string, number> = {
    INVALID_FIELD: 400,
    INVALID_QUERY_FILTER_OPERATOR: 400,
    MALFORMED_QUERY: 400,
    INVALID_CROSS_REFERENCE_KEY: 400,
    REQUIRED_FIELD_MISSING: 400,
    FIELD_CUSTOM_VALIDATION_EXCEPTION: 422,
    DUPLICATE_VALUE: 409,
    ENTITY_IS_LOCKED: 409,
    INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY: 403,
    INSUFFICIENT_ACCESS_OR_READONLY: 403,
    CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY: 403,
    INVALID_SESSION_ID: 401,
    NOT_FOUND: 404,
    ENTITY_IS_DELETED: 404,
    REQUEST_LIMIT_EXCEEDED: 429,
    QUERY_TIMEOUT: 504,
    SERVER_UNAVAILABLE: 503,
  };
  return map[errorCode] ?? 500;
}

/**
 * Creates a typed error to throw from validation code so it's caught
 * by handleToolError as a known code.
 */
export function createValidationError(errorCode: string, message: string): Error {
  const err = new Error(message) as Error & { errorCode: string };
  err.errorCode = errorCode;
  return err;
}
