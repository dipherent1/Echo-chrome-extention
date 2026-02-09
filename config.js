// ============================================
// CONFIGURATION - The Logger Chrome Extension
// ============================================

// --- ENVIRONMENT ---
// Set to 'production' when deploying to Chrome Web Store
const ENV = "production"; // 'development' or 'production'

// --- API Configuration ---
const API_CONFIG = {
  development: "http://localhost:3000",
  production: "https://v0-personal-productivity-tracker-kd.vercel.app", // TODO: Replace with actual prod URL
};

export const API_URL = API_CONFIG[ENV];

// --- Timing Constants ---
export const IDLE_THRESHOLD = 360; // Seconds before user considered idle
export const MIN_DURATION = 5; // Ignore visits shorter than this (seconds)
export const SYNC_INTERVAL = 15; // Minutes between API syncs
export const DEBOUNCE_MS = 500; // Debounce rapid tab switches
export const HEALTH_PING_INTERVAL = 1440; // 24 hours in minutes

// --- Storage Limits ---
export const STORAGE_QUOTA_MB = 4; // Trigger purge at this limit
export const PURGE_PERCENTAGE = 0.1; // Remove 10% of oldest logs on purge

// --- Domain Blacklist (Never track these) ---
export const BLACKLISTED_DOMAINS = [];

// --- Sensitive URL Parameters (Will be redacted) ---
export const SENSITIVE_PARAMS = [
  "token",
  "key",
  "apikey",
  "api_key",
  "password",
  "passwd",
  "pwd",
  "secret",
  "auth",
  "authorization",
  "session",
  "sessionid",
  "session_id",
  "code",
  "access_token",
  "refresh_token",
  "id_token",
  "bearer",
  "credential",
  "ssn",
  "social",
  "credit_card",
  "cc",
  "cvv",
  "pin",
];

// --- System URL Prefixes (Never track these) ---
export const SYSTEM_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "file://",
  "moz-extension://",
  "brave://",
  "opera://",
  "vivaldi://",
];

// --- Export Environment Check ---
export const IS_DEV = ENV === "development";
export const IS_PROD = ENV === "production";
