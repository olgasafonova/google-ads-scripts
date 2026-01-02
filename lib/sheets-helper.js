/**
 * Google Sheets helper functions for Google Ads Scripts
 */

/**
 * Get or create a spreadsheet by URL
 * @param {string} url - Spreadsheet URL
 * @returns {Spreadsheet} Spreadsheet object
 */
function getSpreadsheet(url) {
  return SpreadsheetApp.openByUrl(url);
}

/**
 * Get or create a sheet by name within a spreadsheet
 * @param {Spreadsheet} spreadsheet - Spreadsheet object
 * @param {string} sheetName - Name of the sheet
 * @returns {Sheet} Sheet object
 */
function getOrCreateSheet(spreadsheet, sheetName) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

/**
 * Append a row to a sheet
 * @param {Sheet} sheet - Sheet object
 * @param {Array} row - Array of values for the row
 */
function appendRow(sheet, row) {
  sheet.appendRow(row);
}

/**
 * Append multiple rows to a sheet (more efficient than multiple appendRow calls)
 * @param {Sheet} sheet - Sheet object
 * @param {Array} rows - Array of row arrays
 */
function appendRows(sheet, rows) {
  if (rows.length === 0) return;

  var lastRow = sheet.getLastRow();
  var range = sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length);
  range.setValues(rows);
}

/**
 * Clear all data from a sheet except the header row
 * @param {Sheet} sheet - Sheet object
 */
function clearDataKeepHeader(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
}

/**
 * Set up a sheet with headers if it's empty
 * @param {Sheet} sheet - Sheet object
 * @param {Array} headers - Array of header strings
 */
function setupHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

/**
 * Get all data from a sheet as a 2D array
 * @param {Sheet} sheet - Sheet object
 * @param {boolean} includeHeader - Include header row (default: false)
 * @returns {Array} 2D array of values
 */
function getSheetData(sheet, includeHeader) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow === 0) return [];

  var startRow = includeHeader ? 1 : 2;
  if (startRow > lastRow) return [];

  return sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
}

/**
 * Find a row by value in a specific column
 * @param {Sheet} sheet - Sheet object
 * @param {number} column - Column number (1-indexed)
 * @param {*} value - Value to find
 * @returns {number} Row number (1-indexed) or -1 if not found
 */
function findRowByValue(sheet, column, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][column - 1] === value) {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Update a cell value
 * @param {Sheet} sheet - Sheet object
 * @param {number} row - Row number (1-indexed)
 * @param {number} column - Column number (1-indexed)
 * @param {*} value - New value
 */
function updateCell(sheet, row, column, value) {
  sheet.getRange(row, column).setValue(value);
}

/**
 * Format a column as currency
 * @param {Sheet} sheet - Sheet object
 * @param {number} column - Column number (1-indexed)
 */
function formatColumnAsCurrency(sheet, column) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, column, lastRow - 1, 1).setNumberFormat('$#,##0.00');
  }
}

/**
 * Format a column as percentage
 * @param {Sheet} sheet - Sheet object
 * @param {number} column - Column number (1-indexed)
 */
function formatColumnAsPercent(sheet, column) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, column, lastRow - 1, 1).setNumberFormat('0.00%');
  }
}

/**
 * Auto-resize all columns to fit content
 * @param {Sheet} sheet - Sheet object
 */
function autoResizeColumns(sheet) {
  var lastCol = sheet.getLastColumn();
  for (var i = 1; i <= lastCol; i++) {
    sheet.autoResizeColumn(i);
  }
}
