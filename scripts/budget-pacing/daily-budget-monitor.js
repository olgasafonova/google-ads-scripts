/**
 * Daily Budget Monitor
 *
 * Monitors campaign spending against daily budgets and alerts when:
 * - A campaign is overspending (>110% of daily budget)
 * - A campaign is underspending (<50% of daily budget by midday)
 * - A campaign is close to hitting its budget limit
 *
 * Schedule: Run hourly for best results
 *
 * Setup:
 * 1. Create a Google Sheet to store results
 * 2. Update CONFIG below with your settings
 * 3. Preview the script to test
 * 4. Schedule to run hourly
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email recipients (comma-separated for multiple)
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // Slack webhook URL (optional - leave empty to disable)
  SLACK_WEBHOOK_URL: '',

  // Alert thresholds
  OVERSPEND_THRESHOLD: 1.10,    // Alert if spend > 110% of budget
  UNDERSPEND_THRESHOLD: 0.50,  // Alert if spend < 50% of budget by midday
  NEAR_LIMIT_THRESHOLD: 0.95,  // Alert if spend > 95% of budget

  // Only check campaigns with at least this much daily budget
  MIN_BUDGET_AMOUNT: 10,

  // Campaign name filters (leave empty to check all)
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Only check enabled campaigns
  ONLY_ENABLED: true
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function buildCampaignSelector() {
  var campaignSelector = AdsApp.campaigns()
    .withCondition('Status = ENABLED');

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    campaignSelector = campaignSelector
      .withCondition("Name CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'");
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    campaignSelector = campaignSelector
      .withCondition("Name DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'");
  }

  return campaignSelector;
}

function classifyBudgetStatus(row, currentHour) {
  var spendRatio = row.spendRatio;

  if (spendRatio >= CONFIG.OVERSPEND_THRESHOLD) {
    return {
      status: 'OVERSPEND',
      alert: {
        severity: 'warning',
        campaign: row.campaignName,
        message: 'Overspending: ' + formatPercent(spendRatio) + ' of daily budget spent (' +
                 formatCurrency(row.todaySpend) + ' / ' + formatCurrency(row.dailyBudget) + ')'
      }
    };
  }

  if (spendRatio >= CONFIG.NEAR_LIMIT_THRESHOLD) {
    return {
      status: 'NEAR_LIMIT',
      alert: {
        severity: 'info',
        campaign: row.campaignName,
        message: 'Near budget limit: ' + formatPercent(spendRatio) + ' of daily budget spent (' +
                 formatCurrency(row.todaySpend) + ' / ' + formatCurrency(row.dailyBudget) + ')'
      }
    };
  }

  if (currentHour >= 12 && spendRatio < CONFIG.UNDERSPEND_THRESHOLD * row.expectedRatio) {
    return {
      status: 'UNDERSPEND',
      alert: {
        severity: 'warning',
        campaign: row.campaignName,
        message: 'Underspending: Only ' + formatPercent(spendRatio) + ' of budget spent by ' +
                 currentHour + ':00 (expected ~' + formatPercent(row.expectedRatio) + ')'
      }
    };
  }

  return { status: 'OK', alert: null };
}

function buildCampaignRow(campaign, now, timeZone, currentHour) {
  var budget = campaign.getBudget();
  if (!budget) return null;

  var dailyBudget = budget.getAmount();

  // Skip campaigns below minimum budget threshold
  if (dailyBudget < CONFIG.MIN_BUDGET_AMOUNT) return null;

  var todaySpend = campaign.getStatsFor('TODAY').getCost();

  return {
    timestamp: Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm'),
    campaignName: campaign.getName(),
    dailyBudget: dailyBudget,
    todaySpend: todaySpend,
    spendRatio: dailyBudget > 0 ? todaySpend / dailyBudget : 0,
    expectedRatio: currentHour / 24,
    status: 'OK'
  };
}

function evaluateCampaigns(now, timeZone, currentHour) {
  var alerts = [];
  var campaignData = [];

  var campaigns = buildCampaignSelector().get();

  while (campaigns.hasNext()) {
    var row = buildCampaignRow(campaigns.next(), now, timeZone, currentHour);
    if (!row) continue;

    var classification = classifyBudgetStatus(row, currentHour);
    row.status = classification.status;
    if (classification.alert) alerts.push(classification.alert);

    campaignData.push(row);
  }

  return { alerts: alerts, campaignData: campaignData };
}

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();
  var currentHour = parseInt(Utilities.formatDate(now, timeZone, 'H'));

  Logger.log('Starting budget monitor for account: ' + accountName);
  Logger.log('Current hour: ' + currentHour);

  var result = evaluateCampaigns(now, timeZone, currentHour);

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logToSpreadsheet(result.campaignData);
  }

  // Send alerts
  if (result.alerts.length > 0) {
    sendAlerts(accountName, result.alerts);
  }

  Logger.log('Finished. Found ' + result.alerts.length + ' alerts across ' +
             result.campaignData.length + ' campaigns.');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function logToSpreadsheet(data) {
  if (data.length === 0) return;

  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName('Budget Monitor');

  if (!sheet) {
    sheet = spreadsheet.insertSheet('Budget Monitor');
    sheet.appendRow(['Timestamp', 'Campaign', 'Daily Budget', 'Today Spend', 'Spend %', 'Expected %', 'Status']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var rows = data.map(function(row) {
    return [
      row.timestamp,
      row.campaignName,
      row.dailyBudget,
      row.todaySpend,
      row.spendRatio,
      row.expectedRatio,
      row.status
    ];
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, 7).setValues(rows);

  // Format columns
  sheet.getRange(2, 3, sheet.getLastRow() - 1, 2).setNumberFormat('$#,##0.00');
  sheet.getRange(2, 5, sheet.getLastRow() - 1, 2).setNumberFormat('0.0%');
}

function sendAlerts(accountName, alerts) {
  var subject = '[Google Ads] Budget Alert - ' + accountName;

  var body = 'Budget alerts for ' + accountName + ':\n\n';

  alerts.forEach(function(alert) {
    body += '• ' + alert.campaign + '\n  ' + alert.message + '\n\n';
  });

  body += '\n--\nSent by Google Ads Scripts Budget Monitor';

  // Send email
  if (CONFIG.EMAIL_RECIPIENTS) {
    MailApp.sendEmail({
      to: CONFIG.EMAIL_RECIPIENTS,
      subject: subject,
      body: body
    });
    Logger.log('Email sent to: ' + CONFIG.EMAIL_RECIPIENTS);
  }

  // Send Slack
  if (CONFIG.SLACK_WEBHOOK_URL) {
    var slackMessage = '*' + subject + '*\n\n';
    alerts.forEach(function(alert) {
      var emoji = alert.severity === 'warning' ? ':warning:' : ':information_source:';
      slackMessage += emoji + ' *' + alert.campaign + '*\n' + alert.message + '\n\n';
    });

    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: slackMessage })
    });
    Logger.log('Slack notification sent');
  }
}

function formatCurrency(amount) {
  return '$' + amount.toFixed(2);
}

function formatPercent(value) {
  return (value * 100).toFixed(1) + '%';
}
