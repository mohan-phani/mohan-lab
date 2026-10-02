import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config.js';
import type { NormalizedResponse, NormalizedError, ResponseMetadata } from '../types/salesforce.js';

export function normalizeSuccess<T>(
  data: T,
  durationMs: number,
  options: { correlationId?: string; recordCount?: number } = {}
): NormalizedResponse<T> {
  const config = getConfig();
  const metadata: ResponseMetadata = {
    correlationId: options.correlationId ?? uuidv4(),
    durationMs,
    timestamp: new Date().toISOString(),
    apiVersion: config.auth.apiVersion,
    ...(options.recordCount !== undefined ? { recordCount: options.recordCount } : {}),
  };

  return { success: true, data, metadata };
}

export function normalizeError(
  errorCode: string,
  message: string,
  options: {
    status?: number;
    detail?: string;
    correlationId?: string;
  } = {}
): NormalizedError {
  return {
    success: false,
    error: {
      status: options.status ?? 500,
      errorCode,
      message,
      detail: options.detail,
      correlationId: options.correlationId ?? uuidv4(),
      timestamp: new Date().toISOString(),
    },
  };
}

/** Convert any thrown error into a NormalizedError envelope */
export function normalizeException(
  err: unknown,
  correlationId: string
): NormalizedError {
  if (err instanceof Error) {
    const sfErr = err as Error & { errorCode?: string; statusCode?: number; status?: number };
    const errorCode = sfErr.errorCode ?? 'INTERNAL_ERROR';
    const status = sfErr.statusCode ?? sfErr.status ?? 500;
    return normalizeError(errorCode, err.message, { status, correlationId });
  }
  return normalizeError('INTERNAL_ERROR', String(err), { correlationId });
}

/** Serialise a NormalizedResponse or NormalizedError to the MCP tool content format */
export function toMcpContent(response: NormalizedResponse | NormalizedError): string {
  return JSON.stringify(response, null, 2);
}

export { uuidv4 as generateCorrelationId };
