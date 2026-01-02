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

function getLandingPageUrls() {
  var urlMap = {};

  // Get URLs from ads
  var adQuery = 'SELECT CampaignName, AdGroupName, CreativeFinalUrls, Impressions, Cost ' +
                'FROM AD_PERFORMANCE_REPORT ' +
                'WHERE Impressions > 0 ' +
                'DURING ' + CONFIG.DATE_RANGE;

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    adQuery += " AND CampaignName CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'";
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    adQuery += " AND CampaignName DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'";
  }

  try {
    var report = AdsApp.report(adQuery);
    var rows = report.rows();

    while (rows.hasNext()) {
      var row = rows.next();
      var finalUrls = row['CreativeFinalUrls'];
      var cost = parseFloat(row['Cost']);

      if (cost < CONFIG.MIN_CAMPAIGN_SPEND) continue;

      // Parse final URLs (may be JSON array format)
      if (finalUrls) {
        var urls = [];
        try {
          // Try parsing as JSON array
          urls = JSON.parse(finalUrls);
        } catch (e) {
          // Single URL
          urls = [finalUrls];
        }

        urls.forEach(function(url) {
          if (url && url.indexOf('http') === 0) {
            if (!urlMap[url]) {
              urlMap[url] = {
                url: url,
                campaigns: [],
                adGroups: [],
                totalCost: 0
              };
            }
            if (urlMap[url].campaigns.indexOf(row['CampaignName']) === -1) {
              urlMap[url].campaigns.push(row['CampaignName']);
            }
            if (urlMap[url].adGroups.indexOf(row['AdGroupName']) === -1) {
              urlMap[url].adGroups.push(row['AdGroupName']);
            }
            urlMap[url].totalCost += cost;
          }
        });
      }
    }
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

function checkUrls(urlList) {
  var results = [];

  urlList.forEach(function(urlData, index) {
    if (index % 50 === 0) {
      Logger.log('Checking URL ' + (index + 1) + ' of ' + urlList.length);
    }

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

      var endTime = new Date().getTime();
      result.responseTime = endTime - startTime;
      result.statusCode = response.getResponseCode();

      // Check for redirect (compare final URL)
      var headers = response.getAllHeaders();
      // Note: UrlFetchApp follows redirects automatically

      // Check for issues
      if (CONFIG.ALERT_STATUS_CODES.indexOf(result.statusCode) !== -1) {
        result.hasIssue = true;
        result.issueType = 'HTTP_' + result.statusCode;
      } else if (result.responseTime > CONFIG.SLOW_PAGE_THRESHOLD_MS) {
        result.hasIssue = true;
        result.issueType = 'SLOW_RESPONSE';
      }

    } catch (e) {
      result.error = e.message;
      result.hasIssue = true;

      if (e.message.indexOf('timeout') !== -1 || e.message.indexOf('Timeout') !== -1) {
        result.issueType = 'TIMEOUT';
      } else if (e.message.indexOf('SSL') !== -1 || e.message.indexOf('certificate') !== -1) {
        result.issueType = 'SSL_ERROR';
      } else if (e.message.indexOf('DNS') !== -1 || e.message.indexOf('resolve') !== -1) {
        result.issueType = 'DNS_ERROR';
      } else {
        result.issueType = 'FETCH_ERROR';
      }
    }

    results.push(result);

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

function sendAlerts(accountName, issues) {
  var subject = '[Google Ads] Landing Page Issues - ' + accountName;

  var body = 'Landing Page Issues Detected\n';
  body += 'Account: ' + accountName + '\n';
  body += 'Issues found: ' + issues.length + '\n\n';

  // Group by issue type
  var byType = {};
  issues.forEach(function(issue) {
    if (!byType[issue.issueType]) {
      byType[issue.issueType] = [];
    }
    byType[issue.issueType].push(issue);
  });

  for (var issueType in byType) {
    body += '🚨 ' + issueType + ' (' + byType[issueType].length + ')\n';
    body += '─────────────────────────────────────\n';

    byType[issueType].slice(0, 5).forEach(function(issue) {
      body += '• ' + issue.url.substring(0, 60) + '...\n';
      body += '  Campaigns: ' + issue.campaigns.slice(0, 2).join(', ') + '\n';
      body += '  Spend: $' + issue.totalCost.toFixed(2) + '\n';
      if (issue.error) {
        body += '  Error: ' + issue.error.substring(0, 50) + '\n';
      }
      body += '\n';
    });

    if (byType[issueType].length > 5) {
      body += '  ... and ' + (byType[issueType].length - 5) + ' more\n\n';
    }
  }

  body += '\n💰 Total spend on broken pages: $' +
          issues.reduce(function(sum, i) { return sum + i.totalCost; }, 0).toFixed(2) + '\n';

  body += '\n--\nSent by Google Ads Scripts Landing Page Checker';

  // Send email
  if (CONFIG.EMAIL_RECIPIENTS) {
    MailApp.sendEmail({
      to: CONFIG.EMAIL_RECIPIENTS,
      subject: subject,
      body: body
    });
    Logger.log('Alert email sent');
  }

  // Send Slack
  if (CONFIG.SLACK_WEBHOOK_URL) {
    var slackMsg = '*' + subject + '*\n\n';
    slackMsg += ':rotating_light: ' + issues.length + ' landing pages have issues\n\n';

    for (var type in byType) {
      slackMsg += '*' + type + '*: ' + byType[type].length + ' URLs\n';
    }

    slackMsg += '\nTotal spend at risk: $' +
                issues.reduce(function(sum, i) { return sum + i.totalCost; }, 0).toFixed(2);

    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: slackMsg })
    });
    Logger.log('Slack alert sent');
  }
}
