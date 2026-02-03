// ============================================
// LOGGER - Development Logging Strategy
// ============================================
// Only logs in development mode. In production, all logs are silent.
// Uses structured logging for easier debugging.

import { IS_DEV } from "./config.js";

// Log levels
const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Current log level (can be adjusted)
const CURRENT_LEVEL = IS_DEV ? LEVELS.DEBUG : LEVELS.ERROR;

// Styling for console output
const STYLES = {
  DEBUG: "color: #8B5CF6; font-weight: bold;", // Purple
  INFO: "color: #10B981; font-weight: bold;", // Green
  WARN: "color: #F59E0B; font-weight: bold;", // Orange
  ERROR: "color: #EF4444; font-weight: bold;", // Red
  LABEL: "color: #6B7280;", // Gray
  DATA: "color: #3B82F6;", // Blue
};

// Prefix for all logs
const PREFIX = "[Echo]";

/**
 * Create a structured log entry
 */
function createLogEntry(level, event, data = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };
}

/**
 * Format and output log to console (dev only)
 */
function output(level, event, data) {
  if (LEVELS[level] < CURRENT_LEVEL) return;

  const entry = createLogEntry(level, event, data);
  const style = STYLES[level];

  switch (level) {
    case "DEBUG":
      console.debug(
        `%c${PREFIX} [DEBUG]%c ${event}`,
        style,
        STYLES.LABEL,
        data,
      );
      break;
    case "INFO":
      console.info(`%c${PREFIX} [INFO]%c ${event}`, style, STYLES.LABEL, data);
      break;
    case "WARN":
      console.warn(`%c${PREFIX} [WARN]%c ${event}`, style, STYLES.LABEL, data);
      break;
    case "ERROR":
      console.error(
        `%c${PREFIX} [ERROR]%c ${event}`,
        style,
        STYLES.LABEL,
        data,
      );
      break;
  }

  return entry;
}

// ============================================
// PUBLIC API
// ============================================

export const logger = {
  /**
   * Debug level - Detailed information for development
   * @param {string} event - Event name/description
   * @param {object} data - Additional data to log
   */
  debug(event, data = {}) {
    if (!IS_DEV) return;
    output("DEBUG", event, data);
  },

  /**
   * Info level - General operational messages
   * @param {string} event - Event name/description
   * @param {object} data - Additional data to log
   */
  info(event, data = {}) {
    if (!IS_DEV) return;
    output("INFO", event, data);
  },

  /**
   * Warn level - Potential issues (still logs in dev)
   * @param {string} event - Event name/description
   * @param {object} data - Additional data to log
   */
  warn(event, data = {}) {
    if (!IS_DEV) return;
    output("WARN", event, data);
  },

  /**
   * Error level - Always logs, even in production
   * Collects errors for reporting
   * @param {string} event - Event name/description
   * @param {object} data - Additional data to log
   * @returns {object} - The error entry for potential reporting
   */
  error(event, data = {}) {
    const entry = output("ERROR", event, data);
    // In production, we might want to send this somewhere
    return entry;
  },

  /**
   * Group related logs together (dev only)
   * @param {string} label - Group label
   */
  group(label) {
    if (!IS_DEV) return;
    console.group(`%c${PREFIX}%c ${label}`, STYLES.INFO, STYLES.LABEL);
  },

  /**
   * End a log group
   */
  groupEnd() {
    if (!IS_DEV) return;
    console.groupEnd();
  },

  /**
   * Log a table (dev only)
   * @param {array|object} data - Data to display as table
   */
  table(data) {
    if (!IS_DEV) return;
    console.table(data);
  },

  /**
   * Time a operation (dev only)
   * @param {string} label - Timer label
   */
  time(label) {
    if (!IS_DEV) return;
    console.time(`${PREFIX} ${label}`);
  },

  /**
   * End a timer (dev only)
   * @param {string} label - Timer label
   */
  timeEnd(label) {
    if (!IS_DEV) return;
    console.timeEnd(`${PREFIX} ${label}`);
  },
};

// Export default
export default logger;
