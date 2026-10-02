import { z } from 'zod';
import { getSalesforceConnection, getConnectionInfo } from '../auth/sf-auth.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { normalizeSuccess, generateCorrelationId } from '../utils/response-normalizer.js';
import { handleToolError } from '../utils/error-handler.js';
import { logAudit } from '../utils/audit-logger.js';

// ─── sf_merge ────────────────────────────────────────────────────────────────

export const SfMergeInputSchema = z.object({
  sObjectType: z.enum(['Account', 'Contact', 'Lead'])
    .describe('sObject type to merge. Only Account, Contact, and Lead support merge via API.'),
  masterRecordId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/)
    .describe('⚠️ DESTRUCTIVE — ID of the record to keep (master). The master record survives and absorbs the duplicates.'),
  duplicateRecordIds: z.array(z.string().regex(/^[a-zA-Z0-9]{15,18}$/)).min(1).max(2)
    .describe('IDs of the duplicate records to merge into the master and delete (max 2 at a time per SF API limit).'),
  fieldOverrides: z.record(z.unknown()).optional()
    .describe('Optional map of field values to set on the master record during the merge. Override values from duplicates selectively.'),
});

export type SfMergeInput = z.infer<typeof SfMergeInputSchema>;

export async function sfMerge(input: SfMergeInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      // jsforce merge: master record with Id, merge victims as array
      const master: Record<string, unknown> = { Id: input.masterRecordId, ...(input.fieldOverrides ?? {}) };
      return (conn as unknown as {
        merge: (type: string, master: unknown, duplicates: string[]) => Promise<unknown>
      }).merge(input.sObjectType, master, input.duplicateRecordIds);
    }, 'sf_merge');

    const durationMs = Date.now() - start;
    logAudit(
      { correlationId, caller: 'sf_merge', operation: 'MERGE', sObject: input.sObjectType, recordId: input.masterRecordId, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(result, durationMs, { correlationId }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_merge', operation: 'MERGE', sObject: input.sObjectType, apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_convert_lead ─────────────────────────────────────────────────────────

export const SfConvertLeadInputSchema = z.object({
  leadId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/)
    .describe('⚠️ CONVERTS DATA — ID of the Lead record to convert. The Lead status will change to the converted status.'),
  convertedStatus: z.string().min(1)
    .describe('Lead Status value that represents a converted lead (must be a status marked as "Converted" in your org\'s Lead Status picklist)'),
  accountId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional()
    .describe('Existing Account ID to link the converted Contact to. If omitted, a new Account is created.'),
  contactId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional()
    .describe('Existing Contact ID to merge the Lead into. If omitted, a new Contact is created.'),
  createOpportunity: z.boolean().optional().default(true)
    .describe('Whether to create an Opportunity during conversion. Defaults to true.'),
  opportunityName: z.string().optional()
    .describe('Name for the new Opportunity. Required if createOpportunity is true and no contactId is provided.'),
  ownerId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/).optional()
    .describe('User ID to assign as the owner of the converted records. Defaults to the Lead owner.'),
  sendEmailToOwner: z.boolean().optional().default(false)
    .describe('Whether to notify the new record owner by email'),
});

export type SfConvertLeadInput = z.infer<typeof SfConvertLeadInputSchema>;

export async function sfConvertLead(input: SfConvertLeadInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();
      // SOAP convertLead via jsforce
      const leadConvert: Record<string, unknown> = {
        leadId: input.leadId,
        convertedStatus: input.convertedStatus,
        doNotCreateOpportunity: !input.createOpportunity,
        sendNotificationEmail: input.sendEmailToOwner,
      };
      if (input.accountId) leadConvert.accountId = input.accountId;
      if (input.contactId) leadConvert.contactId = input.contactId;
      if (input.opportunityName) leadConvert.opportunityName = input.opportunityName;
      if (input.ownerId) leadConvert.ownerId = input.ownerId;

      return (conn as unknown as {
        apex: { post: (path: string, body: unknown) => Promise<unknown> }
      }).apex.post('/LeadConvert', leadConvert).catch(async () => {
        // Fallback: SOAP convertLead
        return (conn as unknown as {
          sobject: (type: string) => { convertLead: (params: unknown) => Promise<unknown> }
        }).sobject('Lead').convertLead(leadConvert);
      });
    }, 'sf_convert_lead');

    const durationMs = Date.now() - start;
    logAudit(
      { correlationId, caller: 'sf_convert_lead', operation: 'CONVERT_LEAD', sObject: 'Lead', recordId: input.leadId, apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(result, durationMs, { correlationId }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_convert_lead', operation: 'CONVERT_LEAD', sObject: 'Lead', apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}

// ─── sf_apex_rest ────────────────────────────────────────────────────────────

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const SfApexRestInputSchema = z.object({
  path: z.string().min(1)
    .describe('Apex REST endpoint path relative to /services/apexrest/. Example: "/MyEndpoint/v1/data" (leading slash required)'),
  method: z.enum(HTTP_METHODS).optional().default('GET')
    .describe('HTTP method. GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove)'),
  body: z.unknown().optional()
    .describe('Request body (for POST, PUT, PATCH). Will be JSON-serialised.'),
  urlParameters: z.record(z.string()).optional()
    .describe('Query string parameters to append to the URL (e.g. { "version": "v1", "format": "json" })'),
});

export type SfApexRestInput = z.infer<typeof SfApexRestInputSchema>;

export async function sfApexRest(input: SfApexRestInput): Promise<string> {
  const correlationId = generateCorrelationId();
  const start = Date.now();
  const info = getConnectionInfo();

  try {
    const result = await circuitBreaker.execute(async () => {
      const conn = await getSalesforceConnection();

      let urlPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
      if (input.urlParameters && Object.keys(input.urlParameters).length > 0) {
        const params = new URLSearchParams(input.urlParameters).toString();
        urlPath = `${urlPath}?${params}`;
      }

      const apex = (conn as unknown as { apex: Record<string, (path: string, body?: unknown) => Promise<unknown>> }).apex;
      const method = (input.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';

      if (method === 'get' || method === 'delete') {
        return apex[method](urlPath);
      }
      return apex[method](urlPath, input.body ?? {});
    }, 'sf_apex_rest');

    const durationMs = Date.now() - start;
    logAudit(
      { correlationId, caller: 'sf_apex_rest', operation: 'APEX_REST', apiVersion: info?.apiVersion ?? 'unknown', instanceUrl: info?.instanceUrl },
      { success: true },
      durationMs
    );
    return JSON.stringify(normalizeSuccess(result, durationMs, { correlationId }), null, 2);
  } catch (err) {
    const durationMs = Date.now() - start;
    const normalised = handleToolError(err, correlationId);
    logAudit(
      { correlationId, caller: 'sf_apex_rest', operation: 'APEX_REST', apiVersion: info?.apiVersion ?? 'unknown' },
      { success: false, errorCode: normalised.error.errorCode, errorMessage: normalised.error.message },
      durationMs
    );
    return JSON.stringify(normalised, null, 2);
  }
}
