/**
 * Negative Keyword Miner
 *
 * Automatically identifies wasteful search queries and adds them as negatives:
 * - Zero conversion queries with significant spend
 * - Low CTR queries (likely irrelevant)
 * - Queries containing specified exclusion terms
 *
 * Schedule: Run weekly
 *
 * Setup:
 * 1. Create a Google Sheet to log actions
 * 2. Update CONFIG below with your settings
 * 3. Preview first (APPLY_CHANGES = false) to review
 * 4. Set APPLY_CHANGES = true to auto-add negatives
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Email for notifications
  EMAIL_RECIPIENTS: 'your-email@example.com',

  // IMPORTANT: Set to true to actually add negative keywords
  // Set to false to preview only (recommended for first run)
  APPLY_CHANGES: false,

  // Analysis date range
  DATE_RANGE: 'LAST_30_DAYS',

  // Thresholds for identifying wasteful queries
  MIN_COST: 50,                // Minimum spend to consider ($)
  MIN_CLICKS: 10,              // Minimum clicks to consider
  MAX_CTR: 0.01,               // CTR below this = likely irrelevant (1%)
  MAX_CONVERSIONS: 0,          // Zero conversions = wasteful

  // Where to add negative keywords
  // Options: 'CAMPAIGN' or 'AD_GROUP'
  NEGATIVE_LEVEL: 'CAMPAIGN',

  // Negative keyword match type
  // Options: 'EXACT', 'PHRASE', 'BROAD'
  NEGATIVE_MATCH_TYPE: 'EXACT',

  // Campaign filters
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Terms that should always be added as negatives when found
  EXCLUSION_TERMS: [
    'free',
    'cheap',
    'discount',
    'coupon',
    'torrent',
    'download',
    'cracked',
    'pirate'
  ],

  // Brand terms to protect (never add as negatives)
  BRAND_TERMS: [
    // Add your brand terms here
  ],

  // Maximum negatives to add per run
  MAX_NEGATIVES_PER_RUN: 50
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting Negative Keyword Mining for: ' + accountName);
  Logger.log('Mode: ' + (CONFIG.APPLY_CHANGES ? 'APPLY CHANGES' : 'PREVIEW ONLY'));

  // Get search query data
  var queryData = getSearchQueryData();
  Logger.log('Analyzed ' + queryData.length + ' search queries');

  // Find negative keyword candidates
  var candidates = findNegativeCandidates(queryData);
  Logger.log('Found ' + candidates.length + ' negative keyword candidates');

  if (candidates.length === 0) {
    Logger.log('No negative keywords to add');
    return;
  }

  // Limit to max per run
  candidates = candidates.slice(0, CONFIG.MAX_NEGATIVES_PER_RUN);

  // Apply negatives if enabled
  var results = [];
  if (CONFIG.APPLY_CHANGES) {
    results = applyNegatives(candidates);
  } else {
    results = candidates.map(function(c) {
      c.status = 'PREVIEW';
      return c;
    });
  }

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logResults(results, now, timeZone);
  }

  // Send notification
  sendNotification(accountName, results);

  Logger.log('Finished. Processed ' + results.length + ' negative keywords');
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function getSearchQueryData() {
  var query = 'SELECT Query, CampaignName, AdGroupName, Impressions, Clicks, Cost, Conversions ' +
              'FROM SEARCH_QUERY_PERFORMANCE_REPORT ' +
              'WHERE Impressions > 0 ' +
              'DURING ' + CONFIG.DATE_RANGE;

  if (CONFIG.CAMPAIGN_NAME_CONTAINS) {
    query += " AND CampaignName CONTAINS_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_CONTAINS + "'";
  }

  if (CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN) {
    query += " AND CampaignName DOES_NOT_CONTAIN_IGNORE_CASE '" + CONFIG.CAMPAIGN_NAME_DOES_NOT_CONTAIN + "'";
  }

  var report = AdsApp.report(query);
  var rows = report.rows();
  var data = [];

  while (rows.hasNext()) {
    var row = rows.next();
    data.push({
      query: row['Query'],
      campaign: row['CampaignName'],
      adGroup: row['AdGroupName'],
      impressions: parseInt(row['Impressions'], 10),
      clicks: parseInt(row['Clicks'], 10),
      cost: parseFloat(row['Cost']),
      conversions: parseFloat(row['Conversions'])
    });
  }

  return data;
}

// ============================================================================
// ANALYSIS
// ============================================================================

function findNegativeCandidates(queryData) {
  var candidates = [];
  var brandTermsLower = CONFIG.BRAND_TERMS.map(function(t) { return t.toLowerCase(); });
  var exclusionTermsLower = CONFIG.EXCLUSION_TERMS.map(function(t) { return t.toLowerCase(); });

  queryData.forEach(function(query) {
    var queryLower = query.query.toLowerCase();

    // Skip if contains brand terms
    var containsBrand = brandTermsLower.some(function(brand) {
      return queryLower.indexOf(brand) !== -1;
    });
    if (containsBrand) return;

    var reason = null;

    // Check for exclusion terms
    var matchedExclusion = exclusionTermsLower.find(function(term) {
      return queryLower.indexOf(term) !== -1;
    });
    if (matchedExclusion) {
      reason = 'Contains exclusion term: ' + matchedExclusion;
    }

    // Check for zero conversion high spend
    else if (query.cost >= CONFIG.MIN_COST &&
             query.conversions <= CONFIG.MAX_CONVERSIONS) {
      reason = 'Zero conversions with $' + query.cost.toFixed(2) + ' spend';
    }

    // Check for low CTR
    else if (query.clicks >= CONFIG.MIN_CLICKS) {
      var ctr = query.impressions > 0 ? query.clicks / query.impressions : 0;
      if (ctr <= CONFIG.MAX_CTR) {
        reason = 'Low CTR: ' + (ctr * 100).toFixed(2) + '%';
      }
    }

    if (reason) {
      candidates.push({
        query: query.query,
        campaign: query.campaign,
        adGroup: query.adGroup,
        impressions: query.impressions,
        clicks: query.clicks,
        cost: query.cost,
        conversions: query.conversions,
        ctr: query.impressions > 0 ? query.clicks / query.impressions : 0,
        reason: reason
      });
    }
  });

  // Sort by cost descending (biggest waste first)
  candidates.sort(function(a, b) { return b.cost - a.cost; });

  // Deduplicate by query text
  var seen = {};
  return candidates.filter(function(c) {
    if (seen[c.query]) return false;
    seen[c.query] = true;
    return true;
  });
}

// ============================================================================
// APPLY NEGATIVES
// ============================================================================

function applyNegatives(candidates) {
  var results = [];

  candidates.forEach(function(candidate) {
    try {
      if (CONFIG.NEGATIVE_LEVEL === 'CAMPAIGN') {
        addCampaignNegative(candidate);
      } else {
        addAdGroupNegative(candidate);
      }
      candidate.status = 'ADDED';
    } catch (e) {
      candidate.status = 'ERROR: ' + e.message;
      Logger.log('Error adding negative: ' + e.message);
    }
    results.push(candidate);
  });

  return results;
}

function addCampaignNegative(candidate) {
  var campaigns = AdsApp.campaigns()
    .withCondition("Name = '" + candidate.campaign.replace(/'/g, "\\'") + "'")
    .get();

  if (campaigns.hasNext()) {
    var campaign = campaigns.next();
    var negativeKeyword = formatNegativeKeyword(candidate.query);

    campaign.createNegativeKeyword(negativeKeyword);
    Logger.log('Added campaign negative: ' + negativeKeyword + ' to ' + candidate.campaign);
  }
}

function addAdGroupNegative(candidate) {
  var adGroups = AdsApp.adGroups()
    .withCondition("Name = '" + candidate.adGroup.replace(/'/g, "\\'") + "'")
    .withCondition("CampaignName = '" + candidate.campaign.replace(/'/g, "\\'") + "'")
    .get();

  if (adGroups.hasNext()) {
    var adGroup = adGroups.next();
    var negativeKeyword = formatNegativeKeyword(candidate.query);

    adGroup.createNegativeKeyword(negativeKeyword);
    Logger.log('Added ad group negative: ' + negativeKeyword + ' to ' + candidate.adGroup);
  }
}

function formatNegativeKeyword(query) {
  switch (CONFIG.NEGATIVE_MATCH_TYPE) {
    case 'EXACT':
      return '[' + query + ']';
    case 'PHRASE':
      return '"' + query + '"';
    case 'BROAD':
    default:
      return query;
  }
}

// ============================================================================
// REPORTING
// ============================================================================

function logResults(results, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var sheet = spreadsheet.getSheetByName('Negative Keywords');

  if (!sheet) {
    sheet = spreadsheet.insertSheet('Negative Keywords');
    sheet.appendRow([
      'Date', 'Query', 'Campaign', 'Ad Group', 'Impressions', 'Clicks',
      'CTR', 'Cost', 'Conversions', 'Reason', 'Status'
    ]);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd HH:mm');

  var rows = results.map(function(r) {
    return [
      dateStr,
      r.query,
      r.campaign,
      r.adGroup,
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

  // Format
  var dataRows = sheet.getLastRow() - 1;
  if (dataRows > 0) {
    sheet.getRange(2, 7, dataRows, 1).setNumberFormat('0.00%');
    sheet.getRange(2, 8, dataRows, 1).setNumberFormat('$#,##0.00');
  }
}

function sendNotification(accountName, results) {
  if (!CONFIG.EMAIL_RECIPIENTS) return;

  var added = results.filter(function(r) { return r.status === 'ADDED'; });
  var preview = results.filter(function(r) { return r.status === 'PREVIEW'; });
  var errors = results.filter(function(r) { return r.status.indexOf('ERROR') === 0; });

  var subject = '[Google Ads] Negative Keywords - ' + accountName;

  var body = 'Negative Keyword Mining Results for ' + accountName + '\n\n';

  if (CONFIG.APPLY_CHANGES) {
    body += '✅ Added: ' + added.length + ' negative keywords\n';
    if (errors.length > 0) {
      body += '❌ Errors: ' + errors.length + '\n';
    }
  } else {
    body += '👁️ Preview Mode: ' + preview.length + ' candidates found\n';
    body += 'Set APPLY_CHANGES = true to add these negatives\n';
  }

  body += '\nTotal potential savings: $' + results.reduce(function(sum, r) {
    return sum + r.cost;
  }, 0).toFixed(2) + '\n\n';

  body += 'Top candidates:\n';
  results.slice(0, 10).forEach(function(r) {
    body += '• "' + r.query + '" - $' + r.cost.toFixed(2) + ' (' + r.reason + ')\n';
  });

  body += '\n--\nSent by Google Ads Scripts Negative Keyword Miner';

  MailApp.sendEmail({
    to: CONFIG.EMAIL_RECIPIENTS,
    subject: subject,
    body: body
  });
}
