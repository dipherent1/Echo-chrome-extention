// ============================================
// BACKGROUND.JS - The Logger Chrome Extension
// Production-Ready Service Worker
// ============================================

import {
  API_URL,
  IDLE_THRESHOLD,
  MIN_DURATION,
  SYNC_INTERVAL,
  DEBOUNCE_MS,
  HEALTH_PING_INTERVAL,
  IS_DEV,
} from "./config.js";

import logger from "./logger.js";

import {
  isSystemUrl,
  isBlacklistedDomain,
  redactSensitiveUrl,
  extractDomain,
  sanitizeText,
  debounce,
  checkAndPurgeStorage,
  getLogsFromStorage,
  saveLogsToStorage,
  appendLogToStorage,
  isOnline,
  calculateBackoff,
  refreshBadge,
  loadCustomSettings,
} from "./utils.js";

// ============================================
// STATE
// ============================================
let currentTabId = null;
let currentUrl = "";
let startTime = Date.now();
let currentMetadata = { title: "", description: "" };
let syncRetryCount = 0;
let errorCount = 0;

// Set up idle detection
chrome.idle.setDetectionInterval(IDLE_THRESHOLD);

// ============================================
// 1. CONTENT SCRAPER (Injected into pages)
// ============================================

/**
 * This function runs INSIDE the webpage context
 * Uses requestIdleCallback for lazy execution
 */
function scrapePageContext() {
  return new Promise((resolve) => {
    const doScrape = () => {
      try {
        const getMeta = (name) => {
          const el =
            document.querySelector(`meta[name="${name}"]`) ||
            document.querySelector(`meta[property="${name}"]`);
          return el ? el.content : "";
        };

        resolve({
          title: document.title || window.location.hostname,
          description:
            getMeta("description") || getMeta("og:description") || "",
        });
      } catch (e) {
        resolve({ title: "", description: "" });
      }
    };

    // Use requestIdleCallback if available for lazy execution
    if ("requestIdleCallback" in window) {
      requestIdleCallback(doScrape, { timeout: 2000 });
    } else {
      setTimeout(doScrape, 100);
    }
  });
}

// ============================================
// 2. CORE TRACKING LOGIC
// ============================================

/**
 * Handle tab change - saves previous session, starts new one
 * @param {number|null} newTabId - New tab ID or null to just save
 */
async function handleTabChange(newTabId) {
  const now = Date.now();
  const duration = (now - startTime) / 1000;

  logger.debug("Tab change detected", {
    previousTab: currentTabId,
    newTab: newTabId,
    duration: Math.round(duration),
  });

  // A. LOG PREVIOUS SESSION
  if (currentUrl && duration > MIN_DURATION && currentUrl.startsWith("http")) {
    const domain = extractDomain(currentUrl);

    // Check blacklist
    if (!isBlacklistedDomain(domain)) {
      const logEntry = {
        url: redactSensitiveUrl(currentUrl),
        domain: domain,
        title: sanitizeText(currentMetadata.title, 200),
        description: sanitizeText(currentMetadata.description, 500),
        startTime: startTime,
        endTime: now,
        duration: Math.round(duration),
        timestamp: new Date().toISOString(),
      };

      await saveToBuffer(logEntry);
    } else {
      logger.debug("Skipped blacklisted domain", { domain });
    }
  }

  // B. PREPARE NEW SESSION
  startTime = now;
  currentMetadata = { title: "", description: "" };

  if (!newTabId) {
    currentUrl = "";
    currentTabId = null;
    return;
  }

  try {
    const tab = await chrome.tabs.get(newTabId);

    if (tab.active && tab.url && !isSystemUrl(tab.url)) {
      const domain = extractDomain(tab.url);

      // Skip blacklisted domains entirely
      if (isBlacklistedDomain(domain)) {
        logger.debug("New tab is blacklisted, not tracking", { domain });
        currentUrl = "";
        currentTabId = null;
        return;
      }

      currentUrl = tab.url;
      currentTabId = newTabId;

      // C. SCRAPE PAGE CONTEXT
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: newTabId },
          func: scrapePageContext,
        });

        if (results?.[0]?.result) {
          currentMetadata = results[0].result;
          logger.info("Captured context", {
            title: currentMetadata.title?.substring(0, 50),
          });
        }
      } catch (err) {
        // Script injection fails on restricted pages
        currentMetadata = { title: tab.title || "", description: "" };
        logger.debug("Scrape fallback to tab.title", { error: err.message });
      }
    } else {
      currentUrl = "";
      currentTabId = null;
    }
  } catch (e) {
    logger.warn("Failed to get tab info", { error: e.message });
    currentUrl = "";
    currentTabId = null;
  }
}

/**
 * Debounced version of handleTabChange for rapid switches
 */
const debouncedTabChange = debounce(handleTabChange, DEBOUNCE_MS);

/**
 * Save log entry to local buffer
 * @param {Object} log - Log entry
 */
async function saveToBuffer(log) {
  try {
    // Check storage quota before saving
    await checkAndPurgeStorage();

    const count = await appendLogToStorage(log);
    await refreshBadge();

    logger.info("Buffered log", {
      domain: log.domain,
      duration: log.duration,
      bufferSize: count,
    });
  } catch (e) {
    logger.error("Failed to save to buffer", { error: e.message });
    errorCount++;
  }
}

// ============================================
// 3. EVENT LISTENERS
// ============================================

// Tab activated (switched tabs)
chrome.tabs.onActivated.addListener((activeInfo) => {
  debouncedTabChange(activeInfo.tabId);
});

// Tab updated (URL changed in same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    debouncedTabChange(tabId);
  }
});

// Window focus changed
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User left Chrome - save pending log immediately (no debounce)
    await handleTabChange(null);
  } else {
    // User came back
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs.length > 0) {
      startTime = Date.now();
      debouncedTabChange(tabs[0].id);
    }
  }
});

// Idle state changed
chrome.idle.onStateChanged.addListener(async (state) => {
  logger.debug("Idle state changed", { state });

  if (state === "idle" || state === "locked") {
    await handleTabChange(null);
  } else if (state === "active") {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      startTime = Date.now();
      debouncedTabChange(tabs[0].id);
    }
  }
});

// ============================================
// 4. SERVER SYNC (Offline-First with Retry)
// ============================================

// Create sync alarm
chrome.alarms.create("syncData", { periodInMinutes: SYNC_INTERVAL });

// Create daily health ping alarm
chrome.alarms.create("healthPing", { periodInMinutes: HEALTH_PING_INTERVAL });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "syncData") {
    await syncLogs();
  } else if (alarm.name === "healthPing") {
    await sendHealthPing();
  }
});

/**
 * Sync logs to server with exponential backoff
 * @param {number} retryAttempt - Current retry attempt
 */
async function syncLogs(retryAttempt = 0) {
  // Check network status first
  if (!isOnline()) {
    logger.warn("Offline - skipping sync");
    return;
  }

  const data = await chrome.storage.local.get(["logs", "apiKey"]);
  const logs = data.logs || [];
  const apiKey = data.apiKey;

  if (logs.length === 0) {
    logger.debug("No logs to sync");
    return;
  }

  if (!apiKey) {
    logger.warn("No API key configured");
    return;
  }

  logger.group("Sync Operation");
  logger.time("sync");

  try {
    const response = await fetch(`${API_URL}/api/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(logs),
    });

    if (response.ok) {
      // Success - clear buffer
      await saveLogsToStorage([]);
      await refreshBadge();
      syncRetryCount = 0;

      logger.info("Sync successful", { count: logs.length });
    } else if (response.status === 429) {
      // Rate limited - exponential backoff
      scheduleRetry(retryAttempt);
      logger.warn("Rate limited", { status: response.status });
    } else if (response.status >= 500) {
      // Server error - exponential backoff
      scheduleRetry(retryAttempt);
      logger.warn("Server error", { status: response.status });
    } else {
      // Client error (4xx except 429) - don't retry
      logger.error("Sync rejected", { status: response.status });
      errorCount++;
    }
  } catch (error) {
    // Network error - schedule retry
    scheduleRetry(retryAttempt);
    logger.error("Sync failed", { error: error.message });
    errorCount++;
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
 * Force sync (called from popup)
 */
async function forceSync() {
  logger.info("Force sync triggered");
  await syncLogs(0);
}

// ============================================
// 5. HEALTH PING (Telemetry)
// ============================================

/**
 * Send daily health ping to server
 */
async function sendHealthPing() {
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

// ============================================
// 6. MESSAGE HANDLERS (For Popup Communication)
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "forceSync") {
    forceSync()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((e) => {
        sendResponse({ success: false, error: e.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.action === "getStatus") {
    chrome.storage.local.get(["logs", "apiKey"]).then((data) => {
      sendResponse({
        hasApiKey: !!data.apiKey,
        logCount: data.logs?.length || 0,
        isOnline: isOnline(),
        syncRetryCount: syncRetryCount,
      });
    });
    return true;
  }

  if (message.action === "checkConnection") {
    checkApiConnection(message.apiKey).then(sendResponse);
    return true;
  }

  if (message.action === "refreshSettings") {
    loadCustomSettings().then(() => {
      logger.info("Custom settings refreshed");
      sendResponse({ success: true });
    });
    return true;
  }
});

/**
 * Check if API connection is valid
 * @param {string} apiKey - API key to test
 */
async function checkApiConnection(apiKey) {
  if (!isOnline()) {
    return { connected: false, error: "Offline" };
  }

  if (!apiKey) {
    return { connected: false, error: "No API key" };
  }

  try {
    const response = await fetch(`${API_URL}/api/status`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    return {
      connected: response.ok,
      status: response.status,
    };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

// ============================================
// 7. INITIALIZATION
// ============================================

// Load custom settings on startup
loadCustomSettings();

// Refresh badge on startup
refreshBadge();

logger.info("Background service worker initialized", {
  version: chrome.runtime.getManifest().version,
  apiUrl: API_URL,
  isDev: IS_DEV,
});
