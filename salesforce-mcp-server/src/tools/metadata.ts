import { z } from 'zod';
import NodeCache from 'node-cache';
import { getSalesforceConnection, getConnectionInfo } from '../auth/sf-auth.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { normalizeSuccess, generateCorrelationId } from '../utils/response-normalizer.js';
import { handleToolError } from '../utils/error-handler.js';
import { logAudit } from '../utils/audit-logger.js';
import { getConfig } from '../config.js';

const cache = new NodeCache();

// ─── sf_describe ─────────────────────────────────────────────────────────────

export const SfDescribeInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object to describe (e.g. Account, Contact, Opportunity, Lead, MyCustomObject__c)'),
  includeFields: z.boolean().optional().default(true)
    .describe('Include full field metadata. Set to false for a lighter response with only object-level metadata.'),
  includeRecordTypes: z.boolean().optional().default(true)
    .describe('Include record type information'),
  includeChildRelationships: z.boolean().optional().default(false)
    .describe('Include child relationship definitions (can be verbose)'),
});

export type SfDescribeInput = z.infer<typeof SfDescribeInputSchema>;

export async function sfDescribe(input: SfDescribeInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();
  const config = getConfig();
  const cacheKey = `describe:${input.sObjectType}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.stringify(normalizeSuccess(cached, 0, { correlationId }), null, 2);
  }

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.sobject(input.sObjectType).describe();
    }, 'sf_describe');

    // Trim the response if requested
    const data: Record<string, unknown> = {
      name: result.name,
      label: result.label,
      labelPlural: result.labelPlural,
      keyPrefix: result.keyPrefix,
      createable: result.createable,
      updateable: result.updateable,
      deleteable: result.deleteable,
      queryable: result.queryable,
      searchable: result.searchable,
    };

    if (input.includeFields) data.fields = result.fields;
    if (input.includeRecordTypes) data.recordTypeInfos = result.recordTypeInfos;
    if (input.includeChildRelationships) data.childRelationships = result.childRelationships;

    cache.set(cacheKey, data, config.cache.schemaTtl);

    const durationMs = Date.now() - start;
    logAudit(
      { correlationId, caller: 'sf_describe', operation: 'DESCRIBE', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(data, durationMs, { correlationId }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_describe', operation: 'DESCRIBE', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_describe_global ──────────────────────────────────────────────────────

export const SfDescribeGlobalInputSchema = z.object({
  filter: z.object({
    queryable: z.boolean().optional().describe('Include only queryable objects'),
    createable: z.boolean().optional().describe('Include only createable objects'),
    custom: z.boolean().optional().describe('Include only custom objects'),
  }).optional().describe('Optional filters to narrow the list of returned sObjects'),
});

export type SfDescribeGlobalInput = z.infer<typeof SfDescribeGlobalInputSchema>;

export async function sfDescribeGlobal(input: SfDescribeGlobalInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();
  const config = getConfig();
  const cacheKey = 'describe_global';

  let sobjects = cache.get<unknown[]>(cacheKey);
  if (!sobjects) {
    sobjects = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      const result = await conn.describeGlobal();
      return result.sobjects;
    }, 'sf_describe_global');
    cache.set(cacheKey, sobjects, config.cache.globalDescribeTtl);
  }

  // Apply filters
  let filtered = sobjects as Record<string, unknown>[];
  if (input.filter) {
    const { queryable, createable, custom } = input.filter;
    if (queryable !== undefined) filtered = filtered.filter((o) => o.queryable === queryable);
    if (createable !== undefined) filtered = filtered.filter((o) => o.createable === createable);
    if (custom !== undefined) filtered = filtered.filter((o) => o.custom === custom);
  }

  const durationMs = Date.now() - start;
  logAudit(
    { correlationId, caller: 'sf_describe_global', operation: 'DESCRIBE_GLOBAL', apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
    { success: true, recordCount: filtered.length },
    durationMs
  );
  return JSON.stringify(normalizeSuccess(filtered, durationMs, { correlationId, recordCount: filtered.length }), null, 2);
}

// ─── sf_get_updated ──────────────────────────────────────────────────────────

export const SfGetUpdatedInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object (e.g. Account)'),
  start: z.string()
    .describe('ISO 8601 start datetime (e.g. 2025-01-01T00:00:00Z). Must be within the last 30 days.'),
  end: z.string()
    .describe('ISO 8601 end datetime (e.g. 2025-01-31T23:59:59Z). Must be after start.'),
});

export type SfGetUpdatedInput = z.infer<typeof SfGetUpdatedInputSchema>;

export async function sfGetUpdated(input: SfGetUpdatedInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const ts = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.sobject(input.sObjectType).getUpdated(input.start, input.end);
    }, 'sf_get_updated');

    const durationMs = Date.now() - ts;
    logAudit(
      { correlationId, caller: 'sf_get_updated', operation: 'GET_UPDATED', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true, recordCount: result.ids?.length ?? 0 },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(result, durationMs, { correlationId, recordCount: result.ids?.length ?? 0 }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - ts;
    const normalised = handleToolError(err, correlationId);
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_get_deleted ──────────────────────────────────────────────────────────

export const SfGetDeletedInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object (e.g. Account)'),
  start: z.string()
    .describe('ISO 8601 start datetime. Must be within the last 30 days.'),
  end: z.string()
    .describe('ISO 8601 end datetime. Must be after start.'),
});

export type SfGetDeletedInput = z.infer<typeof SfGetDeletedInputSchema>;

export async function sfGetDeleted(input: SfGetDeletedInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const ts = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.sobject(input.sObjectType).getDeleted(input.start, input.end);
    }, 'sf_get_deleted');

    const durationMs = Date.now() - ts;
    const recordCount = result.deletedRecords?.length ?? 0;
    logAudit(
      { correlationId, caller: 'sf_get_deleted', operation: 'GET_DELETED', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true, recordCount },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(result, durationMs, { correlationId, recordCount }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - ts;
    const normalised = handleToolError(err, correlationId);
    return JSON.stringify(normalised, null, 2);
  }
}
