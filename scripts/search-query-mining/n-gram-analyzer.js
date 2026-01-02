/**
 * N-Gram Search Query Analyzer
 *
 * Analyzes search query reports to find patterns using n-grams:
 * - Identifies high-performing word combinations to add as keywords
 * - Finds poor-performing patterns to add as negatives
 * - Groups queries by common n-grams for easier analysis
 *
 * Schedule: Run weekly
 *
 * Setup:
 * 1. Create a Google Sheet to store results
 * 2. Update CONFIG below with your settings
 * 3. Preview the script to test
 * 4. Schedule to run weekly
 */

// ============================================================================
// CONFIGURATION - Update these values
// ============================================================================

var CONFIG = {
  // Google Sheet URL to log results
  SPREADSHEET_URL: 'YOUR_SPREADSHEET_URL_HERE',

  // Analysis settings
  MIN_IMPRESSIONS: 50,          // Minimum impressions for n-gram to be included
  MIN_CLICKS: 5,                // Minimum clicks for n-gram analysis
  DATE_RANGE: 'LAST_30_DAYS',   // Date range for analysis

  // N-gram sizes to analyze
  NGRAM_SIZES: [1, 2, 3],       // Analyze 1-word, 2-word, and 3-word combinations

  // Performance thresholds for recommendations
  HIGH_CTR_THRESHOLD: 0.05,     // 5% CTR = high performer
  LOW_CTR_THRESHOLD: 0.01,      // 1% CTR = low performer
  HIGH_CONV_RATE: 0.03,         // 3% conversion rate = high performer
  HIGH_CPA_MULTIPLIER: 2,       // CPA > 2x target = too expensive

  // Target CPA (set to your account's target, or leave as 0 to skip CPA analysis)
  TARGET_CPA: 0,

  // Campaign filters
  CAMPAIGN_NAME_CONTAINS: '',
  CAMPAIGN_NAME_DOES_NOT_CONTAIN: '',

  // Stop words to exclude from analysis
  STOP_WORDS: [
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'it', 'its', 'my', 'your', 'our', 'their', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which',
    'who', 'whom', 'how', 'when', 'where', 'why'
  ]
};

// ============================================================================
// MAIN FUNCTION
// ============================================================================

function main() {
  var accountName = AdsApp.currentAccount().getName();
  var timeZone = AdsApp.currentAccount().getTimeZone();
  var now = new Date();

  Logger.log('Starting N-Gram Analysis for: ' + accountName);
  Logger.log('Date range: ' + CONFIG.DATE_RANGE);

  // Get search query data
  var queryData = getSearchQueryData();
  Logger.log('Retrieved ' + queryData.length + ' search queries');

  if (queryData.length === 0) {
    Logger.log('No search query data found');
    return;
  }

  // Analyze n-grams
  var ngramResults = {};

  CONFIG.NGRAM_SIZES.forEach(function(size) {
    ngramResults[size] = analyzeNgrams(queryData, size);
    Logger.log(size + '-grams: ' + Object.keys(ngramResults[size]).length + ' unique combinations');
  });

  // Generate recommendations
  var recommendations = generateRecommendations(ngramResults);

  // Log to spreadsheet
  if (CONFIG.SPREADSHEET_URL && CONFIG.SPREADSHEET_URL !== 'YOUR_SPREADSHEET_URL_HERE') {
    logResults(ngramResults, recommendations, now, timeZone);
  }

  // Log summary
  Logger.log('Finished analysis');
  Logger.log('Keyword opportunities: ' + recommendations.keywords.length);
  Logger.log('Negative keyword candidates: ' + recommendations.negatives.length);
}

// ============================================================================
// DATA RETRIEVAL
// ============================================================================

function getSearchQueryData() {
  var query = 'SELECT Query, CampaignName, Impressions, Clicks, Cost, Conversions, ConversionValue ' +
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
      query: row['Query'].toLowerCase(),
      campaign: row['CampaignName'],
      impressions: parseInt(row['Impressions'], 10),
      clicks: parseInt(row['Clicks'], 10),
      cost: parseFloat(row['Cost']),
      conversions: parseFloat(row['Conversions']),
      conversionValue: parseFloat(row['ConversionValue'])
    });
  }

  return data;
}

// ============================================================================
// N-GRAM ANALYSIS
// ============================================================================

function analyzeNgrams(queryData, ngramSize) {
  var ngrams = {};
  var stopWords = CONFIG.STOP_WORDS.reduce(function(acc, word) {
    acc[word] = true;
    return acc;
  }, {});

  queryData.forEach(function(query) {
    var words = query.query.split(/\s+/).filter(function(word) {
      return word.length > 1 && !stopWords[word];
    });

    // Generate n-grams
    for (var i = 0; i <= words.length - ngramSize; i++) {
      var ngram = words.slice(i, i + ngramSize).join(' ');

      if (!ngrams[ngram]) {
        ngrams[ngram] = {
          ngram: ngram,
          queries: 0,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
          conversionValue: 0
        };
      }

      ngrams[ngram].queries++;
      ngrams[ngram].impressions += query.impressions;
      ngrams[ngram].clicks += query.clicks;
      ngrams[ngram].cost += query.cost;
      ngrams[ngram].conversions += query.conversions;
      ngrams[ngram].conversionValue += query.conversionValue;
    }
  });

  // Calculate derived metrics
  for (var key in ngrams) {
    var ng = ngrams[key];
    ng.ctr = ng.impressions > 0 ? ng.clicks / ng.impressions : 0;
    ng.cpc = ng.clicks > 0 ? ng.cost / ng.clicks : 0;
    ng.convRate = ng.clicks > 0 ? ng.conversions / ng.clicks : 0;
    ng.cpa = ng.conversions > 0 ? ng.cost / ng.conversions : 0;
    ng.roas = ng.cost > 0 ? ng.conversionValue / ng.cost : 0;
  }

  return ngrams;
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

function generateRecommendations(ngramResults) {
  var keywords = [];
  var negatives = [];

  // Analyze each n-gram size
  CONFIG.NGRAM_SIZES.forEach(function(size) {
    var ngrams = ngramResults[size];

    for (var key in ngrams) {
      var ng = ngrams[key];

      // Skip low-volume n-grams
      if (ng.impressions < CONFIG.MIN_IMPRESSIONS) continue;

      // Keyword opportunities: high CTR or high conversion rate
      if (ng.clicks >= CONFIG.MIN_CLICKS) {
        if (ng.ctr >= CONFIG.HIGH_CTR_THRESHOLD || ng.convRate >= CONFIG.HIGH_CONV_RATE) {
          keywords.push({
            ngram: ng.ngram,
            size: size,
            reason: ng.convRate >= CONFIG.HIGH_CONV_RATE ? 'High conversion rate' : 'High CTR',
            impressions: ng.impressions,
            clicks: ng.clicks,
            ctr: ng.ctr,
            conversions: ng.conversions,
            convRate: ng.convRate,
            cpa: ng.cpa
          });
        }

        // Negative keyword candidates: low CTR or high CPA
        if (ng.ctr <= CONFIG.LOW_CTR_THRESHOLD ||
            (CONFIG.TARGET_CPA > 0 && ng.cpa > CONFIG.TARGET_CPA * CONFIG.HIGH_CPA_MULTIPLIER)) {
          negatives.push({
            ngram: ng.ngram,
            size: size,
            reason: ng.ctr <= CONFIG.LOW_CTR_THRESHOLD ? 'Low CTR' : 'High CPA',
            impressions: ng.impressions,
            clicks: ng.clicks,
            ctr: ng.ctr,
            cost: ng.cost,
            conversions: ng.conversions,
            cpa: ng.cpa
          });
        }
      }
    }
  });

  // Sort by impact
  keywords.sort(function(a, b) { return b.conversions - a.conversions; });
  negatives.sort(function(a, b) { return b.cost - a.cost; });

  return {
    keywords: keywords.slice(0, 100),
    negatives: negatives.slice(0, 100)
  };
}

// ============================================================================
// REPORTING
// ============================================================================

function logResults(ngramResults, recommendations, now, timeZone) {
  var spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
  var dateStr = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');

  // Log all n-grams
  CONFIG.NGRAM_SIZES.forEach(function(size) {
    var sheetName = size + '-Grams';
    var sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
      sheet.appendRow([
        'Date', 'N-Gram', 'Queries', 'Impressions', 'Clicks', 'CTR',
        'Cost', 'Conversions', 'Conv Rate', 'CPA', 'ROAS'
      ]);
      sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var ngrams = ngramResults[size];
    var rows = [];

    for (var key in ngrams) {
      var ng = ngrams[key];
      if (ng.impressions < CONFIG.MIN_IMPRESSIONS) continue;

      rows.push([
        dateStr,
        ng.ngram,
        ng.queries,
        ng.impressions,
        ng.clicks,
        ng.ctr,
        ng.cost,
        ng.conversions,
        ng.convRate,
        ng.cpa,
        ng.roas
      ]);
    }

    if (rows.length > 0) {
      // Sort by impressions
      rows.sort(function(a, b) { return b[3] - a[3]; });
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rows.length, 11).setValues(rows);
    }
  });

  // Log recommendations
  logRecommendations(spreadsheet, 'Keyword Opportunities', recommendations.keywords, dateStr);
  logRecommendations(spreadsheet, 'Negative Candidates', recommendations.negatives, dateStr);
}

function logRecommendations(spreadsheet, sheetName, data, dateStr) {
  var sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet.appendRow([
      'Date', 'N-Gram', 'Size', 'Reason', 'Impressions', 'Clicks',
      'CTR', 'Conversions', 'Conv Rate', 'CPA'
    ]);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var rows = data.map(function(item) {
    return [
      dateStr,
      item.ngram,
      item.size,
      item.reason,
      item.impressions,
      item.clicks,
      item.ctr,
      item.conversions || 0,
      item.convRate || 0,
      item.cpa || 0
    ];
  });

  if (rows.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, 10).setValues(rows);
  }
}
