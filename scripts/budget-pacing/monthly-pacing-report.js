/**
 * Monthly Budget Pacing Report
 *
 * Generates a report showing:
 * - Month-to-date spend vs monthly budget
 * - Projected end-of-month spend based on current pacing
 * - Recommended daily budget adjustments
 *
 * Schedule: Run daily (morning recommended)
 *
 * Setup:
 * 1. Create a Google Sheet to store results
 * 2. Update CONFIG below with your settings
 * 3. Preview the script to test
 * 4. Schedule to run daily
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email recipients (comma-separated for multiple)
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // Monthly budgets by campaign name (set to null to use daily budget * 30)
  MONTHLY_BUDGETS: {
    // 'Campaign Name': 5000,
    // 'Another Campaign': 10000
  },

  // Alert thresholds
  OVER_PACE_THRESHOLD: 1.15,   // Alert if projected > 115% of monthly budget
  UNDER_PACE_THRESHOLD: 0.70, // Alert if projected < 70% of monthly budget

  // Only check campaigns with at least this much daily budget
  MIN_BUDGET_AMOUNT: 10,

  // Campaign name filters (leave empty to check all)
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: ''
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  // Get month details
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  var daysInMonth = monthEnd.getDate();
  var currentDay = now.getDate();
  var daysRemaining = daysInMonth - currentDay;
  var monthProgress = currentDay / daysInMonth;

  Logger.log('Starting monthly pacing report for: ' + accountName);
  Logger.log('Day ' + currentDay + ' of ' + daysInMonth + ' (' + formatPercent(monthProgress) + ' through month)');

  var reportData = [];
  var alerts = [];

  // Build campaign selector
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

  var campaigns = campaignSelector.get();

  while (campaigns.hasNext()) {
    var campaign = campaigns.next();
    var campaignName = campaign.getName();
    var budget = campaign.getBudget();

    if (!budget) continue;

    var dailyBudget = budget.getAmount();
    if (dailyBudget < CONFIG.MIN_BUDGET_AMOUNT) continue;

    // Calculate monthly budget
    var monthlyBudget = CONFIG.MONTHLY_BUDGETS[campaignName] || (dailyBudget * daysInMonth);

    // Get month-to-date stats
    var stats = campaign.getStatsFor('THIS_MONTH');
    var mtdSpend = stats.getCost();

    // Calculate pacing
    var expectedSpend = monthlyBudget * monthProgress;
    var avgDailySpend = currentDay > 0 ? mtdSpend / currentDay : 0;
    var projectedSpend = mtdSpend + (avgDailySpend * daysRemaining);
    var paceRatio = monthlyBudget > 0 ? projectedSpend / monthlyBudget : 0;

    // Calculate recommended daily budget
    var remainingBudget = monthlyBudget - mtdSpend;
    var recommendedDaily = daysRemaining > 0 ? remainingBudget / daysRemaining : 0;
    var budgetAdjustment = recommendedDaily - dailyBudget;

    var row = {
      timestamp: Utilities.formatDate(now, timeZone, 'yyyy-MM-dd'),
      campaignName: campaignName,
      dailyBudget: dailyBudget,
      monthlyBudget: monthlyBudget,
      mtdSpend: mtdSpend,
      expectedSpend: expectedSpend,
      projectedSpend: projectedSpend,
      paceRatio: paceRatio,
      recommendedDaily: recommendedDaily,
      budgetAdjustment: budgetAdjustment,
      status: 'ON_PACE'
    };

    // Check for pacing issues
    if (paceRatio >= CONFIG.OVER_PACE_THRESHOLD) {
      row.status = 'OVER_PACE';
      alerts.push({
        severity: 'warning',
        campaign: campaignName,
        message: 'Over-pacing: Projected ' + formatCurrency(projectedSpend) + ' vs ' +
                 formatCurrency(monthlyBudget) + ' budget (' + formatPercent(paceRatio) + '). ' +
                 'Consider reducing daily budget by ' + formatCurrency(Math.abs(budgetAdjustment))
      });
    } else if (paceRatio <= CONFIG.UNDER_PACE_THRESHOLD) {
      row.status = 'UNDER_PACE';
      alerts.push({
        severity: 'warning',
        campaign: campaignName,
        message: 'Under-pacing: Projected ' + formatCurrency(projectedSpend) + ' vs ' +
                 formatCurrency(monthlyBudget) + ' budget (' + formatPercent(paceRatio) + '). ' +
                 'Consider increasing daily budget by ' + formatCurrency(Math.abs(budgetAdjustment))
      });
    }

    reportData.push(row);
  }

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logToSpreadsheet(reportData, now, timeZone);
  }

  // Send report email
  sendReport(accountName, reportData, alerts, {
    currentDay: currentDay,
    daysInMonth: daysInMonth,
    daysRemaining: daysRemaining
  });

  Logger.log('Finished. Processed ' + reportData.length + ' campaigns, ' + alerts.length + ' alerts.');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function logToSpreadsheet(data, now, timeZone) {
  if (data.length === 0) return;

  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheetName = 'Pacing ' + Utilities.formatDate(now, timeZone, 'yyyy-MM');
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.appendRow([
      'Date', 'Campaign', 'Daily Budget', 'Monthly Budget',
      'MTD Spend', 'Expected Spend', 'Projected Spend',
      'Pace %', 'Recommended Daily', 'Adjustment', 'Status'
    ]);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var rows = data.map(function(row) {
    return [
      row.timestamp,
      row.campaignName,
      row.dailyBudget,
      row.monthlyBudget,
      row.mtdSpend,
      row.expectedSpend,
      row.projectedSpend,
      row.paceRatio,
      row.recommendedDaily,
      row.budgetAdjustment,
      row.status
    ];
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, 11).setValues(rows);

  // Format columns
  var dataRows = sheet.getLastRow() - 1;
  if (dataRows > 0) {
    sheet.getRange(2, 3, dataRows, 5).setNumberFormat('$#,##0.00');
    sheet.getRange(2, 8, dataRows, 1).setNumberFormat('0.0%');
    sheet.getRange(2, 9, dataRows, 2).setNumberFormat('$#,##0.00');
  }
}

function sendReport(accountName, data, alerts, monthInfo) {
  if (!CONFIG.EMAIL_RECIPIENTS) return;

  var subject = '[Google Ads] Monthly Pacing Report - ' + accountName;

  var body = 'Monthly Budget Pacing Report for ' + accountName + '\n';
  body += 'Day ' + monthInfo.currentDay + ' of ' + monthInfo.daysInMonth;
  body += ' (' + monthInfo.daysRemaining + ' days remaining)\n\n';

  if (alerts.length > 0) {
    body += '⚠️ ALERTS (' + alerts.length + '):\n\n';
    alerts.forEach(function(alert) {
      body += '• ' + alert.campaign + '\n  ' + alert.message + '\n\n';
    });
  }

  body += '\n📊 CAMPAIGN SUMMARY:\n\n';
  data.forEach(function(row) {
    var statusIcon = row.status === 'ON_PACE' ? '✅' :
                     row.status === 'OVER_PACE' ? '🔴' : '🟡';
    body += statusIcon + ' ' + row.campaignName + '\n';
    body += '   MTD: ' + formatCurrency(row.mtdSpend) + ' / ' + formatCurrency(row.monthlyBudget);
    body += ' (Projected: ' + formatCurrency(row.projectedSpend) + ')\n\n';
  });

  body += '\n--\nSent by Google Ads Scripts Monthly Pacing Report';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS,
    subject: subject,
    body: body
  });

  Logger.log('Report email sent to: ' + CONFIG.EMAIL_RECIPIENTS);
}

function formatCurrency(amount) {
  return '$' + amount.toFixed(2);
}

function formatPercent(value) {
  return (value * 100).toFixed(1) + '%';
}
