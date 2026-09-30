# Mule 4 Global Error Handler

A production-grade, drop-in global error handling framework for MuleSoft Mule 4 applications.

## What Makes This Different

Most error handler examples out there are copy-paste XML blobs with hardcoded messages. This one is engineered as a **reusable module** with:

- **RFC 7807-inspired** structured error payloads — machine-parseable, not just human-readable
- **Separated DataWeave modules** — error response building and log formatting are importable DWL libraries, not inline transforms
- **Correlation ID tracking** — every error response includes the Mule `correlationId` for end-to-end traceability
- **Message sanitization** — strips Java stack traces and internal class names from consumer-facing responses
- **Structured JSON logging** — ready for Splunk, ELK, Datadog, or any JSON-aware log aggregator
- **Environment-aware config** — separate YAML configs for local/dev/prod with sensible defaults
- **MUnit test suite** — 7 tests covering happy path, error categories, and response structure validation
- **Demo API included** — RAML-first API with endpoints that deliberately trigger each error category

## Project Structure

```
mule4-global-error-handler/
├── pom.xml                                    # Maven config (Mule 4.9.x, latest connectors)
├── mule-artifact.json                         # Mule artifact descriptor
├── src/
│   ├── main/
│   │   ├── mule/
│   │   │   ├── global-error-handler.xml       # ★ THE ERROR HANDLER — ref this in your flows
│   │   │   ├── global-config.xml              # HTTP listener, request configs, APIkit
│   │   │   └── demo-api-main.xml              # Demo API showing how to plug it in
│   │   └── resources/
│   │       ├── api/
│   │       │   └── demo-api.raml              # RAML 1.0 API spec
│   │       ├── dwl/
│   │       │   ├── ErrorResponseBuilder.dwl   # Error payload construction library
│   │       │   └── ErrorLogBuilder.dwl        # Structured log entry library
│   │       ├── config-common.yaml             # Shared config
│   │       ├── config-local.yaml              # Local dev config
│   │       ├── config-dev.yaml                # Dev environment
│   │       ├── config-prod.yaml               # Production
│   │       └── log4j2.xml                     # Logging config
│   └── test/
│       ├── munit/
│       │   └── global-error-handler-test.xml  # MUnit test suite
│       └── resources/
│           └── config-test.yaml               # Test config
└── README.md
```

## Quick Start

### 1. Import into Anypoint Studio

1. **File → Import → Anypoint Studio → Anypoint Studio project from File System**
2. Select the `mule4-global-error-handler` folder
3. Studio will resolve Maven dependencies automatically

### 2. Run Locally

1. Right-click the project → **Run As → Mule Application**
2. Add VM argument: `-Denv=local`
3. The API starts on `http://localhost:8081/api/v1`

### 3. Test the Endpoints

```bash
# Happy path
curl http://localhost:8081/api/v1/users

# 404 — User not found
curl http://localhost:8081/api/v1/users/999

# 400 — Missing required field
curl -X POST http://localhost:8081/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"id": 1, "name": "Test"}'

# 504 — Timeout simulation
curl http://localhost:8081/api/v1/demo-errors/timeout

# 500 — Internal server error
curl http://localhost:8081/api/v1/demo-errors/server-error

# 502 — Bad gateway
curl http://localhost:8081/api/v1/demo-errors/bad-gateway

# Health check
curl http://localhost:8081/api/v1/health
```

## How to Plug Into YOUR Project

It takes exactly **two steps**:

### Step 1: Copy the error handler files

Copy these into your project:
- `src/main/mule/global-error-handler.xml`
- `src/main/resources/dwl/ErrorResponseBuilder.dwl`
- `src/main/resources/dwl/ErrorLogBuilder.dwl`

### Step 2: Reference it in your flow

```xml
<flow name="your-api-main">
    <http:listener config-ref="your-listener" path="/api/*">
        <http:response statusCode="#[vars.httpStatus default 200]">
            <http:headers>#[vars.outboundHeaders default {}]</http:headers>
        </http:response>
        <http:error-response statusCode="#[vars.httpStatus default 500]">
            <http:headers>#[vars.outboundHeaders default {}]</http:headers>
        </http:error-response>
    </http:listener>

    <!-- Your business logic here -->

    <!-- ★ ADD THIS ONE LINE ★ -->
    <error-handler ref="global-error-handler" />
</flow>
```

That's it. Every unhandled error in the flow now gets a structured JSON response with the correct HTTP status code.

## Error Response Format

Every error response follows this structure:

```json
{
    "success": false,
    "error": {
        "status": 404,
        "category": "NOT_FOUND",
        "title": "Resource Not Found",
        "detail": "User with ID 999 was not found",
        "errorType": "APIKIT:NOT_FOUND",
        "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "timestamp": "2026-09-30T15:30:45.123+05:30"
    }
}
```

## Error Categories Covered

| HTTP Status | Category | Triggered By |
|-------------|----------|-------------|
| 400 | BAD_REQUEST | Validation failures, malformed input, expression errors |
| 401 | UNAUTHORIZED | Missing/invalid credentials, client security |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource not found (APIkit or custom) |
| 405 | METHOD_NOT_ALLOWED | Wrong HTTP method for endpoint |
| 406 | NOT_ACCEPTABLE | Accept header mismatch |
| 409 | CONFLICT | Duplicate message, routing conflicts |
| 415 | UNSUPPORTED_MEDIA_TYPE | Wrong Content-Type |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_SERVER_ERROR | Catch-all for unhandled errors |
| 502 | BAD_GATEWAY | Downstream returned unparseable response |
| 503 | SERVICE_UNAVAILABLE | Downstream unreachable, retry exhausted |
| 504 | GATEWAY_TIMEOUT | Downstream timeout |

## Tech Stack

| Component | Version |
|-----------|---------|
| Mule Runtime | 4.9.4 (LTS) |
| HTTP Connector | 1.11.0 |
| APIkit Module | 1.12.7 |
| Validation Module | 2.0.7 |
| MUnit | 3.2.2 |
| Mule Maven Plugin | 4.8.0 |

## License

MIT

## Author

**Mohan Phani** — [github.com/mohan-phani](https://github.com/mohan-phani)
