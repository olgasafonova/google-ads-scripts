/**
 * Low Quality Placement Detector
 *
 * Identifies low-quality Display/Video placements based on:
 * - High impressions but zero clicks (wasted impressions)
 * - High cost with zero conversions
 * - Suspicious domain patterns (parked domains, MFA sites)
 * - Mobile app placements with poor performance
 *
 * Schedule: Run weekly
 *
 * Setup:
 * 1. Create a Google Sheet to log results
 * 2. Update CONFIG below with your settings
 * 3. Preview first (APPLY_EXCLUSIONS = false)
 * 4. Set APPLY_EXCLUSIONS = true to auto-exclude
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email for notifications
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // IMPORTANT: Set to true to automatically exclude placements
  // Set to false to preview only (recommended first)
  APPLY_EXCLUSIONS: false,

  // Analysis date range
  DATE_RANGE: 'LAST_30_DAYS',

  // Thresholds for low quality detection
  MIN_IMPRESSIONS: 1000,        // Minimum impressions to analyze
  MIN_COST: 10,                 // Minimum cost to analyze ($)
  MAX_CTR: 0.001,               // CTR below 0.1% = suspicious
  MAX_CONVERSIONS: 0,           // Zero conversions with high spend

  // Mobile app exclusion (many low-quality placements)
  EXCLUDE_MOBILE_APPS: true,
  MIN_APP_COST: 50,             // Exclude apps with this much spend and no conversions

  // Suspicious patterns in placement URLs
  SUSPICIOUS_PATTERNS: [
    'parked',
    'click',
    'anonymous',
    'adsense',
    'error',
    '404',
    'coming-soon'
  ],

  // Campaign types to analyze
  CAMPAIGN_TYPES: ['DISPLAY', 'VIDEO'],

  // Campaign filters
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Maximum placements to exclude per run
  MAX_EXCLUSIONS_PER_RUN: 100
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting Low Quality Placement Detection for: ' + accountName);
  Logger.log('Mode: ' + (CONFIG.APPLY_EXCLUSIONS ? 'APPLY EXCLUSIONS' : 'PREVIEW ONLY'));

  // Get placement data
  var placements = getPlacementData();
  Logger.log('Analyzed ' + placements.length + ' placements');

  // Find low quality placements
  var lowQuality = findLowQualityPlacements(placements);
  Logger.log('Found ' + lowQuality.length + ' low quality placements');

  if (lowQuality.length === 0) {
    Logger.log('No low quality placements found');
    return;
  }

  // Limit exclusions per run
  lowQuality = lowQuality.slice(0, CONFIG.MAX_EXCLUSIONS_PER_RUN);

  // Calculate potential savings
  var totalWaste = lowQuality.reduce(function(sum, p) { return sum + p.cost; }, 0);
  Logger.log('Total potential savings: $' + totalWaste.toFixed(2));

  // Apply exclusions if enabled
  var results = [];
  if (CONFIG.APPLY_EXCLUSIONS) {
    results = applyExclusions(lowQuality);
  } else {
    results = lowQuality.map(function(p) {
      p.status = 'PREVIEW';
      return p;
    });
  }

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logResults(results, now, timeZone);
  }

  // Send notification
  sendNotification(accountName, results, totalWaste);
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function getPlacementData() {
  var placements = [];

  // Get URL placements (websites)
  var urlQuery = 'SELECT Criteria, CampaignName, Impressions, Clicks, Cost, Conversions ' +
                 'FROM URL_PERFORMANCE_REPORT ' +
                 'WHERE Impressions > 0 ' +
                 'DURING ' + CONFIG.DATE_RANGE;

  try {
    var urlReport = AdsApp.report(urlQuery);
    var urlRows = urlReport.rows();

    while (urlRows.hasNext()) {
      var row = urlRows.next();
      placements.push({
        placement: row['Criteria'],
        type: 'URL',
        campaign: row['CampaignName'],
        impressions: parseInt(row['Impressions'], 10),
        clicks: parseInt(row['Clicks'], 10),
        cost: parseFloat(row['Cost']),
        conversions: parseFloat(row['Conversions'])
      });
    }
  } catch (e) {
    Logger.log('URL report error: ' + e.message);
  }

  // Get mobile app placements
  if (CONFIG.EXCLUDE_MOBILE_APPS) {
    var appQuery = 'SELECT Criteria, CampaignName, Impressions, Clicks, Cost, Conversions ' +
                   'FROM PLACEMENT_PERFORMANCE_REPORT ' +
                   'WHERE Impressions > 0 ' +
                   'DURING ' + CONFIG.DATE_RANGE;

    try {
      var appReport = AdsApp.report(appQuery);
      var appRows = appReport.rows();

      while (appRows.hasNext()) {
        var row = appRows.next();
        var criteria = row['Criteria'];

        // Check if it's a mobile app
        if (criteria.indexOf('mobileapp::') === 0) {
          placements.push({
            placement: criteria,
            type: 'MOBILE_APP',
            campaign: row['CampaignName'],
            impressions: parseInt(row['Impressions'], 10),
            clicks: parseInt(row['Clicks'], 10),
            cost: parseFloat(row['Cost']),
            conversions: parseFloat(row['Conversions'])
          });
        }
      }
    } catch (e) {
      Logger.log('Placement report error: ' + e.message);
    }
  }

  return placements;
}

// ============================================================================
// ANALYSIS
// ============================================================================

function findLowQualityPlacements(placements) {
  var lowQuality = [];
  var suspiciousPatterns = CONFIG.SUSPICIOUS_PATTERNS.map(function(p) {
    return p.toLowerCase();
  });

  placements.forEach(function(placement) {
    // Skip if campaign doesn't match filters
    if (CONFIG.CAMPAIGN_NAME_CONTAINS &&
        placement.campaign.toLowerCase().indexOf(CONFIG.CAMPAIGN_NAME_CONTAINS.toLowerCase()) === -1) {
      return;
    }

    if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN &&
        placement.campaign.toLowerCase().indexOf(CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN.toLowerCase()) !== -1) {
      return;
    }

    var ctr = placement.impressions > 0 ? placement.clicks / placement.impressions : 0;
    var reason = null;

    // Mobile app with high spend and no conversions
    if (placement.type === 'MOBILE_APP' &&
        placement.cost >= CONFIG.MIN_APP_COST &&
        placement.conversions <= CONFIG.MAX_CONVERSIONS) {
      reason = 'Mobile app with $' + placement.cost.toFixed(2) + ' spend, 0 conversions';
    }

    // Zero conversions with significant cost
    else if (placement.cost >= CONFIG.MIN_COST &&
             placement.conversions <= CONFIG.MAX_CONVERSIONS) {
      reason = 'Zero conversions with $' + placement.cost.toFixed(2) + ' spend';
    }

    // Very low CTR
    else if (placement.impressions >= CONFIG.MIN_IMPRESSIONS && ctr <= CONFIG.MAX_CTR) {
      reason = 'Very low CTR: ' + (ctr * 100).toFixed(3) + '% (' + placement.impressions + ' impressions)';
    }

    // Suspicious URL patterns
    else if (placement.type === 'URL') {
      var placementLower = placement.placement.toLowerCase();
      var matchedPattern = suspiciousPatterns.find(function(pattern) {
        return placementLower.indexOf(pattern) !== -1;
      });
      if (matchedPattern) {
        reason = 'Suspicious pattern: "' + matchedPattern + '"';
      }
    }

    if (reason) {
      placement.ctr = ctr;
      placement.reason = reason;
      lowQuality.push(placement);
    }
  });

  // Sort by cost descending
  lowQuality.sort(function(a, b) { return b.cost - a.cost; });

  return lowQuality;
}

// ============================================================================
// APPLY EXCLUSIONS
// ============================================================================

function applyExclusions(placements) {
  var results = [];

  placements.forEach(function(placement) {
    try {
      // Get campaigns
      var campaigns = AdsApp.campaigns()
        .withCondition("Name = '" + placement.campaign.replace(/'/g, "\\'") + "'")
        .get();

      if (campaigns.hasNext()) {
        var campaign = campaigns.next();

        // Add placement exclusion
        if (placement.type === 'MOBILE_APP') {
          // For mobile apps, exclude the app
          campaign.display().excludedPlacements().newBuilder()
            .withMobileApplication(placement.placement.replace('mobileapp::', ''))
            .build();
        } else {
          // For URLs, exclude the website
          campaign.display().excludedPlacements().newBuilder()
            .withUrl(placement.placement)
            .build();
        }

        placement.status = 'EXCLUDED';
        Logger.log('Excluded: ' + placement.placement);
      } else {
        placement.status = 'CAMPAIGN_NOT_FOUND';
      }
    } catch (e) {
      placement.status = 'ERROR: ' + e.message;
      Logger.log('Error excluding placement: ' + e.message);
    }

    results.push(placement);
  });

  return results;
}

// ============================================================================
// REPORTING
// ============================================================================

function logResults(results, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName('Placement Exclusions');

  if (!sheet) {
    sheet = spreadsheet.insertSheet('Placement Exclusions');
    sheet.appendRow([
      'Date', 'Placement', 'Type', 'Campaign', 'Impressions', 'Clicks',
      'CTR', 'Cost', 'Conversions', 'Reason', 'Status'
    ]);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm');

  var rows = results.map(function(r) {
    return [
      dateStr,
      r.placement,
      r.type,
      r.campaign,
      r.impressions,
      r.clicks,
      r.ctr,
      r.cost,
      r.conversions,
      r.reason,
      r.status
    ];
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, 11).setValues(rows);
}

function sendNotification(accountName, results, totalWaste) {
  if (!CONFIG.EMAIL_RECIPIENTS) return;

  var excluded = results.filter(function(r) { return r.status === 'EXCLUDED'; });
  var preview = results.filter(function(r) { return r.status === 'PREVIEW'; });

  var subject = '[Google Ads] Low Quality Placements - ' + accountName;

  var body = 'Low Quality Placement Detection for ' + accountName + '\n\n';

  if (CONFIG.APPLY_EXCLUSIONS) {
    body += '🚫 Excluded: ' + excluded.length + ' placements\n';
  } else {
    body += '👁️ Preview Mode: ' + preview.length + ' placements identified\n';
    body += 'Set APPLY_EXCLUSIONS = true to exclude these\n';
  }

  body += '\n💰 Potential savings: $' + totalWaste.toFixed(2) + '\n\n';

  body += 'Top offenders:\n';
  results.slice(0, 15).forEach(function(p) {
    body += '• ' + p.placement.substring(0, 50) + '\n';
    body += '  $' + p.cost.toFixed(2) + ' - ' + p.reason + '\n\n';
  });

  body += '\n--\nSent by Google Ads Scripts Placement Detector';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS,
    subject: subject,
    body: body
  });
}
