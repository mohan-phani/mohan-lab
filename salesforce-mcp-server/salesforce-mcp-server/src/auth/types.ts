export interface JwtPayload {
  iss: string;  // Client ID (Connected App consumer key)
  sub: string;  // Salesforce username
  aud: string;  // Login URL
  exp: number;  // Expiration (3 minutes from now max)
}

export interface TokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  scope?: string;
  issued_at?: string;
  signature?: string;
}

export interface RefreshState {
  expiresAt: number;   // epoch ms
  refreshing: boolean;
  promise: Promise<void> | null;
}
