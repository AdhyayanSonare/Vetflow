import { z } from "zod";

/**
 * Every environment variable the server reads is declared here, validated once, and exposed as a
 * typed `config` object. Nothing else in server/ touches process.env. See .env.example.
 */
const optionalString = z
  .string()
  .optional()
  .transform(v => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Database
  DATABASE_URL: optionalString,
  ADMIN_DATABASE_URL: optionalString,
  APP_DB_PASSWORD: optionalString,
  DATABASE_CA_CERT: optionalString,

  // Optional shared password in front of the whole site (a public demo, for example)
  SITE_PASSWORD: optionalString,

  // Speech to text and note extraction. Groq is a hosted API, ASR_URL is the local asr container.
  GROQ_API_KEY: optionalString,
  GROQ_API_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_TRANSCRIBE_MODEL: z.string().default("whisper-large-v3"),
  GROQ_EXTRACTION_MODEL: z.string().default("openai/gpt-oss-120b"),
  ASR_URL: optionalString,

  // Defaults to true in production. Set false only for plain-HTTP local use such as the demo.
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export type AsrKind = "groq" | "local" | "none";

export type Config = {
  nodeEnv: "development" | "test" | "production";
  isProduction: boolean;
  port: number;
  logLevel: string;
  databaseUrl: string | undefined;
  adminDatabaseUrl: string | undefined;
  appDbPassword: string | undefined;
  cookieSecure: boolean;
  databaseCaCert: string | undefined;
  sitePassword: string | undefined;
  groq: { apiKey: string | undefined; apiUrl: string; transcribeModel: string; extractionModel: string };
  asr: { kind: AsrKind; localUrl: string | undefined };
  /** What this server can do right now. Shown to the UI so it can hide or explain a missing feature. */
  capabilities: { transcription: boolean; extraction: boolean };
};

/**
 * The runtime database URL. If DATABASE_URL is not set but the admin URL and APP_DB_PASSWORD are,
 * the app-role URL is derived from them: same host and port, user `vetflow_app` (keeping a
 * `.projectref` suffix on pooled hosts) and the app password.
 */
export function deriveAppDatabaseUrl(adminUrl: string, appPassword: string): string {
  const u = new URL(adminUrl);
  const dot = u.username.indexOf(".");
  u.username = dot === -1 ? "vetflow_app" : `vetflow_app${u.username.slice(dot)}`;
  u.password = appPassword;
  u.search = "";
  return u.toString();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}. See .env.example.`);
  }
  const e = parsed.data;
  const databaseUrl = e.DATABASE_URL ?? (e.ADMIN_DATABASE_URL && e.APP_DB_PASSWORD ? deriveAppDatabaseUrl(e.ADMIN_DATABASE_URL, e.APP_DB_PASSWORD) : undefined);
  const asrKind: AsrKind = e.GROQ_API_KEY ? "groq" : e.ASR_URL ? "local" : "none";
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === "production",
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl,
    adminDatabaseUrl: e.ADMIN_DATABASE_URL,
    appDbPassword: e.APP_DB_PASSWORD,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === "true" : e.NODE_ENV === "production",
    databaseCaCert: e.DATABASE_CA_CERT,
    sitePassword: e.SITE_PASSWORD,
    groq: { apiKey: e.GROQ_API_KEY, apiUrl: e.GROQ_API_URL.replace(/\/$/, ""), transcribeModel: e.GROQ_TRANSCRIBE_MODEL, extractionModel: e.GROQ_EXTRACTION_MODEL },
    asr: { kind: asrKind, localUrl: e.ASR_URL },
    capabilities: { transcription: asrKind !== "none", extraction: !!e.GROQ_API_KEY },
  };
}

let cached: Config | undefined;
/** The process-wide config, loaded on first use. Tests can pass their own to loadConfig. */
export function getConfig(): Config {
  return (cached ??= loadConfig());
}
export function resetConfigForTests() {
  cached = undefined;
}
