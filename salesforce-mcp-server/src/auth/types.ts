export interface TokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  refresh_token?: string;
  scope?: string;
  issued_at?: string;
  signature?: string;
}

export interface OAuthTokenStore {
  access_token: string;
  refresh_token: string;
  instance_url: string;
  issued_at: number;
}
