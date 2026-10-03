import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import type { AuthMode } from './types/salesforce.js';

// Load .env if present (no-op if not found)
loadDotenv();

const ConfigSchema = z.object({
  // Auth
  SF_AUTH_MODE: z.enum(['oauth', 'jwt', 'password']).default('oauth'),
  SF_LOGIN_URL: z.string().url().default('https://login.salesforce.com'),
  SF_API_VERSION: z.string().default('62.0'),

  // OAuth (Web Server Flow — default and recommended)
  SF_CLIENT_ID: z.string().optional(),
  SF_CLIENT_SECRET: z.string().optional(),
  SF_CALLBACK_PORT: z.coerce.number().int().positive().default(8443),

  // JWT (production / CI)
  SF_USERNAME: z.string().optional(),
  SF_PRIVATE_KEY_PATH: z.string().optional(),
  SF_PRIVATE_KEY: z.string().optional(),

  // Password flow (legacy, NOT recommended)
  SF_PASSWORD: z.string().optional(),
  SF_SECURITY_TOKEN: z.string().optional(),

  // Circuit breaker
  CB_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CB_RESET_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  CB_HALF_OPEN_MAX_CALLS: z.coerce.number().int().positive().default(2),

  // Query guardrails
  QUERY_MAX_LENGTH: z.coerce.number().int().positive().default(10000),
  QUERY_COMPLEXITY_THRESHOLD: z.coerce.number().int().positive().default(8),

  // Cache TTLs (seconds)
  CACHE_GLOBAL_DESCRIBE_TTL: z.coerce.number().int().positive().default(300),
  CACHE_SCHEMA_TTL: z.coerce.number().int().positive().default(300),
  CACHE_LIMITS_TTL: z.coerce.number().int().positive().default(60),

  // HTTP transport
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_API_KEY: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_TRANSPORT: z.enum(['console', 'file']).default('console'),
  LOG_FILE_PATH: z.string().default('./logs/audit.log'),
});

type RawConfig = z.infer<typeof ConfigSchema>;

export interface AppConfig {
  auth: {
    mode: AuthMode;
    loginUrl: string;
    apiVersion: string;
    clientId?: string;
    clientSecret?: string;
    callbackPort: number;
    username?: string;
    privateKeyPath?: string;
    privateKey?: string;
    password?: string;
    securityToken?: string;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxCalls: number;
  };
  query: {
    maxLength: number;
    complexityThreshold: number;
  };
  cache: {
    globalDescribeTtl: number;
    schemaTtl: number;
    limitsTtl: number;
  };
  http: {
    port: number;
    host: string;
    apiKey?: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    transport: 'console' | 'file';
    filePath: string;
  };
}

function parseConfig(): AppConfig {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${issues}`);
  }

  const raw: RawConfig = result.data;

  // Validate auth completeness
  if (raw.SF_AUTH_MODE === 'oauth') {
    if (!raw.SF_CLIENT_ID) throw new Error('SF_CLIENT_ID is required for OAuth flow');
    if (!raw.SF_CLIENT_SECRET) throw new Error('SF_CLIENT_SECRET is required for OAuth flow');
  } else if (raw.SF_AUTH_MODE === 'jwt') {
    if (!raw.SF_CLIENT_ID) throw new Error('SF_CLIENT_ID is required for JWT auth');
    if (!raw.SF_USERNAME) throw new Error('SF_USERNAME is required for JWT auth');
    if (!raw.SF_PRIVATE_KEY && !raw.SF_PRIVATE_KEY_PATH) {
      throw new Error('SF_PRIVATE_KEY or SF_PRIVATE_KEY_PATH is required for JWT auth');
    }
  } else {
    if (!raw.SF_USERNAME) throw new Error('SF_USERNAME is required for password auth');
    if (!raw.SF_PASSWORD) throw new Error('SF_PASSWORD is required for password auth');
  }

  return {
    auth: {
      mode: raw.SF_AUTH_MODE,
      loginUrl: raw.SF_LOGIN_URL,
      apiVersion: raw.SF_API_VERSION,
      clientId: raw.SF_CLIENT_ID,
      clientSecret: raw.SF_CLIENT_SECRET,
      callbackPort: raw.SF_CALLBACK_PORT,
      username: raw.SF_USERNAME,
      privateKeyPath: raw.SF_PRIVATE_KEY_PATH,
      privateKey: raw.SF_PRIVATE_KEY,
      password: raw.SF_PASSWORD,
      securityToken: raw.SF_SECURITY_TOKEN,
    },
    circuitBreaker: {
      failureThreshold: raw.CB_FAILURE_THRESHOLD,
      resetTimeoutMs: raw.CB_RESET_TIMEOUT_MS,
      halfOpenMaxCalls: raw.CB_HALF_OPEN_MAX_CALLS,
    },
    query: {
      maxLength: raw.QUERY_MAX_LENGTH,
      complexityThreshold: raw.QUERY_COMPLEXITY_THRESHOLD,
    },
    cache: {
      globalDescribeTtl: raw.CACHE_GLOBAL_DESCRIBE_TTL,
      schemaTtl: raw.CACHE_SCHEMA_TTL,
      limitsTtl: raw.CACHE_LIMITS_TTL,
    },
    http: {
      port: raw.HTTP_PORT,
      host: raw.HTTP_HOST,
      apiKey: raw.HTTP_API_KEY,
    },
    logging: {
      level: raw.LOG_LEVEL,
      transport: raw.LOG_TRANSPORT,
      filePath: raw.LOG_FILE_PATH,
    },
  };
}

// Singleton — parse once at startup
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = parseConfig();
  }
  return _config;
}

// Allow tests to reset config between tests
export function resetConfig(): void {
  _config = null;
}
