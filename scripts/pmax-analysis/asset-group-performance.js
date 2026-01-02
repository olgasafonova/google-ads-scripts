/**
 * Performance Max Asset Group Performance Analyzer
 *
 * Tracks and reports on PMax asset group performance:
 * - Asset group level metrics
 * - Listing group performance (for Shopping)
 * - Asset performance ratings
 * - Trend analysis over time
 *
 * Schedule: Run weekly
 *
 * Setup:
 * 1. Create a Google Sheet to store results
 * 2. Update CONFIG below with your settings
 * 3. Preview the script to test
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email recipients for reports
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // Analysis date range
  DATE_RANGE: 'LAST_30_DAYS',

  // Campaign name filters (leave empty for all PMax campaigns)
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Performance thresholds
  LOW_PERFORMANCE_CTR: 0.005,      // CTR below 0.5% = low
  HIGH_PERFORMANCE_ROAS: 3,        // ROAS above 300% = high
  LOW_PERFORMANCE_ROAS: 1,         // ROAS below 100% = low

  // Minimum data for analysis
  MIN_IMPRESSIONS: 1000,
  MIN_COST: 10
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting PMax Asset Group Analysis for: ' + accountName);

  // Get PMax campaign data
  var pmaxData = getPMaxData();

  if (pmaxData.campaigns.length === 0) {
    Logger.log('No Performance Max campaigns found');
    return;
  }

  Logger.log('Found ' + pmaxData.campaigns.length + ' PMax campaigns');
  Logger.log('Found ' + pmaxData.assetGroups.length + ' asset groups');

  // Analyze performance
  var analysis = analyzePerformance(pmaxData);

  // Generate recommendations
  var recommendations = generateRecommendations(analysis);

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logResults(pmaxData, analysis, recommendations, now, timeZone);
  }

  // Send report
  sendReport(accountName, pmaxData, analysis, recommendations);

  Logger.log('Finished analysis');
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function getPMaxData() {
  var data = {
    campaigns: [],
    assetGroups: []
  };

  // Get PMax campaign performance
  var campaignQuery = 'SELECT CampaignName, CampaignId, ' +
                      'Impressions, Clicks, Cost, Conversions, ConversionValue ' +
                      'FROM CAMPAIGN_PERFORMANCE_REPORT ' +
                      'WHERE AdvertisingChannelType = PERFORMANCE_MAX ' +
                      'AND CampaignStatus = ENABLED ' +
                      'AND Impressions > 0 ' +
                      'DURING ' + CONFIG.DATE_RANGE;

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    campaignQuery += " AND CampaignName CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'";
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    campaignQuery += " AND CampaignName DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'";
  }

  try {
    var campaignReport = AdsApp.report(campaignQuery);
    var campaignRows = campaignReport.rows();

    while (campaignRows.hasNext()) {
      var row = campaignRows.next();
      data.campaigns.push({
        name: row['CampaignName'],
        id: row['CampaignId'],
        impressions: parseInt(row['Impressions'], 10),
        clicks: parseInt(row['Clicks'], 10),
        cost: parseFloat(row['Cost']),
        conversions: parseFloat(row['Conversions']),
        conversionValue: parseFloat(row['ConversionValue'])
      });
    }
  } catch (e) {
    Logger.log('Campaign report error: ' + e.message);
  }

  // Get asset group performance (if available via API)
  // Note: Asset group data may require Google Ads API, not Scripts
  // This is a best-effort approach using available reports

  try {
    var assetGroupQuery = 'SELECT CampaignName, AssetGroupName, AssetGroupId, ' +
                          'AssetGroupStatus, ' +
                          'Impressions, Clicks, Cost, Conversions, ConversionValue ' +
                          'FROM ASSET_GROUP_PERFORMANCE_REPORT ' +
                          'WHERE Impressions > 0 ' +
                          'DURING ' + CONFIG.DATE_RANGE;

    var assetGroupReport = AdsApp.report(assetGroupQuery);
    var assetGroupRows = assetGroupReport.rows();

    while (assetGroupRows.hasNext()) {
      var row = assetGroupRows.next();
      data.assetGroups.push({
        campaignName: row['CampaignName'],
        assetGroupName: row['AssetGroupName'],
        assetGroupId: row['AssetGroupId'],
        status: row['AssetGroupStatus'],
        impressions: parseInt(row['Impressions'], 10),
        clicks: parseInt(row['Clicks'], 10),
        cost: parseFloat(row['Cost']),
        conversions: parseFloat(row['Conversions']),
        conversionValue: parseFloat(row['ConversionValue'])
      });
    }
  } catch (e) {
    Logger.log('Asset group report not available: ' + e.message);
    Logger.log('Using campaign-level data only');
  }

  return data;
}

// ============================================================================
// ANALYSIS
// ============================================================================

function analyzePerformance(pmaxData) {
  var analysis = {
    topPerformers: [],
    lowPerformers: [],
    trends: {},
    totals: {
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      conversionValue: 0
    }
  };

  // Use asset groups if available, otherwise campaigns
  var entities = pmaxData.assetGroups.length > 0 ?
    pmaxData.assetGroups : pmaxData.campaigns;

  entities.forEach(function(entity) {
    // Add to totals
    analysis.totals.impressions += entity.impressions;
    analysis.totals.clicks += entity.clicks;
    analysis.totals.cost += entity.cost;
    analysis.totals.conversions += entity.conversions;
    analysis.totals.conversionValue += entity.conversionValue;

    // Skip if below thresholds
    if (entity.impressions < CONFIG.MIN_IMPRESSIONS || entity.cost < CONFIG.MIN_COST) {
      return;
    }

    // Calculate metrics
    var ctr = entity.impressions > 0 ? entity.clicks / entity.impressions : 0;
    var cpc = entity.clicks > 0 ? entity.cost / entity.clicks : 0;
    var convRate = entity.clicks > 0 ? entity.conversions / entity.clicks : 0;
    var cpa = entity.conversions > 0 ? entity.cost / entity.conversions : 0;
    var roas = entity.cost > 0 ? entity.conversionValue / entity.cost : 0;

    var entityWithMetrics = {
      name: entity.assetGroupName || entity.name,
      campaignName: entity.campaignName || entity.name,
      impressions: entity.impressions,
      clicks: entity.clicks,
      cost: entity.cost,
      conversions: entity.conversions,
      conversionValue: entity.conversionValue,
      ctr: ctr,
      cpc: cpc,
      convRate: convRate,
      cpa: cpa,
      roas: roas
    };

    // Categorize performance
    if (roas >= CONFIG.HIGH_PERFORMANCE_ROAS) {
      entityWithMetrics.performanceRating = 'HIGH';
      analysis.topPerformers.push(entityWithMetrics);
    } else if (roas < CONFIG.LOW_PERFORMANCE_ROAS || ctr < CONFIG.LOW_PERFORMANCE_CTR) {
      entityWithMetrics.performanceRating = 'LOW';
      analysis.lowPerformers.push(entityWithMetrics);
    }
  });

  // Sort by ROAS
  analysis.topPerformers.sort(function(a, b) { return b.roas - a.roas; });
  analysis.lowPerformers.sort(function(a, b) { return a.roas - b.roas; });

  // Calculate overall metrics
  analysis.totals.ctr = analysis.totals.impressions > 0 ?
    analysis.totals.clicks / analysis.totals.impressions : 0;
  analysis.totals.cpa = analysis.totals.conversions > 0 ?
    analysis.totals.cost / analysis.totals.conversions : 0;
  analysis.totals.roas = analysis.totals.cost > 0 ?
    analysis.totals.conversionValue / analysis.totals.cost : 0;

  return analysis;
}

function generateRecommendations(analysis) {
  var recommendations = [];

  // Low performers
  if (analysis.lowPerformers.length > 0) {
    recommendations.push({
      type: 'warning',
      title: 'Review Low Performing Asset Groups',
      message: analysis.lowPerformers.length + ' asset groups have ROAS below ' +
               CONFIG.LOW_PERFORMANCE_ROAS + 'x or CTR below ' +
               (CONFIG.LOW_PERFORMANCE_CTR * 100) + '%',
      items: analysis.lowPerformers.slice(0, 5).map(function(p) {
        return p.name + ' (ROAS: ' + p.roas.toFixed(2) + 'x)';
      })
    });
  }

  // High performers to scale
  if (analysis.topPerformers.length > 0) {
    recommendations.push({
      type: 'success',
      title: 'Top Performers - Consider Scaling',
      message: analysis.topPerformers.length + ' asset groups have ROAS above ' +
               CONFIG.HIGH_PERFORMANCE_ROAS + 'x',
      items: analysis.topPerformers.slice(0, 5).map(function(p) {
        return p.name + ' (ROAS: ' + p.roas.toFixed(2) + 'x, Conv: ' + p.conversions.toFixed(0) + ')';
      })
    });
  }

  // Overall performance check
  if (analysis.totals.roas < 1) {
    recommendations.push({
      type: 'critical',
      title: 'Overall PMax ROAS Below 100%',
      message: 'Your Performance Max campaigns are generating $' +
               analysis.totals.conversionValue.toFixed(2) + ' in value from $' +
               analysis.totals.cost.toFixed(2) + ' in spend (ROAS: ' +
               analysis.totals.roas.toFixed(2) + 'x)'
    });
  }

  return recommendations;
}

// ============================================================================
// REPORTING
// ============================================================================

function logResults(pmaxData, analysis, recommendations, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');

  // Log summary
  var summarySheet = spreadsheet.getSheetByName('PMax Summary');
  if (!summarySheet) {
    summarySheet = spreadsheet.insertSheet('PMax Summary');
    summarySheet.appendRow([
      'Date', 'Campaigns', 'Asset Groups', 'Impressions', 'Clicks', 'CTR',
      'Cost', 'Conversions', 'CPA', 'Value', 'ROAS'
    ]);
    summarySheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    summarySheet.setFrozenRows(1);
  }

  summarySheet.appendRow([
    dateStr,
    pmaxData.campaigns.length,
    pmaxData.assetGroups.length,
    analysis.totals.impressions,
    analysis.totals.clicks,
    analysis.totals.ctr,
    analysis.totals.cost,
    analysis.totals.conversions,
    analysis.totals.cpa,
    analysis.totals.conversionValue,
    analysis.totals.roas
  ]);

  // Log asset group detail
  var detailSheet = spreadsheet.getSheetByName('Asset Group Detail');
  if (!detailSheet) {
    detailSheet = spreadsheet.insertSheet('Asset Group Detail');
    detailSheet.appendRow([
      'Date', 'Campaign', 'Asset Group', 'Impressions', 'Clicks', 'CTR',
      'Cost', 'Conversions', 'CPA', 'Value', 'ROAS', 'Rating'
    ]);
    detailSheet.getRange(1, 1, 1, 12).setFontWeight('bold');
    detailSheet.setFrozenRows(1);
  }

  var allRated = analysis.topPerformers.concat(analysis.lowPerformers);
  allRated.forEach(function(entity) {
    detailSheet.appendRow([
      dateStr,
      entity.campaignName,
      entity.name,
      entity.impressions,
      entity.clicks,
      entity.ctr,
      entity.cost,
      entity.conversions,
      entity.cpa,
      entity.conversionValue,
      entity.roas,
      entity.performanceRating
    ]);
  });
}

function sendReport(accountName, pmaxData, analysis, recommendations) {
  if (!CONFIG.EMAIL_RECIPIENTS) return;

  var subject = '[Google Ads] PMax Performance Report - ' + accountName;

  var body = 'Performance Max Analysis Report\n';
  body += 'Account: ' + accountName + '\n';
  body += 'Period: ' + CONFIG.DATE_RANGE + '\n\n';

  body += '📊 OVERALL PERFORMANCE\n';
  body += '─────────────────────────────────────\n';
  body += 'Campaigns: ' + pmaxData.campaigns.length + '\n';
  body += 'Asset Groups: ' + pmaxData.assetGroups.length + '\n';
  body += 'Total Spend: $' + analysis.totals.cost.toFixed(2) + '\n';
  body += 'Conversions: ' + analysis.totals.conversions.toFixed(0) + '\n';
  body += 'Conversion Value: $' + analysis.totals.conversionValue.toFixed(2) + '\n';
  body += 'ROAS: ' + analysis.totals.roas.toFixed(2) + 'x\n';
  body += 'CPA: $' + analysis.totals.cpa.toFixed(2) + '\n\n';

  body += '💡 RECOMMENDATIONS\n';
  body += '─────────────────────────────────────\n\n';

  recommendations.forEach(function(rec) {
    var icon = rec.type === 'critical' ? '🚨' :
               rec.type === 'warning' ? '⚠️' : '✅';
    body += icon + ' ' + rec.title + '\n';
    body += rec.message + '\n';
    if (rec.items && rec.items.length > 0) {
      rec.items.forEach(function(item) {
        body += '  • ' + item + '\n';
      });
    }
    body += '\n';
  });

  body += '\n--\nSent by Google Ads Scripts PMax Analyzer';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS,
    subject: subject,
    body: body
  });
}
