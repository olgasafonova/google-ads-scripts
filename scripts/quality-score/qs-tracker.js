/**
 * Quality Score Tracker
 *
 * Tracks Quality Score and its components over time:
 * - Overall Quality Score (1-10)
 * - Expected CTR (Below/Average/Above)
 * - Ad Relevance (Below/Average/Above)
 * - Landing Page Experience (Below/Average/Above)
 *
 * Schedule: Run daily to build historical data
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
  // Google Sheet URL to log results (required)
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Only track keywords with at least this many impressions (last 30 days)
  MIN_IMPRESSIONS: 100,

  // Only track keywords with Quality Score defined
  EXCLUDE_UNSCORED: true,

  // Campaign name filters (leave empty to check all)
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Maximum keywords to track (to stay within execution limits)
  MAX_KEYWORDS: 5000
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();
  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');

  Logger.log('Starting Quality Score tracking for: ' + accountName);
  Logger.log('Date: ' + dateStr);

  if (!CONFIG.SPREADSHEET_URL || CONFIG.SPREADSHEET_URL === 'YOUR_SPREADSHEET_URL_HERE') {
    Logger.log('ERROR: Please configure SPREADSHEET_URL');
    return;
  }

  var keywordData = [];
  var summary = {
    total: 0,
    avgQS: 0,
    distribution: {1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, 10:0},
    components: {
      expectedCtr: {BELOW_AVERAGE: 0, AVERAGE: 0, ABOVE_AVERAGE: 0},
      adRelevance: {BELOW_AVERAGE: 0, AVERAGE: 0, ABOVE_AVERAGE: 0},
      landingPage: {BELOW_AVERAGE: 0, AVERAGE: 0, ABOVE_AVERAGE: 0}
    }
  };

  // Build keyword selector
  var keywordSelector = AdsApp.keywords()
    .withCondition('Status = ENABLED')
    .withCondition('CampaignStatus = ENABLED')
    .withCondition('AdGroupStatus = ENABLED')
    .withCondition('Impressions > ' + CONFIG.MIN_IMPRESSIONS)
    .forDateRange('LAST_30_DAYS')
    .orderBy('Impressions DESC')
    .withLimit(CONFIG.MAX_KEYWORDS);

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    keywordSelector = keywordSelector
      .withCondition("CampaignName CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'");
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    keywordSelector = keywordSelector
      .withCondition("CampaignName DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'");
  }

  var keywords = keywordSelector.get();
  var qsSum = 0;

  while (keywords.hasNext()) {
    var keyword = keywords.next();
    var qs = keyword.getQualityScore();

    // Skip unscored keywords if configured
    if (CONFIG.EXCLUDE_UNSCORED && (qs === null || qs === undefined)) {
      continue;
    }

    var stats = keyword.getStatsFor('LAST_30_DAYS');

    var row = {
      date: dateStr,
      campaignName: keyword.getCampaign().getName(),
      adGroupName: keyword.getAdGroup().getName(),
      keyword: keyword.getText(),
      matchType: keyword.getMatchType(),
      qualityScore: qs || 0,
      expectedCtr: keyword.getExpectedCtr() || 'UNKNOWN',
      adRelevance: keyword.getAdRelevance() || 'UNKNOWN',
      landingPageExperience: keyword.getLandingPageExperience() || 'UNKNOWN',
      impressions: stats.getImpressions(),
      clicks: stats.getClicks(),
      cost: stats.getCost()
    };

    keywordData.push(row);

    // Update summary
    if (qs) {
      summary.total++;
      qsSum += qs;
      summary.distribution[qs]++;
    }

    // Component tracking
    if (row.expectedCtr !== 'UNKNOWN') {
      summary.components.expectedCtr[row.expectedCtr] =
        (summary.components.expectedCtr[row.expectedCtr] || 0) + 1;
    }
    if (row.adRelevance !== 'UNKNOWN') {
      summary.components.adRelevance[row.adRelevance] =
        (summary.components.adRelevance[row.adRelevance] || 0) + 1;
    }
    if (row.landingPageExperience !== 'UNKNOWN') {
      summary.components.landingPage[row.landingPageExperience] =
        (summary.components.landingPage[row.landingPageExperience] || 0) + 1;
    }
  }

  summary.avgQS = summary.total > 0 ? qsSum / summary.total : 0;

  // Log to spreadsheet
  logDetailData(keywordData);
  logSummaryData(dateStr, summary);

  Logger.log('Finished. Tracked ' + keywordData.length + ' keywords.');
  Logger.log('Average Quality Score: ' + summary.avgQS.toFixed(2));
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function logDetailData(data) {
  if (data.length === 0) return;

  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName('QS Detail');

  if (!sheet) {
    sheet = spreadsheet.insertSheet('QS Detail');
    sheet.appendRow([
      'Date', 'Campaign', 'Ad Group', 'Keyword', 'Match Type',
      'Quality Score', 'Expected CTR', 'Ad Relevance', 'Landing Page',
      'Impressions (30d)', 'Clicks (30d)', 'Cost (30d)'
    ]);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var rows = data.map(function(row) {
    return [
      row.date,
      row.campaignName,
      row.adGroupName,
      row.keyword,
      row.matchType,
      row.qualityScore,
      row.expectedCtr,
      row.adRelevance,
      row.landingPageExperience,
      row.impressions,
      row.clicks,
      row.cost
    ];
  });

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, rows.length, 12).setValues(rows);
}

function logSummaryData(dateStr, summary) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName('QS Summary');

  if (!sheet) {
    sheet = spreadsheet.insertSheet('QS Summary');
    sheet.appendRow([
      'Date', 'Keywords Tracked', 'Avg QS',
      'QS 1-3', 'QS 4-6', 'QS 7-10',
      'CTR Below', 'CTR Average', 'CTR Above',
      'Relevance Below', 'Relevance Average', 'Relevance Above',
      'LP Below', 'LP Average', 'LP Above'
    ]);
    sheet.getRange(1, 1, 1, 15).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var qs1to3 = summary.distribution[1] + summary.distribution[2] + summary.distribution[3];
  var qs4to6 = summary.distribution[4] + summary.distribution[5] + summary.distribution[6];
  var qs7to10 = summary.distribution[7] + summary.distribution[8] + summary.distribution[9] + summary.distribution[10];

  sheet.appendRow([
    dateStr,
    summary.total,
    summary.avgQS,
    qs1to3,
    qs4to6,
    qs7to10,
    summary.components.expectedCtr.BELOW_AVERAGE || 0,
    summary.components.expectedCtr.AVERAGE || 0,
    summary.components.expectedCtr.ABOVE_AVERAGE || 0,
    summary.components.adRelevance.BELOW_AVERAGE || 0,
    summary.components.adRelevance.AVERAGE || 0,
    summary.components.adRelevance.ABOVE_AVERAGE || 0,
    summary.components.landingPage.BELOW_AVERAGE || 0,
    summary.components.landingPage.AVERAGE || 0,
    summary.components.landingPage.ABOVE_AVERAGE || 0
  ]);
}
