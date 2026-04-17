/**
 * ============================================================================
 * TRUECOA - SCOREDETECT INTEGRATION SERVICE
 * ============================================================================
 *
 * Integrates with ScoreDetect (scoredetect.com) to create blockchain-verified
 * certificates of authenticity on Polygon.
 *
 * ScoreDetect provides content certification - it hashes certificate content
 * and registers it on the Polygon blockchain, creating an immutable proof
 * of the certificate's existence and content at a specific point in time.
 */

const https = require('https');
const http = require('http');

const SCOREDETECT_API_BASE = 'https://api.scoredetect.com/v1';

/**
 * Create a ScoreDetect certificate for a COA
 *
 * @param {Object} coaData - COA metadata from Google Sheets
 * @param {string} coaData.coaCode - The COA code
 * @param {string} coaData.artist - Artist name
 * @param {string} coaData.title - Artwork title
 * @param {string} [coaData.description] - Description
 * @param {string} [coaData.imageUrl] - Image URL
 * @returns {Promise<Object>} ScoreDetect result with certificateUrl
 */
async function createCertificate(coaData) {
  const apiKey = process.env.SCOREDETECT_API_KEY;

  if (!apiKey) {
    console.log('SCOREDETECT_API_KEY not set, skipping ScoreDetect certification');
    return { skipped: true, reason: 'API key not configured' };
  }

  try {
    // Build certificate content to be hashed and registered
    const certContent = {
      type: 'certificate_of_authenticity',
      version: '1.0',
      issuer: 'TrueCOA',
      coaCode: coaData.coaCode,
      artist: coaData.artist,
      title: coaData.title,
      description: coaData.description || '',
      medium: coaData.medium || '',
      edition: coaData.edition || '',
      condition: coaData.condition || '',
      provenance: coaData.provenance || '',
      imageUrl: coaData.imageUrl || '',
      timestamp: new Date().toISOString(),
      network: 'polygon'
    };

    // Submit to ScoreDetect API
    const response = await fetch(`${SCOREDETECT_API_BASE}/certificates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: JSON.stringify(certContent),
        title: `TrueCOA #${coaData.coaCode} - ${coaData.title}`,
        description: `Certificate of Authenticity for "${coaData.title}" by ${coaData.artist}. Verified by TrueCOA.`,
        metadata: {
          coaCode: coaData.coaCode,
          artist: coaData.artist,
          title: coaData.title
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ScoreDetect API error ${response.status}: ${errText}`);
    }

    const result = await response.json();

    return {
      skipped: false,
      certificateId: result.id || result.certificate_id,
      certificateUrl: result.url || result.certificate_url || result.verification_url,
      transactionHash: result.transaction_hash || result.tx_hash,
      timestamp: result.timestamp || new Date().toISOString()
    };
  } catch (error) {
    console.error(`ScoreDetect error for COA ${coaData.coaCode}:`, error.message);
    return {
      skipped: false,
      error: error.message
    };
  }
}

/**
 * Verify an existing ScoreDetect certificate
 *
 * @param {string} certificateId - The ScoreDetect certificate ID
 * @returns {Promise<Object>} Verification result
 */
async function verifyCertificate(certificateId) {
  const apiKey = process.env.SCOREDETECT_API_KEY;
  if (!apiKey) return { verified: false, reason: 'API key not configured' };

  try {
    const response = await fetch(`${SCOREDETECT_API_BASE}/certificates/${certificateId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      return { verified: false, reason: `API error: ${response.status}` };
    }

    const result = await response.json();
    return {
      verified: true,
      certificateUrl: result.url || result.certificate_url,
      status: result.status
    };
  } catch (error) {
    return { verified: false, reason: error.message };
  }
}

module.exports = { createCertificate, verifyCertificate };
