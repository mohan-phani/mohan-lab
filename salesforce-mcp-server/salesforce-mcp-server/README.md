# Salesforce Universal MCP Server

A production-grade [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI agents (Claude, GPT-4o, Gemini, etc.) safe, auditable, schema-aware access to any Salesforce org.

## Why This Server?

| Feature | This server | Most SF MCP servers |
|---|---|---|
| SOQL injection prevention | ✅ blocks DML, comments, SELECT* | ❌ |
| Query complexity scoring | ✅ penalises cartesian joins | ❌ |
| Circuit breaker | ✅ trips on 5 consecutive failures | ❌ |
| Audit trail (structured JSON) | ✅ every operation logged | ❌ |
| Schema-as-resource | ✅ agents inspect fields before querying | ❌ |
| API version agnostic | ✅ env-configurable | ❌ hardcoded |
| Dual transport | ✅ stdio + streamable-HTTP | ❌ stdio only |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/mohan-phani/mohan-lab
cd mohan-lab/salesforce-mcp-server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Salesforce credentials
```

For a **Salesforce Developer Edition** org (free):
- Sign up at [developer.salesforce.com](https://developer.salesforce.com/signup)
- Set `SF_AUTH_MODE=password`
- Fill in `SF_USERNAME`, `SF_PASSWORD`, and `SF_SECURITY_TOKEN`
  - Security token: `Setup → My Personal Information → Reset My Security Token`

### 3. Build

```bash
npm run build
```

### 4. Run (stdio — for Claude Desktop)

```bash
npm start
```

### 5. Run (HTTP — for remote agents)

```bash
npm run start:http
# Server listens on http://localhost:3000/mcp
```

---

## Claude Desktop Integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/absolute/path/to/salesforce-mcp-server/dist/index.js"],
      "env": {
        "SF_AUTH_MODE": "password",
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_USERNAME": "your@email.com",
        "SF_PASSWORD": "yourpassword",
        "SF_SECURITY_TOKEN": "yourtoken",
        "SF_API_VERSION": "62.0"
      }
    }
  }
}
```

Or reference a `.env` file:

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/absolute/path/to/salesforce-mcp-server/dist/index.js"],
      "cwd": "/absolute/path/to/salesforce-mcp-server"
    }
  }
}
```

---

## Available Tools (15)

### Query & Search
| Tool | Description |
|---|---|
| `sf_query` | Execute SOQL with injection prevention + complexity scoring |
| `sf_search` | Full-text SOSL search across multiple objects |

### Record CRUD
| Tool | Description |
|---|---|
| `sf_get_record` | Retrieve a single record by ID |
| `sf_create_record` | Create a new record in any sObject |
| `sf_update_record` | Update a record by ID |
| `sf_upsert_record` | Upsert using an external ID field |
| `sf_delete_record` | Delete a record by ID |

### Metadata & Schema
| Tool | Description |
|---|---|
| `sf_describe` | Describe an sObject (fields, picklists, record types) |
| `sf_describe_global` | List all sObjects in the org |
| `sf_get_updated` | Records updated in a date range |
| `sf_get_deleted` | Records deleted (tombstones) in a date range |

### Advanced
| Tool | Description |
|---|---|
| `sf_merge` | Merge duplicate records |
| `sf_convert_lead` | Convert a Lead to Contact/Account/Opportunity |
| `sf_apex_rest` | Invoke a custom Apex REST endpoint |
| `sf_health` | Health check with connectivity test |

---

## Available Resources (3)

| URI | Description | Cache TTL |
|---|---|---|
| `sf://org/describe` | Global describe of all sObjects | 5 min |
| `sf://org/limits` | API usage limits | 60 sec |
| `sf://schema/{sObjectType}` | Full schema for one sObject | 5 min |

---

## Authentication Modes

### JWT Bearer (Production)

1. Create a Connected App in Salesforce with OAuth + certificate
2. Generate an RSA key pair: `openssl genrsa -out server.key 2048`
3. Create a self-signed cert: `openssl req -new -x509 -key server.key -out server.crt -days 365`
4. Upload `server.crt` to your Connected App
5. Set environment:
   ```
   SF_AUTH_MODE=jwt
   SF_CLIENT_ID=<consumer key>
   SF_USERNAME=<api-user@example.com>
   SF_PRIVATE_KEY_PATH=./certs/server.key
   ```

### Username + Password (Dev/Sandbox)

```
SF_AUTH_MODE=password
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=yourtoken
```

---

## Query Guardrails

Every `sf_query` call passes through two layers:

### Injection Prevention

Blocks:
- DML keywords (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `UPSERT`)
- SQL comments (`--`, `/* */`)
- Multiple statements (`;`)
- `SELECT *` (not valid SOQL anyway, but blocked explicitly)
- Empty or oversized queries (> 10,000 chars by default)

### Complexity Scoring

| Factor | Penalty |
|---|---|
| Subquery per instance | +2 |
| Missing WHERE | +3 |
| Missing LIMIT | +2 |
| COUNT/SUM/AVG/MAX/MIN | +1 each |
| Leading wildcard `LIKE '%foo` | +2 |

Default threshold: **8** — queries scoring ≥ 8 are rejected with a descriptive error.

---

## Circuit Breaker

State machine: `CLOSED → OPEN → HALF-OPEN → CLOSED`

| Config | Default |
|---|---|
| `CB_FAILURE_THRESHOLD` | 5 consecutive failures |
| `CB_RESET_TIMEOUT_MS` | 60,000 ms (60 s) |
| `CB_HALF_OPEN_MAX_CALLS` | 2 probe calls |

Tracked failure types: `CONNECTIVITY_ERROR`, `TIMEOUT`, `AUTH_ERROR`

---

## Audit Log Format

Every operation emits a structured JSON log entry:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "correlationId": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "caller": "sf_query",
  "operation": "QUERY",
  "sObject": "Account",
  "soql": "SELECT Id, Name FROM Account LIMIT 10",
  "success": true,
  "recordCount": 10,
  "durationMs": 234,
  "apiVersion": "62.0"
}
```

---

## Response Envelope

All tools return a normalised envelope:

```json
{
  "success": true,
  "data": { ... },
  "metadata": {
    "correlationId": "...",
    "durationMs": 234,
    "timestamp": "...",
    "apiVersion": "62.0"
  }
}
```

Error responses follow RFC 7807:

```json
{
  "success": false,
  "error": {
    "status": 400,
    "errorCode": "QUERY_INJECTION_DETECTED",
    "message": "Query rejected by security guardrail",
    "detail": "DML keyword DELETE detected in SOQL query",
    "correlationId": "...",
    "timestamp": "..."
  }
}
```

---

## Running Tests

```bash
npm test
# or with coverage:
npm run test:coverage
```

Tests cover:
- `query-validator.test.ts` — injection patterns, complexity scoring, edge cases
- `circuit-breaker.test.ts` — state transitions, timers, half-open probing
- `response-normalizer.test.ts` — envelope structure, error formatting

---

## HTTP Transport

When started with `--transport http`, the server exposes:

- `POST /mcp` — MCP streamable-HTTP endpoint
- `GET /health` — liveness probe (no SF auth required)

Optional API key protection:
```
HTTP_API_KEY=my-secret-key
# Clients must send: Authorization: Bearer my-secret-key
```

---

## Project Structure

```
salesforce-mcp-server/
├── src/
│   ├── index.ts               # Entry point, transport selection
│   ├── server.ts              # MCP server, tool & resource registration
│   ├── config.ts              # Env loader + validation
│   ├── auth/
│   │   ├── sf-auth.ts         # JWT + password auth, auto-refresh
│   │   └── types.ts           # Auth-related types
│   ├── tools/
│   │   ├── query.ts           # sf_query, sf_search
│   │   ├── crud.ts            # get_record, create, update, upsert, delete
│   │   ├── metadata.ts        # describe, describe_global, get_updated, get_deleted
│   │   ├── advanced.ts        # merge, convert_lead, apex_rest
│   │   └── health.ts          # sf_health
│   ├── resources/
│   │   ├── schema.ts          # sf://schema/{sObjectType}
│   │   └── org.ts             # sf://org/describe, sf://org/limits
│   ├── guardrails/
│   │   ├── query-validator.ts # Injection prevention + complexity scoring
│   │   └── circuit-breaker.ts # In-memory circuit breaker
│   ├── utils/
│   │   ├── response-normalizer.ts
│   │   ├── error-handler.ts
│   │   └── audit-logger.ts
│   └── types/
│       └── salesforce.ts
└── tests/
    ├── query-validator.test.ts
    ├── circuit-breaker.test.ts
    └── response-normalizer.test.ts
```

---

## License

MIT — see [LICENSE](LICENSE)
