// Salesforce-specific TypeScript types

export interface SalesforceRecord {
  Id?: string;
  [key: string]: unknown;
}

export interface QueryResult<T = SalesforceRecord> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface SearchResult {
  searchRecords: SalesforceRecord[];
}

export interface DescribeResult {
  name: string;
  label: string;
  labelPlural: string;
  keyPrefix: string | null;
  fields: FieldDescribe[];
  recordTypeInfos: RecordTypeInfo[];
  childRelationships: ChildRelationship[];
  createable: boolean;
  updateable: boolean;
  deleteable: boolean;
  queryable: boolean;
  searchable: boolean;
}

export interface FieldDescribe {
  name: string;
  label: string;
  type: string;
  length: number;
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  unique: boolean;
  externalId: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues: PicklistValue[];
  defaultValue: unknown;
  required: boolean;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
}

export interface PicklistValue {
  value: string;
  label: string;
  active: boolean;
  defaultValue: boolean;
}

export interface RecordTypeInfo {
  recordTypeId: string;
  name: string;
  developerName: string;
  defaultRecordTypeMapping: boolean;
  active: boolean;
  available: boolean;
}

export interface ChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | null;
  cascadeDelete: boolean;
}

export interface GlobalDescribeResult {
  sobjects: GlobalSObjectInfo[];
}

export interface GlobalSObjectInfo {
  name: string;
  label: string;
  labelPlural: string;
  keyPrefix: string | null;
  createable: boolean;
  updateable: boolean;
  deleteable: boolean;
  queryable: boolean;
  searchable: boolean;
  custom: boolean;
  customSetting: boolean;
  urls: Record<string, string>;
}

export interface SaveResult {
  id: string;
  success: boolean;
  errors: SaveError[];
}

export interface SaveError {
  statusCode: string;
  message: string;
  fields: string[];
}

export interface UpsertResult extends SaveResult {
  created: boolean;
}

export interface DeleteResult {
  id: string;
  success: boolean;
  errors: SaveError[];
}

export interface MergeResult {
  id: string;
  success: boolean;
  errors: SaveError[];
}

export interface LeadConvertResult {
  leadId: string;
  contactId?: string;
  accountId?: string;
  opportunityId?: string;
  success: boolean;
  errors: SaveError[];
}

export interface GetUpdatedResult {
  ids: string[];
  latestDateCovered: string;
}

export interface GetDeletedResult {
  deletedRecords: DeletedRecord[];
  earliestDateAvailable: string;
  latestDateCovered: string;
}

export interface DeletedRecord {
  id: string;
  deletedDate: string;
}

export interface OrgLimits {
  [limitName: string]: {
    Max: number;
    Remaining: number;
  };
}

export interface ApexRestResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface SalesforceError {
  errorCode: string;
  message: string;
  fields?: string[];
}

export type AuthMode = 'oauth' | 'jwt' | 'password';

export interface ConnectionInfo {
  instanceUrl: string;
  accessToken: string;
  organizationId?: string;
  userId?: string;
  apiVersion: string;
  authMode: AuthMode;
  connectedAt: Date;
}

// Normalised response envelope
export interface NormalizedResponse<T = unknown> {
  success: true;
  data: T;
  metadata: ResponseMetadata;
}

export interface NormalizedError {
  success: false;
  error: ErrorDetail;
}

export interface ResponseMetadata {
  correlationId: string;
  durationMs: number;
  timestamp: string;
  apiVersion: string;
  recordCount?: number;
}

export interface ErrorDetail {
  status: number;
  errorCode: string;
  message: string;
  detail?: string;
  correlationId: string;
  timestamp: string;
}

export type ToolResponse = NormalizedResponse | NormalizedError;

// Circuit breaker
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  totalCalls: number;
  totalFailures: number;
}

// Audit log
export interface AuditLogEntry {
  timestamp: string;
  correlationId: string;
  caller: string;
  operation: SalesforceOperation;
  sObject?: string;
  soql?: string;
  recordId?: string;
  success: boolean;
  recordCount?: number;
  durationMs: number;
  apiVersion: string;
  errorCode?: string;
  errorMessage?: string;
  userId?: string;
  instanceUrl?: string;
}

export type SalesforceOperation =
  | 'QUERY'
  | 'SEARCH'
  | 'GET_RECORD'
  | 'CREATE'
  | 'UPDATE'
  | 'UPSERT'
  | 'DELETE'
  | 'DESCRIBE'
  | 'DESCRIBE_GLOBAL'
  | 'GET_UPDATED'
  | 'GET_DELETED'
  | 'MERGE'
  | 'CONVERT_LEAD'
  | 'APEX_REST'
  | 'HEALTH_CHECK'
  | 'GET_LIMITS';

// Query validation
export interface QueryValidationResult {
  valid: boolean;
  complexityScore: number;
  violations: string[];
  warnings: string[];
}
