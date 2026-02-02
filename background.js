// Global State
let currentTabId = null;
let currentUrl = null;
let startTime = Date.now();

const IDLE_THRESHOLD = 60; // Seconds until considered "Idle"

// Initialize Idle Detection
chrome.idle.setDetectionInterval(IDLE_THRESHOLD);

// --- CORE FUNCTIONS ---

// 1. Commit the log to storage
async function logSession() {
  const now = Date.now();
  const duration = (now - startTime) / 1000; // in seconds

  // Filter: Ignore short visits (< 1s) or system pages (chrome://)
  if (currentUrl && duration > 1 && currentUrl.startsWith("http")) {
    const newLog = {
      url: currentUrl,
      domain: new URL(currentUrl).hostname,
      startTime: startTime,
      endTime: now,
      duration: Math.round(duration),
      date: new Date().toISOString(),
    };

    // Save to local storage
    const data = await chrome.storage.local.get("activityLogs");
    const logs = data.activityLogs || [];
    logs.push(newLog);
    await chrome.storage.local.set({ activityLogs: logs });

    console.log("Logged:", newLog); // View this in Service Worker Console
  }

  // Reset Timer
  startTime = now;
}

// 2. Update State
async function updateState(tabId) {
  // Log the *previous* session before switching
  await logSession();

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) {
      currentUrl = tab.url;
      currentTabId = tabId;
    }
  } catch (err) {
    // Tab might be closed or restricted
    currentUrl = null;
  }
}

// --- EVENT LISTENERS ---

// A. Tab Switched
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await updateState(activeInfo.tabId);
});

// B. URL Changed (Navigation)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    await updateState(tabId);
  }
});

// C. Window Focus Changed (User minimizes Chrome)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome is no longer focused -> Log and stop tracking
    await logSession();
    currentUrl = null; // Stop tracking
  } else {
    // Chrome is back in focus -> Find active tab
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs.length > 0) {
      await updateState(tabs[0].id);
    }
  }
});

// D. Idle Detection (User walks away)
chrome.idle.onStateChanged.addListener(async (newState) => {
  console.log("User State:", newState);
  if (newState === "idle" || newState === "locked") {
    // User is gone -> Log the session up to this point
    await logSession();
    currentUrl = null; // Pause tracking
  } else if (newState === "active") {
    // User returned -> Restart tracking on current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      // Reset start time to NOW (don't count the idle time)
      startTime = Date.now();
      currentUrl = tabs[0].url;
    }
  }
});
