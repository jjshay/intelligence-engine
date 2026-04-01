/**
 * ============================================================================
 * TRUECOA - GOOGLE SHEETS WRITER SERVICE
 * ============================================================================
 *
 * Writes automation results back to Google Sheets.
 * Upgrades the existing read-only Sheets integration to read/write.
 *
 * Column mapping (0-indexed, matches COAGenerator_Combined.gs CONFIG.COLUMNS):
 *   A(0):  COA_Code       B(1):  QR_Code        C(2):  Artist
 *   D(3):  Title          E(4):  Date            F(5):  Length
 *   G(6):  Width          H(7):  Number          I(8):  Edition
 *   J(9):  Medium         K(10): Condition        L(11): Description
 *   M(12): Notes          N(13): Assignee         O(14): Image_URL
 *   P(15): SKU            Q(16): COA_Code2        R(17): NFT_TokenID
 *   S(18): Short_URL      T(19): Blockchain_URL   U(20): NFT_URL
 *   V(21): Cert_URL       W(22): Done             X(23): Generated
 */

const { google } = require('googleapis');

// Column indices for write-back (0-indexed)
const COLUMNS = {
  COA_CODE: 0,
  QR_CODE: 1,
  ARTIST: 2,
  TITLE: 3,
  NFT_TOKEN_ID: 17,  // R
  SHORT_URL: 18,      // S
  BLOCKCHAIN_URL: 19, // T
  NFT_URL: 20,        // U
  CERT_URL: 21,       // V
  DONE: 22,           // W
  GENERATED: 23       // X
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

  // Always update the Done/status column
  const status = results.status || new Date().toISOString();
  updates.push([colToLetter(COLUMNS.DONE), status]);
  updates.push([colToLetter(COLUMNS.GENERATED), new Date().toISOString()]);

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
  await updateCell(spreadsheetId, sheetName, rowNumber, COLUMNS.DONE, status);
}

/**
 * Get all unprocessed rows (COA code present, Done column empty)
 *
 * @returns {Promise<Array>} Array of { rowNumber, coaCode, artist, title, ... }
 */
async function getUnprocessedRows() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'COA2';

  if (!sheetsClient) throw new Error('Sheets writer not initialized');

  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:X`
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const unprocessed = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const coaCode = (row[COLUMNS.COA_CODE] || '').toString().trim();
    const artist = (row[COLUMNS.ARTIST] || '').toString().trim();
    const title = (row[COLUMNS.TITLE] || '').toString().trim();
    const doneStatus = (row[COLUMNS.DONE] || '').toString().trim();
    const imageUrl = (row[14] || '').toString().trim(); // O: Image_URL

    // Skip rows without COA code or required fields
    if (!coaCode) continue;

    // Skip rows already processed or currently processing
    if (doneStatus && doneStatus !== 'error') continue;

    // Require at least artist or title to be filled in
    if (!artist && !title) continue;

    unprocessed.push({
      rowNumber: i + 1, // 1-indexed for Sheets API
      coaCode,
      artist,
      title,
      date: (row[4] || '').toString().trim(),
      medium: (row[9] || '').toString().trim(),
      condition: (row[10] || '').toString().trim(),
      description: (row[11] || '').toString().trim(),
      provenance: (row[12] || '').toString().trim(),
      assignee: (row[13] || '').toString().trim(),
      imageUrl,
      sku: (row[15] || '').toString().trim(),
      edition: row[7] && row[8] ? `${row[7]} of ${row[8]}` : '',
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
