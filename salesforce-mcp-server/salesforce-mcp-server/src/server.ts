import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Tools
import { sfQuery, SfQueryInputSchema } from './tools/query.js';
import { sfSearch, SfSearchInputSchema } from './tools/query.js';
import { sfGetRecord, SfGetRecordInputSchema } from './tools/crud.js';
import { sfCreateRecord, SfCreateRecordInputSchema } from './tools/crud.js';
import { sfUpdateRecord, SfUpdateRecordInputSchema } from './tools/crud.js';
import { sfUpsertRecord, SfUpsertRecordInputSchema } from './tools/crud.js';
import { sfDeleteRecord, SfDeleteRecordInputSchema } from './tools/crud.js';
import { sfDescribe, SfDescribeInputSchema } from './tools/metadata.js';
import { sfDescribeGlobal, SfDescribeGlobalInputSchema } from './tools/metadata.js';
import { sfGetUpdated, SfGetUpdatedInputSchema } from './tools/metadata.js';
import { sfGetDeleted, SfGetDeletedInputSchema } from './tools/metadata.js';
import { sfMerge, SfMergeInputSchema } from './tools/advanced.js';
import { sfConvertLead, SfConvertLeadInputSchema } from './tools/advanced.js';
import { sfApexRest, SfApexRestInputSchema } from './tools/advanced.js';
import { sfHealth, SfHealthInputSchema } from './tools/health.js';

// Resources
import { getOrgDescribeResource, getOrgLimitsResource } from './resources/org.js';
import { getSchemaResource } from './resources/schema.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'salesforce-mcp-server',
    version: '1.0.0',
  });

  // ─── Query & Search ─────────────────────────────────────────────────────────

  server.tool(
    'sf_query',
    'Execute a SOQL query against Salesforce with automatic injection prevention and complexity scoring. ' +
      'Always specify explicit fields — never SELECT *. Include WHERE and LIMIT clauses to avoid full-table scans.',
    SfQueryInputSchema.shape,
    async (args) => {
      const result = await sfQuery(SfQueryInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_search',
    'Perform a full-text SOSL (Salesforce Object Search Language) search across multiple objects. ' +
      'Use when you need to find records by keywords rather than structured field values.',
    SfSearchInputSchema.shape,
    async (args) => {
      const result = await sfSearch(SfSearchInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ─── Record CRUD ─────────────────────────────────────────────────────────────

  server.tool(
    'sf_get_record',
    'Retrieve a single Salesforce record by its ID. Specify fields to retrieve for a lightweight response.',
    SfGetRecordInputSchema.shape,
    async (args) => {
      const result = await sfGetRecord(SfGetRecordInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_create_record',
    '⚠️ CREATES DATA — Create a new record in any Salesforce sObject. ' +
      'Use sf_describe to discover required fields and their data types before calling this tool.',
    SfCreateRecordInputSchema.shape,
    async (args) => {
      const result = await sfCreateRecord(SfCreateRecordInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_update_record',
    '⚠️ MODIFIES DATA — Update an existing Salesforce record by ID. Only include fields you want to change.',
    SfUpdateRecordInputSchema.shape,
    async (args) => {
      const result = await sfUpdateRecord(SfUpdateRecordInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_upsert_record',
    '⚠️ CREATES OR MODIFIES DATA — Upsert a record using an external ID field. ' +
      'Creates if no match is found, updates if matched. The externalIdField must be marked as External ID in the org.',
    SfUpsertRecordInputSchema.shape,
    async (args) => {
      const result = await sfUpsertRecord(SfUpsertRecordInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_delete_record',
    '⚠️ DESTRUCTIVE — Delete a Salesforce record by ID. ' +
      'The record moves to the Recycle Bin for 15 days (for most objects). Confirm the record ID before calling.',
    SfDeleteRecordInputSchema.shape,
    async (args) => {
      const result = await sfDeleteRecord(SfDeleteRecordInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ─── Metadata & Schema ───────────────────────────────────────────────────────

  server.tool(
    'sf_describe',
    'Describe a Salesforce sObject — returns field definitions, picklist values, record types, and capabilities. ' +
      'Call this before creating/updating records to discover required fields and valid values.',
    SfDescribeInputSchema.shape,
    async (args) => {
      const result = await sfDescribe(SfDescribeInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_describe_global',
    'List all sObjects available in the Salesforce org. Optionally filter by queryable, createable, or custom flag.',
    SfDescribeGlobalInputSchema.shape,
    async (args) => {
      const result = await sfDescribeGlobal(SfDescribeGlobalInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_get_updated',
    'Get IDs of records that were updated in a date/time range (max 30-day window). ' +
      'Useful for change detection and incremental sync.',
    SfGetUpdatedInputSchema.shape,
    async (args) => {
      const result = await sfGetUpdated(SfGetUpdatedInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_get_deleted',
    'Get IDs and deletion timestamps for records deleted in a date/time range (max 30-day window). ' +
      'Returns tombstone records including those in the Recycle Bin.',
    SfGetDeletedInputSchema.shape,
    async (args) => {
      const result = await sfGetDeleted(SfGetDeletedInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ─── Advanced ────────────────────────────────────────────────────────────────

  server.tool(
    'sf_merge',
    '⚠️ DESTRUCTIVE — Merge 2-3 duplicate Salesforce records into one master record. ' +
      'Supported only for Account, Contact, and Lead. Duplicate records are permanently deleted. ' +
      'Verify the masterRecordId carefully before calling.',
    SfMergeInputSchema.shape,
    async (args) => {
      const result = await sfMerge(SfMergeInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_convert_lead',
    '⚠️ CONVERTS DATA — Convert a Salesforce Lead into Contact, Account, and optionally Opportunity. ' +
      'This changes the Lead\'s status permanently. Verify leadId and convertedStatus before calling.',
    SfConvertLeadInputSchema.shape,
    async (args) => {
      const result = await sfConvertLead(SfConvertLeadInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.tool(
    'sf_apex_rest',
    'Invoke a custom Apex REST endpoint in the Salesforce org. ' +
      'The path is relative to /services/apexrest/. Use GET for reads, POST/PUT/PATCH for writes, DELETE for removals.',
    SfApexRestInputSchema.shape,
    async (args) => {
      const result = await sfApexRest(SfApexRestInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ─── Health ──────────────────────────────────────────────────────────────────

  server.tool(
    'sf_health',
    'Check the health of the Salesforce MCP server: connectivity, circuit breaker state, auth status, and optionally API limits.',
    SfHealthInputSchema.shape,
    async (args) => {
      const result = await sfHealth(SfHealthInputSchema.parse(args));
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // ─── Resources ───────────────────────────────────────────────────────────────

  server.resource(
    'sf_org_describe',
    'sf://org/describe',
    {
      description: 'Cached global describe of all sObjects in the org. Refreshes every 5 minutes. ' +
        'Use this to discover available objects before querying or writing data.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const content = await getOrgDescribeResource();
      return {
        contents: [
          {
            uri: 'sf://org/describe',
            mimeType: 'application/json',
            text: content,
          },
        ],
      };
    }
  );

  server.resource(
    'sf_org_limits',
    'sf://org/limits',
    {
      description: 'Current Salesforce API usage limits. Shows Max and Remaining for each limit type. ' +
        'Refreshes every 60 seconds.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const content = await getOrgLimitsResource();
      return {
        contents: [
          {
            uri: 'sf://org/limits',
            mimeType: 'application/json',
            text: content,
          },
        ],
      };
    }
  );

  server.resource(
    'sf_schema',
    new ResourceTemplate('sf://schema/{sObjectType}', { list: undefined }),
    {
      description: 'Cached sObject schema including all field definitions, picklist values, and record types. ' +
        'Pass the sObject API name (e.g. sf://schema/Account, sf://schema/MyObject__c). Refreshes every 5 minutes.',
      mimeType: 'application/json',
    },
    async (uri, { sObjectType }) => {
      const objectType = Array.isArray(sObjectType) ? sObjectType[0] : sObjectType;
      const content = await getSchemaResource(objectType);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: content,
          },
        ],
      };
    }
  );

  return server;
}
