import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import jsforce, { Connection } from 'jsforce';
import { getConfig } from '../config.js';
import type { ConnectionInfo } from '../types/salesforce.js';
import type { TokenResponse } from './types.js';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

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
    // Consider token valid if it hasn't expired (with buffer)
    return Date.now() < this.tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  private async authenticate(): Promise<void> {
    const config = getConfig();

    if (config.auth.mode === 'jwt') {
      await this.authenticateJwt();
    } else {
      await this.authenticatePassword();
    }
  }

  private async authenticateJwt(): Promise<void> {
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
      exp: now + 180, // 3-minute assertion lifetime (SF max)
    };

    const assertion = jwt.sign(payload, privateKeyPem, { algorithm: 'RS256' });

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

    // JWT tokens from SF don't include expiry in response — treat as 2-hour (SF default)
    this.tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
  }

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
        // OAuth 2.0 resource owner password credentials
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
        // jsforce login (SOAP-based, simpler for dev)
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

      // Password flow tokens last 2 hours by default
      this.tokenExpiresAt = Date.now() + 2 * 60 * 60 * 1000;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Salesforce authentication failed: ${message}`);
    }
  }

  private applyToken(token: TokenResponse, apiVersion: string, mode: 'jwt' | 'password'): void {
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
