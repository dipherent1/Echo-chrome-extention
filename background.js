// ============================================
// BACKGROUND.JS - The Logger Chrome Extension
// Production-Ready Service Worker (Modular)
// ============================================

import { IDLE_THRESHOLD, IS_DEV, HEALTH_PING_INTERVAL } from "./config.js";
import logger from "./logger.js";
import { debounce, loadCustomSettings, refreshBadge } from "./utils.js";
import * as sessionTracker from "./sessionTracker.js";
import * as syncManager from "./syncManager.js";
import { getEntries } from "./bufferManager.js";
import { API_URL } from "./config.js";
import { isOnline } from "./utils.js";

// ============================================
// INITIALIZATION
// ============================================

// Set up idle detection
chrome.idle.setDetectionInterval(IDLE_THRESHOLD);

// Load custom settings on startup
loadCustomSettings();

// Refresh badge on startup
refreshBadge();

// Set up sync alarms
syncManager.setupAlarms();

// Set up health ping alarm
chrome.alarms.create("healthPing", { periodInMinutes: HEALTH_PING_INTERVAL });

logger.info("Background service worker initialized", {
  version: chrome.runtime.getManifest().version,
  apiUrl: API_URL,
  isDev: IS_DEV,
});

// ============================================
// EVENT LISTENERS - TABS
// ============================================

/**
 * Debounced version of handleTabChange for rapid switches
 */
const debouncedTabChange = debounce(sessionTracker.handleTabChange, 500);

// Tab activated (switched tabs)
chrome.tabs.onActivated.addListener((activeInfo) => {
  debouncedTabChange(activeInfo.tabId);
});

// Tab updated (URL changed in same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Trigger if loading completes OR if URL changes (SPA navigation like YouTube)
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    debouncedTabChange(tabId);
  }
});

// Tab removed (closed)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const currentSession = sessionTracker.getCurrentSession();
  if (tabId === currentSession.tabId) {
    // Pass null to signal that the active session has ended
    sessionTracker.handleTabChange(null);
  }
});

// ============================================
// EVENT LISTENERS - WINDOWS
// ============================================

// Window focus changed
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User left Chrome - save pending log immediately (no debounce)
    await sessionTracker.endSession();
  } else {
    // User came back
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs.length > 0) {
      debouncedTabChange(tabs[0].id);
    }
  }
});

// ============================================
// EVENT LISTENERS - IDLE
// ============================================

// Idle state changed
chrome.idle.onStateChanged.addListener(async (state) => {
  logger.debug("Idle state changed", { state });

  if (state === "idle" || state === "locked") {
    // Check if the current tab is playing audio (e.g. YouTube)
    const currentSession = sessionTracker.getCurrentSession();
    let isAudible = false;

    if (currentSession.tabId) {
      try {
        const tab = await chrome.tabs.get(currentSession.tabId);
        if (tab && tab.audible) {
          isAudible = true;
        }
      } catch (e) {
        /* ignore */
      }
    }

    if (isAudible) {
      logger.debug("User idle but media playing - keeping session alive");
      return;
    }

    await sessionTracker.endSession();
  } else if (state === "active") {
    // If we're already tracking a valid session, don't reset
    const currentSession = sessionTracker.getCurrentSession();
    if (currentSession.url && currentSession.tabId) {
      logger.debug("User active again - continuing session");
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      await sessionTracker.startSession(tabs[0].id);
    }
  }
});

// ============================================
// EVENT LISTENERS - ALARMS
// ============================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "sessionChunk") {
    await syncManager.handleSessionChunkAlarm();
  } else if (alarm.name === "syncData") {
    await syncManager.syncLogs();
  } else if (alarm.name === "healthPing") {
    await syncManager.sendHealthPing();
  }
});

// ============================================
// MESSAGE HANDLERS (For Popup Communication)
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "forceSync") {
    syncManager
      .forceSync()
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
      const syncStatus = syncManager.getSyncStatus();
      sendResponse({
        hasApiKey: !!data.apiKey,
        logCount: data.logs?.length || 0,
        isOnline: isOnline(),
        syncRetryCount: syncStatus.syncRetryCount,
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
