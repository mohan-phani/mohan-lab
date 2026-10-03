import { z } from 'zod';
import { getSalesforceConnection, getConnectionInfo } from '../auth/sf-auth.js';
import { validateQuery } from '../guardrails/query-validator.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { normalizeSuccess, normalizeError, generateCorrelationId } from '../utils/response-normalizer.js';
import { handleToolError, createValidationError } from '../utils/error-handler.js';
import { logAudit } from '../utils/audit-logger.js';

// ─── sf_query ───────────────────────────────────────────────────────────────

export const SfQueryInputSchema = z.object({
  soql: z.string()
    .min(1)
    .describe(
      'SOQL query to execute. Must start with SELECT. Do NOT use SELECT * — list explicit fields. ' +
      'Always include a WHERE clause and LIMIT to avoid full-table scans. ' +
      'Example: SELECT Id, Name, Industry FROM Account WHERE CreatedDate = TODAY LIMIT 50'
    ),
  includeMetadata: z.boolean().optional().default(false)
    .describe('When true, includes totalSize and done status in the response'),
});

export type SfQueryInput = z.infer<typeof SfQueryInputSchema>;

export async function sfQuery(input: SfQueryInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  // 1. Validate SOQL
  const validation = validateQuery(input.soql);
  if (!validation.valid) {
    const message = validation.violations.join('; ');
    const err = normalizeError('QUERY_INJECTION_DETECTED', message, {
      status: 400,
      detail: `Complexity score: ${validation.complexityScore}. Violations: ${message}`,
      correlationId,
    });
    logAudit(
      { correlationId, caller: 'sf_query', operation: 'QUERY', soql: input.soql, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: 'QUERY_INJECTION_DETECTED', errorMessage: message },
      Date.now() - start
    );
    return JSON.stringify(err, null, 2);
  }

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.query(input.soql);
    }, 'sf_query');

    const durationMs = Date.now() - start;
    logAudit(
      { correlationId, caller: 'sf_query', operation: 'QUERY', soql: input.soql, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true, recordCount: result.totalSize },
      durationMs
    );

    const data = input.includeMetadata
      ? result
      : result.records;

    const response = normalizeSuccess(data, durationMs, { correlationId, recordCount: result.totalSize });
    if (validation.warnings.length > 0) {
      (response as Record<string, unknown>).warnings = validation.warnings;
    }
    return JSON.stringify(response, null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_query', operation: 'QUERY', soql: input.soql, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_search ──────────────────────────────────────────────────────────────

export const SfSearchInputSchema = z.object({
  sosl: z.string()
    .min(1)
    .describe(
      'SOSL (Salesforce Object Search Language) query. Must start with FIND. ' +
      'Example: FIND {Acme*} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, FirstName, LastName)'
    ),
});

export type SfSearchInput = z.infer<typeof SfSearchInputSchema>;

export async function sfSearch(input: SfSearchInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  // Basic SOSL injection check (reuse validator, FIND prefix is already checked)
  const validation = validateQuery(input.sosl);
  if (!validation.valid) {
    const message = validation.violations.join('; ');
    return JSON.stringify(
      normalizeError('QUERY_INJECTION_DETECTED', message, { status: 400, correlationId }),
      null, 2
    );
  }

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.search(input.sosl);
    }, 'sf_search');

    const durationMs = Date.now() - start;
    const recordCount = result.searchRecords?.length ?? 0;

    logAudit(
      { correlationId, caller: 'sf_search', operation: 'SEARCH', soql: input.sosl, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true, recordCount },
      durationMs
    );

    return JSON.stringify(normalizeSuccess(result.searchRecords, durationMs, { correlationId, recordCount }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_search', operation: 'SEARCH', apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}
