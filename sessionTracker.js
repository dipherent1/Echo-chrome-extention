// ============================================
// SESSION TRACKER - Active Session Management
// ============================================

import logger from "./logger.js";
import { addEntry } from "./bufferManager.js";
import {
  isSystemUrl,
  isBlacklistedDomain,
  redactSensitiveUrl,
  extractDomain,
  sanitizeText,
  refreshBadge,
} from "./utils.js";
import { MIN_DURATION } from "./config.js";

// ============================================
// STATE
// ============================================
let currentTabId = null;
let currentUrl = "";
let lastActiveTime = Date.now();
let currentMetadata = { title: "", description: "" };

// ============================================
// CONTENT SCRAPER (Injected into pages)
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
// PUBLIC API
// ============================================

/**
 * Start tracking a new session
 * @param {number} tabId - Tab ID to track
 */
export async function startSession(tabId) {
  if (!tabId) {
    currentUrl = "";
    currentTabId = null;
    currentMetadata = { title: "", description: "" };
    lastActiveTime = Date.now();
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);

    if (tab.active && tab.url && !isSystemUrl(tab.url)) {
      const domain = extractDomain(tab.url);

      // Skip blacklisted domains
      if (isBlacklistedDomain(domain)) {
        logger.debug("Skipping blacklisted domain", { domain });
        currentUrl = "";
        currentTabId = null;
        currentMetadata = { title: "", description: "" };
        return;
      }

      currentUrl = tab.url;
      currentTabId = tabId;
      lastActiveTime = Date.now();

      // Scrape page context
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: scrapePageContext,
        });

        if (results?.[0]?.result) {
          currentMetadata = results[0].result;
          logger.info("Started session", {
            title: currentMetadata.title?.substring(0, 50),
            domain,
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
      currentMetadata = { title: "", description: "" };
    }
  } catch (e) {
    logger.warn("Failed to start session", { error: e.message });
    currentUrl = "";
    currentTabId = null;
    currentMetadata = { title: "", description: "" };
  }
}

/**
 * End the current session and save to buffer
 * @returns {Promise<Object|null>} Log entry or null if too short
 */
export async function endSession() {
  const now = Date.now();
  const duration = (now - lastActiveTime) / 1000;

  if (
    !currentUrl ||
    duration < MIN_DURATION ||
    !currentUrl.startsWith("http")
  ) {
    logger.debug("Session too short or invalid, not saving", {
      duration: Math.round(duration),
      url: currentUrl ? currentUrl.substring(0, 50) : "none",
    });

    // Reset state
    currentUrl = "";
    currentTabId = null;
    currentMetadata = { title: "", description: "" };
    lastActiveTime = Date.now();
    return null;
  }

  const domain = extractDomain(currentUrl);

  // Check blacklist one more time
  if (isBlacklistedDomain(domain)) {
    logger.debug("Skipping blacklisted domain", { domain });
    currentUrl = "";
    currentTabId = null;
    currentMetadata = { title: "", description: "" };
    lastActiveTime = Date.now();
    return null;
  }

  const logEntry = {
    url: redactSensitiveUrl(currentUrl),
    domain: domain,
    title: sanitizeText(currentMetadata.title, 200),
    description: sanitizeText(currentMetadata.description, 500),
    startTime: lastActiveTime,
    endTime: now,
    duration: Math.round(duration),
    timestamp: new Date().toISOString(),
  };

  await addEntry(logEntry);
  await refreshBadge();

  logger.info("Ended session", {
    domain: logEntry.domain,
    duration: logEntry.duration,
  });

  // Reset state
  currentUrl = "";
  currentTabId = null;
  currentMetadata = { title: "", description: "" };
  lastActiveTime = Date.now();

  return logEntry;
}

/**
 * End current session and immediately restart on the same tab
 * This creates "chunks" of long sessions for periodic syncing
 * @returns {Promise<Object|null>} Log entry from ended session, or null if too short
 */
export async function endAndRestartSession() {
  const savedTabId = currentTabId;
  const savedUrl = currentUrl;
  const savedMetadata = { ...currentMetadata };

  // End the current session
  const logEntry = await endSession();

  // If there was an active session, restart tracking on the same tab
  if (savedTabId && savedUrl) {
    currentTabId = savedTabId;
    currentUrl = savedUrl;
    currentMetadata = savedMetadata;
    lastActiveTime = Date.now();

    logger.debug("Restarted session (chunking)", {
      url: savedUrl.substring(0, 50),
    });
  }

  return logEntry;
}

/**
 * Handle tab change - ends old session, starts new one
 * @param {number|null} newTabId - New tab ID or null to just end
 */
export async function handleTabChange(newTabId) {
  const now = Date.now();
  let newTab = null;

  // Pre-fetch new tab info to check for duplicates
  if (newTabId) {
    try {
      newTab = await chrome.tabs.get(newTabId);
    } catch (e) {
      // Tab might be missing/closed, proceed without it
    }
  }

  // Check if we are still on the same URL (e.g. spurious onUpdated event)
  let isSameSession = false;
  if (newTabId && currentTabId === newTabId && newTab) {
    if (newTab.url === currentUrl) {
      isSameSession = true;
    } else if (
      currentUrl &&
      currentUrl.includes("youtube.com/watch") &&
      newTab.url.includes("youtube.com/watch")
    ) {
      // Smart check for YouTube: same video ID means same session
      try {
        const u1 = new URL(currentUrl);
        const u2 = new URL(newTab.url);
        if (u1.searchParams.get("v") === u2.searchParams.get("v")) {
          isSameSession = true;
        }
      } catch (e) {}
    }
  }

  if (isSameSession) {
    // We can update metadata here if we want, but do NOT reset the timer or end the session
    logger.debug("Same session update - refreshing metadata", {
      url: currentUrl.substring(0, 50),
    });

    // If the page has finished loading, try to grab better metadata
    if (newTab && newTab.status === "complete") {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: newTabId },
          func: scrapePageContext,
        });

        if (results?.[0]?.result && results[0].result.title) {
          currentMetadata = results[0].result;
        }
      } catch (err) {
        /* ignore injection errors on same-session updates */
      }
    }
    return;
  }

  const duration = (now - lastActiveTime) / 1000;

  logger.debug("Tab change detected", {
    previousTab: currentTabId,
    newTab: newTabId,
    duration: Math.round(duration),
  });

  // End current session
  await endSession();

  // Start new session
  await startSession(newTabId);
}

/**
 * Get current session info for status queries
 * @returns {Object} Current session state
 */
export function getCurrentSession() {
  return {
    tabId: currentTabId,
    url: currentUrl,
    metadata: currentMetadata,
    startTime: lastActiveTime,
    duration: (Date.now() - lastActiveTime) / 1000,
  };
}
