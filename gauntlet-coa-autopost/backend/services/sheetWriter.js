/**
 * ============================================================================
 * TRUECOA - GOOGLE SHEETS WRITER SERVICE
 * ============================================================================
 *
 * Writes automation results back to Google Sheets.
 * Upgrades the existing read-only Sheets integration to read/write.
 *
 * Column mapping (0-indexed, matches COAGenerator_Combined.gs CONFIG.COLUMNS):
 *   A(0):  COA_CODE       B(1):  QR_CODE        C(2):  SIGNER
 *   D(3):  TITLE          E(4):  ART_DATE       F(5):  LENGTH
 *   G(6):  WIDTH          H(7):  AUTHENTICATOR  I(8):  AUTH_NUMBER
 *   J(9):  AUTH_DATE      K(10): CONDITION      L(11): DESCRIPTION
 *   M(12): EDITION        N(13): MEDIUM         O(14): ASSIGNEE
 *   P(15): IMAGE_URL      Q(16): SKU            R(17): THIRD_PARTY_COA
 *   S(18): NFT_TOKEN_ID   T(19): SHORT_URL      U(20): BLOCKCHAIN_URL
 *   V(21): NFT_URL        W(22): CERT_URL       X(23): STATUS
 *   Y(24): COMPLETION_DATE
 */

const { google } = require('googleapis');

// Column indices for write-back (0-indexed)
const COLUMNS = {
  COA_CODE: 0,        // A
  QR_CODE: 1,         // B
  SIGNER: 2,          // C
  TITLE: 3,           // D
  ART_DATE: 4,        // E
  LENGTH: 5,          // F
  WIDTH: 6,           // G
  AUTHENTICATOR: 7,   // H
  AUTH_NUMBER: 8,     // I
  AUTH_DATE: 9,       // J
  CONDITION: 10,      // K
  DESCRIPTION: 11,    // L
  EDITION: 12,        // M
  MEDIUM: 13,         // N
  ASSIGNEE: 14,       // O
  IMAGE_URL: 15,      // P
  SKU: 16,            // Q
  THIRD_PARTY_COA: 17,// R
  NFT_TOKEN_ID: 18,   // S
  SHORT_URL: 19,      // T
  BLOCKCHAIN_URL: 20, // U
  NFT_URL: 21,        // V
  CERT_URL: 22,       // W
  STATUS: 23,         // X
  COMPLETION_DATE: 24 // Y
};

let sheetsClient = null;

/**
 * Initialize Google Sheets API with read/write scope
 */
async function initSheetsWriter() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    console.log('Warning: GOOGLE_CREDENTIALS not set, Sheets writer disabled');
    return;
  }

  try {
    let credentialsJson = process.env.GOOGLE_CREDENTIALS;
    if (!credentialsJson.trim().startsWith('{')) {
      credentialsJson = Buffer.from(credentialsJson, 'base64').toString('utf8');
    }

    const credentials = JSON.parse(credentialsJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      // Upgraded to full read/write scope
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('Sheets writer initialized (read/write)');
  } catch (err) {
    console.error('Failed to init Sheets writer:', err.message);
  }
}

/**
 * Convert column index (0-based) to A1 notation letter
 */
function colToLetter(col) {
  let letter = '';
  let temp = col;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Update a single cell in the sheet
 */
async function updateCell(spreadsheetId, sheetName, row, col, value) {
  if (!sheetsClient) throw new Error('Sheets writer not initialized');

  const cell = `${sheetName}!${colToLetter(col)}${row}`;
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: cell,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] }
  });
}

/**
 * Write automation results for a COA row
 *
 * @param {number} rowNumber - Sheet row number (1-indexed)
 * @param {Object} results - Automation results to write
 * @param {string} [results.tokenId] - NFT token ID
 * @param {string} [results.polygonscanUrl] - Polygonscan transaction URL
 * @param {string} [results.openSeaUrl] - OpenSea NFT URL
 * @param {string} [results.certificateUrl] - ScoreDetect certificate URL
 * @param {string} [results.shortUrl] - Bit.ly short URL
 * @param {string} [results.status] - Status message
 */
async function writeResults(rowNumber, results) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'COA2';

  if (!spreadsheetId) throw new Error('SPREADSHEET_ID not set');
  if (!sheetsClient) throw new Error('Sheets writer not initialized');

  const updates = [];

  if (results.tokenId) {
    updates.push([colToLetter(COLUMNS.NFT_TOKEN_ID), results.tokenId]);
  }
  if (results.polygonscanUrl) {
    updates.push([colToLetter(COLUMNS.BLOCKCHAIN_URL), results.polygonscanUrl]);
  }
  if (results.openSeaUrl) {
    updates.push([colToLetter(COLUMNS.NFT_URL), results.openSeaUrl]);
  }
  if (results.certificateUrl) {
    updates.push([colToLetter(COLUMNS.CERT_URL), results.certificateUrl]);
  }
  if (results.shortUrl) {
    updates.push([colToLetter(COLUMNS.SHORT_URL), results.shortUrl]);
  }

  // Always update the Status/completion column
  const status = results.status || new Date().toISOString();
  updates.push([colToLetter(COLUMNS.STATUS), status]);
  updates.push([colToLetter(COLUMNS.COMPLETION_DATE), new Date().toISOString()]);

  // Batch update all cells
  const data = updates.map(([col, value]) => ({
    range: `${sheetName}!${col}${rowNumber}`,
    values: [[value]]
  }));

  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data
    }
  });

  console.log(`Updated row ${rowNumber} with ${updates.length} fields`);
}

/**
 * Set the status/Done column for a row (used for in-progress tracking)
 */
async function setRowStatus(rowNumber, status) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'COA2';
  await updateCell(spreadsheetId, sheetName, rowNumber, COLUMNS.STATUS, status);
}

/**
 * Get all unprocessed rows (COA code present, STATUS column empty)
 *
 * @returns {Promise<Array>} Array of { rowNumber, coaCode, signer, title, ... }
 */
async function getUnprocessedRows() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'COA2';

  if (!sheetsClient) throw new Error('Sheets writer not initialized');

  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Y`
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const unprocessed = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const coaCode = (row[COLUMNS.COA_CODE] || '').toString().trim();
    const signer = (row[COLUMNS.SIGNER] || '').toString().trim();
    const title = (row[COLUMNS.TITLE] || '').toString().trim();
    const status = (row[COLUMNS.STATUS] || '').toString().trim();
    const imageUrl = (row[COLUMNS.IMAGE_URL] || '').toString().trim();

    // Skip rows without COA code or required fields
    if (!coaCode) continue;

    // Skip rows already processed or currently processing
    if (status && status !== 'error') continue;

    // Require at least signer or title to be filled in
    if (!signer && !title) continue;

    unprocessed.push({
      rowNumber: i + 1, // 1-indexed for Sheets API
      coaCode,
      signer,
      title,
      artDate: (row[COLUMNS.ART_DATE] || '').toString().trim(),
      length: (row[COLUMNS.LENGTH] || '').toString().trim(),
      width: (row[COLUMNS.WIDTH] || '').toString().trim(),
      authenticator: (row[COLUMNS.AUTHENTICATOR] || '').toString().trim(),
      authNumber: (row[COLUMNS.AUTH_NUMBER] || '').toString().trim(),
      authDate: (row[COLUMNS.AUTH_DATE] || '').toString().trim(),
      condition: (row[COLUMNS.CONDITION] || '').toString().trim(),
      description: (row[COLUMNS.DESCRIPTION] || '').toString().trim(),
      edition: (row[COLUMNS.EDITION] || '').toString().trim(),
      medium: (row[COLUMNS.MEDIUM] || '').toString().trim(),
      assignee: (row[COLUMNS.ASSIGNEE] || '').toString().trim(),
      imageUrl,
      sku: (row[COLUMNS.SKU] || '').toString().trim(),
      thirdPartyCoa: (row[COLUMNS.THIRD_PARTY_COA] || '').toString().trim(),
      shortUrl: (row[COLUMNS.SHORT_URL] || '').toString().trim()
    });
  }

  return unprocessed;
}

module.exports = {
  initSheetsWriter,
  writeResults,
  setRowStatus,
  getUnprocessedRows,
  COLUMNS
};
