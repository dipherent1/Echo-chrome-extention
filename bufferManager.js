// ============================================
// BUFFER MANAGER - Log Entry Buffer Management
// ============================================

import logger from "./logger.js";
import { checkAndPurgeStorage } from "./utils.js";

/**
 * Get all log entries from the buffer
 * @returns {Promise<Array>} Array of log entries
 */
export async function getEntries() {
  const data = await chrome.storage.local.get("logs");
  return data.logs || [];
}

/**
 * Add a new log entry to the buffer (no merging)
 * @param {Object} log - Log entry to add
 * @returns {Promise<number>} New buffer size
 */
export async function addEntry(log) {
  try {
    // Check storage quota before adding
    await checkAndPurgeStorage();

    const logs = await getEntries();
    logs.push(log);

    await chrome.storage.local.set({ logs });

    logger.debug("Added entry to buffer", {
      domain: log.domain,
      duration: log.duration,
      bufferSize: logs.length,
    });

    return logs.length;
  } catch (e) {
    logger.error("Failed to add entry to buffer", { error: e.message });
    throw e;
  }
}

/**
 * Remove entries from buffer by indices
 * @param {number[]} indices - Array of indices to remove
 * @returns {Promise<number>} Remaining buffer size
 */
export async function removeEntries(indices) {
  try {
    const logs = await getEntries();
    const indicesToRemove = new Set(indices);
    const remainingLogs = logs.filter(
      (_, index) => !indicesToRemove.has(index),
    );

    await chrome.storage.local.set({ logs: remainingLogs });

    logger.debug("Removed entries from buffer", {
      removed: indices.length,
      remaining: remainingLogs.length,
    });

    return remainingLogs.length;
  } catch (e) {
    logger.error("Failed to remove entries from buffer", { error: e.message });
    throw e;
  }
}

/**
 * Clear the entire buffer
 * @returns {Promise<void>}
 */
export async function clear() {
  await chrome.storage.local.set({ logs: [] });
  logger.info("Buffer cleared");
}
