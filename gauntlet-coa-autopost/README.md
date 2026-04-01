# TrueCOA Auto-Post NFT Pipeline

Auto-mint NFTs, create ScoreDetect certificates, and list on OpenSea when a new COA row is filled in Google Sheets.

## Flow

```
Google Sheet edit → GAS trigger → Backend webhook → Mint NFT on Polygon →
ScoreDetect certificate → OpenSea auto-indexes → Results written back to sheet
```

## New Files

| File | Purpose |
|------|---------|
| `backend/services/nftMinter.js` | Mint NFTs on Polygon via ethers.js (queued, nonce-safe) |
| `backend/services/scoreDetect.js` | ScoreDetect blockchain certification API |
| `backend/services/sheetWriter.js` | Write results back to Google Sheets (read/write scope) |
| `backend/services/automationPipeline.js` | Orchestrates the full pipeline per row |
| `backend/routes/automation.js` | Express routes: webhook, poll, retry, status |
| `google-apps-script/AutoPostTrigger.gs` | GAS installable trigger + menu for auto-post |

## Modified Files

| File | Changes |
|------|---------|
| `backend/index.js` | Added automation routes, sheets writer init, cron polling |
| `backend/package.json` | Added `node-cron` dependency |
| `backend/.env.example` | Added auto-post environment variables |

## Setup

### 1. Railway Environment Variables

Add to your Railway backend deployment:

```env
PRIVATE_KEY=your_polygon_wallet_private_key
MINT_RECIPIENT=0xYourGalleryWalletAddress
WEBHOOK_SECRET=your-random-secret-string
SCOREDETECT_API_KEY=your-scoredetect-key
OPENSEA_API_KEY=your-opensea-key          # optional
POLL_INTERVAL=*/3 * * * *                 # optional, default 3 min
```

### 2. Google Sheets Scope

The service account now needs **read/write** access to the spreadsheet (not just Viewer).
Share the sheet with the service account email as **Editor**.

### 3. Google Apps Script

1. Open your COA2 Google Sheet
2. Extensions > Apps Script
3. Create a new file: `AutoPostTrigger.gs`
4. Paste contents of `google-apps-script/AutoPostTrigger.gs`
5. Set Script Properties (File > Project settings > Script properties):
   - `WEBHOOK_URL` = `https://coa.up.railway.app/api/automate`
   - `WEBHOOK_SECRET` = (same secret as Railway)
6. Run `setupAutoPostTrigger()` once from the editor

### 4. Deploy Backend

```bash
cd backend
npm install
# Push to Railway (auto-deploys on git push)
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/automate/:coaCode` | POST | Webhook - process single COA |
| `/api/automate/poll` | POST | Manually trigger poll for all unprocessed rows |
| `/api/automate/retry/:coaCode` | POST | Retry a failed COA |
| `/api/automate/status` | GET | Pipeline status, wallet balance, config check |

## How It Works

1. **You edit a row** in the COA2 sheet (add artist, title, etc.)
2. **GAS trigger fires** → calls backend webhook with the COA code
3. **Backend processes**:
   - Validates required fields
   - Mints NFT on Polygon (queued to prevent nonce collisions)
   - Creates ScoreDetect blockchain certificate
   - Triggers OpenSea metadata refresh
   - Writes token ID, URLs, and timestamp back to the sheet
4. **Polling fallback** runs every 3 minutes to catch anything the trigger missed

## Sheet Column Mapping (COA2, 21 columns A-U)

| Column | Index | Field | Description |
|--------|-------|-------|-------------|
| A | 0 | COA_CODE | COA identifier |
| B | 1 | QR_CODE | QR code image URL (output) |
| C | 2 | SIGNER | Artist / signer name |
| D | 3 | TITLE | Artwork title |
| E | 4 | DATE | Date of artwork |
| F | 5 | SIZE | Dimensions |
| G | 6 | CONDITION | Condition of artwork |
| H | 7 | DESCRIPTION | Description |
| I | 8 | PROVENANCE | Provenance (header: "Provience") |
| J | 9 | EDITION | Edition info |
| K | 10 | MEDIUM | Medium |
| L | 11 | ASSIGNEE | Assignee |
| M | 12 | THIRD_PARTY_AUTH_NOTES | Third party auth notes |
| N | 13 | IMAGE_URL | Image URL |
| O | 14 | NFT_TOKEN_ID | NFT token ID (output) |
| P | 15 | SHORT_URL | Bit.ly short URL (output) |
| Q | 16 | BLOCKCHAIN_URL | Polygonscan URL (output) |
| R | 17 | NFT_URL | OpenSea URL (output) |
| S | 18 | CERT_URL | ScoreDetect certificate URL (output) |
| T | 19 | STATUS | Status / Done timestamp (output) |
| U | 20 | COMPLETION_DATE | Completion timestamp (output) |
