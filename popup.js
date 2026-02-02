document.addEventListener("DOMContentLoaded", renderLogs);
document.getElementById("save").addEventListener("click", saveKey);
document.getElementById("clearBtn").addEventListener("click", clearLogs);

// 1. Save API Key
function saveKey() {
  const key = document.getElementById("apiKey").value;
  chrome.storage.local.set({ apiKey: key }, () => {
    alert("API Key Saved");
    renderLogs();
  });
}

// 2. Clear Logs
async function clearLogs() {
  await chrome.storage.local.set({ logs: [] });
  renderLogs();
}

// 3. Render
async function renderLogs() {
  const data = await chrome.storage.local.get(["logs", "apiKey"]);
  const logs = data.logs || [];

  // Fill Key Input if exists
  if (data.apiKey) document.getElementById("apiKey").value = data.apiKey;

  const container = document.getElementById("log-container");
  container.innerHTML = "";

  logs
    .slice()
    .reverse()
    .forEach((log) => {
      const div = document.createElement("div");
      div.className = "log-item";

      // Use Title if available, else Domain
      const titleText = log.title || log.domain;
      // Truncate
      const cleanTitle =
        titleText.length > 40 ? titleText.substring(0, 40) + "..." : titleText;

      // Time format
      const duration =
        log.duration < 60
          ? `${log.duration}s`
          : `${Math.floor(log.duration / 60)}m ${log.duration % 60}s`;

      div.innerHTML = `
            <div class="domain" title="${log.description || ""}">${cleanTitle}</div>
            <div class="time">${log.domain} • ${duration}</div>
        `;
      container.appendChild(div);
    });

  if (logs.length === 0)
    container.innerHTML = '<div style="color:#999">No logs buffer.</div>';
}
