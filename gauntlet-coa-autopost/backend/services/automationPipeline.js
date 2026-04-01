/**
 * ============================================================================
 * TRUECOA - AUTOMATION PIPELINE
 * ============================================================================
 *
 * Orchestrates the full auto-post NFT pipeline:
 *   1. Validate row data
 *   2. Mint NFT on Polygon
 *   3. Create ScoreDetect certificate
 *   4. Force OpenSea metadata refresh
 *   5. Write results back to Google Sheet
 *
 * Triggered by:
 *   - Google Apps Script webhook (near-instant on sheet edit)
 *   - Backend polling (fallback, every 3 minutes)
 *   - Manual API call (/api/automate/:coaCode)
 */

const { mintCOA } = require('./nftMinter');
const { createCertificate } = require('./scoreDetect');
const { writeResults, setRowStatus, getUnprocessedRows } = require('./sheetWriter');

// Track in-flight processing to prevent duplicates
const processing = new Set();

/**
 * Process a single COA row through the full automation pipeline
 *
 * @param {Object} rowData - Row data from getUnprocessedRows()
 * @param {number} rowData.rowNumber - Sheet row number
 * @param {string} rowData.coaCode - COA code
 * @param {string} rowData.signer - Signer name
 * @param {string} rowData.title - Title
 * @returns {Promise<Object>} Pipeline result
 */
async function processRow(rowData) {
  const { rowNumber, coaCode, signer, title } = rowData;

  // Prevent duplicate processing
  if (processing.has(coaCode)) {
    console.log(`COA ${coaCode} already being processed, skipping`);
    return { skipped: true, reason: 'already processing' };
  }

  processing.add(coaCode);
  const results = { coaCode, rowNumber, steps: {} };

  try {
    // Mark row as processing
    await setRowStatus(rowNumber, 'processing');
    console.log(`\n========== Processing COA ${coaCode} (Row ${rowNumber}) ==========`);

    // --- Step 1: Validate ---
    if (!coaCode || (!signer && !title)) {
      throw new Error('Missing required fields: coaCode and (signer or title)');
    }
    results.steps.validate = { success: true };
    console.log(`[1/4] Validated: "${title}" by ${signer}`);

    // --- Step 2: Mint NFT on Polygon ---
    try {
      const mintResult = await mintCOA(coaCode);
      results.steps.mint = { success: true, ...mintResult };
      results.tokenId = mintResult.tokenId;
      results.polygonscanUrl = mintResult.polygonscanUrl;
      results.openSeaUrl = mintResult.openSeaUrl;

      if (mintResult.alreadyMinted) {
        console.log(`[2/4] NFT already minted: Token #${mintResult.tokenId}`);
      } else {
        console.log(`[2/4] NFT minted: Token #${mintResult.tokenId} (tx: ${mintResult.txHash})`);
      }
    } catch (mintErr) {
      console.error(`[2/4] Mint failed: ${mintErr.message}`);
      results.steps.mint = { success: false, error: mintErr.message };
      // Continue - minting failure shouldn't block ScoreDetect
    }

    // --- Step 3: ScoreDetect Certificate ---
    try {
      const certResult = await createCertificate({
        coaCode,
        signer,
        title,
        description: rowData.description,
        medium: rowData.medium,
        edition: rowData.edition,
        condition: rowData.condition,
        provenance: rowData.provenance,
        imageUrl: rowData.imageUrl
      });
      results.steps.scoreDetect = certResult;

      if (certResult.skipped) {
        console.log(`[3/4] ScoreDetect skipped: ${certResult.reason}`);
      } else if (certResult.error) {
        console.log(`[3/4] ScoreDetect error: ${certResult.error}`);
      } else {
        results.certificateUrl = certResult.certificateUrl;
        console.log(`[3/4] ScoreDetect certificate: ${certResult.certificateUrl}`);
      }
    } catch (certErr) {
      console.error(`[3/4] ScoreDetect failed: ${certErr.message}`);
      results.steps.scoreDetect = { success: false, error: certErr.message };
    }

    // --- Step 4: Force OpenSea metadata refresh ---
    try {
      if (results.tokenId) {
        const refreshResult = await refreshOpenSeaMetadata(
          process.env.CONTRACT_ADDRESS || '0xD55496144F8CD69046656ddd5bb894c8b0C2d1b1',
          results.tokenId
        );
        results.steps.openSea = refreshResult;
        console.log(`[4/4] OpenSea refresh: ${refreshResult.success ? 'done' : refreshResult.reason || 'skipped'}`);
      } else {
        results.steps.openSea = { skipped: true, reason: 'No token ID (mint failed)' };
        console.log('[4/4] OpenSea refresh skipped (no token)');
      }
    } catch (osErr) {
      console.error(`[4/4] OpenSea refresh failed: ${osErr.message}`);
      results.steps.openSea = { success: false, error: osErr.message };
    }

    // --- Write results back to sheet ---
    const writeData = {
      tokenId: results.tokenId,
      polygonscanUrl: results.polygonscanUrl,
      openSeaUrl: results.openSeaUrl,
      certificateUrl: results.certificateUrl,
      shortUrl: rowData.shortUrl, // preserve existing
      status: new Date().toISOString()
    };

    await writeResults(rowNumber, writeData);
    results.success = true;
    console.log(`========== COA ${coaCode} complete ==========\n`);

  } catch (error) {
    console.error(`Pipeline error for COA ${coaCode}:`, error.message);
    results.success = false;
    results.error = error.message;

    // Write error status to sheet
    try {
      await setRowStatus(rowNumber, `error: ${error.message}`);
    } catch (writeErr) {
      console.error('Failed to write error status:', writeErr.message);
    }
  } finally {
    processing.delete(coaCode);
  }

  return results;
}

/**
 * Force OpenSea to refresh NFT metadata
 */
async function refreshOpenSeaMetadata(contractAddress, tokenId) {
  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) {
    return { success: false, reason: 'OPENSEA_API_KEY not set' };
  }

  try {
    const url = `https://api.opensea.io/api/v2/chain/matic/contract/${contractAddress}/nfts/${tokenId}/refresh`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey }
    });

    return { success: response.ok, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Poll for unprocessed rows and process them
 * Called by the cron job / setInterval
 */
async function pollAndProcess() {
  try {
    const unprocessed = await getUnprocessedRows();

    if (unprocessed.length === 0) {
      return { processed: 0, message: 'No unprocessed rows' };
    }

    console.log(`Found ${unprocessed.length} unprocessed row(s)`);

    const results = [];
    for (const row of unprocessed) {
      const result = await processRow(row);
      results.push(result);
    }

    return {
      processed: results.length,
      results
    };
  } catch (error) {
    console.error('Poll error:', error.message);
    return { processed: 0, error: error.message };
  }
}

/**
 * Process a single COA code (for webhook/manual trigger)
 * Looks up the row in the sheet first
 */
async function processCoaCode(coaCode) {
  const unprocessed = await getUnprocessedRows();
  const row = unprocessed.find(r => r.coaCode.toUpperCase() === coaCode.toUpperCase());

  if (!row) {
    // Check all rows (including processed) for retry
    throw new Error(`COA code ${coaCode} not found or already processed`);
  }

  return processRow(row);
}

module.exports = { processRow, pollAndProcess, processCoaCode, processing };
