/**
 * Tests for the response normalizer.
 * Verifies the NormalizedResponse and NormalizedError envelopes.
 */

jest.mock('../src/config', () => ({
  getConfig: () => ({
    auth: { apiVersion: '62.0' },
    circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 },
    query: { maxLength: 10000, complexityThreshold: 8 },
    cache: { globalDescribeTtl: 300, schemaTtl: 300, limitsTtl: 60 },
    logging: { level: 'error', transport: 'console', filePath: '' },
    http: { port: 3000, host: '0.0.0.0' },
  }),
}));

import {
  normalizeSuccess,
  normalizeError,
  normalizeException,
  toMcpContent,
} from '../src/utils/response-normalizer';

const CORRELATION_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('normalizeSuccess', () => {
  test('returns success: true envelope', () => {
    const result = normalizeSuccess({ Id: '001', Name: 'Acme' }, 123, { correlationId: CORRELATION_ID });
    expect(result.success).toBe(true);
  });

  test('includes data payload', () => {
    const payload = { Id: '001', Name: 'Acme' };
    const result = normalizeSuccess(payload, 100, { correlationId: CORRELATION_ID });
    expect(result.data).toEqual(payload);
  });

  test('includes metadata with correlationId, durationMs, timestamp, apiVersion', () => {
    const result = normalizeSuccess({}, 250, { correlationId: CORRELATION_ID });
    expect(result.metadata.correlationId).toBe(CORRELATION_ID);
    expect(result.metadata.durationMs).toBe(250);
    expect(result.metadata.apiVersion).toBe('62.0');
    expect(new Date(result.metadata.timestamp)).toBeInstanceOf(Date);
  });

  test('includes recordCount when provided', () => {
    const result = normalizeSuccess([], 50, { correlationId: CORRELATION_ID, recordCount: 42 });
    expect(result.metadata.recordCount).toBe(42);
  });

  test('omits recordCount when not provided', () => {
    const result = normalizeSuccess({}, 10, { correlationId: CORRELATION_ID });
    expect(result.metadata.recordCount).toBeUndefined();
  });

  test('generates a correlationId when none is provided', () => {
    const result = normalizeSuccess({}, 10);
    expect(result.metadata.correlationId).toBeTruthy();
    expect(result.metadata.correlationId.length).toBeGreaterThan(10);
  });

  test('handles null data', () => {
    const result = normalizeSuccess(null, 0, { correlationId: CORRELATION_ID });
    expect(result.data).toBeNull();
  });

  test('handles array data', () => {
    const arr = [1, 2, 3];
    const result = normalizeSuccess(arr, 0, { correlationId: CORRELATION_ID });
    expect(result.data).toEqual(arr);
  });
});

describe('normalizeError', () => {
  test('returns success: false envelope', () => {
    const result = normalizeError('TEST_ERROR', 'Something went wrong', { correlationId: CORRELATION_ID });
    expect(result.success).toBe(false);
  });

  test('includes error details', () => {
    const result = normalizeError('INVALID_FIELD', 'Field not found', {
      status: 400,
      detail: 'The field XYZ does not exist',
      correlationId: CORRELATION_ID,
    });
    expect(result.error.errorCode).toBe('INVALID_FIELD');
    expect(result.error.message).toBe('Field not found');
    expect(result.error.status).toBe(400);
    expect(result.error.detail).toBe('The field XYZ does not exist');
    expect(result.error.correlationId).toBe(CORRELATION_ID);
  });

  test('defaults status to 500', () => {
    const result = normalizeError('INTERNAL_ERROR', 'Unexpected error', { correlationId: CORRELATION_ID });
    expect(result.error.status).toBe(500);
  });

  test('includes timestamp', () => {
    const result = normalizeError('X', 'msg', { correlationId: CORRELATION_ID });
    expect(new Date(result.error.timestamp)).toBeInstanceOf(Date);
  });

  test('generates a correlationId when none provided', () => {
    const result = normalizeError('X', 'msg');
    expect(result.error.correlationId).toBeTruthy();
  });

  test('omits detail when not provided', () => {
    const result = normalizeError('X', 'msg', { correlationId: CORRELATION_ID });
    expect(result.error.detail).toBeUndefined();
  });
});

describe('normalizeException', () => {
  test('handles standard Error with errorCode', () => {
    const err = new Error('Field not found') as Error & { errorCode: string; statusCode: number };
    err.errorCode = 'INVALID_FIELD';
    err.statusCode = 400;
    const result = normalizeException(err, CORRELATION_ID);
    expect(result.success).toBe(false);
    expect(result.error.errorCode).toBe('INVALID_FIELD');
    expect(result.error.status).toBe(400);
  });

  test('handles standard Error without errorCode', () => {
    const err = new Error('Something broke');
    const result = normalizeException(err, CORRELATION_ID);
    expect(result.error.errorCode).toBe('INTERNAL_ERROR');
    expect(result.error.message).toBe('Something broke');
    expect(result.error.status).toBe(500);
  });

  test('handles non-Error thrown values', () => {
    const result = normalizeException('just a string error', CORRELATION_ID);
    expect(result.error.errorCode).toBe('INTERNAL_ERROR');
    expect(result.error.message).toContain('just a string error');
  });

  test('sets provided correlationId', () => {
    const result = normalizeException(new Error('x'), CORRELATION_ID);
    expect(result.error.correlationId).toBe(CORRELATION_ID);
  });
});

describe('toMcpContent', () => {
  test('serialises NormalizedResponse as pretty-printed JSON string', () => {
    const response = normalizeSuccess({ Id: '001' }, 100, { correlationId: CORRELATION_ID });
    const content = toMcpContent(response);
    expect(typeof content).toBe('string');
    const parsed = JSON.parse(content);
    expect(parsed.success).toBe(true);
    expect(parsed.data.Id).toBe('001');
  });

  test('serialises NormalizedError as pretty-printed JSON string', () => {
    const error = normalizeError('X', 'msg', { correlationId: CORRELATION_ID });
    const content = toMcpContent(error);
    const parsed = JSON.parse(content);
    expect(parsed.success).toBe(false);
    expect(parsed.error.errorCode).toBe('X');
  });

  test('output is valid JSON', () => {
    const response = normalizeSuccess([1, 2, 3], 10, { correlationId: CORRELATION_ID });
    expect(() => JSON.parse(toMcpContent(response))).not.toThrow();
  });
});

describe('RFC 7807 compliance', () => {
  test('error envelope contains all RFC 7807 fields', () => {
    const result = normalizeError('NOT_FOUND', 'Record not found', {
      status: 404,
      detail: 'Account with ID 001xxx does not exist',
      correlationId: CORRELATION_ID,
    });

    // RFC 7807 required: status, title (errorCode), detail
    expect(result.error).toHaveProperty('status');
    expect(result.error).toHaveProperty('errorCode');
    expect(result.error).toHaveProperty('message');
    expect(result.error).toHaveProperty('detail');
    // Extensions
    expect(result.error).toHaveProperty('correlationId');
    expect(result.error).toHaveProperty('timestamp');
  });

  test('success and error are mutually exclusive via success discriminant', () => {
    const ok = normalizeSuccess({}, 0, { correlationId: CORRELATION_ID });
    const err = normalizeError('X', 'y', { correlationId: CORRELATION_ID });
    expect(ok.success).toBe(true);
    expect(err.success).toBe(false);
    expect('data' in ok).toBe(true);
    expect('error' in err).toBe(true);
    expect('data' in err).toBe(false);
    expect('error' in ok).toBe(false);
  });
});
