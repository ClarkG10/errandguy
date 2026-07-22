/**
 * Central typed config. Mirrors the Laravel config/*.php + .env values that the
 * ported controllers/services depend on.
 */
export interface AppConfig {
  env: string;
  name: string;
  url: string;
  port: number;
  apiPrefix: string;
}

export interface AuthConfig {
  /** Token lifetime in minutes (Sanctum `expiration`). null = never expires. */
  expirationMinutes: number | null;
  tokenPrefix: string;
  tokenableUserType: string;
  tokenableAdminType: string;
  bcryptRounds: number;
}

export interface LimitsConfig {
  corsOrigins: string[];
  maxBodyBytes: number;
  maxUploadBytes: number;
}

export interface IntegrationsConfig {
  firebase: { credentials: string; projectId: string };
  resend: { apiKey: string; fromAddress: string; fromName: string };
  xendit: { secretKey: string; publicKey: string; webhookToken: string };
  supabase: { url: string; serviceKey: string };
  mapbox: { secretToken: string };
}

export interface QueueConfig {
  pollMs: number;
  enabled: boolean;
  schedulerEnabled: boolean;
}

export interface Configuration {
  app: AppConfig;
  auth: AuthConfig;
  limits: LimitsConfig;
  integrations: IntegrationsConfig;
  queue: QueueConfig;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export default (): Configuration => {
  const expirationRaw = process.env.SANCTUM_EXPIRATION;
  return {
    app: {
      env: process.env.NODE_ENV ?? 'development',
      name: process.env.APP_NAME ?? 'ErrandGuy',
      url: process.env.APP_URL ?? 'http://localhost:3000',
      port: num(process.env.PORT, 3000),
      apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    },
    auth: {
      expirationMinutes:
        expirationRaw === '' || expirationRaw === undefined
          ? 60 * 24 * 30
          : expirationRaw.toLowerCase() === 'null'
            ? null
            : num(expirationRaw, 60 * 24 * 30),
      tokenPrefix: process.env.SANCTUM_TOKEN_PREFIX ?? '',
      tokenableUserType: process.env.TOKENABLE_USER_TYPE ?? 'App\\Models\\User',
      tokenableAdminType: process.env.TOKENABLE_ADMIN_TYPE ?? 'App\\Models\\AdminUser',
      bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
    },
    limits: {
      corsOrigins: (process.env.CORS_ALLOWED_ORIGINS ??
        'http://localhost:3000,http://localhost:8081,http://127.0.0.1:3000')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      maxBodyBytes: num(process.env.API_MAX_BODY_BYTES, 1_048_576),
      maxUploadBytes: num(process.env.API_MAX_UPLOAD_BYTES, 12_582_912),
    },
    integrations: {
      firebase: {
        credentials: process.env.FIREBASE_CREDENTIALS ?? '',
        projectId: process.env.FIREBASE_PROJECT_ID ?? '',
      },
      resend: {
        apiKey: process.env.RESEND_API_KEY ?? '',
        fromAddress: process.env.MAIL_FROM_ADDRESS ?? 'no-reply@errandguy.app',
        fromName: process.env.MAIL_FROM_NAME ?? 'ErrandGuy',
      },
      xendit: {
        secretKey: process.env.XENDIT_SECRET_KEY ?? '',
        publicKey: process.env.XENDIT_PUBLIC_KEY ?? '',
        webhookToken: process.env.XENDIT_WEBHOOK_TOKEN ?? '',
      },
      supabase: {
        url: process.env.SUPABASE_URL ?? '',
        serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
      },
      mapbox: { secretToken: process.env.MAPBOX_SECRET_TOKEN ?? '' },
    },
    queue: {
      pollMs: num(process.env.QUEUE_POLL_MS, 2000),
      enabled: bool(process.env.QUEUE_ENABLED, true),
      schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
    },
  };
};
