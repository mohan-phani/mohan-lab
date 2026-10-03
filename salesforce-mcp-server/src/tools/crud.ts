import { z } from 'zod';
import { getSalesforceConnection, getConnectionInfo } from '../auth/sf-auth.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { normalizeSuccess, normalizeError, generateCorrelationId } from '../utils/response-normalizer.js';
import { handleToolError } from '../utils/error-handler.js';
import { logAudit } from '../utils/audit-logger.js';

// ─── sf_get_record ───────────────────────────────────────────────────────────

export const SfGetRecordInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object (e.g. Account, Contact, Opportunity, MyCustomObject__c)'),
  recordId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/)
    .describe('Salesforce record ID (15 or 18 character)'),
  fields: z.array(z.string()).optional()
    .describe('Optional list of field API names to retrieve. If omitted, retrieves all accessible fields.'),
});

export type SfGetRecordInput = z.infer<typeof SfGetRecordInputSchema>;

export async function sfGetRecord(input: SfGetRecordInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      if (input.fields?.length) {
        return conn.sobject(input.sObjectType).retrieve(input.recordId, { fields: input.fields });
      }
      return conn.sobject(input.sObjectType).retrieve(input.recordId);
    }, 'sf_get_record');

    const durationMs = Date.now() - start;
    logAudit(
      { correlationId, caller: 'sf_get_record', operation: 'GET_RECORD', sObject: input.sObjectType, recordId: input.recordId, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true, recordCount: 1 },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(result, durationMs, { correlationId, recordCount: 1 }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_get_record', operation: 'GET_RECORD', sObject: input.sObjectType, recordId: input.recordId, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_create_record ────────────────────────────────────────────────────────

export const SfCreateRecordInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object to create (e.g. Account, Lead, Case)'),
  fields: z.record(z.unknown())
    .describe(
      '⚠️ CREATES DATA — Key-value map of field API names to values. ' +
      'Example: { "Name": "Acme Corp", "Industry": "Technology", "AnnualRevenue": 1000000 }'
    ),
});

export type SfCreateRecordInput = z.infer<typeof SfCreateRecordInputSchema>;

export async function sfCreateRecord(input: SfCreateRecordInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.sobject(input.sObjectType).create(input.fields);
    }, 'sf_create_record');

    const durationMs = Date.now() - start;
    const saveResult = Array.isArray(result) ? result[0] : result;
    logAudit(
      { correlationId, caller: 'sf_create_record', operation: 'CREATE', sObject: input.sObjectType, recordId: saveResult.id, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: saveResult.success, recordCount: 1 },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(saveResult, durationMs, { correlationId, recordCount: 1 }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_create_record', operation: 'CREATE', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_update_record ────────────────────────────────────────────────────────

export const SfUpdateRecordInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object (e.g. Account, Contact)'),
  recordId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/)
    .describe('Salesforce record ID to update (15 or 18 character)'),
  fields: z.record(z.unknown())
    .describe(
      '⚠️ MODIFIES DATA — Key-value map of fields to update. Only include fields you want to change. ' +
      'Example: { "Phone": "+1-555-0100", "BillingCity": "San Francisco" }'
    ),
});

export type SfUpdateRecordInput = z.infer<typeof SfUpdateRecordInputSchema>;

export async function sfUpdateRecord(input: SfUpdateRecordInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.sobject(input.sObjectType).update({ Id: input.recordId, ...input.fields });
    }, 'sf_update_record');

    const durationMs = Date.now() - start;
    const saveResult = Array.isArray(result) ? result[0] : result;
    logAudit(
      { correlationId, caller: 'sf_update_record', operation: 'UPDATE', sObject: input.sObjectType, recordId: input.recordId, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: saveResult.success, recordCount: 1 },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(saveResult, durationMs, { correlationId, recordCount: 1 }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_update_record', operation: 'UPDATE', sObject: input.sObjectType, recordId: input.recordId, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_upsert_record ────────────────────────────────────────────────────────

export const SfUpsertRecordInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object'),
  externalIdField: z.string().min(1)
    .describe('API name of the external ID field to match on (e.g. External_Id__c, Email for Contact)'),
  externalIdValue: z.string().min(1)
    .describe('Value of the external ID field to match'),
  fields: z.record(z.unknown())
    .describe(
      '⚠️ CREATES OR MODIFIES DATA — Key-value map of all field values. ' +
      'If no record matches externalIdValue, a new record is created. Otherwise the matched record is updated.'
    ),
});

export type SfUpsertRecordInput = z.infer<typeof SfUpsertRecordInputSchema>;

export async function sfUpsertRecord(input: SfUpsertRecordInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      const record = { [input.externalIdField]: input.externalIdValue, ...input.fields };
      return conn.sobject(input.sObjectType).upsert(record, input.externalIdField);
    }, 'sf_upsert_record');

    const durationMs = Date.now() - start;
    const upsertResult = Array.isArray(result) ? result[0] : result;
    logAudit(
      { correlationId, caller: 'sf_upsert_record', operation: 'UPSERT', sObject: input.sObjectType, recordId: upsertResult.id, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: upsertResult.success, recordCount: 1 },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(upsertResult, durationMs, { correlationId, recordCount: 1 }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_upsert_record', operation: 'UPSERT', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_delete_record ────────────────────────────────────────────────────────

export const SfDeleteRecordInputSchema = z.object({
  sObjectType: z.string().min(1)
    .describe('API name of the Salesforce object (e.g. Account, Opportunity)'),
  recordId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/)
    .describe('Salesforce record ID to delete (15 or 18 character). ⚠️ THIS IS IRREVERSIBLE (unless your org has Recycle Bin enabled for the object).'),
});

export type SfDeleteRecordInput = z.infer<typeof SfDeleteRecordInputSchema>;

export async function sfDeleteRecord(input: SfDeleteRecordInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      return conn.sobject(input.sObjectType).delete(input.recordId);
    }, 'sf_delete_record');

    const durationMs = Date.now() - start;
    const deleteResult = Array.isArray(result) ? result[0] : result;
    logAudit(
      { correlationId, caller: 'sf_delete_record', operation: 'DELETE', sObject: input.sObjectType, recordId: input.recordId, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: deleteResult.success, recordCount: 1 },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(deleteResult, durationMs, { correlationId }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_delete_record', operation: 'DELETE', sObject: input.sObjectType, recordId: input.recordId, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}
