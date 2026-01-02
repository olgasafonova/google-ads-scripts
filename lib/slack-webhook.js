/**
 * Slack webhook helper for Google Ads Scripts
 *
 * Setup:
 * 1. Go to https://api.slack.com/apps
 * 2. Create new app → From scratch
 * 3. Enable Incoming Webhooks
 * 4. Add new webhook to workspace
 * 5. Copy the webhook URL
 */

/**
 * Send a message to Slack
 * @param {string} webhookUrl - Slack webhook URL
 * @param {string} message - Message text
 * @param {Object} options - Optional settings
 * @param {string} options.channel - Override default channel
 * @param {string} options.username - Bot username
 * @param {string} options.iconEmoji - Bot icon emoji (e.g., ':chart_with_upwards_trend:')
 * @returns {boolean} True if sent successfully
 */
function sendSlackMessage(webhookUrl, message, options) {
  if (!webhookUrl) {
    Logger.log('Slack webhook URL not configured');
    return false;
  }

  options = options || {};

  var payload = {
    text: message
  };

  if (options.channel) payload.channel = options.channel;
  if (options.username) payload.username = options.username;
  if (options.iconEmoji) payload.icon_emoji = options.iconEmoji;

  try {
    var response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      return true;
    } else {
      Logger.log('Slack error: ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('Slack exception: ' + e.message);
    return false;
  }
}

/**
 * Send a formatted alert to Slack
 * @param {string} webhookUrl - Slack webhook URL
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {string} severity - 'info', 'warning', or 'critical'
 * @returns {boolean} True if sent successfully
 */
function sendSlackAlert(webhookUrl, title, message, severity) {
  if (!webhookUrl) {
    Logger.log('Slack webhook URL not configured');
    return false;
  }

  severity = severity || 'info';

  var colors = {
    'info': '#36a64f',      // Green
    'warning': '#ff9800',   // Orange
    'critical': '#f44336'   // Red
  };

  var emojis = {
    'info': ':white_check_mark:',
    'warning': ':warning:',
    'critical': ':rotating_light:'
  };

  var payload = {
    attachments: [{
      color: colors[severity] || colors.info,
      title: emojis[severity] + ' ' + title,
      text: message,
      footer: 'Google Ads Scripts',
      ts: Math.floor(Date.now() / 1000)
    }]
  };

  try {
    var response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    return response.getResponseCode() === 200;
  } catch (e) {
    Logger.log('Slack exception: ' + e.message);
    return false;
  }
}

/**
 * Send a table to Slack (formatted as code block)
 * @param {string} webhookUrl - Slack webhook URL
 * @param {string} title - Table title
 * @param {Array} headers - Array of column headers
 * @param {Array} rows - 2D array of row data
 * @returns {boolean} True if sent successfully
 */
function sendSlackTable(webhookUrl, title, headers, rows) {
  if (!webhookUrl) return false;

  // Calculate column widths
  var widths = headers.map(function(h, i) {
    var maxLen = String(h).length;
    rows.forEach(function(row) {
      var cellLen = String(row[i] || '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    });
    return maxLen;
  });

  // Build table string
  var lines = [];

  // Header row
  var headerRow = headers.map(function(h, i) {
    return padRight(String(h), widths[i]);
  }).join(' | ');
  lines.push(headerRow);

  // Separator
  var separator = widths.map(function(w) {
    return repeat('-', w);
  }).join('-+-');
  lines.push(separator);

  // Data rows
  rows.forEach(function(row) {
    var dataRow = row.map(function(cell, i) {
      return padRight(String(cell || ''), widths[i]);
    }).join(' | ');
    lines.push(dataRow);
  });

  var tableText = '```\n' + lines.join('\n') + '\n```';

  var payload = {
    text: '*' + title + '*\n' + tableText
  };

  try {
    var response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    return response.getResponseCode() === 200;
  } catch (e) {
    Logger.log('Slack exception: ' + e.message);
    return false;
  }
}

// Helper: Pad string to the right
function padRight(str, len) {
  while (str.length < len) str += ' ';
  return str;
}

// Helper: Repeat character
function repeat(char, count) {
  var result = '';
  for (var i = 0; i < count; i++) result += char;
  return result;
}
