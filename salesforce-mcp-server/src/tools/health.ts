import { z } from 'zod';
import { getSalesforceConnection, getConnectionInfo } from '../auth/sf-auth.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { normalizeSuccess, normalizeError, generateCorrelationId } from '../utils/response-normalizer.js';
import { logAudit } from '../utils/audit-logger.js';

export const SfHealthInputSchema = z.object({
  includeCircuitBreakerStats: z.boolean().optional().default(true)
    .describe('Include circuit breaker state and failure counts in the response'),
  includeLimits: z.boolean().optional().default(false)
    .describe('Also retrieve API limit usage from Salesforce (costs one API call)'),
});

export type SfHealthInput = z.infer<typeof SfHealthInputSchema>;

export async function sfHealth(input: SfHealthInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  const cbStats = circuitBreaker.getStats();
  const cbData = input.includeCircuitBreakerStats ? cbStats : undefined;

  if (cbStats.state === 'OPEN') {
    const durationMs = Date.now() - start;
    const msUntilReset = cbStats.lastFailureAt
      ? Math.max(0, 60000 - (Date.now() - cbStats.lastFailureAt.getTime()))
      : 0;

    return JSON.stringify(
      normalizeError('CIRCUIT_BREAKER_OPEN', 'Salesforce connection circuit breaker is OPEN', {
        status: 503,
        detail: `${cbStats.failures} consecutive failures. Auto-reset in ~${Math.round(msUntilReset / 1000)}s.`,
        correlationId,
      }),
      null, 2
    );
  }

  try {
    // Lightweight connectivity probe — query 1 record from User
    const probeResult = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      const result = await conn.query('SELECT Id FROM User WHERE IsActive = true LIMIT 1');
      return { connected: true, userId: result.records[0]?.Id };
    }, 'sf_health');

    let limits: unknown;
    if (input.includeLimits) {
      const conn = await getSalesforceConnection();
      limits = await (conn as unknown as { limits: () => Promise<unknown> }).limits();
    }

    const durationMs = Date.now() - start;
    const healthData = {
      status: 'healthy',
      connected: true,
      instanceUrl: info?.instanceUrl,
      apiVersion: info?.apiVersion,
      authMode: info?.authMode,
      connectedAt: info?.connectedAt?.toISOString(),
      probe: probeResult,
      ...(cbData ? { circuitBreaker: cbData } : {}),
      ...(limits ? { apiLimits: limits } : {}),
    };

    logAudit(
      { correlationId, caller: 'sf_health', operation: 'HEALTH_CHECK', apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true },
      durationMs
    );

    return JSON.stringify(normalizeSuccess(healthData, durationMs, { correlationId }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    logAudit(
      { correlationId, caller: 'sf_health', operation: 'HEALTH_CHECK', apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: 'CONNECTIVITY_ERROR', errorMessage: message },
      durationMs
    );

    return JSON.stringify(
      normalizeError('CONNECTIVITY_ERROR', 'Salesforce connectivity test failed', {
        status: 503,
        detail: message,
        correlationId,
      }),
      null, 2
    );
  }
}
