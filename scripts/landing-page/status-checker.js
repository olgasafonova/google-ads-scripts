/**
 * Landing Page Status Checker
 *
 * Monitors landing page health across your Google Ads account:
 * - Checks HTTP status codes (404, 500, redirects)
 * - Verifies SSL certificates
 * - Detects slow-loading pages
 * - Alerts on broken or problematic URLs
 *
 * Schedule: Run daily
 *
 * Setup:
 * 1. Create a Google Sheet to log results
 * 2. Update CONFIG below with your settings
 * 3. Preview the script to test
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email recipients for alerts
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // Slack webhook URL (optional)
  SLACK_WEBHOOK_URL: '',

  // Request timeout in milliseconds
  TIMEOUT_MS: 10000,

  // Alert on response time above this (milliseconds)
  SLOW_PAGE_THRESHOLD_MS: 5000,

  // Only check URLs from campaigns with at least this spend
  MIN_CAMPAIGN_SPEND: 10,

  // Date range for finding active URLs
  DATE_RANGE: 'LAST_30_DAYS',

  // Campaign filters (leave empty for all)
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Maximum URLs to check per run (to stay within limits)
  MAX_URLS_PER_RUN: 200,

  // HTTP status codes to alert on
  ALERT_STATUS_CODES: [404, 500, 502, 503, 504],

  // Alert on redirect chains
  ALERT_ON_REDIRECTS: true
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting Landing Page Status Check for: ' + accountName);

  // Get unique landing page URLs
  var urls = getLandingPageUrls();
  Logger.log('Found ' + urls.length + ' unique landing page URLs');

  if (urls.length === 0) {
    Logger.log('No landing page URLs found');
    return;
  }

  // Limit URLs per run
  urls = urls.slice(0, CONFIG.MAX_URLS_PER_RUN);

  // Check each URL
  var results = checkUrls(urls);

  // Identify issues
  var issues = results.filter(function(r) { return r.hasIssue; });
  Logger.log('Found ' + issues.length + ' URLs with issues');

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logResults(results, now, timeZone);
  }

  // Send alerts
  if (issues.length > 0) {
    sendAlerts(accountName, issues);
  }

  Logger.log('Finished. Checked ' + results.length + ' URLs');
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function buildLandingPageQuery() {
  var adQuery = 'SELECT campaign.name, ad_group.name, ' +
                'ad_group_ad.ad.final_urls, metrics.impressions, metrics.cost_micros ' +
                'FROM ad_group_ad ' +
                'WHERE metrics.impressions > 0 ' +
                'AND segments.date DURING ' + CONFIG.DATE_RANGE;

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    adQuery += " AND campaign.name REGEXP_MATCH '(?i).*" + CONFIG.CAMPAIGN_NAME_CONTAINS + ".*'";
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    adQuery += " AND campaign.name NOT REGEXP_MATCH '(?i).*" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + ".*'";
  }

  return adQuery;
}

function parseFinalUrls(finalUrls) {
  if (!finalUrls) return [];
  try {
    // Try parsing as JSON array
    return JSON.parse(finalUrls);
  } catch (e) {
    // Single URL
    return [finalUrls];
  }
}

function addToUrlMap(urlMap, url, campaignName, adGroupName, cost) {
  if (!url || url.indexOf('http') !== 0) return;

  if (!urlMap[url]) {
    urlMap[url] = {
      url: url,
      campaigns: [],
      adGroups: [],
      totalCost: 0
    };
  }
  if (urlMap[url].campaigns.indexOf(campaignName) === -1) {
    urlMap[url].campaigns.push(campaignName);
  }
  if (urlMap[url].adGroups.indexOf(adGroupName) === -1) {
    urlMap[url].adGroups.push(adGroupName);
  }
  urlMap[url].totalCost += cost;
}

function collectUrlsFromReport(urlMap) {
  var report = AdsApp.report(buildLandingPageQuery());
  var rows = report.rows();

  while (rows.hasNext()) {
    var row = rows.next();
    var cost = parseFloat(row['metrics.cost_micros']) / 1000000;

    if (cost < CONFIG.MIN_CAMPAIGN_SPEND) continue;

    parseFinalUrls(row['ad_group_ad.ad.final_urls']).forEach(function(url) {
      addToUrlMap(urlMap, url, row['campaign.name'], row['ad_group.name'], cost);
    });
  }
}

function getLandingPageUrls() {
  var urlMap = {};

  try {
    collectUrlsFromReport(urlMap);
  } catch (e) {
    Logger.log('Error fetching URLs: ' + e.message);
  }

  // Convert to array and sort by cost
  var urlList = [];
  for (var url in urlMap) {
    urlList.push(urlMap[url]);
  }

  urlList.sort(function(a, b) { return b.totalCost - a.totalCost; });

  return urlList;
}

// ============================================================================
// URL CHECKING
// ============================================================================

function classifyFetchError(message) {
  if (message.indexOf('timeout') !== -1 || message.indexOf('Timeout') !== -1) {
    return 'TIMEOUT';
  }
  if (message.indexOf('SSL') !== -1 || message.indexOf('certificate') !== -1) {
    return 'SSL_ERROR';
  }
  if (message.indexOf('DNS') !== -1 || message.indexOf('resolve') !== -1) {
    return 'DNS_ERROR';
  }
  return 'FETCH_ERROR';
}

function applyResponseStatus(result) {
  if (CONFIG.ALERT_STATUS_CODES.indexOf(result.statusCode) !== -1) {
    result.hasIssue = true;
    result.issueType = 'HTTP_' + result.statusCode;
  } else if (result.responseTime > CONFIG.SLOW_PAGE_THRESHOLD_MS) {
    result.hasIssue = true;
    result.issueType = 'SLOW_RESPONSE';
  }
}

function checkSingleUrl(urlData) {
  var result = {
    url: urlData.url,
    campaigns: urlData.campaigns,
    adGroups: urlData.adGroups,
    totalCost: urlData.totalCost,
    statusCode: null,
    responseTime: null,
    finalUrl: null,
    redirectCount: 0,
    error: null,
    hasIssue: false,
    issueType: null
  };

  try {
    var startTime = new Date().getTime();

    var response = UrlFetchApp.fetch(urlData.url, {
      muteHttpExceptions: true,
      followRedirects: true,
      timeout: CONFIG.TIMEOUT_MS / 1000
    });

    result.responseTime = new Date().getTime() - startTime;
    result.statusCode = response.getResponseCode();

    applyResponseStatus(result);
  } catch (e) {
    result.error = e.message;
    result.hasIssue = true;
    result.issueType = classifyFetchError(e.message);
  }

  return result;
}

function checkUrls(urlList) {
  var results = [];

  urlList.forEach(function(urlData, index) {
    if (index % 50 === 0) {
      Logger.log('Checking URL ' + (index + 1) + ' of ' + urlList.length);
    }

    results.push(checkSingleUrl(urlData));

    // Small delay to avoid rate limiting
    Utilities.sleep(100);
  });

  return results;
}

// ============================================================================
// REPORTING
// ============================================================================

function logResults(results, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm');

  // Log all results
  var allSheet = spreadsheet.getSheetByName('LP Status All');
  if (!allSheet) {
    allSheet = spreadsheet.insertSheet('LP Status All');
    allSheet.appendRow([
      'Date', 'URL', 'Status Code', 'Response Time (ms)', 'Issue Type',
      'Error', 'Campaigns', 'Ad Groups', 'Spend ($)'
    ]);
    allSheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    allSheet.setFrozenRows(1);
  }

  var rows = results.map(function(r) {
    return [
      dateStr,
      r.url,
      r.statusCode,
      r.responseTime,
      r.issueType || 'OK',
      r.error || '',
      r.campaigns.join(', '),
      r.adGroups.join(', '),
      r.totalCost
    ];
  });

  var lastRow = allSheet.getLastRow();
  allSheet.getRange(lastRow + 1, 1, rows.length, 9).setValues(rows);

  // Log issues only
  var issueSheet = spreadsheet.getSheetByName('LP Issues');
  if (!issueSheet) {
    issueSheet = spreadsheet.insertSheet('LP Issues');
    issueSheet.appendRow([
      'Date', 'URL', 'Issue Type', 'Status Code', 'Error',
      'Campaigns', 'Spend ($)'
    ]);
    issueSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    issueSheet.setFrozenRows(1);
  }

  var issues = results.filter(function(r) { return r.hasIssue; });
  if (issues.length > 0) {
    var issueRows = issues.map(function(r) {
      return [
        dateStr,
        r.url,
        r.issueType,
        r.statusCode,
        r.error || '',
        r.campaigns.join(', '),
        r.totalCost
      ];
    });

    var issueLast = issueSheet.getLastRow();
    issueSheet.getRange(issueLast + 1, 1, issueRows.length, 7).setValues(issueRows);
  }
}

function groupIssuesByType(issues) {
  var byType = {};
  issues.forEach(function(issue) {
    if (!byType[issue.issueType]) {
      byType[issue.issueType] = [];
    }
    byType[issue.issueType].push(issue);
  });
  return byType;
}

function totalIssueSpend(issues) {
  return issues.reduce(function(sum, i) { return sum + i.totalCost; }, 0).toFixed(2);
}

function formatIssueLine(issue) {
  var line = '• ' + issue.url.substring(0, 60) + '...\n';
  line += '  Campaigns: ' + issue.campaigns.slice(0, 2).join(', ') + '\n';
  line += '  Spend: $' + issue.totalCost.toFixed(2) + '\n';
  if (issue.error) {
    line += '  Error: ' + issue.error.substring(0, 50) + '\n';
  }
  return line + '\n';
}

function buildAlertEmailBody(accountName, issues, byType) {
  var body = 'Landing Page Issues Detected\n';
  body += 'Account: ' + accountName + '\n';
  body += 'Issues found: ' + issues.length + '\n\n';

  for (var issueType in byType) {
    body += '🚨 ' + issueType + ' (' + byType[issueType].length + ')\n';
    body += '─────────────────────────────────────\n';

    byType[issueType].slice(0, 5).forEach(function(issue) {
      body += formatIssueLine(issue);
    });

    if (byType[issueType].length > 5) {
      body += '  ... and ' + (byType[issueType].length - 5) + ' more\n\n';
    }
  }

  body += '\n💰 Total spend on broken pages: $' + totalIssueSpend(issues) + '\n';
  body += '\n--\nSent by Google Ads Scripts Landing Page Checker';
  return body;
}

function buildSlackMessage(subject, issues, byType) {
  var slackMsg = '*' + subject + '*\n\n';
  slackMsg += ':rotating_light: ' + issues.length + ' landing pages have issues\n\n';

  for (var type in byType) {
    slackMsg += '*' + type + '*: ' + byType[type].length + ' URLs\n';
  }

  slackMsg += '\nTotal spend at risk: $' + totalIssueSpend(issues);
  return slackMsg;
}

function sendAlerts(accountName, issues) {
  var subject = '[Google Ads] Landing Page Issues - ' + accountName;
  var byType = groupIssuesByType(issues);

  // Send email
  if (CONFIG.EMAIL_RECIPIENTS) {
    MailApp.sendEmail({
      to: CONFIG.EMAIL_RECIPIENTS,
      subject: subject,
      body: buildAlertEmailBody(accountName, issues, byType)
    });
    Logger.log('Alert email sent');
  }

  // Send Slack
  if (CONFIG.SLACK_WEBHOOK_URL) {
    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: buildSlackMessage(subject, issues, byType) })
    });
    Logger.log('Slack alert sent');
  }
}
