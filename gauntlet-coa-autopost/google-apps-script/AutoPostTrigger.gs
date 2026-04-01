/**
 * ============================================================================
 * TRUECOA - AUTO-POST NFT TRIGGER
 * ============================================================================
 *
 * Google Apps Script installable trigger that fires when the COA2 sheet
 * is edited. When a row has a COA code and required fields filled in,
 * it calls the backend webhook to start the auto-post NFT pipeline.
 *
 * Setup:
 *   1. Open Google Sheets > Extensions > Apps Script
 *   2. Paste this file
 *   3. Run setupAutoPostTrigger() once to install the trigger
 *   4. Set WEBHOOK_URL and WEBHOOK_SECRET in script properties:
 *      File > Project properties > Script properties
 *
 * Pipeline flow:
 *   Sheet edit → This trigger → Backend webhook → Mint NFT → ScoreDetect →
 *   OpenSea auto-index → Write results back to sheet
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Get configuration from Script Properties
 * Set these in: File > Project settings > Script properties
 */
function getAutoPostConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    WEBHOOK_URL: props.getProperty('WEBHOOK_URL') || 'https://coa.up.railway.app/api/automate',
    WEBHOOK_SECRET: props.getProperty('WEBHOOK_SECRET') || '',
    SHEET_NAME: 'COA2',
    COA_CODE_COL: 0,  // A: COA_Code
    ARTIST_COL: 2,     // C: Artist
    TITLE_COL: 3,      // D: Title
    DONE_COL: 22       // W: Done
  };
}

// ============================================================================
// TRIGGER SETUP
// ============================================================================

/**
 * Install the auto-post trigger.
 * Run this function ONCE from the Apps Script editor.
 *
 * Creates an installable onChange trigger (required for UrlFetchApp access).
 * Simple onEdit triggers cannot make external HTTP calls.
 */
function setupAutoPostTrigger() {
  // Remove existing auto-post triggers to prevent duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onSheetEditAutoPost') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create new installable trigger
  ScriptApp.newTrigger('onSheetEditAutoPost')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  Logger.log('Auto-post trigger installed successfully.');
  SpreadsheetApp.getUi().alert(
    'Auto-Post Trigger Installed',
    'The auto-post NFT trigger is now active.\n\n' +
    'When you fill in a COA row (COA Code + Artist/Title), it will automatically:\n' +
    '1. Mint an NFT on Polygon\n' +
    '2. Create a ScoreDetect certificate\n' +
    '3. Register on OpenSea\n' +
    '4. Write results back to the sheet\n\n' +
    'Make sure WEBHOOK_URL and WEBHOOK_SECRET are set in Script Properties.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Remove the auto-post trigger
 */
function removeAutoPostTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'onSheetEditAutoPost') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(`Removed ${removed} auto-post trigger(s).`);
  SpreadsheetApp.getUi().alert(`Removed ${removed} auto-post trigger(s).`);
}

// ============================================================================
// TRIGGER HANDLER
// ============================================================================

/**
 * Installable onEdit handler - fires when any cell is edited in the sheet.
 *
 * Checks if the edited row in COA2 has:
 *   - A COA code (column A)
 *   - At least artist OR title filled in
 *   - Done column (W) is empty (not yet processed)
 *
 * If all conditions met, calls the backend webhook to start processing.
 *
 * @param {Object} e - Edit event object
 */
function onSheetEditAutoPost(e) {
  try {
    const config = getAutoPostConfig();
    const sheet = e.source.getActiveSheet();

    // Only trigger on the COA2 sheet
    if (sheet.getName() !== config.SHEET_NAME) return;

    // Get the edited range
    const range = e.range;
    const row = range.getRow();

    // Skip header row
    if (row <= 1) return;

    // Get row data
    const rowData = sheet.getRange(row, 1, 1, 24).getValues()[0];

    // Check required fields
    const coaCode = String(rowData[config.COA_CODE_COL] || '').trim();
    const artist = String(rowData[config.ARTIST_COL] || '').trim();
    const title = String(rowData[config.TITLE_COL] || '').trim();
    const done = String(rowData[config.DONE_COL] || '').trim();

    // Skip if no COA code
    if (!coaCode) return;

    // Skip if already processed or processing
    if (done && done !== 'error') return;

    // Require at least artist or title
    if (!artist && !title) return;

    // Call the backend webhook
    Logger.log(`Auto-post triggered for COA: ${coaCode} (Row ${row})`);
    callWebhook(config, coaCode, row);

  } catch (error) {
    Logger.log(`Auto-post trigger error: ${error.message}`);
  }
}

/**
 * Call the backend webhook to start the automation pipeline
 *
 * @param {Object} config - Configuration
 * @param {string} coaCode - COA code to process
 * @param {number} rowNumber - Sheet row number
 */
function callWebhook(config, coaCode, rowNumber) {
  try {
    const url = `${config.WEBHOOK_URL}/${encodeURIComponent(coaCode)}`;

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': config.WEBHOOK_SECRET
      },
      payload: JSON.stringify({
        coaCode: coaCode,
        rowNumber: rowNumber,
        source: 'google-apps-script',
        timestamp: new Date().toISOString()
      }),
      muteHttpExceptions: true,
      // 10 second timeout - webhook returns immediately, processing is async
      followRedirects: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    if (code >= 200 && code < 300) {
      Logger.log(`Webhook OK for ${coaCode}: ${body}`);
    } else {
      Logger.log(`Webhook error for ${coaCode} (${code}): ${body}`);
    }
  } catch (error) {
    Logger.log(`Webhook call failed for ${coaCode}: ${error.message}`);
  }
}

// ============================================================================
// MENU INTEGRATION
// ============================================================================

/**
 * Add auto-post options to the existing TrueCOA menu
 * Call this from onOpen() or add to the existing menu setup
 */
function addAutoPostMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Auto-Post NFT')
    .addItem('Setup Auto-Post Trigger', 'setupAutoPostTrigger')
    .addItem('Remove Auto-Post Trigger', 'removeAutoPostTrigger')
    .addSeparator()
    .addItem('Process All Unprocessed Rows', 'triggerPollAll')
    .addItem('Process Selected Row', 'triggerProcessSelected')
    .addSeparator()
    .addItem('Check Pipeline Status', 'checkPipelineStatus')
    .addToUi();
}

/**
 * Trigger polling for all unprocessed rows
 */
function triggerPollAll() {
  const config = getAutoPostConfig();
  try {
    const response = UrlFetchApp.fetch(`${config.WEBHOOK_URL}/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': config.WEBHOOK_SECRET
      },
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    SpreadsheetApp.getUi().alert(
      'Poll Result',
      `Processed: ${result.processed || 0} row(s)\n${result.message || ''}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

/**
 * Process the currently selected row
 */
function triggerProcessSelected() {
  const config = getAutoPostConfig();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.SHEET_NAME);
  const row = sheet.getActiveRange().getRow();

  if (row <= 1) {
    SpreadsheetApp.getUi().alert('Please select a data row (not the header).');
    return;
  }

  const coaCode = String(sheet.getRange(row, 1).getValue()).trim();
  if (!coaCode) {
    SpreadsheetApp.getUi().alert('Selected row has no COA code.');
    return;
  }

  callWebhook(config, coaCode, row);
  SpreadsheetApp.getUi().alert(`Processing started for COA: ${coaCode}\nCheck column W for status.`);
}

/**
 * Check the backend pipeline status
 */
function checkPipelineStatus() {
  const config = getAutoPostConfig();
  try {
    const response = UrlFetchApp.fetch(`${config.WEBHOOK_URL}/status`, {
      muteHttpExceptions: true
    });

    const status = JSON.parse(response.getContentText());
    const walletBalance = status.wallet?.balanceMatic?.toFixed(4) || 'unknown';

    SpreadsheetApp.getUi().alert(
      'Pipeline Status',
      `Status: ${status.status}\n` +
      `Unprocessed rows: ${status.unprocessedRows}\n` +
      `Currently processing: ${status.currentlyProcessing?.length || 0}\n` +
      `Wallet balance: ${walletBalance} MATIC\n\n` +
      `Config:\n` +
      `  Private key: ${status.config?.privateKeySet ? 'SET' : 'NOT SET'}\n` +
      `  ScoreDetect key: ${status.config?.scoreDetectKeySet ? 'SET' : 'NOT SET'}\n` +
      `  OpenSea key: ${status.config?.openSeaKeySet ? 'SET' : 'NOT SET'}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}
