import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import jsforce, { Connection } from 'jsforce';
import { getConfig } from '../config.js';
import type { ConnectionInfo } from '../types/salesforce.js';
import type { TokenResponse, OAuthTokenStore } from './types.js';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const TOKEN_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.salesforce-mcp-tokens.json'
);

class SalesforceAuthManager {
  private connection: Connection | null = null;
  private connectionInfo: ConnectionInfo | null = null;
  private refreshPromise: Promise<void> | null = null;
  private tokenExpiresAt: number = 0;

  async getConnection(): Promise<Connection> {
    if (this.connection && this.isConnectionValid()) {
      return this.connection;
    }

    // Deduplicate concurrent auth requests
    if (this.refreshPromise) {
      await this.refreshPromise;
      return this.connection!;
    }

    this.refreshPromise = this.authenticate().finally(() => {
      this.refreshPromise = null;
    });

    await this.refreshPromise;
    return this.connection!;
  }

  getConnectionInfo(): ConnectionInfo | null {
    return this.connectionInfo;
  }

  private isConnectionValid(): boolean {
    if (!this.connection) return false;
    return Date.now() < this.tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  private async authenticate(): Promise<void> {
    const config = getConfig();

    if (config.auth.mode === 'oauth') {
      await this.authenticateOAuth();
    } else if (config.auth.mode === 'jwt') {
      await this.authenticateJwt();
    } else {
      await this.authenticatePassword();
    }
  }

  // ── OAuth 2.0 Web Server (Authorization Code) Flow ──────────────────────
  //
  // First run: opens browser → user logs in → callback captures auth code →
  // exchanges for access + refresh tokens → saves refresh token to disk.
  //
  // Subsequent runs: loads refresh token from disk → exchanges for new
  // access token silently. No browser needed.
  //
  // NO security token required. NO "Use Any API" permission set needed.
  // Works with any Salesforce edition including free Developer orgs.

  private async authenticateOAuth(): Promise<void> {
    const config = getConfig();
    const { clientId, clientSecret, loginUrl, apiVersion, callbackPort } = config.auth;

    // Try to use stored refresh token first
    const stored = this.loadStoredTokens();
    if (stored?.refresh_token) {
      try {
        await this.refreshOAuthToken(stored.refresh_token);
        return;
      } catch (err) {
        // Refresh token expired or revoked — fall through to browser flow
        console.error('Stored refresh token invalid, starting browser auth flow...');
        this.clearStoredTokens();
      }
    }

    // Browser-based authorization
    const authCode = await this.getAuthorizationCode(clientId!, loginUrl, callbackPort);

    // Exchange auth code for tokens
    const callbackUrl = `http://localhost:${callbackPort}/callback`;
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: callbackUrl,
    });

    const response = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OAuth token exchange failed (${response.status}): ${body}`);
    }

    const token = (await response.json()) as TokenResponse;

    // Store refresh token for next time
    if (token.refresh_token) {
      this.saveTokens({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        instance_url: token.instance_url,
        issued_at: Date.now(),
      });
    }

    this.applyToken(token, apiVersion, 'oauth');
    this.tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
  }

  private async refreshOAuthToken(refreshToken: string): Promise<void> {
    const config = getConfig();
    const { clientId, clientSecret, loginUrl, apiVersion } = config.auth;

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
    });

    const response = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OAuth refresh failed (${response.status}): ${body}`);
    }

    const token = (await response.json()) as TokenResponse;

    // Update stored tokens (refresh token might be rotated)
    const stored = this.loadStoredTokens();
    this.saveTokens({
      access_token: token.access_token,
      refresh_token: token.refresh_token || stored?.refresh_token || refreshToken,
      instance_url: token.instance_url,
      issued_at: Date.now(),
    });

    this.applyToken(token, apiVersion, 'oauth');
    this.tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
  }

  private getAuthorizationCode(
    clientId: string,
    loginUrl: string,
    port: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const state = crypto.randomBytes(16).toString('hex');
      const callbackUrl = `http://localhost:${port}/callback`;

      const authUrl =
        `${loginUrl}/services/oauth2/authorize?` +
        new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: callbackUrl,
          state,
          prompt: 'login consent',
        }).toString();

      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          const errorDesc = url.searchParams.get('error_description');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h2>Authorization Failed</h2><p>${errorDesc || error}</p><p>You can close this tab.</p></body></html>`);
            server.close();
            reject(new Error(`OAuth authorization denied: ${errorDesc || error}`));
            return;
          }

          if (returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>State Mismatch</h2><p>Possible CSRF attack. Try again.</p></body></html>');
            server.close();
            reject(new Error('OAuth state mismatch'));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>No Code</h2><p>No authorization code received.</p></body></html>');
            server.close();
            reject(new Error('No authorization code received'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<html><body style="font-family:system-ui;text-align:center;padding:60px">' +
            '<h2 style="color:#22c55e">&#10003; Connected to Salesforce!</h2>' +
            '<p>You can close this tab and return to your terminal.</p>' +
            '</body></html>'
          );
          server.close();
          resolve(code);
        }
      });

      server.listen(port, () => {
        console.error(`\n${'='.repeat(60)}`);
        console.error('SALESFORCE AUTHORIZATION REQUIRED');
        console.error('='.repeat(60));
        console.error(`\nOpen this URL in your browser to connect:\n`);
        console.error(authUrl);
        console.error(`\nWaiting for authorization...\n`);

        // Try to open browser automatically
        import('open').then((openModule) => {
          openModule.default(authUrl).catch(() => {
            // If browser open fails, user will use the printed URL
          });
        }).catch(() => {
          // open module not available, user will use the printed URL
        });
      });

      // 5-minute timeout
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth authorization timed out after 5 minutes'));
      }, 5 * 60 * 1000);
    });
  }

  // ── Token persistence ──────────────────────────────────────────────────

  private loadStoredTokens(): OAuthTokenStore | null {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = fs.readFileSync(TOKEN_FILE, 'utf8');
        return JSON.parse(data) as OAuthTokenStore;
      }
    } catch {
      // Corrupt file — ignore
    }
    return null;
  }

  private saveTokens(tokens: OAuthTokenStore): void {
    try {
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), {
        mode: 0o600, // owner-only read/write
      });
    } catch (err) {
      console.error('Warning: Could not save OAuth tokens:', err);
    }
  }

  private clearStoredTokens(): void {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        fs.unlinkSync(TOKEN_FILE);
      }
    } catch {
      // ignore
    }
  }

  // ── JWT Bearer Flow (production / CI) ──────────────────────────────────

  private async authenticateJwt(): Promise<void> {
    // Dynamic import — only loaded when JWT mode is used
    const jwt = await import('jsonwebtoken');
    const config = getConfig();
    const { clientId, username, loginUrl, apiVersion, privateKey, privateKeyPath } = config.auth;

    let privateKeyPem: string;
    if (privateKey) {
      privateKeyPem = privateKey.replace(/\\n/g, '\n');
    } else if (privateKeyPath) {
      const resolvedPath = path.resolve(privateKeyPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Private key file not found: ${resolvedPath}`);
      }
      privateKeyPem = fs.readFileSync(resolvedPath, 'utf8');
    } else {
      throw new Error('No private key configured for JWT auth');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientId!,
      sub: username!,
      aud: loginUrl,
      exp: now + 180,
    };

    const assertion = jwt.default.sign(payload, privateKeyPem, { algorithm: 'RS256' });

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const response = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`JWT auth failed (${response.status}): ${body}`);
    }

    const token = (await response.json()) as TokenResponse;
    this.applyToken(token, apiVersion, 'jwt');
    this.tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
  }

  // ── Password Flow (legacy) ─────────────────────────────────────────────

  private async authenticatePassword(): Promise<void> {
    const config = getConfig();
    const { username, password, securityToken, loginUrl, apiVersion, clientId, clientSecret } =
      config.auth;

    const conn = new jsforce.Connection({
      loginUrl,
      version: apiVersion,
    });

    const passwordWithToken = securityToken ? `${password}${securityToken}` : password!;

    try {
      if (clientId && clientSecret) {
        const params = new URLSearchParams({
          grant_type: 'password',
          client_id: clientId,
          client_secret: clientSecret,
          username: username!,
          password: passwordWithToken,
        });

        const response = await fetch(`${loginUrl}/services/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Password auth failed (${response.status}): ${body}`);
        }

        const token = (await response.json()) as TokenResponse;
        this.applyToken(token, apiVersion, 'password');
      } else {
        await conn.login(username!, passwordWithToken);
        this.connection = conn;
        this.connectionInfo = {
          instanceUrl: conn.instanceUrl,
          accessToken: conn.accessToken!,
          apiVersion,
          authMode: 'password',
          connectedAt: new Date(),
        };
      }

      this.tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Salesforce authentication failed: ${message}`);
    }
  }

  // ── Shared helpers ─────────────────────────────────────────────────────

  private applyToken(
    token: TokenResponse,
    apiVersion: string,
    mode: 'oauth' | 'jwt' | 'password'
  ): void {
    this.connection = new jsforce.Connection({
      instanceUrl: token.instance_url,
      accessToken: token.access_token,
      version: apiVersion,
    });

    this.connectionInfo = {
      instanceUrl: token.instance_url,
      accessToken: token.access_token,
      apiVersion,
      authMode: mode,
      connectedAt: new Date(),
    };
  }

  /** Force a re-auth on next getConnection() call */
  invalidate(): void {
    this.tokenExpiresAt = 0;
  }
}

// Module-level singleton
const authManager = new SalesforceAuthManager();

export function getSalesforceConnection(): Promise<Connection> {
  return authManager.getConnection();
}

export function getConnectionInfo(): ConnectionInfo | null {
  return authManager.getConnectionInfo();
}

export function invalidateAuth(): void {
  authManager.invalidate();
}
