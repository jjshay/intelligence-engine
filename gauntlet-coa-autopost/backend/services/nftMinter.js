/**
 * ============================================================================
 * TRUECOA - NFT MINTING SERVICE
 * ============================================================================
 *
 * Mints COA NFTs on Polygon blockchain using the deployed GauntletCOA contract.
 * Adapted from scripts/mint.js for use as a backend service.
 *
 * Contract: 0xD55496144F8CD69046656ddd5bb894c8b0C2d1b1 (Polygon Mainnet)
 */

const { ethers } = require('ethers');

// Contract ABI - includes write functions for minting
const CONTRACT_ABI = [
  "function mintCOA(address to, string memory coaCode, string memory uri) public returns (uint256)",
  "function batchMintCOA(address to, string[] memory coaCodes, string[] memory uris) public",
  "function isCoaMinted(string memory coaCode) public view returns (bool)",
  "function getTokenIdByCoaCode(string memory coaCode) public view returns (uint256)",
  "function getCoaOwner(string memory coaCode) public view returns (address)",
  "function tokenURI(uint256 tokenId) public view returns (string memory)",
  "event COAMinted(uint256 indexed tokenId, string coaCode, address indexed owner)"
];

// Mutex for sequential minting (prevents nonce collisions)
let mintLock = false;
const mintQueue = [];

/**
 * Process the mint queue one at a time
 */
async function processMintQueue() {
  if (mintLock || mintQueue.length === 0) return;
  mintLock = true;

  const { coaCode, recipientAddress, resolve, reject } = mintQueue.shift();

  try {
    const result = await _executeMint(coaCode, recipientAddress);
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    mintLock = false;
    if (mintQueue.length > 0) {
      processMintQueue();
    }
  }
}

/**
 * Execute a single NFT mint on Polygon
 */
async function _executeMint(coaCode, recipientAddress) {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable not set');
  }

  const contractAddress = process.env.CONTRACT_ADDRESS || '0xD55496144F8CD69046656ddd5bb894c8b0C2d1b1';
  const rpcUrl = process.env.POLYGON_RPC || 'https://1rpc.io/matic';
  const recipient = recipientAddress || process.env.MINT_RECIPIENT;

  if (!recipient) {
    throw new Error('No recipient address provided and MINT_RECIPIENT not set');
  }

  // Connect to Polygon with a signer (wallet)
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, wallet);

  // Check MATIC balance
  const balance = await provider.getBalance(wallet.address);
  const balanceMatic = parseFloat(ethers.formatEther(balance));
  if (balanceMatic < 0.01) {
    throw new Error(`Low MATIC balance: ${balanceMatic.toFixed(4)} MATIC. Need at least 0.01 to mint.`);
  }

  // Check if already minted (idempotency)
  const isMinted = await contract.isCoaMinted(coaCode);
  if (isMinted) {
    const tokenId = await contract.getTokenIdByCoaCode(coaCode);
    const owner = await contract.getCoaOwner(coaCode);
    console.log(`COA ${coaCode} already minted as token #${tokenId}`);
    return {
      alreadyMinted: true,
      tokenId: tokenId.toString(),
      owner,
      contractAddress,
      polygonscanUrl: `https://polygonscan.com/token/${contractAddress}?a=${tokenId}`,
      openSeaUrl: `https://opensea.io/assets/matic/${contractAddress}/${tokenId}`
    };
  }

  // Build metadata URI pointing to the backend API
  const metadataUri = `https://coa.up.railway.app/api/nft/${coaCode}`;

  console.log(`Minting COA ${coaCode} to ${recipient}...`);

  // Send mint transaction
  const tx = await contract.mintCOA(recipient, coaCode, metadataUri);
  console.log(`Mint tx sent: ${tx.hash}`);

  // Wait for confirmation
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Get the token ID
  const tokenId = await contract.getTokenIdByCoaCode(coaCode);

  const result = {
    alreadyMinted: false,
    tokenId: tokenId.toString(),
    owner: recipient,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    contractAddress,
    polygonscanUrl: `https://polygonscan.com/token/${contractAddress}?a=${tokenId}`,
    openSeaUrl: `https://opensea.io/assets/matic/${contractAddress}/${tokenId}`,
    metadataUri
  };

  console.log(`Minted COA ${coaCode} -> Token #${tokenId}`);
  return result;
}

/**
 * Mint a COA NFT (queued to prevent nonce collisions)
 *
 * @param {string} coaCode - The COA code to mint
 * @param {string} [recipientAddress] - Wallet to receive the NFT (defaults to MINT_RECIPIENT)
 * @returns {Promise<Object>} Mint result with tokenId, txHash, URLs
 */
function mintCOA(coaCode, recipientAddress) {
  return new Promise((resolve, reject) => {
    mintQueue.push({ coaCode, recipientAddress, resolve, reject });
    processMintQueue();
  });
}

/**
 * Check if a COA code has been minted
 */
async function isCoaMinted(coaCode) {
  const contractAddress = process.env.CONTRACT_ADDRESS || '0xD55496144F8CD69046656ddd5bb894c8b0C2d1b1';
  const rpcUrl = process.env.POLYGON_RPC || 'https://1rpc.io/matic';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);
  return contract.isCoaMinted(coaCode);
}

/**
 * Get wallet MATIC balance
 */
async function getWalletBalance() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) return null;

  const rpcUrl = process.env.POLYGON_RPC || 'https://1rpc.io/matic';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);
  return {
    address: wallet.address,
    balanceMatic: parseFloat(ethers.formatEther(balance)),
    balanceWei: balance.toString()
  };
}

module.exports = { mintCOA, isCoaMinted, getWalletBalance };
