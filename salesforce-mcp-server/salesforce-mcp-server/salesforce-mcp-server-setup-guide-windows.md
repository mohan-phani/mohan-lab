# Salesforce Universal MCP Server — Complete Setup Guide (Windows)

**For:** Windows users who are new to Salesforce, AI agents, and MCP  
**Time needed:** 45–60 minutes  
**What you'll have at the end:** A running Salesforce MCP server that Claude Desktop can talk to

---

## Table of Contents

1. [What Is This? (Plain English)](#1-what-is-this-plain-english)
2. [Step 1 — Create a Free Salesforce Account](#2-step-1--create-a-free-salesforce-account)
3. [Step 2 — Get Your Salesforce Credentials](#3-step-2--get-your-salesforce-credentials)
4. [Step 3 — Install Node.js on Windows](#4-step-3--install-nodejs-on-windows)
5. [Step 4 — Extract and Set Up the MCP Server](#5-step-4--extract-and-set-up-the-mcp-server)
6. [Step 5 — Configure Your Environment File](#6-step-5--configure-your-environment-file)
7. [Step 6 — Build and Run Unit Tests](#7-step-6--build-and-run-unit-tests)
8. [Step 7 — Connect Claude Desktop](#8-step-7--connect-claude-desktop)
9. [Step 8 — Test via Claude Desktop Chat](#9-step-8--test-via-claude-desktop-chat)
10. [Step 9 — Test with MCP Inspector (Browser Tool)](#10-step-9--test-with-mcp-inspector-browser-tool)
11. [Step 10 — Test with Postman (HTTP Transport)](#11-step-10--test-with-postman-http-transport)
12. [Troubleshooting](#12-troubleshooting)
13. [Glossary](#13-glossary)

---

## 1. What Is This? (Plain English)

**MCP (Model Context Protocol)** is a standard that lets AI assistants like Claude call tools — just like a web browser calls APIs. Instead of Claude only knowing things from its training, it can ask your MCP server to query Salesforce, create records, search data, and more — in real time.

**This project** is your own MCP server that sits between Claude and Salesforce. When you ask Claude "show me all open Opportunities over $100K", Claude calls your server, your server queries Salesforce securely, and Claude explains the results to you.

Think of it like this:

```
You → Claude Desktop → Your MCP Server → Salesforce
                    ← data ←           ← query result ←
```

The server includes built-in safety features copied from enterprise Mule integrations:
- **SOQL injection prevention** — stops malicious queries (like SQL injection but for Salesforce)
- **Circuit breaker** — stops hammering Salesforce if it's down
- **Audit logging** — records every operation for compliance

> **Note on running commands:** All commands in this guide are for **PowerShell** (not Command Prompt). To open PowerShell: press `Windows + X` → click "Windows PowerShell" or "Terminal". On Windows 11 the default terminal app is already PowerShell.

---

## 2. Step 1 — Create a Free Salesforce Account

A **Developer Edition** (DE) is a permanent free Salesforce org with sample data. It is NOT a trial — it never expires.

### 2.1 Sign Up

1. Open your browser and go to: **https://developer.salesforce.com/signup**
2. Fill in the form:
   - **First Name / Last Name** — your real name (used in the org)
   - **Email** — use a real email you check (Salesforce sends a confirmation)
   - **Role** — choose "Developer"
   - **Company** — anything works (e.g., "Personal")
   - **Country** — United States (or your country)
   - **Postal Code** — your zip code
   - **Username** — this is **not** your email login. It must look like an email (`yourname@example-dev.com`) but it doesn't need to be real. Make it unique, e.g., `mohan.sfmcp.dev@example.com`
     > ⚠️ **Write this username down!** You will need it constantly.
3. Click **Sign me up**
4. Check your email for a message from Salesforce with subject "Verify your email for your Salesforce account"
5. Click **Verify Account** in the email
6. Set a password:
   - At least 8 characters
   - Must include a letter AND a number AND a special character
   - Write it down securely
7. You'll land on your new Salesforce org home page. You're in!

### 2.2 First Look at Your Org

The URL in your browser will look like:
```
https://yourcompany.my.salesforce.com/
```

This is your **instance URL**. Write it down — you'll need it later.

---

## 3. Step 2 — Get Your Salesforce Credentials

You need three things: **username**, **password**, and **security token**.

### 3.1 Your Username and Password

You already have these from Step 1. Your username looks like `mohan.sfmcp.dev@example.com`.

### 3.2 Reset Your Security Token

A security token is an extra security code that Salesforce requires when connecting from outside its trusted IP ranges (like your laptop).

1. In Salesforce, click your **profile avatar** (top right corner)
2. Click **Settings**
3. In the left sidebar, under "My Personal Information", click **Reset My Security Token**
4. Click the **Reset Security Token** button
5. Salesforce emails you a new token immediately. Check your email.
6. The token looks like: `aBcDeFgHiJkLmNoPqRsT` (a string of ~25 characters)
7. **Copy it and keep it safe** — once you navigate away from the email, Salesforce won't show it again. You can always reset again if you lose it.

> **What is the security token for?**  
> When you log in from a new computer or IP address, Salesforce requires your password + security token together. Your actual password field in the `.env` file must be `YourPassword` alone, and the security token goes in a separate field. The MCP server appends them correctly when authenticating.

### 3.3 Find Your Login URL

Use:
```
https://login.salesforce.com
```

This is the standard Salesforce login endpoint. Even though your org has its own URL, authentication happens at `login.salesforce.com`.

---

## 4. Step 3 — Install Node.js on Windows

The MCP server is written in TypeScript/Node.js. You need Node.js 18 or higher.

### 4.1 Check if Node.js is Already Installed

Open **PowerShell** and run:

```powershell
node --version
```

If you see `v18.x.x` or `v20.x.x` or higher — you're done! Skip to Step 4.

If you see an error like `node : The term 'node' is not recognized`, continue below.

### 4.2 Install Node.js

**Option A — Install from the official website (recommended for beginners):**

1. Go to **https://nodejs.org**
2. Download the **LTS** version (e.g., "22.x LTS") — click the big green button
3. Open the downloaded `.msi` installer
4. Follow the installer steps:
   - Accept the license agreement
   - Keep the default install location (`C:\Program Files\nodejs\`)
   - On the "Tools for Native Modules" screen, check "Automatically install the necessary tools" if you see it
   - Click Install
5. When done, **close and reopen PowerShell**, then run `node --version` to verify

> If PowerShell says `node` is still not recognized after installing, try closing and reopening it. If still not working, restart your computer.

**Option B — Install using winget (Windows Package Manager, built into Windows 11):**

```powershell
winget install OpenJS.NodeJS.LTS
```

### 4.3 Verify npm Is Installed

npm (Node Package Manager) comes bundled with Node.js:

```powershell
npm --version
```

You should see something like `10.x.x`.

---

## 5. Step 4 — Extract and Set Up the MCP Server

### 5.1 Move the Zip File to a Good Location

The zip file you received is `salesforce-mcp-server.zip`. Place it somewhere permanent — not your Downloads folder. Recommended:

```
C:\Dev\salesforce-mcp-server.zip
```

To create that folder and move the zip:

```powershell
New-Item -ItemType Directory -Path C:\Dev -Force
Move-Item "$env:USERPROFILE\Downloads\salesforce-mcp-server.zip" C:\Dev\
```

### 5.2 Extract the Zip

```powershell
Expand-Archive -Path C:\Dev\salesforce-mcp-server.zip -DestinationPath C:\Dev\
```

You'll now have:

```
C:\Dev\salesforce-mcp-server\
├── src\                    ← TypeScript source code
│   ├── index.ts            ← Entry point
│   ├── server.ts           ← MCP server with all 15 tools
│   ├── config.ts           ← Configuration (reads .env)
│   ├── auth\               ← Salesforce authentication
│   ├── tools\              ← Tool implementations
│   ├── guardrails\         ← Security (injection prevention, circuit breaker)
│   ├── resources\          ← MCP resources (schema, limits)
│   └── utils\              ← Helpers
├── tests\                  ← Unit tests
├── package.json            ← Dependencies list
├── tsconfig.json           ← TypeScript compiler settings
├── .env.example            ← Template for your secrets
└── mcp.json                ← Claude Desktop config example
```

### 5.3 Open PowerShell in the Project Folder

```powershell
cd C:\Dev\salesforce-mcp-server
```

All commands from here on assume you're in this directory. You can verify with:

```powershell
pwd
```

It should show `C:\Dev\salesforce-mcp-server`.

### 5.4 Allow PowerShell to Run Scripts

Windows blocks unsigned scripts by default. Run this once (you'll need to confirm):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Type `Y` and press Enter when prompted.

### 5.5 Install Dependencies

```powershell
npm install
```

This downloads all the libraries the server needs. It creates a `node_modules\` folder. This takes 1–2 minutes.

---

## 6. Step 5 — Configure Your Environment File

The server reads credentials from a `.env` file. This file is **never committed to Git** (it's in `.gitignore`).

### 6.1 Copy the Template

```powershell
Copy-Item .env.example .env
```

### 6.2 Edit the File

> **Important:** Windows Notepad may not handle Unix line endings well. Use **Notepad++** (free, at https://notepad-plus-plus.org) or **VS Code** (free, at https://code.visualstudio.com) for editing `.env` files.

Open `.env` in Notepad++ or VS Code:

```powershell
# If VS Code is installed:
code .env

# Or open with Notepad (works fine for simple edits):
notepad .env
```

Find and fill in these fields (the rest can stay as their defaults):

```
# Authentication mode — use "password" for Developer Edition
SF_AUTH_MODE=password

# Salesforce login URL — always this for standard orgs
SF_LOGIN_URL=https://login.salesforce.com

# Your Salesforce username (looks like an email)
SF_USERNAME=mohan.sfmcp.dev@example.com

# Your Salesforce password (just the password, NOT the token)
SF_PASSWORD=YourActualPassword123!

# Your security token from Step 2.2
SF_SECURITY_TOKEN=aBcDeFgHiJkLmNoPqRsT

# API version — leave as is
SF_API_VERSION=62.0
```

Save the file (`Ctrl + S`).

> **Security reminder:** The `.env` file contains your Salesforce password. Never share it, never commit it to GitHub. The `.gitignore` file already excludes it.

### 6.3 What the Other Settings Do (Leave as Defaults for Now)

| Setting | Default | What it does |
|---|---|---|
| `CB_FAILURE_THRESHOLD` | `5` | How many connection failures before the circuit breaker trips |
| `CB_RESET_TIMEOUT_MS` | `60000` | How long (ms) before retrying after a circuit break (60 seconds) |
| `QUERY_MAX_LENGTH` | `10000` | Maximum SOQL query length |
| `QUERY_COMPLEXITY_THRESHOLD` | `8` | Max complexity score before a query is rejected |
| `CACHE_SCHEMA_TTL` | `300` | Seconds to cache schema (describe) results |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |

---

## 7. Step 6 — Build and Run Unit Tests

### 7.1 Build the TypeScript

TypeScript must be compiled to JavaScript before running:

```powershell
npm run build
```

You should see output like:
```
> salesforce-mcp-server@1.0.0 build
> tsc
```

No output after that line means success. If you see red error lines starting with a file path, the TypeScript has a type error — check that you haven't accidentally edited a source file.

The compiled JavaScript goes into `dist\`:

```
dist\
├── index.js        ← This is what Node runs
├── server.js
├── config.js
└── ...
```

### 7.2 Run Unit Tests

The project has three test files that run **without connecting to Salesforce** — they test internal logic only:

```powershell
npm test
```

Expected output:
```
PASS tests/query-validator.test.ts
  validateQuery — basic guards
    ✓ rejects empty query
    ✓ accepts valid SELECT query
    ...

PASS tests/circuit-breaker.test.ts
  CircuitBreaker — CLOSED state
    ✓ starts in CLOSED state
    ...

PASS tests/response-normalizer.test.ts
  normalizeSuccess
    ✓ returns success: true envelope
    ...

Test Suites: 3 passed, 3 total
Tests:       XX passed, XX total
```

All tests should pass. If any fail, the error message below the test name explains what's wrong.

### 7.3 Start the Server Manually (Sanity Check)

Run the server in stdio mode:

```powershell
node dist/index.js --transport stdio
```

You'll see log output:
```json
{"level":"info","message":"Salesforce MCP Server starting","transport":"stdio"}
```

The server is waiting for MCP messages. Press `Ctrl + C` to stop it. This confirms the build works.

### 7.4 Run in HTTP Mode (Optional Test)

```powershell
node dist/index.js --transport http
```

Output:
```json
{"level":"info","message":"HTTP server listening","port":3000,"path":"/mcp"}
```

The server is now accessible at `http://localhost:3000/mcp`. Press `Ctrl + C` to stop.

---

## 8. Step 7 — Connect Claude Desktop

Claude Desktop uses MCP servers defined in a configuration file.

### 8.1 Find the Claude Desktop Config File

On Windows the file lives at:
```
%APPDATA%\Claude\claude_desktop_config.json
```

`%APPDATA%` is a Windows shortcut for `C:\Users\YourUsername\AppData\Roaming`.

To open the folder in File Explorer, press `Windows + R`, type:
```
%APPDATA%\Claude
```
and press Enter.

If the `Claude` folder doesn't exist, create it:

```powershell
New-Item -ItemType Directory -Path "$env:APPDATA\Claude" -Force
```

### 8.2 Create or Edit the Config File

Open it with VS Code or Notepad:

```powershell
# VS Code (preferred):
code "$env:APPDATA\Claude\claude_desktop_config.json"

# Or Notepad:
notepad "$env:APPDATA\Claude\claude_desktop_config.json"
```

Paste this content — **replace the path and credentials with your own values**:

```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["C:\\Dev\\salesforce-mcp-server\\dist\\index.js"],
      "env": {
        "SF_AUTH_MODE": "password",
        "SF_LOGIN_URL": "https://login.salesforce.com",
        "SF_USERNAME": "mohan.sfmcp.dev@example.com",
        "SF_PASSWORD": "YourActualPassword123!",
        "SF_SECURITY_TOKEN": "aBcDeFgHiJkLmNoPqRsT",
        "SF_API_VERSION": "62.0",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

> **Windows path rule:** In JSON, backslashes must be doubled. Write `C:\\Dev\\salesforce-mcp-server\\dist\\index.js`, NOT `C:\Dev\...`

Save the file (`Ctrl + S`).

### 8.3 Validate the JSON

Before restarting Claude, validate the JSON is well-formed (one wrong character breaks it):

1. Copy the entire file contents
2. Go to **https://jsonlint.com**
3. Paste it in and click **Validate JSON**
4. You should see "Valid JSON"

### 8.4 Restart Claude Desktop

1. Right-click the Claude icon in the **system tray** (bottom-right notification area) → Quit
2. Or use Task Manager (`Ctrl + Shift + Esc`) → find Claude → End Task
3. Reopen Claude Desktop from the Start menu or desktop shortcut

### 8.5 Verify the Server Loaded

In Claude Desktop:
1. Look for the **hammer icon** (🔨) or an MCP indicator in the bottom bar
2. You should see "salesforce" listed as a connected MCP server
3. If you see a red error indicator, check Step 12 (Troubleshooting)

---

## 9. Step 8 — Test via Claude Desktop Chat

Now the fun part — talking to your Salesforce org through Claude.

### 9.1 Basic Health Check

Type this in Claude Desktop:

```
Check the health of my Salesforce connection using the sf_health tool
```

Expected response from Claude:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "circuitBreakerState": "CLOSED",
    "authenticated": true,
    "orgId": "00D...",
    "username": "mohan.sfmcp.dev@example.com"
  }
}
```

### 9.2 Query Some Data

Your Developer Edition org has pre-loaded sample data. Try:

```
Query the 10 most recently created Accounts using sf_query
```

Claude will automatically construct a SOQL query and call your server:

```sql
SELECT Id, Name, Industry, CreatedDate FROM Account ORDER BY CreatedDate DESC LIMIT 10
```

### 9.3 Describe an Object

```
Use sf_describe to show me the fields on the Contact object
```

### 9.4 Create a Test Record

```
Create a new Account in Salesforce called "MCP Test Company" in the Technology industry
```

Claude will call `sf_create_record` with a warning that it creates data, then proceed.

### 9.5 Search Across Objects

```
Search Salesforce for anything related to "Edge" using sf_search
```

This uses SOSL (Salesforce Object Search Language) to search across multiple objects at once.

---

## 10. Step 9 — Test with MCP Inspector (Browser Tool)

**MCP Inspector** is the equivalent of Postman, but for MCP servers. It's a browser app that lets you call tools directly without Claude.

### 10.1 Install and Run MCP Inspector

Make sure you're in the project directory first:

```powershell
cd C:\Dev\salesforce-mcp-server
npx @modelcontextprotocol/inspector dist/index.js
```

If it asks to install the package, type `y` and press Enter. Wait a moment — it may take 10–15 seconds to start.

### 10.2 Open Inspector in Browser

The terminal will show:
```
MCP Inspector running at http://localhost:5173
```

Open your browser and go to: **http://localhost:5173**

### 10.3 Using the Inspector

The Inspector has three panels:

**Left panel — Connection:**
- Command: `node`
- Arguments: `C:\Dev\salesforce-mcp-server\dist\index.js`
- Click **Connect**

**Middle panel — Tools:**
- You'll see all 15 tools listed: `sf_query`, `sf_health`, `sf_describe`, etc.
- Click any tool to expand it

**Right panel — Input/Output:**
- Fill in the tool's parameters
- Click **Run Tool**
- See the JSON response

### 10.4 Test sf_health

1. Click **sf_health** in the tools list
2. Set `includeLimits` to `true`
3. Click **Run Tool**
4. You'll see the health response with API limits remaining

### 10.5 Test sf_query

1. Click **sf_query**
2. Set `soql` to: `SELECT Id, Name FROM Account LIMIT 5`
3. Click **Run Tool**
4. You'll see Account records from your org

### 10.6 Test the SOQL Injection Prevention

1. Click **sf_query**
2. Set `soql` to: `SELECT Id FROM Account; DELETE FROM Account`
3. Click **Run Tool**
4. The server should **reject** this with a validation error — the security feature in action

---

## 11. Step 10 — Test with Postman (HTTP Transport)

For this you need the HTTP transport mode, which starts an Express web server.

### 11.1 Start the Server in HTTP Mode

Open a **new** PowerShell window (so you can keep this server running while you use Postman):

```powershell
cd C:\Dev\salesforce-mcp-server
node dist/index.js --transport http
```

Output:
```json
{"message":"HTTP server listening","port":3000,"path":"/mcp"}
```

Keep this window open.

### 11.2 Open Postman

If you don't have Postman: download it free from **https://www.postman.com/downloads/** and install it.

### 11.3 Set Up the MCP Endpoint

**Create a new request in Postman:**

- Method: `POST`
- URL: `http://localhost:3000/mcp`
- Click the **Headers** tab and add:
  - Key: `Content-Type` → Value: `application/json`
  - Key: `Accept` → Value: `application/json, text/event-stream`

### 11.4 Initialize the Session

Click the **Body** tab → select **raw** → select **JSON** from the dropdown.

Paste:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "postman-test",
      "version": "1.0.0"
    }
  }
}
```

Click **Send**. You'll get a response like:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "salesforce-mcp-server",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": {},
      "resources": {}
    }
  }
}
```

Look at the **Response Headers** panel in Postman and copy the value of `Mcp-Session-Id` — you'll need it for all following requests.

### 11.5 List Available Tools

Add a new header: `Mcp-Session-Id: <paste the value from step 11.4>`

Change the body to:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Click **Send**. You'll see all 15 tools with their descriptions.

### 11.6 Call sf_health Tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "sf_health",
    "arguments": {
      "includeLimits": true
    }
  }
}
```

### 11.7 Call sf_query Tool

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "sf_query",
    "arguments": {
      "soql": "SELECT Id, Name, Industry FROM Account LIMIT 5"
    }
  }
}
```

### 11.8 Check the Liveness Endpoint

This is a simple GET request — no MCP protocol or session header needed:

- Method: `GET`
- URL: `http://localhost:3000/health`

Response:
```json
{
  "status": "ok",
  "server": "salesforce-mcp-server",
  "version": "1.0.0"
}
```

---

## 12. Troubleshooting

### "Authentication failed" or "INVALID_LOGIN"

**Cause:** Wrong username, password, or security token.

**Fix:**
1. Confirm your username in Salesforce: click your avatar → Settings → My Personal Information
2. Reset your security token (Step 2.2) — you might be using an old one
3. Double-check: `SF_PASSWORD` = password only; `SF_SECURITY_TOKEN` = token only (not combined)

### "node is not recognized" in PowerShell

**Cause:** Node.js isn't installed, or PATH hasn't updated yet.

**Fix:**
1. Close PowerShell completely and reopen it
2. If still failing, restart your computer
3. Verify the install: open `C:\Program Files\nodejs\` in File Explorer — `node.exe` should be there

### "npm : File ... cannot be loaded because running scripts is disabled"

**Cause:** PowerShell execution policy is blocking scripts.

**Fix:**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Type `Y` and press Enter.

### "Cannot find module" when running the server

**Cause:** You didn't run `npm install` or `npm run build`, or you're in the wrong folder.

**Fix:**
```powershell
cd C:\Dev\salesforce-mcp-server
npm install
npm run build
```

### Claude Desktop doesn't show "salesforce" in MCP servers

**Cause:** JSON syntax error in `claude_desktop_config.json`, wrong path, or backslash not doubled.

**Fix:**
1. Validate your JSON at **https://jsonlint.com**
2. Check that backslashes are doubled in the path: `C:\\Dev\\salesforce-mcp-server\\dist\\index.js`
3. Verify the file exists: in PowerShell run `Test-Path C:\Dev\salesforce-mcp-server\dist\index.js` — it should return `True` (if `False`, run `npm run build` first)
4. Fully quit Claude Desktop and reopen it

### "EADDRINUSE: address already in use :::3000"

**Cause:** Another process is already using port 3000.

**Fix — Option 1:** Find and stop the process:
```powershell
netstat -ano | findstr :3000
```
Note the PID (last column), then:
```powershell
Stop-Process -Id <PID>
```

**Fix — Option 2:** Use a different port in `.env`:
```
HTTP_PORT=3001
```
Then use `http://localhost:3001/mcp` in Postman.

### "Circuit breaker is OPEN" error

**Cause:** The server had 5+ connection failures in a row and stopped trying.

**Fix:** Wait 60 seconds (the reset timeout). The circuit switches to HALF_OPEN and retries automatically. If Salesforce is reachable, it closes back to CLOSED.

### "Query rejected: complexity score X exceeds threshold 8"

**Cause:** The SOQL query is too expensive (missing WHERE clause, missing LIMIT, subqueries).

**Fix:** Add a WHERE clause and LIMIT:
```sql
-- Bad (score 5: missing WHERE +3, missing LIMIT +2)
SELECT Id, Name FROM Account

-- Good (score 0)
SELECT Id, Name FROM Account WHERE CreatedDate = TODAY LIMIT 50
```

### Windows Firewall blocks localhost connections

**Cause:** Windows Defender Firewall blocking port 3000.

**Fix:** When Windows asks "Do you want to allow Node.js to communicate on this network?", click **Allow access**. Or add a manual rule in Windows Defender Firewall → Allow an app through → add `node.exe`.

---

## 13. Glossary

| Term | What it means |
|---|---|
| **MCP** | Model Context Protocol — the standard Claude uses to call tools |
| **Salesforce Developer Edition (DE)** | Free permanent Salesforce org for developers |
| **SOQL** | Salesforce Object Query Language — like SQL but for Salesforce data |
| **SOSL** | Salesforce Object Search Language — for full-text search across objects |
| **Security Token** | Extra code Salesforce requires when connecting from untrusted IPs |
| **sObject** | Salesforce's term for a data table (Account, Contact, Opportunity, etc.) |
| **jsforce** | Node.js library for talking to Salesforce APIs |
| **Circuit Breaker** | Pattern that stops calling a failing service to give it time to recover |
| **stdio** | Standard input/output — how Claude Desktop communicates with local MCP servers |
| **HTTP transport** | Alternative transport for remote/cloud MCP clients |
| **JWT Bearer** | Advanced auth using RSA keys — for production orgs (not needed for DE) |
| **Connected App** | A Salesforce app registration required for JWT auth |
| **API Version** | Salesforce API version (62.0 = Spring '25 release) |
| **TypeScript** | JavaScript with type checking — the language this server is written in |
| **npm** | Node Package Manager — used to install libraries |
| **PowerShell** | Windows command-line shell (preferred over Command Prompt for this guide) |
| **%APPDATA%** | Windows shortcut for `C:\Users\YourUsername\AppData\Roaming` |
| **PATH** | System variable that tells Windows where to find programs like `node` |
| **`.env` file** | Local file storing secrets (never committed to Git) |
| **ExecutionPolicy** | Windows setting that controls which scripts PowerShell can run |
