// --- CONFIGURATION ---
const IDLE_THRESHOLD = 60; // Seconds
const MIN_DURATION = 5; // Ignore visits shorter than this
const SYNC_INTERVAL = 5; // Minutes between API syncs

// --- STATE ---
let currentTabId = null;
let currentUrl = "";
let startTime = Date.now();
// We store metadata here so we can attach it to the log when the user *leaves* the page
let currentMetadata = { title: "", description: "" };

chrome.idle.setDetectionInterval(IDLE_THRESHOLD);

// --- 1. THE SCRAPER (Runs inside the webpage) ---
function scrapePageContext() {
  try {
    const getMeta = (name) => {
      const element = document.querySelector(`meta[name="${name}"]`);
      return element ? element.content : "";
    };
    return {
      title: document.title || window.location.hostname,
      description: getMeta("description") || getMeta("og:description") || "",
    };
  } catch (e) {
    return { title: "", description: "" };
  }
}

// --- 2. CORE LOGIC ---

async function handleTabChange(newTabId) {
  const now = Date.now();
  const duration = (now - startTime) / 1000; // Seconds

  // A. LOG PREVIOUS SESSION
  // Only save if it was a real URL and lasted longer than threshold
  if (currentUrl && duration > MIN_DURATION && currentUrl.startsWith("http")) {
    const logEntry = {
      url: currentUrl,
      domain: new URL(currentUrl).hostname,
      title: currentMetadata.title, // From previous scrape
      description: currentMetadata.description, // From previous scrape
      startTime: startTime,
      endTime: now,
      duration: Math.round(duration),
      timestamp: new Date().toISOString(),
    };

    await saveToBuffer(logEntry);
  }

  // B. PREPARE NEW SESSION
  startTime = now;
  currentMetadata = { title: "", description: "" }; // Reset

  try {
    const tab = await chrome.tabs.get(newTabId);

    if (tab.active && tab.url.startsWith("http")) {
      currentUrl = tab.url;
      currentTabId = newTabId;

      // C. SCRAPE NEW PAGE (Knowledge Base)
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: newTabId },
          func: scrapePageContext,
        });

        if (results && results[0] && results[0].result) {
          currentMetadata = results[0].result;
          console.log("Captured Context:", currentMetadata.title);
        }
      } catch (err) {
        // Fails on restricted pages (chrome://, webstore, etc.)
        currentMetadata = { title: tab.title, description: "" };
      }
    } else {
      currentUrl = "";
    }
  } catch (e) {
    currentUrl = "";
  }
}

async function saveToBuffer(log) {
  const data = await chrome.storage.local.get("logs");
  const logs = data.logs || [];
  logs.push(log);
  await chrome.storage.local.set({ logs });
  console.log("Buffered Log:", log);
}

// --- 3. LISTENERS ---

// Tab Switch
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await handleTabChange(activeInfo.tabId);
});

// URL Change (same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    await handleTabChange(tabId);
  }
});

// Window Focus (Stop timer if minimized)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User left Chrome
    await handleTabChange(null); // Just saves pending log
  } else {
    // User came back
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs.length > 0) {
      startTime = Date.now(); // Reset timer to NOW
      await handleTabChange(tabs[0].id);
    }
  }
});

// Idle (User walked away)
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "idle" || state === "locked") {
    await handleTabChange(null); // Save pending log
  } else if (state === "active") {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      startTime = Date.now();
      await handleTabChange(tabs[0].id);
    }
  }
});

// --- 4. SERVER SYNC (The "Productivity Hawk" Part) ---
chrome.alarms.create("syncData", { periodInMinutes: SYNC_INTERVAL });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "syncData") {
    const data = await chrome.storage.local.get(["logs", "apiKey"]);
    const logs = data.logs || [];
    const apiKey = data.apiKey;

    if (logs.length === 0) return; // Nothing to sync

    if (!apiKey) {
      console.warn("No API Key found. Logs accumulating locally.");
      return;
    }

    try {
      // Send to your Next.js API
      const response = await fetch("http://localhost:3000/api/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(logs),
      });

      if (response.ok) {
        console.log(`Synced ${logs.length} logs to cloud.`);
        await chrome.storage.local.set({ logs: [] }); // Clear buffer
      } else {
        console.error("Server rejected logs:", response.status);
      }
    } catch (error) {
      console.error("Sync failed (Server offline?):", error);
    }
  }
});
