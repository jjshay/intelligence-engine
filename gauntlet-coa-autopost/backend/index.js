/**
 * ============================================================================
 * TRUECOA - BACKEND API SERVER
 * ============================================================================
 *
 * Express.js server that provides the API layer for the Certificate of
 * Authenticity verification system. This server acts as the bridge between:
 *
 * 1. Frontend React application
 * 2. Google Sheets (artwork metadata database)
 * 3. Polygon blockchain (NFT verification)
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                         API Server                                   │
 * │                                                                     │
 * │   Frontend ──► /api/verify/:code ──► Google Sheets + Blockchain    │
 * │   Frontend ──► /api/image/:code ──► Google Drive (proxy)           │
 * │   Monitors ──► /health ──► Status check                            │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Deployed: Railway (https://coa.up.railway.app)
 *
 * @author John Shay
 * @version 1.0.0
 */

// ============================================================================
// DEPENDENCIES
// ============================================================================

// Load environment variables from .env file (development only)
require('dotenv').config();

// Express.js - Web framework for Node.js
const express = require('express');

// CORS - Cross-Origin Resource Sharing middleware
// Allows frontend on different domain to access this API
const cors = require('cors');

// Google APIs - Official Google client library
// Used for reading artwork data from Google Sheets
const { google } = require('googleapis');

// Ethers.js v6 - Ethereum library for blockchain interaction
// Used for verifying NFTs on Polygon
const { ethers } = require('ethers');

// Node-cron - Scheduled tasks for polling automation
const cron = require('node-cron');

// Automation services
const automationRoutes = require('./routes/automation');
const { initSheetsWriter } = require('./services/sheetWriter');
const { pollAndProcess } = require('./services/automationPipeline');

// ============================================================================
// APPLICATION SETUP
// ============================================================================

// Initialize Express application
const app = express();

// Enable CORS for all origins
// TODO: In production, restrict to specific domains:
// app.use(cors({ origin: ['https://truecoa.com', 'https://gauntlet-coa-frontend.vercel.app'] }));
app.use(cors());

// Parse JSON request bodies
// Enables req.body for POST/PUT requests with JSON content
app.use(express.json());

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Google Sheet containing artwork data
 * Format: 16Kya2WQD0tbXTdsug9zSuoP03XmWXsZRTIykbEbBJBU (from sheet URL)
 */
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

/**
 * Name of the tab/sheet within the spreadsheet
 * Default: 'COA'
 */
const SHEET_NAME = process.env.SHEET_NAME || 'COA';

/**
 * Deployed smart contract address on Polygon
 * This is the GauntletCOA ERC-721 contract
 */
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xD55496144F8CD69046656ddd5bb894c8b0C2d1b1';

/**
 * Polygon RPC endpoint for blockchain queries
 * Using public Polygon RPC for mainnet
 */
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://1rpc.io/matic';

// ============================================================================
// SMART CONTRACT INTERFACE
// ============================================================================

/**
 * Minimal ABI (Application Binary Interface) for the GauntletCOA contract
 *
 * We only include the read-only functions needed for verification:
 * - isCoaMinted: Check if a COA code has been minted
 * - getTokenIdByCoaCode: Get the token ID for a COA code
 * - getCoaOwner: Get the owner address of a COA
 * - tokenURI: Get the metadata URI for a token
 *
 * Full contract ABI not needed since we don't mint from the backend
 */
const CONTRACT_ABI = [
  "function isCoaMinted(string memory coaCode) public view returns (bool)",
  "function getTokenIdByCoaCode(string memory coaCode) public view returns (uint256)",
  "function getCoaOwner(string memory coaCode) public view returns (address)",
  "function tokenURI(uint256 tokenId) public view returns (string memory)"
];

// ============================================================================
// GOOGLE SHEETS INTEGRATION
// ============================================================================

/**
 * Google Sheets API client instance
 * Initialized once at startup, reused for all requests
 */
let sheets;

/**
 * Initialize Google Sheets API client with service account credentials
 *
 * Authentication uses a Google Cloud service account, which allows
 * server-to-server communication without user interaction.
 *
 * The service account email must be given Viewer access to the spreadsheet.
 *
 * @returns {Promise<void>}
 */
async function initGoogleSheets() {
  // Check if credentials are configured
  if (!process.env.GOOGLE_CREDENTIALS) {
    console.log('Warning: GOOGLE_CREDENTIALS not set, Google Sheets disabled');
    return;
  }

  try {
    let credentialsJson = process.env.GOOGLE_CREDENTIALS;

    // Check if credentials are base64 encoded (doesn't start with {)
    if (!credentialsJson.trim().startsWith('{')) {
      console.log('Decoding base64 credentials');
      credentialsJson = Buffer.from(credentialsJson, 'base64').toString('utf8');
    }

    console.log('Parsing credentials...');
    let credentials = JSON.parse(credentialsJson);
    console.log('Parsed successfully, client_email:', credentials.client_email);

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    // Create Sheets API client
    sheets = google.sheets({ version: 'v4', auth });
    console.log('Google Sheets initialized successfully');
  } catch (err) {
    console.error('Failed to init Google Sheets:', err.message);
    console.error('Full error:', err);
  }
}

/**
 * Retrieve COA data from Google Sheets by COA code
 *
 * Searches the spreadsheet for a row matching the given COA code
 * and returns all columns as a key-value object.
 *
 * Sheet Structure Expected:
 * | coa_code | artist | title | date | length | width | edition | number | history | image_url |
 *
 * @param {string} coaCode - The COA code to search for (e.g., "290745")
 * @returns {Promise<Object|null>} - COA data object or null if not found
 *
 * @example
 * const coa = await getCOAFromSheet("290745");
 * // Returns: { coa_code: "290745", artist: "Shepard Fairey", title: "...", ... }
 */
async function getCOAFromSheet(coaCode) {
  // Check if sheets client is initialized
  if (!sheets) {
    throw new Error('Google Sheets not initialized - check GOOGLE_CREDENTIALS');
  }

  // Fetch all data from the sheet (columns A through K)
  // Range format: SheetName!A:K means columns A-K, all rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:AZ`  // All columns including any new additions
  });

  const rows = response.data.values;

  // Check if sheet has data
  if (!rows || rows.length === 0) return null;

  // First row contains headers - normalize to lowercase with underscores
  // Example: "COA Code" becomes "coa_code"
  // Handle duplicate column names by appending _2, _3, etc.
  const rawHeaders = rows[0].map(h => String(h)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, ''));
  const headerCount = {};
  const headers = rawHeaders.map(h => {
    headerCount[h] = (headerCount[h] || 0) + 1;
    return headerCount[h] > 1 ? `${h}_${headerCount[h]}` : h;
  });
  console.log('Sheet headers (deduplicated):', headers);

  // Find the index of the coa_code column
  const coaCodeIndex = headers.indexOf('coa_code');

  if (coaCodeIndex === -1) {
    throw new Error('COA_Code column not found in spreadsheet');
  }

  // Search for matching row (skip header row, start at index 1)
  for (let i = 1; i < rows.length; i++) {
    // Compare COA codes (case-insensitive comparison done by caller)
    if (rows[i][coaCodeIndex] === coaCode) {
      // Build object from headers and row values
      const coaData = {};
      headers.forEach((header, index) => {
        coaData[header] = rows[i][index] || '';  // Default to empty string if cell is empty
      });
      return coaData;
    }
  }

  // No matching row found
  return null;
}

// ============================================================================
// BLOCKCHAIN VERIFICATION
// ============================================================================

/**
 * Verify NFT status on Polygon blockchain
 *
 * Checks if a COA code has been minted as an NFT and retrieves
 * ownership and metadata information.
 *
 * @param {string} coaCode - The COA code to verify
 * @returns {Promise<Object>} - Verification result object
 *
 * @example
 * // NFT exists:
 * { verified: true, tokenId: "1", owner: "0x...", tokenURI: "ipfs://...", ... }
 *
 * // NFT not minted:
 * { verified: false, reason: "NFT not minted for this COA" }
 */
async function verifyNFT(coaCode) {
  // Check if contract is configured
  if (!CONTRACT_ADDRESS) {
    return { verified: false, reason: 'Contract not deployed yet' };
  }

  try {
    // Create read-only connection to Polygon network
    // JsonRpcProvider is for HTTP-based connections
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

    // Create contract instance with provider (read-only, no signer needed)
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

    // Check if this COA code has been minted
    const isMinted = await contract.isCoaMinted(coaCode);

    if (!isMinted) {
      return { verified: false, reason: 'NFT not minted for this COA' };
    }

    // COA is minted - fetch additional details
    const tokenId = await contract.getTokenIdByCoaCode(coaCode);
    const owner = await contract.getCoaOwner(coaCode);
    let tokenURI = '';
    try {
      tokenURI = await contract.tokenURI(tokenId);
    } catch (e) {
      // tokenURI may not be set - that's OK
      console.log('tokenURI not available for token', tokenId.toString());
    }

    return {
      verified: true,
      tokenId: tokenId.toString(),
      owner,
      tokenURI,
      contractAddress: CONTRACT_ADDRESS,
      network: 'Polygon'
    };
  } catch (error) {
    // Return error as unverified status
    // Common errors: network issues, contract not found, RPC rate limit
    return { verified: false, reason: error.message };
  }
}

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * Health Check Endpoint
 * GET /health
 *
 * Used by:
 * - Railway for deployment health checks
 * - Monitoring systems
 * - Manual verification that server is running
 *
 * @returns {Object} { status: "ok", timestamp: "ISO date string" }
 */
app.get('/health', (req, res) => {
  let clientEmail = null;
  try {
    let raw = process.env.GOOGLE_CREDENTIALS || '{}';
    if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
    const creds = JSON.parse(raw);
    clientEmail = creds.client_email || 'not found';
  } catch (e) {
    clientEmail = 'parse error: ' + e.message;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sheetsReady: !!sheets,
    credentialsSet: !!process.env.GOOGLE_CREDENTIALS,
    clientEmail: clientEmail
  });
});

/**
 * COA Verification Endpoint
 * GET /api/verify/:coaCode
 *
 * Main endpoint for verifying artwork authenticity. Combines data from
 * Google Sheets (metadata) and Polygon blockchain (NFT verification).
 *
 * @param {string} coaCode - URL parameter, the COA code to verify
 *
 * @returns {Object} Combined verification response:
 * {
 *   success: true,
 *   coa: { code, artist, title, date, dimensions, edition, number, history, imageUrl },
 *   blockchain: { verified, tokenId?, owner?, tokenURI?, contractAddress?, network? },
 *   verifiedAt: "ISO timestamp"
 * }
 *
 * @example
 * GET /api/verify/290745
 */
app.get('/api/verify/:coaCode', async (req, res) => {
  try {
    const { coaCode } = req.params;

    // Validate input
    if (!coaCode) {
      return res.status(400).json({ error: 'COA code is required' });
    }

    // Normalize COA code to uppercase for consistent matching
    const normalizedCode = coaCode.toUpperCase();

    // Static fallback metadata for known minted tokens (used when Google Sheets is unavailable)
    const FALLBACK_METADATA = {
      '291046': {
        artist: 'Shepard Fairey', title: 'Lenin Record', date: '2005',
        dimensions: '24" x 18"', edition: '101 of 300', medium: 'Drawing on Heavy Matte Paper',
        condition: 'Very good', sku: '1_Obey_Lenin-Record_P',
        description: 'Felt-tip drawing on heavy paper depicting actor James Dean. Preparatory drawing for the Japanese ads series.',
        provenance: 'Acquired by Executor of Warhol\'s Estate Fredrick Hughes and subsequently sold to the grandfather of the current owner, where upon the passing of said grandfather, the current owner, grandchild inherited the work.'
      },
      '291047': {
        artist: 'Shepard Fairey', title: 'Rose Soldier', date: '2017',
        dimensions: '13" x 10"', edition: '2 of 450', medium: '',
        condition: '', sku: '2_Obey_Rose-Soldier_P',
        description: '', provenance: ''
      },
      '291048': {
        artist: 'Shepard Fairey', title: 'Chinese Soldiers', date: '2006',
        dimensions: '24" x 18"', edition: '3 of 300', medium: '',
        condition: '', sku: '3_Obey_Chinese-Soldiers_P',
        description: '', provenance: ''
      },
      'W1': {
        artist: 'Andy Warhol', title: 'Rebel Without a Cause (James Dean)', date: '1985',
        dimensions: '', edition: 'Unique', medium: 'Felt-tip drawing on heavy matte paper',
        condition: 'Very good', sku: 'W1_Warhol_James-Dean_L',
        description: 'Felt-tip drawing on heavy paper depicting actor James Dean. Preparatory drawing for the Japanese ads series Andy Warhol Rebel Without a Cause (James Dean) from the 1985 Ad Series.',
        provenance: 'Acquired by Executor of Warhol\'s Estate Fredrick Hughes and subsequently sold to the grandfather of the current owner, where upon the passing of said grandfather, the current owner, grandchild inherited the work.'
      }
    };

    // Step 1: Get COA data from Google Sheets (with fallback)
    let coaData = null;
    try {
      coaData = await getCOAFromSheet(normalizedCode);
    } catch (sheetErr) {
      console.error('Google Sheets error, using fallback:', sheetErr.message);
    }

    // Use fallback if Sheets failed or returned nothing
    if (!coaData) {
      const fallback = FALLBACK_METADATA[normalizedCode];
      if (!fallback) {
        return res.status(404).json({ error: 'COA not found', code: coaCode });
      }
      coaData = {
        signer: fallback.artist,
        title: fallback.title,
        date: fallback.date,
        size: fallback.dimensions,
        edition: fallback.edition,
        medium: fallback.medium,
        condition: fallback.condition,
        description: fallback.description,
        providence: fallback.provenance,
        image_url: ''
      };
    }

    // Step 2: Verify on blockchain
    const blockchainStatus = await verifyNFT(normalizedCode);

    // Step 3: Build and return response
    // Map column names to standard fields
    // COA sheet headers (normalized):
    // coa_code, qr_code, signer, title, date, medium, edition, size, condition,
    // description, providence, assignor, assignee, third_party_authentication_notes,
    // sku, image_url, nft_tokenid, short_url, blockchain_url, nft_url, cert_url,
    // status, completion_date
    const artist = coaData.signer || coaData.artist || coaData.Artist || '';
    const title = coaData.title || coaData.Title || 'Untitled';
    const description = coaData.description || coaData.Description || '';
    const provenance = coaData.providence || coaData.provenance || coaData.notes_providence || '';
    const medium = coaData.medium || coaData.Medium || '';
    const condition = coaData.condition || coaData.Condition || '';
    const size = coaData.size || coaData.dimensions || '';
    const edition = coaData.edition || coaData.edition_ || coaData.Edition || '';
    const year = coaData.date || coaData.Date || coaData.year || '';
    const imageUrl = coaData.image_url || coaData.Image_URL || '';
    const sku = coaData.sku || coaData.SKU || '';
    const assignor = coaData.assignor || coaData.authenticator || '';
    const assignee = coaData.assignee || '';
    const authNotes = coaData.third_party_authentication_notes || coaData.auth_notes || '';
    const completionDate = coaData.completion_date || '';
    const qrCodeUrl = coaData.qr_code || '';
    const shortUrl = coaData.short_url || '';
    const blockchainUrl = coaData.blockchain_url || '';
    const nftUrl = coaData.nft_url || '';
    const certUrl = coaData.cert_url || '';
    const authenticator = coaData.authenticator || '';
    const authenticatorNumber = coaData.authenticator_number || coaData.number || '';
    const authenticatorDate = coaData.authenticator_date || '';
    const authenticatorLink = coaData.third_party_coa_link || coaData.authenticator_link || '';

    // Build image URL - prefer Image_URL from sheet
    let nftImage = imageUrl;
    if (!nftImage || nftImage.includes('#REF')) {
      nftImage = '';
    }

    // Build rich description from all available COA fields
    let nftDescription = `Certificate of Authenticity for "${title}" by ${artist}.`;
    if (year) nftDescription += ` Created in ${year}.`;
    if (medium) nftDescription += `\n\nMedium: ${medium}`;
    if (size) nftDescription += `\nSize: ${size}`;
    if (edition) nftDescription += `\nEdition: ${edition}`;
    if (condition) nftDescription += `\nCondition: ${condition}`;
    if (description) nftDescription += `\n\n${description}`;
    if (provenance) nftDescription += `\n\nProvenance: ${provenance}`;
    nftDescription += `\n\nThis certificate is cryptographically secured on the Polygon blockchain and linked to a unique NFT. Verified by TrueCOA.`;

    // Build attributes array with all available fields
    const attributes = [
      { trait_type: "Signer", value: artist || 'Unknown' },
      { trait_type: "Title", value: title },
      { trait_type: "COA Code", value: normalizedCode }
    ];
    if (year) attributes.push({ trait_type: "Year", value: year });
    if (medium) attributes.push({ trait_type: "Medium", value: medium });
    if (size) attributes.push({ trait_type: "Size", value: size });
    if (edition) attributes.push({ trait_type: "Edition", value: edition });
    if (condition) attributes.push({ trait_type: "Condition", value: condition });
    if (assignor) attributes.push({ trait_type: "Assignor", value: assignor });
    attributes.push({ trait_type: "Verified By", value: "TrueCOA" });
    attributes.push({ trait_type: "Blockchain", value: "Polygon" });

    const response = {
      // === ERC-721 Metadata fields (for OpenSea/NFT marketplaces) ===
      name: `TrueCOA - ${title}`,
      description: nftDescription.trim(),
      image: nftImage,
      external_url: `https://truecoa.com/AUTHENTICATE/${normalizedCode}`,
      attributes,
      // === Legacy fields (for frontend app) ===
      success: true,
      coa: {
        code: normalizedCode,
        artist,
        title,
        date: year,
        completionDate,
        size,
        edition,
        medium,
        condition,
        description,
        provenance,
        assignor,
        assignee,
        authNotes,
        authenticator,
        authenticatorNumber,
        authenticatorDate,
        authenticatorLink,
        qrCodeUrl,
        shortUrl,
        blockchainUrl,
        nftUrl,
        certUrl,
        sku,
        imageUrl: imageUrl
      },
      blockchain: blockchainStatus,
      verifiedAt: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    // Log error for debugging (visible in Railway logs)
    console.error('Verification error:', error);

    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Image Proxy Endpoint
 * GET /api/image/:coaCode
 *
 * Retrieves the artwork image URL from the sheet and redirects to it.
 * Handles Google Drive URL conversion for direct image access.
 *
 * Why a proxy?
 * - Google Drive links don't work directly in <img> tags
 * - Abstracts storage location from frontend
 * - Could add caching/CDN in the future
 *
 * @param {string} coaCode - URL parameter, the COA code
 *
 * @returns Redirect (302) to the image URL
 */
app.get('/api/image/:coaCode', async (req, res) => {
  try {
    const { coaCode } = req.params;

    // Get COA data to find image URL
    const coaData = await getCOAFromSheet(coaCode.toUpperCase());

    if (!coaData || !coaData.image_url) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Convert Google Drive sharing link to direct download URL
    // Input formats:
    //   https://drive.google.com/file/d/FILE_ID/view
    //   https://drive.google.com/open?id=FILE_ID
    // Output format:
    //   https://drive.google.com/uc?export=view&id=FILE_ID
    let imageUrl = coaData.image_url;

    if (imageUrl.includes('drive.google.com')) {
      // Extract file ID using regex
      const fileId = imageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1]
        || imageUrl.match(/id=([a-zA-Z0-9_-]+)/)?.[1];

      if (fileId) {
        // Convert to direct view URL
        imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
    }

    // Redirect to the image URL
    // 302 = temporary redirect (allows URL to change in future)
    res.redirect(imageUrl);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

/**
 * NFT Metadata Endpoint (OpenSea Compatible)
 * GET /api/nft/:coaCode
 *
 * Returns NFT metadata in OpenSea-compatible format for wallets and marketplaces.
 *
 * @param {string} coaCode - URL parameter, the COA code
 *
 * @returns {Object} OpenSea-compatible metadata:
 * {
 *   name: "COA #291045 - Title",
 *   description: "Certificate of Authenticity...",
 *   image: "https://...",
 *   external_url: "https://...",
 *   attributes: [...]
 * }
 */
// ============================================================================
// AUTOMATION ROUTES
// ============================================================================

/**
 * Auto-post NFT pipeline routes
 * POST /api/automate/:coaCode  - Webhook from GAS
 * POST /api/automate/poll      - Manual poll trigger
 * GET  /api/automate/status    - Pipeline status
 * POST /api/automate/retry/:coaCode - Retry failed
 */
app.use('/api/automate', automationRoutes);

app.get('/api/nft/:coaCode', async (req, res) => {
  try {
    const { coaCode } = req.params;
    const normalizedCode = coaCode.toUpperCase();

    // Get COA data from Google Sheets
    const coaData = await getCOAFromSheet(normalizedCode);

    if (!coaData) {
      return res.status(404).json({ error: 'COA not found' });
    }

    // Build image URL
    let imageUrl = coaData.image_url || '';
    if (imageUrl.includes('drive.google.com')) {
      const fileId = imageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1]
        || imageUrl.match(/id=([a-zA-Z0-9_-]+)/)?.[1];
      if (fileId) {
        imageUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
    }

    // Build OpenSea-compatible metadata
    const metadata = {
      name: `TrueCOA #${normalizedCode} - ${coaData.title || 'Untitled'}`,
      description: `Certificate of Authenticity for "${coaData.title || 'Untitled'}" by ${coaData.signer || coaData.artist || 'Unknown'}. Verified on Polygon blockchain. ${coaData.description || ''}`.trim(),
      image: imageUrl || `https://coa.up.railway.app/api/image/${normalizedCode}`,
      external_url: `https://truecoa.com/AUTHENTICATE/${normalizedCode}`,
      attributes: [
        { trait_type: "Signer", value: coaData.signer || coaData.artist || 'Unknown' },
        { trait_type: "Title", value: coaData.title || 'Untitled' },
        { trait_type: "Year", value: coaData.date || 'Unknown' },
        { trait_type: "Size", value: coaData.size || '' },
        { trait_type: "COA Code", value: normalizedCode }
      ]
    };

    // Add edition info if available
    if (coaData.edition) {
      metadata.attributes.push({ trait_type: "Edition", value: coaData.edition });
    }

    res.json(metadata);
  } catch (error) {
    console.error('NFT metadata error:', error);
    res.status(500).json({ error: 'Failed to fetch NFT metadata' });
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Server port - defaults to 3001 for local development
 * Railway sets PORT environment variable automatically
 */
const PORT = process.env.PORT || 3001;

/**
 * Initialize services and start the server
 *
 * Startup sequence:
 * 1. Initialize Google Sheets connection
 * 2. Start Express server
 * 3. If Sheets fails, server still starts (graceful degradation)
 */
/**
 * Startup sequence:
 * 1. Initialize Google Sheets (read-only for verification)
 * 2. Initialize Sheets Writer (read/write for automation)
 * 3. Start Express server
 * 4. Start polling cron job for auto-post pipeline
 */
Promise.all([
  initGoogleSheets().catch(err => console.error('Sheets read init warning:', err.message)),
  initSheetsWriter().catch(err => console.error('Sheets write init warning:', err.message))
])
  .then(() => {
    // Start server, binding to 0.0.0.0 for container environments
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`TrueCOA API running on port ${PORT}`);

      // Start auto-post polling every 3 minutes (if PRIVATE_KEY is configured)
      if (process.env.PRIVATE_KEY) {
        const POLL_INTERVAL = process.env.POLL_INTERVAL || '*/3 * * * *'; // every 3 min
        cron.schedule(POLL_INTERVAL, async () => {
          console.log('[cron] Polling for unprocessed COA rows...');
          try {
            const result = await pollAndProcess();
            if (result.processed > 0) {
              console.log(`[cron] Processed ${result.processed} row(s)`);
            }
          } catch (err) {
            console.error('[cron] Poll error:', err.message);
          }
        });
        console.log(`Auto-post polling enabled (${POLL_INTERVAL})`);
      } else {
        console.log('Auto-post polling disabled (PRIVATE_KEY not set)');
      }
    });
  })
  .catch(err => {
    console.error('Warning:', err.message);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`TrueCOA API running on port ${PORT} (degraded mode)`);
    });
  });
