/**
 * Shared utilities for Google Ads Scripts
 * Copy these functions into your script or include via the script editor.
 */

/**
 * Format a number as currency
 * @param {number} amount - Amount in micros (1,000,000 = $1)
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, currency) {
  currency = currency || 'USD';
  var value = amount / 1000000;
  return Utilities.formatString('%s%.2f', getCurrencySymbol(currency), value);
}

/**
 * Get currency symbol
 * @param {string} currency - Currency code
 * @returns {string} Currency symbol
 */
function getCurrencySymbol(currency) {
  var symbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'AUD': 'A$',
    'CAD': 'C$'
  };
  return symbols[currency] || currency + ' ';
}

/**
 * Format a number as percentage
 * @param {number} value - Value between 0 and 1
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted percentage string
 */
function formatPercent(value, decimals) {
  decimals = decimals || 2;
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Get date string in YYYY-MM-DD format
 * @param {Date} date - Date object (default: today)
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  date = date || new Date();
  return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

/**
 * Get date N days ago
 * @param {number} daysAgo - Number of days to go back
 * @returns {Date} Date object
 */
function getDateDaysAgo(daysAgo) {
  var date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date;
}

/**
 * Get the date range string for Google Ads reports
 * @param {number} daysAgo - Number of days to look back
 * @returns {string} Date range in YYYYMMDD,YYYYMMDD format
 */
function getDateRange(daysAgo) {
  var endDate = new Date();
  var startDate = getDateDaysAgo(daysAgo);
  var tz = AdsApp.currentAccount().getTimeZone();
  return Utilities.formatDate(startDate, tz, 'yyyyMMdd') + ',' +
         Utilities.formatDate(endDate, tz, 'yyyyMMdd');
}

/**
 * Calculate percentage change between two values
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {number} Percentage change (0.1 = 10%)
 */
function percentChange(current, previous) {
  if (previous === 0) {
    return current > 0 ? 1 : 0;
  }
  return (current - previous) / previous;
}

/**
 * Check if today is a weekday (Mon-Fri)
 * @returns {boolean} True if weekday
 */
function isWeekday() {
  var day = new Date().getDay();
  return day >= 1 && day <= 5;
}

/**
 * Check if today is a weekend (Sat-Sun)
 * @returns {boolean} True if weekend
 */
function isWeekend() {
  return !isWeekday();
}

/**
 * Get day of week name
 * @param {Date} date - Date object (default: today)
 * @returns {string} Day name (e.g., "Monday")
 */
function getDayName(date) {
  date = date || new Date();
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

/**
 * Sleep for specified milliseconds
 * Note: Google Ads Scripts have execution limits, use sparingly
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  Utilities.sleep(ms);
}

/**
 * Chunk an array into smaller arrays
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array} Array of chunks
 */
function chunkArray(array, size) {
  var chunks = [];
  for (var i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Remove duplicates from array
 * @param {Array} array - Array with potential duplicates
 * @returns {Array} Array with unique values
 */
function uniqueArray(array) {
  return array.filter(function(value, index, self) {
    return self.indexOf(value) === index;
  });
}
