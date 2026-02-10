// ============================================
// SYNC MANAGER - Server Synchronization
// ============================================

import logger from "./logger.js";
import { getEntries, removeEntries } from "./bufferManager.js";
import { endAndRestartSession, endSession } from "./sessionTracker.js";
import {
  isOnline,
  calculateBackoff,
  getClientId,
  refreshBadge,
} from "./utils.js";
import { API_URL, SYNC_INTERVAL } from "./config.js";

// ============================================
// STATE
// ============================================
let syncRetryCount = 0;
let errorCount = 0;

// ============================================
// ALARM SETUP
// ============================================

/**
 * Set up synchronization and session-chunking alarms
 */
export function setupAlarms() {
  // Session chunking alarm - ends and restarts sessions every SYNC_INTERVAL
  chrome.alarms.create("sessionChunk", { periodInMinutes: SYNC_INTERVAL });

  // Sync alarm - sends buffered data to server
  chrome.alarms.create("syncData", { periodInMinutes: SYNC_INTERVAL });

  logger.info("Sync alarms configured", { intervalMinutes: SYNC_INTERVAL });
}

/**
 * Handle session chunk alarm - end and restart the current session
 */
export async function handleSessionChunkAlarm() {
  logger.debug("Session chunk alarm fired");
  await endAndRestartSession();
}

/**
 * Sync logs to server with exponential backoff
 * @param {number} retryAttempt - Current retry attempt
 */
export async function syncLogs(retryAttempt = 0) {
  // Check network status first
  if (!isOnline()) {
    logger.warn("Offline - skipping sync");
    return;
  }

  const data = await chrome.storage.local.get("apiKey");
  const apiKey = data.apiKey;

  if (!apiKey) {
    logger.warn("No API key configured");
    return;
  }

  const logs = await getEntries();

  if (logs.length === 0) {
    logger.debug("No logs to sync");
    return;
  }

  logger.group("Sync Operation");
  logger.time("sync");

  const clientId = await getClientId();
  const successfulIndices = [];
  let abortSync = false;

  for (let i = 0; i < logs.length; i++) {
    if (abortSync) break;

    const log = logs[i];

    // Transform to production schema
    const payload = {
      url: log.url,
      title: log.title || "Untitled",
      duration: log.duration,
      timestamp: log.timestamp || new Date(log.startTime).toISOString(),
      description: log.description || "",
      source: {
        type: "chrome-extension",
        deviceName: "Chrome Extension",
        clientId: clientId,
      },
    };

    try {
      const response = await fetch(`${API_URL}/api/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        successfulIndices.push(i);
        logger.debug("Synced log", { title: payload.title });
        syncRetryCount = 0; // Reset retry on success
      } else if (response.status === 429 || response.status >= 500) {
        // Temporary failure - stop syncing and retry later
        logger.warn("Sync paused (server issue)", { status: response.status });
        scheduleRetry(retryAttempt);
        abortSync = true;
      } else {
        // Permanent failure (400/401) - remove bad log to prevent clogging
        logger.error("Log rejected", {
          status: response.status,
          url: payload.url,
        });
        errorCount++;
        successfulIndices.push(i); // Remove bad logs to clear queue
      }
    } catch (error) {
      // Network error - stop syncing
      logger.error("Sync failed", { error: error.message });
      scheduleRetry(retryAttempt);
      abortSync = true;
      errorCount++;
    }
  }

  // Remove successful logs from buffer
  if (successfulIndices.length > 0) {
    await removeEntries(successfulIndices);
    await refreshBadge();

    logger.info("Sync batch completed", {
      synced: successfulIndices.length,
      remaining: logs.length - successfulIndices.length,
    });
  }

  logger.timeEnd("sync");
  logger.groupEnd();
}

/**
 * Schedule a sync retry with exponential backoff
 * @param {number} attempt - Current attempt number
 */
function scheduleRetry(attempt) {
  const delay = calculateBackoff(attempt);
  const nextAttempt = attempt + 1;

  logger.info("Scheduling retry", {
    attempt: nextAttempt,
    delayMs: delay,
  });

  setTimeout(() => syncLogs(nextAttempt), delay);
  syncRetryCount = nextAttempt;
}

/**
 * Force sync - end current session and sync immediately
 */
export async function forceSync() {
  logger.info("Force sync triggered");

  // End the current session first so it gets into the buffer
  await endSession();

  // Reset retry count and sync
  syncRetryCount = 0;
  await syncLogs(0);
}

/**
 * Get sync status
 * @returns {Object} Sync status info
 */
export function getSyncStatus() {
  return {
    syncRetryCount,
    errorCount,
  };
}

/**
 * Send daily health ping to server
 */
export async function sendHealthPing() {
  if (!isOnline()) return;

  const data = await chrome.storage.local.get("apiKey");
  if (!data.apiKey) return;

  try {
    const platformInfo = await chrome.runtime.getPlatformInfo();
    const manifest = chrome.runtime.getManifest();

    const payload = {
      extensionVersion: manifest.version,
      platform: platformInfo.os,
      arch: platformInfo.arch,
      errorsEncountered: errorCount,
      timestamp: new Date().toISOString(),
    };

    await fetch(`${API_URL}/api/health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    logger.info("Health ping sent", payload);

    // Reset error count after successful ping
    errorCount = 0;
  } catch (e) {
    logger.warn("Health ping failed", { error: e.message });
  }
}
