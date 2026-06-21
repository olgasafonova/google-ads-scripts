/**
 * Performance Max Brand Overlap Detector
 *
 * Analyzes Performance Max campaigns to detect potential brand cannibalization:
 * - Compares PMax performance against branded Search campaigns
 * - Identifies when PMax is capturing branded searches
 * - Calculates true incremental value of PMax
 *
 * Note: PMax is largely a "black box" - this uses available signals
 * to estimate brand overlap.
 *
 * Schedule: Run weekly
 *
 * Setup:
 * 1. Create a Google Sheet to store results
 * 2. Update CONFIG below with your brand terms
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

  // Your brand terms (used to identify brand campaigns and estimate overlap)
  BRAND_TERMS: [
    // 'YourBrand',
    // 'Your Brand Name',
    // 'yourbrand.com'
  ],

  // Pattern to identify branded Search campaigns
  BRAND_CAMPAIGN_PATTERN: 'brand',  // Case insensitive

  // Analysis date range
  DATE_RANGE: 'LAST_30_DAYS',

  // Threshold for flagging potential cannibalization
  // If PMax cost is > this % of Brand Search cost, flag it
  CANNIBALIZATION_THRESHOLD: 0.3,  // 30%

  // Expected PMax brand share (estimate)
  // Used to calculate estimated brand spend within PMax
  ESTIMATED_PMAX_BRAND_SHARE: 0.4  // 40% of PMax is often brand
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting PMax Brand Overlap Analysis for: ' + accountName);

  if (CONFIG.BRAND_TERMS.length === 0) {
    Logger.log('WARNING: No brand terms configured. Please add your brand terms to CONFIG.BRAND_TERMS');
  }

  // Get campaign performance data
  var campaignData = getCampaignData();

  // Categorize campaigns
  var analysis = analyzeCampaigns(campaignData);

  // Generate insights
  var insights = generateInsights(analysis);

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logResults(analysis, insights, now, timeZone);
  }

  // Send report
  sendReport(accountName, analysis, insights);

  Logger.log('Finished analysis');
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function getCampaignData() {
  var campaigns = [];

  // Get all campaign performance using GAQL
  var query = 'SELECT campaign.name, campaign.id, campaign.advertising_channel_type, ' +
              'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
              'metrics.conversions, metrics.conversions_value ' +
              'FROM campaign ' +
              'WHERE metrics.impressions > 0 AND campaign.status = "ENABLED" ' +
              'AND segments.date DURING ' + CONFIG.DATE_RANGE;

  var report = AdsApp.report(query);
  var rows = report.rows();

  while (rows.hasNext()) {
    var row = rows.next();
    campaigns.push({
      name: row['campaign.name'],
      id: row['campaign.id'],
      type: row['campaign.advertising_channel_type'],
      impressions: parseInt(row['metrics.impressions'], 10),
      clicks: parseInt(row['metrics.clicks'], 10),
      cost: parseFloat(row['metrics.cost_micros']) / 1000000,
      conversions: parseFloat(row['metrics.conversions']),
      conversionValue: parseFloat(row['metrics.conversions_value'])
    });
  }

  return campaigns;
}

// ============================================================================
// ANALYSIS
// ============================================================================

function analyzeCampaigns(campaignData) {
  var analysis = {
    pmax: [],
    brandSearch: [],
    nonBrandSearch: [],
    other: [],
    totals: {
      pmaxCost: 0,
      pmaxConversions: 0,
      pmaxValue: 0,
      brandSearchCost: 0,
      brandSearchConversions: 0,
      brandSearchValue: 0,
      nonBrandSearchCost: 0,
      nonBrandSearchConversions: 0
    }
  };

  var brandPattern = CONFIG.BRAND_CAMPAIGN_PATTERN.toLowerCase();

  campaignData.forEach(function(campaign) {
    var nameLower = campaign.name.toLowerCase();

    // Categorize campaign
    if (campaign.type === 'PERFORMANCE_MAX') {
      analysis.pmax.push(campaign);
      analysis.totals.pmaxCost += campaign.cost;
      analysis.totals.pmaxConversions += campaign.conversions;
      analysis.totals.pmaxValue += campaign.conversionValue;
    }
    else if (campaign.type === 'SEARCH') {
      var isBrand = brandPattern && nameLower.indexOf(brandPattern) !== -1;

      // Also check for brand terms in campaign name
      if (!isBrand && CONFIG.BRAND_TERMS.length > 0) {
        isBrand = CONFIG.BRAND_TERMS.some(function(term) {
          return nameLower.indexOf(term.toLowerCase()) !== -1;
        });
      }

      if (isBrand) {
        analysis.brandSearch.push(campaign);
        analysis.totals.brandSearchCost += campaign.cost;
        analysis.totals.brandSearchConversions += campaign.conversions;
        analysis.totals.brandSearchValue += campaign.conversionValue;
      } else {
        analysis.nonBrandSearch.push(campaign);
        analysis.totals.nonBrandSearchCost += campaign.cost;
        analysis.totals.nonBrandSearchConversions += campaign.conversions;
      }
    }
    else {
      analysis.other.push(campaign);
    }
  });

  return analysis;
}

function buildSpendInsights(totals) {
  var estimatedPmaxBrandSpend = totals.pmaxCost * CONFIG.ESTIMATED_PMAX_BRAND_SHARE;
  var overlapRatio = totals.brandSearchCost > 0 ?
    estimatedPmaxBrandSpend / totals.brandSearchCost : 0;

  var insights = [
    { metric: 'Total PMax Spend', value: totals.pmaxCost, format: 'currency' },
    { metric: 'Total Brand Search Spend', value: totals.brandSearchCost, format: 'currency' },
    {
      metric: 'Estimated PMax Brand Spend',
      value: estimatedPmaxBrandSpend,
      format: 'currency',
      note: 'Based on ' + (CONFIG.ESTIMATED_PMAX_BRAND_SHARE * 100) + '% brand share assumption'
    },
    {
      metric: 'Brand Overlap Ratio',
      value: overlapRatio,
      format: 'percent',
      note: 'PMax brand spend vs Brand Search spend'
    }
  ];

  if (overlapRatio > CONFIG.CANNIBALIZATION_THRESHOLD) {
    insights.push({
      metric: '⚠️ CANNIBALIZATION WARNING',
      value: null,
      format: 'text',
      note: 'PMax may be capturing ' + formatPercent(CONFIG.ESTIMATED_PMAX_BRAND_SHARE) +
            ' of branded traffic. Consider brand exclusions in PMax.'
    });
  }

  return insights;
}

function buildCpaInsights(totals) {
  var pmaxCPA = totals.pmaxConversions > 0 ? totals.pmaxCost / totals.pmaxConversions : 0;
  var brandCPA = totals.brandSearchConversions > 0 ?
    totals.brandSearchCost / totals.brandSearchConversions : 0;
  var nonBrandCPA = totals.nonBrandSearchConversions > 0 ?
    totals.nonBrandSearchCost / totals.nonBrandSearchConversions : 0;

  // True incremental value estimate: if X% of PMax is brand, what's the non-brand CPA?
  var estimatedPmaxNonBrandSpend = totals.pmaxCost * (1 - CONFIG.ESTIMATED_PMAX_BRAND_SHARE);
  var estimatedPmaxNonBrandConversions = totals.pmaxConversions * (1 - CONFIG.ESTIMATED_PMAX_BRAND_SHARE);
  var estimatedPmaxNonBrandCPA = estimatedPmaxNonBrandConversions > 0 ?
    estimatedPmaxNonBrandSpend / estimatedPmaxNonBrandConversions : 0;

  return [
    { metric: 'PMax CPA', value: pmaxCPA, format: 'currency' },
    { metric: 'Brand Search CPA', value: brandCPA, format: 'currency' },
    { metric: 'Non-Brand Search CPA', value: nonBrandCPA, format: 'currency' },
    {
      metric: 'Estimated PMax Non-Brand CPA',
      value: estimatedPmaxNonBrandCPA,
      format: 'currency',
      note: 'True incremental cost estimate'
    }
  ];
}

function generateInsights(analysis) {
  return buildSpendInsights(analysis.totals).concat(buildCpaInsights(analysis.totals));
}

// ============================================================================
// REPORTING
// ============================================================================

function formatInsightValue(insight) {
  if (insight.value === null) return '';
  if (insight.format === 'currency') {
    return '$' + insight.value.toFixed(2);
  }
  if (insight.format === 'percent') {
    return (insight.value * 100).toFixed(1) + '%';
  }
  return insight.value;
}

function logInsightRows(spreadsheet, insights, dateStr) {
  var insightSheet = spreadsheet.getSheetByName('Brand Overlap Insights');
  if (!insightSheet) {
    insightSheet = spreadsheet.insertSheet('Brand Overlap Insights');
    insightSheet.appendRow(['Date', 'Metric', 'Value', 'Notes']);
    insightSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    insightSheet.setFrozenRows(1);
  }

  insights.forEach(function(insight) {
    insightSheet.appendRow([
      dateStr,
      insight.metric,
      formatInsightValue(insight),
      insight.note || ''
    ]);
  });
}

function logCampaignBreakdown(spreadsheet, analysis, dateStr) {
  var campaignSheet = spreadsheet.getSheetByName('Campaign Breakdown');
  if (!campaignSheet) {
    campaignSheet = spreadsheet.insertSheet('Campaign Breakdown');
    campaignSheet.appendRow([
      'Date', 'Campaign', 'Type', 'Category', 'Cost', 'Conversions', 'CPA', 'ROAS'
    ]);
    campaignSheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    campaignSheet.setFrozenRows(1);
  }

  var allCampaigns = [
    { campaigns: analysis.pmax, category: 'PMAX' },
    { campaigns: analysis.brandSearch, category: 'BRAND_SEARCH' },
    { campaigns: analysis.nonBrandSearch, category: 'NON_BRAND_SEARCH' }
  ];

  allCampaigns.forEach(function(group) {
    group.campaigns.forEach(function(c) {
      var cpa = c.conversions > 0 ? c.cost / c.conversions : 0;
      var roas = c.cost > 0 ? c.conversionValue / c.cost : 0;

      campaignSheet.appendRow([
        dateStr, c.name, c.type, group.category,
        c.cost, c.conversions, cpa, roas
      ]);
    });
  });
}

function logResults(analysis, insights, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');

  logInsightRows(spreadsheet, insights, dateStr);
  logCampaignBreakdown(spreadsheet, analysis, dateStr);
}

function sendReport(accountName, analysis, insights) {
  if (!CONFIG.EMAIL_RECIPIENTS) return;

  var subject = '[Google Ads] PMax Brand Overlap Report - ' + accountName;

  var body = 'Performance Max Brand Overlap Analysis\n';
  body += 'Account: ' + accountName + '\n';
  body += 'Period: ' + CONFIG.DATE_RANGE + '\n\n';

  body += '📊 KEY METRICS\n';
  body += '─────────────────────────────────────\n\n';

  insights.forEach(function(insight) {
    var displayValue = '';
    if (insight.format === 'currency' && insight.value !== null) {
      displayValue = '$' + insight.value.toFixed(2);
    } else if (insight.format === 'percent' && insight.value !== null) {
      displayValue = (insight.value * 100).toFixed(1) + '%';
    } else {
      displayValue = insight.value || '';
    }

    body += insight.metric + ': ' + displayValue + '\n';
    if (insight.note) {
      body += '  → ' + insight.note + '\n';
    }
    body += '\n';
  });

  body += '\n📋 CAMPAIGN COUNTS\n';
  body += '─────────────────────────────────────\n';
  body += 'PMax Campaigns: ' + analysis.pmax.length + '\n';
  body += 'Brand Search Campaigns: ' + analysis.brandSearch.length + '\n';
  body += 'Non-Brand Search Campaigns: ' + analysis.nonBrandSearch.length + '\n';

  body += '\n💡 RECOMMENDATIONS\n';
  body += '─────────────────────────────────────\n';
  body += '• Consider adding brand exclusions to PMax campaigns\n';
  body += '• Review Search Terms report in PMax Insights\n';
  body += '• Compare incremental lift with holdout tests\n';

  body += '\n--\nSent by Google Ads Scripts PMax Brand Overlap Detector';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS,
    subject: subject,
    body: body
  });
}

function formatPercent(value) {
  return (value * 100).toFixed(0) + '%';
}
