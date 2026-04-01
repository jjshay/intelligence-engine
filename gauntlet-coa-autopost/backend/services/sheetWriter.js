/**
 * ============================================================================
 * TRUECOA - GOOGLE SHEETS WRITER SERVICE
 * ============================================================================
 *
 * Writes automation results back to Google Sheets.
 * Upgrades the existing read-only Sheets integration to read/write.
 *
 * Column mapping (0-indexed, matches COA2 sheet with 21 columns A-U):
 *   A(0):  COA_CODE       B(1):  QR_CODE        C(2):  SIGNER
 *   D(3):  TITLE          E(4):  DATE           F(5):  SIZE
 *   G(6):  CONDITION      H(7):  DESCRIPTION    I(8):  PROVENANCE
 *   J(9):  EDITION        K(10): MEDIUM         L(11): ASSIGNEE
 *   M(12): THIRD_PARTY_AUTH_NOTES                N(13): IMAGE_URL
 *   O(14): NFT_TOKEN_ID   P(15): SHORT_URL      Q(16): BLOCKCHAIN_URL
 *   R(17): NFT_URL        S(18): CERT_URL       T(19): STATUS
 *   U(20): COMPLETION_DATE
 */

const { google } = require('googleapis');

// Column indices for write-back (0-indexed)
const COLUMNS = {
  COA_CODE: 0,                    // A
  QR_CODE: 1,                     // B
  SIGNER: 2,                      // C
  TITLE: 3,                       // D
  DATE: 4,                        // E
  SIZE: 5,                        // F
  CONDITION: 6,                   // G
  DESCRIPTION: 7,                 // H
  PROVENANCE: 8,                  // I (header says "Provience" - misspelled)
  EDITION: 9,                     // J
  MEDIUM: 10,                     // K
  ASSIGNEE: 11,                   // L
  THIRD_PARTY_AUTH_NOTES: 12,     // M
  IMAGE_URL: 13,                  // N
  NFT_TOKEN_ID: 14,               // O
  SHORT_URL: 15,                  // P
  BLOCKCHAIN_URL: 16,             // Q
  NFT_URL: 17,                    // R
  CERT_URL: 18,                   // S
  STATUS: 19,                     // T
  COMPLETION_DATE: 20             // U
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
    range: `${sheetName}!A:U`
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
      date: (row[COLUMNS.DATE] || '').toString().trim(),
      size: (row[COLUMNS.SIZE] || '').toString().trim(),
      condition: (row[COLUMNS.CONDITION] || '').toString().trim(),
      description: (row[COLUMNS.DESCRIPTION] || '').toString().trim(),
      provenance: (row[COLUMNS.PROVENANCE] || '').toString().trim(),
      edition: (row[COLUMNS.EDITION] || '').toString().trim(),
      medium: (row[COLUMNS.MEDIUM] || '').toString().trim(),
      assignee: (row[COLUMNS.ASSIGNEE] || '').toString().trim(),
      thirdPartyAuthNotes: (row[COLUMNS.THIRD_PARTY_AUTH_NOTES] || '').toString().trim(),
      imageUrl,
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
