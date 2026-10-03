# Salesforce MCP Server

A production-grade [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI agents (Claude, GPT-4o, Gemini, etc.) safe, auditable, schema-aware access to any Salesforce org.

## Why This Server?

| Feature | This server | Most SF MCP servers |
|---|---|---|
| **OAuth 2.0 login** | Browser-based, no security token needed | Username + password |
| SOQL injection prevention | Blocks DML, comments, `SELECT *` | None |
| Query complexity scoring | Penalises cartesian joins | None |
| Circuit breaker | Trips on 5 consecutive failures | None |
| Audit trail (structured JSON) | Every operation logged | None |
| Schema-as-resource | Agents inspect fields before querying | None |
| Dual transport | stdio + streamable-HTTP | stdio only |

---

## Setup (15 minutes)

### Prerequisites

- **Node.js 18+** — [Download here](https://nodejs.org/)
- **A Salesforce org** — [Free Developer Edition](https://developer.salesforce.com/signup) works perfectly

### Step 1: Create a Connected App in Salesforce

This is a one-time setup. It creates an OAuth "key" that lets the server connect to your org.

1. Log into your Salesforce org
2. Go to **Setup** → search for **App Manager** → click **New Connected App**
3. Fill in:
   - **Connected App Name**: `MCP Server`
   - **API Name**: `MCP_Server` (auto-fills)
   - **Contact Email**: your email
4. Under **API (Enable OAuth Settings)**:
   - Check **Enable OAuth Settings**
   - **Callback URL**: `http://localhost:8443/callback`
   - **Selected OAuth Scopes** — add these:
     - `Full access (full)`
     - `Perform requests at any time (refresh_token, offline_access)`
   - Uncheck **Require Proof Key for Code Exchange (PKCE)**
   - Check **Require Secret for Web Server Flow**
   - Check **Require Secret for Refresh Token Flow**
5. Click **Save**, then **Continue**
6. Wait 2–10 minutes for Salesforce to activate the app
7. Click **Manage Consumer Details** → verify your identity
8. Copy the **Consumer Key** and **Consumer Secret** — you'll need these next

### Step 2: Clone and install

```bash
git clone https://github.com/mohan-phani/mohan-lab
cd mohan-lab/salesforce-mcp-server
npm install
```

### Step 3: Configure

```bash
cp .env.example .env
```

Edit `.env` and fill in **only these two values**:

```env
SF_CLIENT_ID=paste-your-consumer-key-here
SF_CLIENT_SECRET=paste-your-consumer-secret-here
```

That's it. Everything else has sensible defaults.

### Step 4: Build

```bash
npm run build
```

### Step 5: Authorize (one time)

```bash
npm start
```

The first time you run this, it will:
1. Open your browser to the Salesforce login page
2. You log in and click **Allow**
3. The browser shows "Connected to Salesforce!" — you can close it
4. The server stores a refresh token locally so you never have to do this again

> **Note:** On subsequent runs, authorization is automatic (no browser needed).

### Step 6: Connect to Claude Desktop

Add this to your Claude Desktop config (`Settings → Developer → Edit Config`):

**macOS** config path: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows** config path: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["/FULL/PATH/TO/salesforce-mcp-server/dist/index.js"],
      "env": {
        "SF_AUTH_MODE": "oauth",
        "SF_CLIENT_ID": "your-consumer-key",
        "SF_CLIENT_SECRET": "your-consumer-secret",
        "SF_LOGIN_URL": "https://login.salesforce.com"
      }
    }
  }
}
```

Replace `/FULL/PATH/TO/` with the actual absolute path to the project.

**Then fully quit and relaunch Claude Desktop** (including the system tray icon).

---

## Authentication Modes

### OAuth 2.0 Web Server Flow (Default — Recommended)

The default mode. Opens a browser for login, stores a refresh token for silent re-auth.

**Pros:** No security token needed, no special permissions needed, works with any Salesforce edition (including free Developer Edition).

```env
SF_AUTH_MODE=oauth
SF_CLIENT_ID=your-consumer-key
SF_CLIENT_SECRET=your-consumer-secret
```

### JWT Bearer Flow (Production / CI)

For headless environments. Requires a Connected App with a certificate.

```env
SF_AUTH_MODE=jwt
SF_CLIENT_ID=your-consumer-key
SF_USERNAME=your-username@example.com
SF_PRIVATE_KEY_PATH=./certs/server.key
```

### Password Flow (Legacy — NOT Recommended)

Uses username + password + security token. May require the "Use Any API" permission set which is not available in all orgs.

```env
SF_AUTH_MODE=password
SF_USERNAME=your-username@example.com
SF_PASSWORD=your-password
SF_SECURITY_TOKEN=your-security-token
```

---

## Available Tools (15)

| Tool | Description |
|---|---|
| `sf_query` | Run SOQL queries with injection prevention |
| `sf_search` | SOSL full-text search |
| `sf_get_record` | Retrieve a single record by ID |
| `sf_create_record` | Create a new record |
| `sf_update_record` | Update an existing record |
| `sf_upsert_record` | Upsert via external ID |
| `sf_delete_record` | Delete a record |
| `sf_describe` | Describe an sObject's schema |
| `sf_describe_global` | List all sObjects in the org |
| `sf_get_updated` | Get records updated in a date range |
| `sf_get_deleted` | Get records deleted in a date range |
| `sf_merge` | Merge duplicate records |
| `sf_convert_lead` | Convert Lead to Contact/Account/Opportunity |
| `sf_apex_rest` | Call custom Apex REST endpoints |
| `sf_health` | Health check + circuit breaker stats |

## Resources

| URI | Description |
|---|---|
| `sf://org/describe` | Org metadata (all sObjects) |
| `sf://org/limits` | API usage limits |
| `sf://schema/{sObjectType}` | Detailed schema for any sObject |

---

## Development

```bash
npm run build          # Build with esbuild (fast, <1 second)
npm run typecheck      # Type-check with tsc (no emit)
npm test               # Run tests
npm run test:coverage  # Tests + coverage report
npm run dev            # Run directly with ts-node (no build)
```

### HTTP Transport

For multi-client setups or testing with tools like Postman:

```bash
npm run start:http     # Starts HTTP server on port 3000
```

Optionally protect with an API key:

```env
HTTP_PORT=3000
HTTP_API_KEY=your-secret-key
```

---

## Troubleshooting

### "OAuth token exchange failed (400)"
- Wait 2–10 minutes after creating the Connected App — Salesforce needs time to activate it
- Verify the callback URL in your Connected App matches `http://localhost:8443/callback`
- Make sure you checked "Require Secret for Web Server Flow"

### "EADDRINUSE: port 8443 already in use"
- Another process is using port 8443. Either stop it or change `SF_CALLBACK_PORT` in your `.env`

### Build errors / tsc out of memory
- The project uses `esbuild` for building (fast, no OOM). Run `npm run build`
- For type checking: `npm run typecheck`

### Claude Desktop doesn't show Salesforce tools
- Fully quit Claude Desktop (including system tray) and relaunch
- Use **absolute paths** in the config (not relative)
- Don't use `console.log()` in stdio mode — it corrupts the MCP protocol. We use `console.error()` instead
- Check logs: macOS `~/Library/Logs/Claude/`, Windows `%APPDATA%\Claude\logs\`

### "INSUFFICIENT_ACCESS" or "Use Any API" errors
- This happens with the **password** auth mode on Developer Edition orgs
- **Solution:** Switch to `SF_AUTH_MODE=oauth` (the default). OAuth doesn't need this permission

### Circuit breaker is OPEN
- The server detected 5+ consecutive Salesforce API failures and is protecting your org
- Wait 60 seconds for it to reset, or restart the server
- Check if your Salesforce org is accessible

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `SF_AUTH_MODE` | `oauth` | Auth mode: `oauth`, `jwt`, or `password` |
| `SF_LOGIN_URL` | `https://login.salesforce.com` | Login endpoint |
| `SF_API_VERSION` | `62.0` | Salesforce API version |
| `SF_CLIENT_ID` | — | Connected App Consumer Key |
| `SF_CLIENT_SECRET` | — | Connected App Consumer Secret |
| `SF_CALLBACK_PORT` | `8443` | Local port for OAuth callback |
| `CB_FAILURE_THRESHOLD` | `5` | Failures before circuit breaker trips |
| `CB_RESET_TIMEOUT_MS` | `60000` | Circuit breaker reset timeout (ms) |
| `QUERY_MAX_LENGTH` | `10000` | Max SOQL query length |
| `QUERY_COMPLEXITY_THRESHOLD` | `8` | Max query complexity score |
| `LOG_LEVEL` | `info` | Logging level |

---

## License

MIT
