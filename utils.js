// ============================================
// UTILITIES - Helper Functions
// ============================================

import {
  BLACKLISTED_DOMAINS,
  SENSITIVE_PARAMS,
  SYSTEM_URL_PREFIXES,
  STORAGE_QUOTA_MB,
  PURGE_PERCENTAGE,
} from "./config.js";
import logger from "./logger.js";
import { getEntries } from "./bufferManager.js";

// ============================================
// CACHED CUSTOM SETTINGS
// ============================================

// Cache for custom settings (loaded from storage)
let cachedCustomBlockedDomains = [];
let cachedCustomSensitiveParams = [];

/**
 * Load custom settings from storage into cache
 * Should be called on startup and when settings change
 */
export async function loadCustomSettings() {
  try {
    const data = await chrome.storage.local.get([
      "customBlockedDomains",
      "customSensitiveParams",
    ]);

    cachedCustomBlockedDomains = data.customBlockedDomains || [];
    cachedCustomSensitiveParams = data.customSensitiveParams || [];

    logger.debug("Custom settings loaded", {
      blockedDomains: cachedCustomBlockedDomains.length,
      sensitiveParams: cachedCustomSensitiveParams.length,
    });
  } catch (e) {
    logger.error("Failed to load custom settings", { error: e.message });
  }
}

/**
 * Get combined blocked domains (default + custom)
 * @returns {string[]}
 */
export function getAllBlockedDomains() {
  return [...BLACKLISTED_DOMAINS, ...cachedCustomBlockedDomains];
}

/**
 * Get combined sensitive params (default + custom)
 * @returns {string[]}
 */
export function getAllSensitiveParams() {
  return [...SENSITIVE_PARAMS, ...cachedCustomSensitiveParams];
}

// ============================================
// URL & DOMAIN UTILITIES
// ============================================

/**
 * Check if a URL is a system/internal page that should never be tracked
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export function isSystemUrl(url) {
  if (!url) return true;
  return SYSTEM_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Check if a domain is blacklisted (banking, sensitive sites, or custom)
 * @param {string} domain - Domain to check
 * @returns {boolean}
 */
export function isBlacklistedDomain(domain) {
  if (!domain) return true;
  const lowerDomain = domain.toLowerCase();
  const allBlocked = getAllBlockedDomains();

  return allBlocked.some(
    (blocked) => lowerDomain === blocked || lowerDomain.endsWith("." + blocked),
  );
}

/**
 * Redact sensitive URL parameters (tokens, passwords, etc.)
 * Includes both default and custom sensitive params
 * @param {string} url - Full URL to process
 * @returns {string} - URL with sensitive params redacted
 */
export function redactSensitiveUrl(url) {
  try {
    const urlObj = new URL(url);
    let hasRedacted = false;
    const allParams = getAllSensitiveParams();

    allParams.forEach((param) => {
      // Check exact match
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, "REDACTED");
        hasRedacted = true;
      }

      // Check case-insensitive and partial matches
      for (const [key, value] of urlObj.searchParams.entries()) {
        if (key.toLowerCase().includes(param.toLowerCase())) {
          urlObj.searchParams.set(key, "REDACTED");
          hasRedacted = true;
        }
      }
    });

    if (hasRedacted) {
      logger.debug("Redacted sensitive URL params", {
        originalHost: urlObj.hostname,
      });
    }

    return urlObj.toString();
  } catch (e) {
    logger.warn("Failed to parse URL for redaction", { url, error: e.message });
    return url;
  }
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string|null} - Domain or null if invalid
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Sanitize text content (strip HTML, limit length)
 * @param {string} text - Text to sanitize
 * @param {number} maxLength - Maximum length (default 500)
 * @returns {string}
 */
export function sanitizeText(text, maxLength = 500) {
  if (!text) return "";

  // Strip HTML tags
  const stripped = text.replace(/<[^>]*>/g, "");

  // Normalize whitespace
  const normalized = stripped.replace(/\s+/g, " ").trim();

  // Truncate if needed
  if (normalized.length > maxLength) {
    return normalized.substring(0, maxLength) + "...";
  }

  return normalized;
}

// ============================================
// DEBOUNCE UTILITY
// ============================================

/**
 * Create a debounced function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ============================================
// STORAGE UTILITIES
// ============================================

/**
 * Check current storage usage and purge if over limit
 * @returns {Promise<{usedMB: number, purged: boolean}>}
 */
export async function checkAndPurgeStorage() {
  try {
    const data = await chrome.storage.local.get("logs");
    const logs = data.logs || [];

    // Estimate size (rough calculation)
    const jsonSize = JSON.stringify(logs).length;
    const usedMB = jsonSize / (1024 * 1024);

    logger.debug("Storage check", {
      usedMB: usedMB.toFixed(2),
      logCount: logs.length,
    });

    if (usedMB > STORAGE_QUOTA_MB) {
      const purgeCount = Math.ceil(logs.length * PURGE_PERCENTAGE);
      const remainingLogs = logs.slice(purgeCount);

      await chrome.storage.local.set({ logs: remainingLogs });

      logger.warn("Storage purge triggered", {
        purgedCount: purgeCount,
        remainingCount: remainingLogs.length,
      });

      return { usedMB, purged: true, purgedCount: purgeCount };
    }

    return { usedMB, purged: false };
  } catch (e) {
    logger.error("Storage check failed", { error: e.message });
    return { usedMB: 0, purged: false };
  }
}

// ============================================
// NETWORK UTILITIES
// ============================================

/**
 * Check if browser is online
 * @returns {boolean}
 */
export function isOnline() {
  return navigator.onLine;
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} baseMs - Base delay in ms (default 60000 = 1 min)
 * @param {number} maxMs - Maximum delay in ms (default 300000 = 5 min)
 * @returns {number} - Delay in ms
 */
export function calculateBackoff(attempt, baseMs = 60000, maxMs = 300000) {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

// ============================================
// BADGE UTILITIES
// ============================================

/**
 * Update extension badge with log count
 * @param {number} count - Number of logs in buffer
 */
export async function updateBadge(count) {
  const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: count > 0 ? "#10B981" : "#6B7280",
  });
}

/**
 * Refresh badge from storage
 */
export async function refreshBadge() {
  const logs = await getEntries();
  await updateBadge(logs.length);
}

// ============================================
// CLIENT ID UTILITIES
// ============================================

/**
 * Get or create a unique client ID
 * @returns {Promise<string>}
 */
export async function getClientId() {
  const data = await chrome.storage.local.get("clientId");
  if (data.clientId) {
    return data.clientId;
  }

  // Generate new UUID-like ID
  const newId =
    "client_" +
    Math.random().toString(36).substr(2, 9) +
    "_" +
    Date.now().toString(36);
  await chrome.storage.local.set({ clientId: newId });
  return newId;
}
