import { getConfig } from '../config.js';
import type { CircuitState, CircuitBreakerStats } from '../types/salesforce.js';

// Failure types that count toward the circuit breaker threshold
const COUNTED_FAILURE_CODES = new Set([
  'CONNECTIVITY_ERROR',
  'TIMEOUT',
  'REQUEST_RUNNING_TOO_LONG',
  'SERVER_UNAVAILABLE',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private halfOpenCallCount = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private totalCalls = 0;
  private totalFailures = 0;
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;

  constructor(overrides?: { failureThreshold?: number; resetTimeoutMs?: number; halfOpenMaxCalls?: number }) {
    const config = getConfig();
    this.failureThreshold = overrides?.failureThreshold ?? config.circuitBreaker.failureThreshold;
    this.resetTimeoutMs = overrides?.resetTimeoutMs ?? config.circuitBreaker.resetTimeoutMs;
    this.halfOpenMaxCalls = overrides?.halfOpenMaxCalls ?? config.circuitBreaker.halfOpenMaxCalls;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError immediately if OPEN and timeout hasn't elapsed.
   */
  async execute<T>(fn: () => Promise<T>, operationName = 'operation'): Promise<T> {
    this.transitionIfReady();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(
        `Circuit breaker is OPEN for ${operationName}. ` +
          `Consecutive failures: ${this.consecutiveFailures}. ` +
          `Auto-reset in ${this.msUntilReset()} ms.`
      );
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenCallCount >= this.halfOpenMaxCalls) {
        throw new CircuitOpenError(
          `Circuit breaker is HALF-OPEN probe limit reached for ${operationName}.`
        );
      }
      this.halfOpenCallCount++;
    }

    this.totalCalls++;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err: unknown) {
      this.onFailure(err);
      throw err;
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  /** Manually reset the circuit (e.g. after a config change or deployment) */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.halfOpenCallCount = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
  }

  private transitionIfReady(): void {
    if (this.state === 'OPEN' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenCallCount = 0;
      }
    }
  }

  private onSuccess(): void {
    this.lastSuccessAt = new Date();
    if (this.state === 'HALF_OPEN') {
      // Probe succeeded — close the circuit
      this.state = 'CLOSED';
      this.consecutiveFailures = 0;
      this.openedAt = null;
    } else {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(err: unknown): void {
    const errorCode = extractErrorCode(err);
    this.totalFailures++;
    this.lastFailureAt = new Date();

    if (!COUNTED_FAILURE_CODES.has(errorCode)) {
      // Application-level error (e.g. INVALID_FIELD) — don't trip the breaker
      return;
    }

    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN') {
      // Probe failed — reopen
      this.tripOpen();
    } else if (this.consecutiveFailures >= this.failureThreshold) {
      this.tripOpen();
    }
  }

  private tripOpen(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
  }

  private msUntilReset(): number {
    if (this.openedAt === null) return this.resetTimeoutMs;
    return Math.max(0, this.resetTimeoutMs - (Date.now() - this.openedAt));
  }
}

function extractErrorCode(err: unknown): string {
  if (err instanceof Error) {
    // jsforce errors carry errorCode
    const sfErr = err as Error & { errorCode?: string; code?: string; name?: string };
    if (sfErr.errorCode) return sfErr.errorCode;
    if (sfErr.code) return sfErr.code;
    // Node network errors
    if (sfErr.name === 'FetchError') return 'CONNECTIVITY_ERROR';
    if (sfErr.message?.includes('ETIMEDOUT') || sfErr.message?.includes('timeout')) return 'TIMEOUT';
    if (sfErr.message?.includes('ECONNREFUSED')) return 'ECONNREFUSED';
    if (sfErr.message?.includes('ECONNRESET')) return 'ECONNRESET';
    if (sfErr.message?.includes('ENOTFOUND')) return 'ENOTFOUND';
  }
  return 'UNKNOWN';
}

export class CircuitOpenError extends Error {
  readonly isCircuitOpen = true;
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

// Module-level singleton — shared across all tool calls
export const circuitBreaker = new CircuitBreaker();
