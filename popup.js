// Load logs when popup opens
document.addEventListener("DOMContentLoaded", async () => {
  await renderLogs();
});

// Clear logs button
document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ activityLogs: [] });
  await renderLogs();
});

async function renderLogs() {
  const data = await chrome.storage.local.get("activityLogs");
  const logs = data.activityLogs || [];
  const container = document.getElementById("log-container");

  container.innerHTML = "";

  // Show newest first
  logs
    .slice()
    .reverse()
    .forEach((log) => {
      const div = document.createElement("div");
      div.className = "log-item";

      // Format duration nicely
      const duration =
        log.duration < 60
          ? `${log.duration}s`
          : `${Math.floor(log.duration / 60)}m ${log.duration % 60}s`;

      div.innerHTML = `
      <div class="domain">${log.domain}</div>
      <div class="time">${duration} • ${new Date(log.startTime).toLocaleTimeString()}</div>
    `;
      container.appendChild(div);
    });

  if (logs.length === 0) {
    container.innerHTML =
      '<div style="padding:10px; color:#888;">No logs yet.</div>';
  }
}
