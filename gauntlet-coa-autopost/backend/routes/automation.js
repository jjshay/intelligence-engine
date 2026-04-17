/**
 * ============================================================================
 * TRUECOA - AUTOMATION ROUTES
 * ============================================================================
 *
 * Express routes for the auto-post NFT pipeline:
 *   POST /api/automate/:coaCode  - Webhook (triggered by GAS on sheet edit)
 *   POST /api/automate/poll      - Manually trigger polling
 *   GET  /api/automate/status    - Pipeline status & wallet balance
 *   POST /api/automate/retry/:coaCode - Retry a failed row
 */

const express = require('express');
const router = express.Router();
const { processCoaCode, pollAndProcess, processing } = require('../services/automationPipeline');
const { getWalletBalance } = require('../services/nftMinter');
const { getUnprocessedRows } = require('../services/sheetWriter');

/**
 * Webhook authentication middleware
 * Validates the shared secret from Google Apps Script
 */
function authenticateWebhook(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;

  // If no secret configured, allow all requests (dev mode)
  if (!secret) {
    console.log('Warning: WEBHOOK_SECRET not set, webhook auth disabled');
    return next();
  }

  const provided = req.headers['x-webhook-secret'] || req.body?.secret;
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * POST /api/automate/:coaCode
 *
 * Webhook endpoint called by Google Apps Script when a row is edited.
 * Processes a single COA code through the full pipeline.
 */
router.post('/:coaCode', authenticateWebhook, async (req, res) => {
  try {
    const { coaCode } = req.params;

    if (!coaCode) {
      return res.status(400).json({ error: 'COA code is required' });
    }

    console.log(`Webhook received for COA: ${coaCode}`);

    // Process asynchronously - return immediately
    res.json({
      accepted: true,
      coaCode,
      message: 'Processing started. Check /api/automate/status for progress.'
    });

    // Process in background
    processCoaCode(coaCode)
      .then(result => {
        console.log(`Webhook processing complete for ${coaCode}:`, result.success ? 'SUCCESS' : 'FAILED');
      })
      .catch(err => {
        console.error(`Webhook processing error for ${coaCode}:`, err.message);
      });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/automate/poll
 *
 * Manually trigger a poll for unprocessed rows.
 * Useful for testing or when the cron job needs a manual kick.
 */
router.post('/poll', authenticateWebhook, async (req, res) => {
  try {
    console.log('Manual poll triggered');
    const result = await pollAndProcess();
    res.json(result);
  } catch (error) {
    console.error('Poll error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/automate/retry/:coaCode
 *
 * Retry a failed COA code. Clears the error status and re-processes.
 */
router.post('/retry/:coaCode', authenticateWebhook, async (req, res) => {
  try {
    const { coaCode } = req.params;
    console.log(`Retry requested for COA: ${coaCode}`);

    const result = await processCoaCode(coaCode);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/automate/status
 *
 * Returns current pipeline status:
 * - Currently processing COA codes
 * - Unprocessed row count
 * - Wallet MATIC balance
 * - Configuration status
 */
router.get('/status', async (req, res) => {
  try {
    let walletInfo = null;
    try {
      walletInfo = await getWalletBalance();
    } catch (e) {
      walletInfo = { error: e.message };
    }

    let unprocessedCount = 0;
    try {
      const rows = await getUnprocessedRows();
      unprocessedCount = rows.length;
    } catch (e) {
      // Sheets may not be initialized
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      currentlyProcessing: Array.from(processing),
      unprocessedRows: unprocessedCount,
      wallet: walletInfo,
      config: {
        privateKeySet: !!process.env.PRIVATE_KEY,
        webhookSecretSet: !!process.env.WEBHOOK_SECRET,
        scoreDetectKeySet: !!process.env.SCOREDETECT_API_KEY,
        openSeaKeySet: !!process.env.OPENSEA_API_KEY,
        mintRecipientSet: !!process.env.MINT_RECIPIENT,
        contractAddress: process.env.CONTRACT_ADDRESS || '0xD55496144F8CD69046656ddd5bb894c8b0C2d1b1',
        spreadsheetId: process.env.SPREADSHEET_ID ? '***configured***' : 'NOT SET',
        sheetName: process.env.SHEET_NAME || 'COA2'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
