/**
 * Quality Score Alert
 *
 * Monitors for Quality Score drops and sends alerts when:
 * - A keyword's QS drops by 2+ points from its recent average
 * - A keyword drops to QS 1-3 (poor)
 * - Account average QS drops significantly
 *
 * Schedule: Run daily
 *
 * Setup:
 * 1. First run the QS Tracker script to build historical data
 * 2. Update CONFIG below with your settings
 * 3. Preview the script to test
 * 4. Schedule to run daily
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL with QS history (from qs-tracker.js)
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email recipients (comma-separated for multiple)
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // Slack webhook URL (optional - leave empty to disable)
  SLACK_WEBHOOK_URL: '',

  // Alert thresholds
  QS_DROP_THRESHOLD: 2,        // Alert if QS drops by this many points
  POOR_QS_THRESHOLD: 3,        // Alert if QS falls to this or below
  AVG_QS_DROP_THRESHOLD: 0.5,  // Alert if account avg QS drops by this much

  // Only alert for keywords with at least this many impressions
  MIN_IMPRESSIONS: 100,

  // Days of history to compare against
  LOOKBACK_DAYS: 7
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();
  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');

  Logger.log('Starting Quality Score Alert check for: ' + accountName);

  if (!CONFIG.SPREADSHEET_URL || CONFIG.SPREADSHEET_URL === 'YOUR_SPREADSHEET_URL_HERE') {
    Logger.log('ERROR: Please configure SPREADSHEET_URL with your QS tracking sheet');
    return;
  }

  var alerts = [];

  // Get historical QS data
  var historicalData = getHistoricalQSData();

  if (Object.keys(historicalData).length === 0) {
    Logger.log('No historical data found. Run qs-tracker.js first to build history.');
    return;
  }

  // Get current QS for all keywords
  var currentData = getCurrentQSData();

  // Compare and generate alerts
  var currentSum = 0;
  var currentCount = 0;
  var historicalSum = 0;
  var historicalCount = 0;

  for (var keywordKey in currentData) {
    var current = currentData[keywordKey];
    var historical = historicalData[keywordKey];

    currentSum += current.qualityScore;
    currentCount++;

    if (historical) {
      historicalSum += historical.avgQS;
      historicalCount++;

      var qsDrop = historical.avgQS - current.qualityScore;

      // Check for significant drop
      if (qsDrop >= CONFIG.QS_DROP_THRESHOLD) {
        alerts.push({
          severity: 'warning',
          type: 'QS_DROP',
          campaign: current.campaignName,
          adGroup: current.adGroupName,
          keyword: current.keyword,
          currentQS: current.qualityScore,
          previousQS: historical.avgQS.toFixed(1),
          drop: qsDrop.toFixed(1),
          message: 'Quality Score dropped from ' + historical.avgQS.toFixed(1) +
                   ' to ' + current.qualityScore + ' (-' + qsDrop.toFixed(1) + ')'
        });
      }
    }

    // Check for poor QS
    if (current.qualityScore <= CONFIG.POOR_QS_THRESHOLD) {
      // Avoid duplicate alerts
      var alreadyAlerted = alerts.some(function(a) {
        return a.keyword === current.keyword && a.campaign === current.campaignName;
      });

      if (!alreadyAlerted) {
        alerts.push({
          severity: 'info',
          type: 'POOR_QS',
          campaign: current.campaignName,
          adGroup: current.adGroupName,
          keyword: current.keyword,
          currentQS: current.qualityScore,
          expectedCtr: current.expectedCtr,
          adRelevance: current.adRelevance,
          landingPage: current.landingPageExperience,
          message: 'Poor Quality Score: ' + current.qualityScore + '/10'
        });
      }
    }
  }

  // Check account-level average
  var currentAvg = currentCount > 0 ? currentSum / currentCount : 0;
  var historicalAvg = historicalCount > 0 ? historicalSum / historicalCount : 0;

  if (historicalAvg > 0 && (historicalAvg - currentAvg) >= CONFIG.AVG_QS_DROP_THRESHOLD) {
    alerts.unshift({
      severity: 'critical',
      type: 'ACCOUNT_AVG_DROP',
      message: 'Account average QS dropped from ' + historicalAvg.toFixed(2) +
               ' to ' + currentAvg.toFixed(2) + ' (-' + (historicalAvg - currentAvg).toFixed(2) + ')'
    });
  }

  // Send alerts
  if (alerts.length > 0) {
    sendAlerts(accountName, alerts, {
      currentAvg: currentAvg,
      historicalAvg: historicalAvg,
      keywordCount: currentCount
    });
    Logger.log('Sent ' + alerts.length + ' alerts');
  } else {
    Logger.log('No Quality Score alerts triggered');
  }

  Logger.log('Current avg QS: ' + currentAvg.toFixed(2) + ', Historical: ' + historicalAvg.toFixed(2));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getHistoricalQSData() {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName('QS Detail');

  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var campaignCol = headers.indexOf('Campaign');
  var adGroupCol = headers.indexOf('Ad Group');
  var keywordCol = headers.indexOf('Keyword');
  var qsCol = headers.indexOf('Quality Score');

  if (dateCol === -1 || keywordCol === -1 || qsCol === -1) return {};

  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.LOOKBACK_DAYS);

  var keywordHistory = {};

  for (var i = 1; i < data.length; i++) {
    var rowDate = new Date(data[i][dateCol]);
    if (rowDate < cutoffDate) continue;

    var key = data[i][campaignCol] + '|' + data[i][adGroupCol] + '|' + data[i][keywordCol];
    var qs = data[i][qsCol];

    if (!keywordHistory[key]) {
      keywordHistory[key] = { scores: [], avgQS: 0 };
    }

    if (qs && qs > 0) {
      keywordHistory[key].scores.push(qs);
    }
  }

  // Calculate averages
  for (var key in keywordHistory) {
    var scores = keywordHistory[key].scores;
    if (scores.length > 0) {
      keywordHistory[key].avgQS = scores.reduce(function(a, b) { return a + b; }, 0) / scores.length;
    }
  }

  return keywordHistory;
}

function getCurrentQSData() {
  var currentData = {};

  var keywords = AdsApp.keywords()
    .withCondition('Status = ENABLED')
    .withCondition('CampaignStatus = ENABLED')
    .withCondition('AdGroupStatus = ENABLED')
    .withCondition('Impressions > ' + CONFIG.MIN_IMPRESSIONS)
    .forDateRange('LAST_30_DAYS')
    .get();

  while (keywords.hasNext()) {
    var keyword = keywords.next();
    var qs = keyword.getQualityScore();

    if (!qs) continue;

    var key = keyword.getCampaign().getName() + '|' +
              keyword.getAdGroup().getName() + '|' +
              keyword.getText();

    currentData[key] = {
      campaignName: keyword.getCampaign().getName(),
      adGroupName: keyword.getAdGroup().getName(),
      keyword: keyword.getText(),
      qualityScore: qs,
      expectedCtr: keyword.getExpectedCtr(),
      adRelevance: keyword.getAdRelevance(),
      landingPageExperience: keyword.getLandingPageExperience()
    };
  }

  return currentData;
}

function sendAlerts(accountName, alerts, stats) {
  var subject = '[Google Ads] Quality Score Alert - ' + accountName;

  var body = 'Quality Score Alerts for ' + accountName + '\n';
  body += 'Current avg QS: ' + stats.currentAvg.toFixed(2);
  body += ' (' + stats.keywordCount + ' keywords)\n\n';

  // Group alerts by type
  var critical = alerts.filter(function(a) { return a.severity === 'critical'; });
  var warnings = alerts.filter(function(a) { return a.severity === 'warning'; });
  var info = alerts.filter(function(a) { return a.severity === 'info'; });

  if (critical.length > 0) {
    body += '🚨 CRITICAL:\n';
    critical.forEach(function(a) {
      body += '• ' + a.message + '\n';
    });
    body += '\n';
  }

  if (warnings.length > 0) {
    body += '⚠️ QS DROPS (' + warnings.length + '):\n';
    warnings.forEach(function(a) {
      body += '• ' + a.keyword + ' (' + a.campaign + ')\n';
      body += '  ' + a.message + '\n';
    });
    body += '\n';
  }

  if (info.length > 0 && info.length <= 20) {
    body += 'ℹ️ POOR QS KEYWORDS (' + info.length + '):\n';
    info.forEach(function(a) {
      body += '• ' + a.keyword + ' (QS: ' + a.currentQS + ')\n';
      body += '  CTR: ' + a.expectedCtr + ', Relevance: ' + a.adRelevance + ', LP: ' + a.landingPage + '\n';
    });
  } else if (info.length > 20) {
    body += 'ℹ️ POOR QS KEYWORDS: ' + info.length + ' keywords with QS ≤ ' + CONFIG.POOR_QS_THRESHOLD + '\n';
  }

  body += '\n--\nSent by Google Ads Scripts Quality Score Alert';

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
    var slackMsg = '*' + subject + '*\n\n';
    if (critical.length > 0) {
      slackMsg += ':rotating_light: ' + critical[0].message + '\n\n';
    }
    slackMsg += ':warning: ' + warnings.length + ' QS drops, ';
    slackMsg += ':information_source: ' + info.length + ' poor QS keywords';

    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: slackMsg })
    });
  }
}
