/**
 * Placement Exclusion List Manager
 *
 * Manages shared placement exclusion lists across campaigns:
 * - Syncs exclusions from a master Google Sheet
 * - Supports categories (MFA sites, adult content, etc.)
 * - Applies exclusions to all Display/Video campaigns
 *
 * Schedule: Run daily to keep exclusions up to date
 *
 * Setup:
 * 1. Create a Google Sheet with exclusion lists
 * 2. Format: Column A = Placement URL, Column B = Category
 * 3. Update CONFIG below
 * 4. Preview first to test
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL with placement exclusion list
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Sheet name containing exclusions
  SHEET_NAME: 'Exclusions',

  // Email for notifications
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // Apply to these campaign types
  CAMPAIGN_TYPES: ['DISPLAY', 'VIDEO'],

  // Campaign filters (leave empty for all)
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Log results back to sheet
  LOG_SHEET_NAME: 'Sync Log',

  // Maximum exclusions to process per run
  MAX_EXCLUSIONS_PER_RUN: 500
};

// Known MFA and low-quality placement patterns
var DEFAULT_EXCLUSIONS = [
  // Mobile app categories (high fraud)
  'mobileapp::2-com.android.games',
  'mobileapp::2-com.kids',

  // Common low-quality patterns
  'anonymous.google',
  'adsenseformobileapps.com',

  // Parked domains
  'parked-content.godaddy.com',
  'sedoparking.com',

  // Game apps (usually low quality traffic)
  // Add your own patterns here
];

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting Placement Exclusion Sync for: ' + accountName);

  // Get exclusions from sheet
  var exclusions = getExclusionsFromSheet();
  Logger.log('Loaded ' + exclusions.length + ' exclusions from sheet');

  // Add default exclusions
  var allExclusions = exclusions.concat(DEFAULT_EXCLUSIONS.map(function(url) {
    return { url: url, category: 'DEFAULT' };
  }));

  // Deduplicate
  var seen = {};
  allExclusions = allExclusions.filter(function(e) {
    if (seen[e.url]) return false;
    seen[e.url] = true;
    return true;
  });

  Logger.log('Total unique exclusions: ' + allExclusions.length);

  // Get target campaigns
  var campaigns = getTargetCampaigns();
  Logger.log('Found ' + campaigns.length + ' campaigns to update');

  if (campaigns.length === 0) {
    Logger.log('No matching campaigns found');
    return;
  }

  // Apply exclusions
  var results = applyExclusions(campaigns, allExclusions.slice(0, CONFIG.MAX_EXCLUSIONS_PER_RUN));

  // Log results
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logSyncResults(results, now, timeZone);
  }

  // Summary
  Logger.log('Finished. Added ' + results.added + ' exclusions, ' + results.skipped + ' already existed');
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function getExclusionsFromSheet() {
  if (!CONFIG.SPREADSHEET_URL || CONFIG.SPREADSHEET_URL === 'YOUR_SPREADSHEET_URL_HERE') {
    Logger.log('No spreadsheet configured, using defaults only');
    return [];
  }

  try {
    var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
    var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      Logger.log('Sheet "' + CONFIG.SHEET_NAME + '" not found');
      return [];
    }

    var data = sheet.getDataRange().getValues();
    var exclusions = [];

    // Skip header row
    for (var i = 1; i < data.length; i++) {
      var url = String(data[i][0]).trim();
      var category = String(data[i][1] || 'CUSTOM').trim();

      if (url && url.length > 0) {
        exclusions.push({
          url: url,
          category: category
        });
      }
    }

    return exclusions;
  } catch (e) {
    Logger.log('Error reading sheet: ' + e.message);
    return [];
  }
}

function getTargetCampaigns() {
  var campaigns = [];

  // Get Display campaigns
  var displaySelector = AdsApp.campaigns()
    .withCondition('Status = ENABLED')
    .withCondition('AdvertisingChannelType = DISPLAY');

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    displaySelector = displaySelector
      .withCondition("Name CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'");
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    displaySelector = displaySelector
      .withCondition("Name DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'");
  }

  var displayCampaigns = displaySelector.get();
  while (displayCampaigns.hasNext()) {
    campaigns.push({
      campaign: displayCampaigns.next(),
      type: 'DISPLAY'
    });
  }

  // Get Video campaigns
  var videoSelector = AdsApp.videoCampaigns()
    .withCondition('Status = ENABLED');

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    videoSelector = videoSelector
      .withCondition("Name CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'");
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    videoSelector = videoSelector
      .withCondition("Name DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'");
  }

  var videoCampaigns = videoSelector.get();
  while (videoCampaigns.hasNext()) {
    campaigns.push({
      campaign: videoCampaigns.next(),
      type: 'VIDEO'
    });
  }

  return campaigns;
}

// ============================================================================
// APPLY EXCLUSIONS
// ============================================================================

function applyExclusions(campaigns, exclusions) {
  var results = {
    added: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  campaigns.forEach(function(campaignData) {
    var campaign = campaignData.campaign;
    var campaignName = campaign.getName();

    // Get existing exclusions
    var existingExclusions = {};
    try {
      var excludedPlacements = campaign.display().excludedPlacements().get();
      while (excludedPlacements.hasNext()) {
        var excluded = excludedPlacements.next();
        existingExclusions[excluded.getUrl()] = true;
      }
    } catch (e) {
      // Some campaign types may not support this
    }

    // Add new exclusions
    exclusions.forEach(function(exclusion) {
      if (existingExclusions[exclusion.url]) {
        results.skipped++;
        return;
      }

      try {
        if (exclusion.url.indexOf('mobileapp::') === 0) {
          // Mobile app exclusion
          campaign.display().excludedPlacements().newBuilder()
            .withMobileApplication(exclusion.url.replace('mobileapp::', ''))
            .build();
        } else {
          // URL exclusion
          campaign.display().excludedPlacements().newBuilder()
            .withUrl(exclusion.url)
            .build();
        }

        results.added++;
        results.details.push({
          campaign: campaignName,
          url: exclusion.url,
          category: exclusion.category,
          status: 'ADDED'
        });
      } catch (e) {
        results.errors++;
        results.details.push({
          campaign: campaignName,
          url: exclusion.url,
          category: exclusion.category,
          status: 'ERROR: ' + e.message
        });
      }
    });
  });

  return results;
}

// ============================================================================
// LOGGING
// ============================================================================

function logSyncResults(results, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName(CONFIG.LOG_SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(['Date', 'Campaign', 'URL', 'Category', 'Status']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm');

  // Only log added items (not skips)
  var addedDetails = results.details.filter(function(d) {
    return d.status === 'ADDED' || d.status.indexOf('ERROR') === 0;
  });

  if (addedDetails.length === 0) {
    // Log summary row if nothing added
    sheet.appendRow([dateStr, 'SUMMARY', '-', '-', 'No new exclusions added']);
    return;
  }

  var rows = addedDetails.map(function(d) {
    return [dateStr, d.campaign, d.url, d.category, d.status];
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, 5).setValues(rows);

  // Add summary row
  sheet.appendRow([
    dateStr,
    'SUMMARY',
    '-',
    '-',
    'Added: ' + results.added + ', Skipped: ' + results.skipped + ', Errors: ' + results.errors
  ]);
}

// ============================================================================
// UTILITY: CREATE TEMPLATE SHEET
// ============================================================================

/**
 * Run this function once to create a template exclusion sheet
 */
function createTemplateSheet() {
  if (!CONFIG.SPREADSHEET_URL || CONFIG.SPREADSHEET_URL === 'YOUR_SPREADSHEET_URL_HERE') {
    Logger.log('Please set SPREADSHEET_URL first');
    return;
  }

  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  if (sheet) {
    Logger.log('Sheet already exists');
    return;
  }

  sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);

  // Headers
  sheet.appendRow(['Placement URL', 'Category', 'Notes']);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Sample data
  var sampleData = [
    ['anonymous.google', 'LOW_QUALITY', 'Anonymous Google placements'],
    ['adsenseformobileapps.com', 'MOBILE_APP', 'Generic mobile app traffic'],
    ['mobileapp::2-com.example.game', 'MOBILE_APP', 'Example game app'],
    ['parked-content.godaddy.com', 'PARKED', 'Parked domains'],
    ['example-mfa-site.com', 'MFA', 'Made for AdSense site']
  ];

  sheet.getRange(2, 1, sampleData.length, 3).setValues(sampleData);

  // Format
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 250);

  Logger.log('Template sheet created with sample data');
}
