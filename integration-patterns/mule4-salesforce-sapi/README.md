# Mule 4 Salesforce Universal System API (SAPI)

A production-grade, sObject-agnostic Salesforce System API built on **Mule 4.9.4 LTS** and **Salesforce Connector 12.0**. Not just another SFDC wrapper — this accelerator adds SOQL injection prevention, query complexity scoring, an ObjectStore-backed circuit breaker, bulk auto-routing, and a compliance-ready audit trail.

## Why This Exists

Every Exchange template gives you a thin CRUD wrapper. This SAPI gives you:

| Feature | Exchange Templates | This Accelerator |
|---|---|---|
| SOQL injection prevention | No | Yes — blocks DML, comments, multi-statement, SELECT* |
| Query complexity scoring | No | Yes — warns about expensive queries before they hit SF |
| Circuit breaker | No | Yes — ObjectStore-backed, auto-trip & auto-reset |
| Bulk auto-routing | No | Yes — arrays > threshold auto-route to Bulk API v2 |
| Audit trail (Splunk/ELK ready) | No | Yes — every operation logged with latency, caller, result |
| Centralized API version | No | Yes — change one property to upgrade across all endpoints |
| Universal endpoints | Partial | Yes — every SF Connector 12.0 operation has an endpoint |

## Quick Start (2 steps)

### Step 1 — Configure Salesforce Connection

Edit `src/main/resources/config-local.yaml`:

```yaml
sfdc:
  connection:
    username: "your-sf-username"
    password: "your-sf-password"
    security-token: "your-sf-security-token"
    url: "https://login.salesforce.com/services/Soap/u/v62.0"
```

### Step 2 — Run

```bash
mvn clean package -DskipTests
mvn mule:run -Dmule.env=local
```

The API starts at `http://localhost:8081/api/v1/`

---

## Endpoints Reference

### Universal SOQL Query Engine

```
POST /api/v1/query
Content-Type: application/json

{
  "soql": "SELECT Id, Name, Industry FROM Account WHERE Industry != null LIMIT 10"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "records": [{ "Id": "001xx...", "Name": "Acme", "Industry": "Technology" }],
    "totalSize": 1
  },
  "metadata": {
    "operation": "query",
    "recordCount": 1,
    "apiVersion": "v62.0",
    "queryComplexity": { "score": 2, "warnings": [] }
  }
}
```

The query engine validates every SOQL query before it reaches Salesforce:
- Blocks DML injection (`INSERT`, `UPDATE`, `DELETE` embedded in queries)
- Blocks SQL comments (`--`, `/* */`)
- Blocks multi-statement (`;`)
- Blocks `SELECT *` (SF doesn't support it)
- Rejects empty or oversized queries
- Returns a complexity score with warnings for expensive queries

### SOSL Search

```
POST /api/v1/search
Content-Type: application/json

{
  "sosl": "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name)"
}
```

### Create Record(s)

```
POST /api/v1/records/Account
Content-Type: application/json

# Single record
{ "Name": "Acme Corp", "Industry": "Technology" }

# Multiple records (auto-detected)
[
  { "Name": "Acme Corp", "Industry": "Technology" },
  { "Name": "Globex", "Industry": "Manufacturing" }
]
```

Arrays exceeding the bulk threshold (configurable, default 200) automatically route to **Bulk API v2** — no code change needed.

### Retrieve Record

```
GET /api/v1/records/Account/001xx000003DGbYAAW
GET /api/v1/records/Account/001xx000003DGbYAAW?fields=Id,Name,Industry
```

Omit `fields` to get all fields via `FIELDS(ALL)`. Returns `404` if record doesn't exist.

### Update Record

```
PATCH /api/v1/records/Account/001xx000003DGbYAAW
Content-Type: application/json

{ "Industry": "Finance" }
```

### Upsert Record(s)

```
PUT /api/v1/records/Account/upsert
Content-Type: application/json

{
  "externalIdField": "External_Id__c",
  "records": [
    { "Name": "Acme Corp", "External_Id__c": "EXT-001" }
  ]
}
```

### Delete Record

```
DELETE /api/v1/records/Account/001xx000003DGbYAAW
```

### Merge Records

```
POST /api/v1/records/Account/merge
Content-Type: application/json

{
  "masterId": "001xx000003DGbYAAW",
  "victimIds": ["001xx000003DGbZAAW"]
}
```

### Describe sObject

```
GET /api/v1/describe/Account
```

Returns field definitions, picklist values, record types — everything you need for dynamic UIs.

### Describe Global

```
GET /api/v1/describe
```

Returns all accessible sObjects in the org with their capabilities (queryable, createable, etc.).

### Get Updated Records

```
GET /api/v1/records/Account/updated?startDate=2024-01-01T00:00:00Z&endDate=2024-01-02T00:00:00Z
```

### Get Deleted Records

```
GET /api/v1/records/Account/deleted?startDate=2024-01-01T00:00:00Z&endDate=2024-01-02T00:00:00Z
```

### Convert Lead

```
POST /api/v1/leads/convert
Content-Type: application/json

{
  "leadId": "00Qxx000001234",
  "convertedStatus": "Qualified",
  "doNotCreateOpportunity": false
}
```

### Invoke Apex REST

```
POST /api/v1/apex/rest
Content-Type: application/json

{
  "path": "/MyService/v1/process",
  "method": "POST",
  "body": { "action": "processRecords" }
}
```

### Invoke Apex SOAP

```
POST /api/v1/apex/soap
Content-Type: application/json

{
  "className": "MyWebService",
  "methodName": "processRecords",
  "arguments": []
}
```

### Health Check

```
GET /api/v1/health
```

Returns `200` with `"status": "UP"` when Salesforce is reachable, `503` with `"status": "DEGRADED"` when it's not.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Consumer (Process API / Experience API / External System)   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP
┌────────────────────────────▼────────────────────────────────┐
│                    APIkit Router                             │
│                  (RAML-driven routing)                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │  Query   │ │  CRUD    │ │ Describe  │ │ Apex / Bulk  │  │
│  │  Engine  │ │  Ops     │ │ & Meta    │ │ & Lead Conv  │  │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────┬───────┘  │
│       │             │             │               │          │
│  ┌────▼─────────────▼─────────────▼───────────────▼──────┐  │
│  │              Circuit Breaker (ObjectStore)              │  │
│  │         check → record-failure → trip → auto-reset     │  │
│  └────────────────────────┬──────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼──────────────────────────────┐  │
│  │              Salesforce Connector 12.0                  │  │
│  │         (reconnection: 3s freq, 5 retries)             │  │
│  └────────────────────────┬──────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼──────────────────────────────┐  │
│  │  DataWeave Libraries                                    │  │
│  │  • QueryGuardrails (SOQL validation + complexity)       │  │
│  │  • SfdcResponseNormalizer (envelope wrapping)           │  │
│  │  • SfdcErrorHandler (RFC 7807-inspired errors)          │  │
│  │  • AuditLogger (Splunk/ELK/Datadog structured logs)     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Global Error Handler                                   │  │
│  │  8 SALESFORCE: error types + APIKIT + HTTP + catch-all  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration

All config is externalized to YAML. Switch environments with `-Dmule.env=dev|prod`.

### Key Configuration Properties

| Property | Default | Description |
|---|---|---|
| `sfdc.api.version` | `v62.0` | SF API version — change once, applies everywhere |
| `query.max.soql-length` | `20000` | Max SOQL query length before rejection |
| `query.default.records-per-page` | `200` | Default records per page for query results |
| `bulk.auto-route.threshold` | `200` | Record count above which array inserts use Bulk API v2 |
| `circuit-breaker.failure-threshold` | `5` | Consecutive failures before circuit opens |
| `circuit-breaker.reset-timeout-seconds` | `60` | Seconds before circuit auto-resets (ObjectStore TTL) |
| `audit.enabled` | `true` | Toggle audit logging on/off |

### Upgrading Salesforce API Version

When Salesforce releases a new API version:

1. Change `sfdc.api.version` in `config-common.yaml`
2. Update `sfdc.connection.url` in environment configs
3. That's it — every endpoint automatically uses the new version

---

## Circuit Breaker

The ObjectStore-backed circuit breaker protects against cascading failures:

1. **Closed** (normal) — requests flow through to Salesforce
2. **Open** (tripped) — after `failure-threshold` consecutive CONNECTIVITY/TIMEOUT/RETRY_EXHAUSTED errors, returns `503` immediately without hitting SF
3. **Half-open** (auto-reset) — after `reset-timeout-seconds`, the ObjectStore TTL expires and the circuit resets

No external dependencies. No coordination. Pure Mule ObjectStore.

---

## Error Handling

Every error returns a consistent RFC 7807-inspired JSON envelope:

```json
{
  "success": false,
  "error": {
    "status": 503,
    "errorCode": "SALESFORCE:CONNECTIVITY",
    "message": "Unable to reach Salesforce",
    "detail": "Connection timed out after 30000ms",
    "correlationId": "abc-123-def",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "path": "/api/v1/query"
  }
}
```

Covered error types: `SALESFORCE:CONNECTIVITY`, `SALESFORCE:INVALID_INPUT`, `SALESFORCE:INVALID_RESPONSE`, `SALESFORCE:TIMEOUT`, `SALESFORCE:RETRY_EXHAUSTED`, `SALESFORCE:MUTUAL_AUTHENTICATION_FAILED`, `SALESFORCE:NOT_FOUND`, `SALESFORCE:LIMIT_EXCEEDED`, plus all APIKIT and HTTP errors.

---

## Audit Trail

Every operation produces a structured JSON audit log entry:

```json
{
  "logType": "SFDC_AUDIT",
  "level": "INFO",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "correlationId": "abc-123",
  "operation": "query",
  "sObject": "Account",
  "recordCount": 42,
  "durationMs": 187,
  "request": {
    "method": "POST",
    "path": "/api/v1/query",
    "remoteAddress": "10.0.0.1",
    "clientId": "process-api-v2"
  }
}
```

Designed for direct ingestion by Splunk, ELK Stack, or Datadog — no parsing rules needed.

---

## Project Structure

```
mule4-salesforce-sapi/
├── pom.xml
├── mule-artifact.json
├── README.md
└── src/
    ├── main/
    │   ├── mule/
    │   │   ├── sf-sapi-main.xml              # APIkit router + request tracking
    │   │   ├── global-config.xml             # SF connection, HTTP, ObjectStore
    │   │   ├── salesforce-error-handler.xml   # Error handler + circuit breaker
    │   │   ├── sf-query-operations.xml        # POST /query, POST /search
    │   │   ├── sf-crud-operations.xml         # CRUD + merge + bulk auto-route
    │   │   └── sf-metadata-operations.xml     # Describe, updated/deleted, apex, health
    │   └── resources/
    │       ├── api/
    │       │   └── salesforce-sapi.raml        # RAML 1.0 API specification
    │       ├── dwl/
    │       │   ├── QueryGuardrails.dwl         # SOQL validation + complexity scoring
    │       │   ├── SfdcResponseNormalizer.dwl   # Response envelope wrapping
    │       │   ├── SfdcErrorHandler.dwl         # Error response builder
    │       │   └── AuditLogger.dwl              # Structured audit logging
    │       ├── config-common.yaml
    │       ├── config-local.yaml
    │       ├── config-dev.yaml
    │       ├── config-prod.yaml
    │       └── log4j2.xml
    └── test/
        ├── munit/
        │   ├── sf-query-operations-test.xml    # 7 query/search tests
        │   └── sf-crud-operations-test.xml     # 10 CRUD + health tests
        └── resources/
            └── config-test.yaml
```

## Runtime Requirements

- Mule Runtime 4.9.4 (LTS)
- Salesforce Connector 12.0.0
- APIkit 1.12.7
- Java 17

## License

MIT
