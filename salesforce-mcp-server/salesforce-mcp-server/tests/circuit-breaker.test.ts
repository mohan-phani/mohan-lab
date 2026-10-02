/**
 * Tests for the in-memory circuit breaker.
 * Verifies state transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
 */

jest.mock('../src/config', () => ({
  getConfig: () => ({
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 500, halfOpenMaxCalls: 2 },
    auth: { apiVersion: '62.0' },
    query: { maxLength: 10000, complexityThreshold: 8 },
    cache: { globalDescribeTtl: 300, schemaTtl: 300, limitsTtl: 60 },
    logging: { level: 'error', transport: 'console', filePath: '' },
    http: { port: 3000, host: '0.0.0.0' },
  }),
}));

import { CircuitBreaker, CircuitOpenError } from '../src/guardrails/circuit-breaker';

function connectivityError(): Error {
  const err = new Error('Connection refused') as Error & { errorCode: string };
  err.errorCode = 'ECONNREFUSED';
  return err;
}

function appError(): Error {
  // Application-level error — should NOT trip the breaker
  const err = new Error('INVALID_FIELD') as Error & { errorCode: string };
  err.errorCode = 'INVALID_FIELD';
  return err;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CircuitBreaker — CLOSED state', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 500, halfOpenMaxCalls: 2 });
  });

  test('starts in CLOSED state', () => {
    expect(cb.getStats().state).toBe('CLOSED');
    expect(cb.getStats().failures).toBe(0);
  });

  test('executes successful operations', async () => {
    const result = await cb.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(cb.getStats().failures).toBe(0);
  });

  test('passes through non-connectivity errors without tripping', async () => {
    await expect(cb.execute(() => Promise.reject(appError()))).rejects.toThrow('INVALID_FIELD');
    expect(cb.getStats().state).toBe('CLOSED');
    expect(cb.getStats().failures).toBe(0);
  });

  test('counts connectivity failures', async () => {
    await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    expect(cb.getStats().failures).toBe(1);
    expect(cb.getStats().state).toBe('CLOSED');
  });

  test('resets consecutive failure count on success', async () => {
    await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    expect(cb.getStats().failures).toBe(2);

    // A success resets the counter
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStats().failures).toBe(0);
  });
});

describe('CircuitBreaker — OPEN state', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 500, halfOpenMaxCalls: 2 });
  });

  async function tripBreaker(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    }
  }

  test('trips to OPEN after reaching failure threshold', async () => {
    await tripBreaker();
    expect(cb.getStats().state).toBe('OPEN');
  });

  test('rejects calls immediately when OPEN without calling the function', async () => {
    await tripBreaker();
    const fn = jest.fn(() => Promise.resolve('should not be called'));
    await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  test('throws CircuitOpenError with isCircuitOpen flag', async () => {
    await tripBreaker();
    try {
      await cb.execute(() => Promise.resolve('x'));
      fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).isCircuitOpen).toBe(true);
    }
  });

  test('tracks total calls and failures in stats', async () => {
    await tripBreaker();
    const stats = cb.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.totalFailures).toBe(3);
    expect(stats.lastFailureAt).toBeInstanceOf(Date);
  });
});

describe('CircuitBreaker — HALF_OPEN state', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100, halfOpenMaxCalls: 2 });
  });

  async function tripAndWait(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    }
    // Wait for reset timeout to elapse
    await delay(150);
  }

  test('transitions to HALF_OPEN after reset timeout', async () => {
    await tripAndWait();
    // Trigger the state check by attempting a call
    try {
      await cb.execute(() => Promise.resolve('probe'));
    } catch {
      // Might succeed or fail — what matters is state
    }
    // After the timeout elapses, the breaker should have moved to HALF_OPEN or CLOSED
    expect(['HALF_OPEN', 'CLOSED']).toContain(cb.getStats().state);
  });

  test('closes circuit when probe succeeds', async () => {
    await tripAndWait();
    await cb.execute(() => Promise.resolve('probe succeeded'));
    expect(cb.getStats().state).toBe('CLOSED');
    expect(cb.getStats().failures).toBe(0);
  });

  test('reopens circuit when probe fails', async () => {
    await tripAndWait();
    // Probe fails — reopen
    await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    expect(cb.getStats().state).toBe('OPEN');
  });

  test('limits concurrent probe calls in HALF_OPEN', async () => {
    await tripAndWait();

    // First probe — transitions state
    const probe1 = cb.execute(() => delay(200).then(() => 'slow-probe'));
    // Second probe — allowed (halfOpenMaxCalls = 2)
    const probe2 = cb.execute(() => Promise.resolve('fast-probe'));
    // Third probe — should be rejected (limit exceeded)
    await expect(cb.execute(() => Promise.resolve('too-many'))).rejects.toThrow(CircuitOpenError);

    // Clean up
    await Promise.allSettled([probe1, probe2]);
  });
});

describe('CircuitBreaker — reset', () => {
  test('manual reset returns breaker to CLOSED', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(connectivityError()))).rejects.toThrow();
    }
    expect(cb.getStats().state).toBe('OPEN');
    cb.reset();
    expect(cb.getStats().state).toBe('CLOSED');
    expect(cb.getStats().failures).toBe(0);
  });
});

describe('CircuitBreaker — error classification', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 });
  });

  const countedCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'CONNECTIVITY_ERROR', 'TIMEOUT'];
  const ignoredCodes = ['INVALID_FIELD', 'DUPLICATE_VALUE', 'REQUIRED_FIELD_MISSING', 'INVALID_CROSS_REFERENCE_KEY'];

  test.each(countedCodes)('counts %s toward threshold', async (code) => {
    const err = new Error(code) as Error & { errorCode: string };
    err.errorCode = code;
    await expect(cb.execute(() => Promise.reject(err))).rejects.toThrow();
    expect(cb.getStats().failures).toBe(1);
  });

  test.each(ignoredCodes)('ignores %s (application error)', async (code) => {
    const err = new Error(code) as Error & { errorCode: string };
    err.errorCode = code;
    await expect(cb.execute(() => Promise.reject(err))).rejects.toThrow();
    expect(cb.getStats().failures).toBe(0);
  });
});
