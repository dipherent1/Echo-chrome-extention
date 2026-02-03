// ============================================
// POPUP.JS - Echo Extension Popup Logic
// ============================================

// --- DOM Elements ---
const elements = {
  // Header
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  version: document.getElementById("version"),

  // Tab Navigation
  tabBtns: document.querySelectorAll(".tab-btn"),
  activityTab: document.getElementById("activity-tab"),
  settingsTab: document.getElementById("settings-tab"),

  // Activity Tab
  apiKeyInput: document.getElementById("apiKey"),
  toggleVisibility: document.getElementById("toggleVisibility"),
  saveBtn: document.getElementById("saveBtn"),
  bufferCount: document.getElementById("bufferCount"),
  networkStatus: document.getElementById("networkStatus"),
  logsCount: document.getElementById("logsCount"),
  logContainer: document.getElementById("logContainer"),
  syncBtn: document.getElementById("syncBtn"),
  syncBtnText: document.getElementById("syncBtnText"),
  clearBtn: document.getElementById("clearBtn"),

  // Settings Tab
  blockedDomainsList: document.getElementById("blockedDomainsList"),
  newBlockedDomain: document.getElementById("newBlockedDomain"),
  addBlockedDomainBtn: document.getElementById("addBlockedDomainBtn"),
  sensitiveParamsList: document.getElementById("sensitiveParamsList"),
  newSensitiveParam: document.getElementById("newSensitiveParam"),
  addSensitiveParamBtn: document.getElementById("addSensitiveParamBtn"),
  resetSettingsBtn: document.getElementById("resetSettingsBtn"),

  // Toast
  toast: document.getElementById("toast"),
};

// --- State ---
let isPasswordVisible = false;
let isSyncing = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener("DOMContentLoaded", async () => {
  // Load saved API key
  await loadApiKey();

  // Render logs
  await renderLogs();

  // Check connection status
  await checkConnectionStatus();

  // Update network status
  updateNetworkStatus();

  // Load custom settings
  await loadCustomSettings();

  // Set version from manifest
  const manifest = chrome.runtime.getManifest();
  elements.version.textContent = `v${manifest.version}`;

  // Setup tab navigation
  setupTabs();
});

// ============================================
// TAB NAVIGATION
// ============================================

function setupTabs() {
  elements.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;

      // Update button states
      elements.tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Update tab content
      document.querySelectorAll(".tab-content").forEach((tab) => {
        tab.classList.remove("active");
      });
      document.getElementById(`${tabName}-tab`).classList.add("active");
    });
  });
}

// ============================================
// EVENT LISTENERS - ACTIVITY TAB
// ============================================

// Save API Key
elements.saveBtn.addEventListener("click", saveApiKey);

// Toggle password visibility
elements.toggleVisibility.addEventListener("click", () => {
  isPasswordVisible = !isPasswordVisible;
  elements.apiKeyInput.type = isPasswordVisible ? "text" : "password";
  elements.toggleVisibility.textContent = isPasswordVisible ? "🙈" : "👁";
});

// Enter key to save
elements.apiKeyInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    saveApiKey();
  }
});

// Force Sync
elements.syncBtn.addEventListener("click", forceSync);

// Clear Logs
elements.clearBtn.addEventListener("click", clearLogs);

// ============================================
// EVENT LISTENERS - SETTINGS TAB
// ============================================

// Add blocked domain
elements.addBlockedDomainBtn.addEventListener("click", () => {
  addCustomItem("blockedDomains", elements.newBlockedDomain);
});

elements.newBlockedDomain.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    addCustomItem("blockedDomains", elements.newBlockedDomain);
  }
});

// Add sensitive param
elements.addSensitiveParamBtn.addEventListener("click", () => {
  addCustomItem("sensitiveParams", elements.newSensitiveParam);
});

elements.newSensitiveParam.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    addCustomItem("sensitiveParams", elements.newSensitiveParam);
  }
});

// Reset settings
elements.resetSettingsBtn.addEventListener("click", resetCustomSettings);

// ============================================
// CUSTOM SETTINGS MANAGEMENT
// ============================================

async function loadCustomSettings() {
  const data = await chrome.storage.local.get([
    "customBlockedDomains",
    "customSensitiveParams",
  ]);

  const blockedDomains = data.customBlockedDomains || [];
  const sensitiveParams = data.customSensitiveParams || [];

  renderTags("blockedDomainsList", blockedDomains, "blockedDomains");
  renderTags("sensitiveParamsList", sensitiveParams, "sensitiveParams");
}

function renderTags(containerId, items, storageKey) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  items.forEach((item) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.innerHTML = `
      ${escapeHtml(item)}
      <button class="tag-remove" data-item="${escapeHtml(item)}" data-key="${storageKey}">×</button>
    `;
    container.appendChild(tag);
  });

  // Add click handlers for remove buttons
  container.querySelectorAll(".tag-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const item = e.target.dataset.item;
      const key = e.target.dataset.key;
      await removeCustomItem(key, item);
    });
  });
}

async function addCustomItem(storageKey, inputElement) {
  const value = inputElement.value.trim().toLowerCase();

  if (!value) {
    showToast("Please enter a value", "error");
    return;
  }

  // Validate based on type
  if (storageKey === "blockedDomains") {
    // Basic domain validation
    if (!isValidDomain(value)) {
      showToast("Please enter a valid domain (e.g., example.com)", "error");
      return;
    }
  } else if (storageKey === "sensitiveParams") {
    // Param validation (alphanumeric + underscore)
    if (!/^[a-z0-9_]+$/i.test(value)) {
      showToast(
        "Parameters can only contain letters, numbers, and underscores",
        "error",
      );
      return;
    }
  }

  const chromeKey =
    storageKey === "blockedDomains"
      ? "customBlockedDomains"
      : "customSensitiveParams";
  const data = await chrome.storage.local.get(chromeKey);
  const items = data[chromeKey] || [];

  // Check for duplicates
  if (items.includes(value)) {
    showToast("This item already exists", "error");
    return;
  }

  // Add new item
  items.push(value);
  await chrome.storage.local.set({ [chromeKey]: items });

  // Clear input and refresh
  inputElement.value = "";
  await loadCustomSettings();

  // Notify background to refresh
  chrome.runtime.sendMessage({ action: "refreshSettings" });

  showToast(`Added "${value}"`, "success");
}

async function removeCustomItem(storageKey, item) {
  const chromeKey =
    storageKey === "blockedDomains"
      ? "customBlockedDomains"
      : "customSensitiveParams";
  const data = await chrome.storage.local.get(chromeKey);
  const items = data[chromeKey] || [];

  const filtered = items.filter((i) => i !== item);
  await chrome.storage.local.set({ [chromeKey]: filtered });

  await loadCustomSettings();

  // Notify background to refresh
  chrome.runtime.sendMessage({ action: "refreshSettings" });

  showToast(`Removed "${item}"`, "success");
}

async function resetCustomSettings() {
  if (
    !confirm(
      "This will remove all custom blocked domains and sensitive parameters. Continue?",
    )
  ) {
    return;
  }

  await chrome.storage.local.set({
    customBlockedDomains: [],
    customSensitiveParams: [],
  });

  await loadCustomSettings();

  // Notify background to refresh
  chrome.runtime.sendMessage({ action: "refreshSettings" });

  showToast("Custom settings reset", "success");
}

function isValidDomain(value) {
  // Simple domain validation
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
  // Also allow IP addresses
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  // Also allow localhost
  if (value === "localhost") return true;
  return domainRegex.test(value) || ipRegex.test(value);
}

// ============================================
// API KEY MANAGEMENT
// ============================================

async function loadApiKey() {
  const data = await chrome.storage.local.get("apiKey");
  if (data.apiKey) {
    elements.apiKeyInput.value = data.apiKey;
  }
}

async function saveApiKey() {
  const key = elements.apiKeyInput.value.trim();

  if (!key) {
    showToast("Please enter an API key", "error");
    return;
  }

  // Save to storage
  await chrome.storage.local.set({ apiKey: key });
  showToast("API key saved!", "success");

  // Re-check connection
  await checkConnectionStatus();
}

// ============================================
// CONNECTION STATUS
// ============================================

async function checkConnectionStatus() {
  setStatus("checking", "Checking...");

  const data = await chrome.storage.local.get("apiKey");

  if (!data.apiKey) {
    setStatus("disconnected", "No API key");
    return;
  }

  if (!navigator.onLine) {
    setStatus("disconnected", "Offline");
    return;
  }

  try {
    // Send message to background to check connection
    const response = await chrome.runtime.sendMessage({
      action: "checkConnection",
      apiKey: data.apiKey,
    });

    if (response?.connected) {
      setStatus("connected", "Connected");
    } else {
      setStatus("disconnected", response?.error || "Disconnected");
    }
  } catch (e) {
    // If we can't reach background, just check if we have a key
    setStatus("connected", "Ready");
  }
}

function setStatus(status, text) {
  elements.statusDot.className = "status-dot " + status;
  elements.statusText.textContent = text;
}

function updateNetworkStatus() {
  elements.networkStatus.textContent = navigator.onLine
    ? "🟢 Online"
    : "🔴 Offline";
}

// Listen for online/offline changes
window.addEventListener("online", () => {
  updateNetworkStatus();
  checkConnectionStatus();
});

window.addEventListener("offline", () => {
  updateNetworkStatus();
  setStatus("disconnected", "Offline");
});

// ============================================
// LOGS RENDERING
// ============================================

async function renderLogs() {
  const data = await chrome.storage.local.get("logs");
  const logs = data.logs || [];

  // Update counts
  elements.bufferCount.textContent = logs.length;
  elements.logsCount.textContent = `${logs.length} item${logs.length !== 1 ? "s" : ""}`;

  // Clear container
  elements.logContainer.innerHTML = "";

  if (logs.length === 0) {
    elements.logContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-text">No activity logged yet.<br>Start browsing to capture data.</div>
      </div>
    `;
    return;
  }

  // Render logs (newest first, limit to 20)
  const recentLogs = logs.slice().reverse().slice(0, 20);

  recentLogs.forEach((log) => {
    const item = document.createElement("div");
    item.className = "log-item";

    // Format title
    const title = log.title || log.domain;
    const cleanTitle =
      title.length > 45 ? title.substring(0, 45) + "..." : title;

    // Format duration
    const duration = formatDuration(log.duration);

    item.innerHTML = `
      <div class="log-title" title="${escapeHtml(log.description || log.title || "")}">${escapeHtml(cleanTitle)}</div>
      <div class="log-meta">
        <span class="log-domain">${escapeHtml(log.domain)}</span>
        <span>•</span>
        <span class="log-duration">${duration}</span>
      </div>
    `;

    elements.logContainer.appendChild(item);
  });
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// SYNC OPERATIONS
// ============================================

async function forceSync() {
  if (isSyncing) return;

  const data = await chrome.storage.local.get(["logs", "apiKey"]);

  if (!data.apiKey) {
    showToast("Please set an API key first", "error");
    return;
  }

  if (!data.logs || data.logs.length === 0) {
    showToast("No logs to sync", "error");
    return;
  }

  if (!navigator.onLine) {
    showToast("You are offline", "error");
    return;
  }

  // Set syncing state
  isSyncing = true;
  elements.syncBtn.disabled = true;
  elements.syncBtn.classList.add("syncing");
  elements.syncBtnText.innerHTML = '<span class="spinner"></span> Syncing...';

  try {
    // Send message to background to sync
    const response = await chrome.runtime.sendMessage({ action: "forceSync" });

    if (response?.success) {
      showToast(`Synced ${data.logs.length} logs!`, "success");
      await renderLogs();
      await checkConnectionStatus();
    } else {
      showToast(response?.error || "Sync failed", "error");
    }
  } catch (e) {
    showToast("Sync error: " + e.message, "error");
  } finally {
    isSyncing = false;
    elements.syncBtn.disabled = false;
    elements.syncBtn.classList.remove("syncing");
    elements.syncBtnText.innerHTML = "⚡ Force Sync";
  }
}

// ============================================
// CLEAR LOGS
// ============================================

async function clearLogs() {
  const data = await chrome.storage.local.get("logs");
  const count = data.logs?.length || 0;

  if (count === 0) {
    showToast("Buffer is already empty", "error");
    return;
  }

  // Confirm before clearing
  if (
    !confirm(
      `Clear ${count} buffered log${count !== 1 ? "s" : ""}? This cannot be undone.`,
    )
  ) {
    return;
  }

  await chrome.storage.local.set({ logs: [] });
  await renderLogs();
  showToast("Buffer cleared", "success");
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

let toastTimeout;

function showToast(message, type = "success") {
  clearTimeout(toastTimeout);

  elements.toast.textContent = message;
  elements.toast.className = `toast ${type} show`;

  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3000);
}

// ============================================
// AUTO-REFRESH (Update logs when popup is open)
// ============================================

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.logs) {
      renderLogs();
    }
    if (changes.customBlockedDomains || changes.customSensitiveParams) {
      loadCustomSettings();
    }
  }
});
