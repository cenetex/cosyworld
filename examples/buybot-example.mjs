/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Buybot Service Usage Examples
 * 
 * This file demonstrates how to use the BuybotService programmatically.
 * In production, users interact via Discord commands, but this shows the API.
 */

import { createHelius } from 'helius-sdk';

// Example: Initialize Helius SDK
async function initializeHelius() {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error('HELIUS_API_KEY not configured');
    return null;
  }

  const helius = createHelius({ apiKey });
  console.log('✓ Helius SDK initialized');
  return helius;
}

// Example: Get token information
async function getTokenExample() {
  const helius = await initializeHelius();
  if (!helius) return;

  // USDC token address
  const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  try {
    const asset = await helius.getAsset({ id: tokenAddress });
    
    console.log('\n📊 Token Information:');
    console.log('Name:', asset.content?.metadata?.name);
    console.log('Symbol:', asset.content?.metadata?.symbol);
    console.log('Decimals:', asset.token_info?.decimals);
    console.log('Supply:', asset.token_info?.supply);
    console.log('Image:', asset.content?.links?.image);
  } catch (error) {
    console.error('Error fetching token:', error);
  }
}

// Example: Get recent transactions for a token
async function getTransactionsExample() {
  const helius = await initializeHelius();
  if (!helius) return;

  // USDC token address
  const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  try {
    const transactions = await helius.getTransactionsByAddress({
      address: tokenAddress,
      limit: 5,
    });

    console.log('\n💰 Recent Transactions:');
    
    for (const tx of transactions) {
      console.log('\n---');
      console.log('Signature:', tx.signature);
      console.log('Type:', tx.type);
      console.log('Description:', tx.description);
      console.log('Timestamp:', new Date(tx.timestamp * 1000).toLocaleString());
      
      if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        const transfer = tx.tokenTransfers.find(t => t.mint === tokenAddress);
        if (transfer) {
          console.log('Amount:', transfer.tokenAmount);
          console.log('From:', transfer.fromUserAccount?.slice(0, 8) + '...');
          console.log('To:', transfer.toUserAccount?.slice(0, 8) + '...');
        }
      }
    }
  } catch (error) {
    console.error('Error fetching transactions:', error);
  }
}

// Example: Parse transaction for swaps vs transfers
function parseTransactionType(tx) {
  const isSwap = tx.type === 'SWAP' || 
                 tx.description?.toLowerCase().includes('swap') ||
                 tx.description?.toLowerCase().includes('trade');
  
  return {
    type: isSwap ? 'swap' : 'transfer',
    emoji: isSwap ? '💰' : '📤',
    color: isSwap ? 'green' : 'blue',
    title: isSwap ? 'Token Purchase' : 'Token Transfer'
  };
}

// Example: Format token amounts
function formatTokenAmount(amount, decimals = 9) {
  const num = parseFloat(amount) / Math.pow(10, decimals);
  return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

// Example: Format addresses for display
function formatAddress(address) {
  if (!address || address.length < 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

// Example: Check if token is tradeable
async function checkTokenTradeability() {
  const helius = await initializeHelius();
  if (!helius) return;

  const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  try {
    const asset = await helius.getAsset({ id: tokenAddress });
    
    console.log('\n🔍 Token Tradeability Check:');
    console.log('Token:', asset.content?.metadata?.name);
    console.log('Fungible:', asset.interface === 'FungibleToken' || asset.interface === 'FungibleAsset');
    console.log('Supply:', asset.token_info?.supply);
    console.log('Decimals:', asset.token_info?.decimals);
    
    // Tokens with supply and proper decimals are typically tradeable
    const isTradeable = asset.token_info?.supply && asset.token_info?.decimals !== undefined;
    console.log('Tradeable:', isTradeable ? '✓ Yes' : '✗ No');
  } catch (error) {
    console.error('Error checking token:', error);
  }
}

// Example usage patterns for Discord integration
const discordUsageExamples = {
  // Adding a token to track
  addToken: {
    command: '/ca EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    description: 'Track USDC transfers and purchases in this channel',
    expectedResponse: {
      success: true,
      message: 'Now tracking **USD Coin** (USDC)',
      tokenInfo: {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6
      }
    }
  },

  // Viewing tracked tokens
  viewTokens: {
    command: '/ca',
    description: 'Show all tracked tokens in the channel',
    expectedResponse: {
      embed: {
        title: '📊 Tracked Tokens',
        fields: [
          {
            name: 'USDC - USD Coin',
            value: 'Address: `EPjFW...Dt1v`\nAdded: 2 hours ago\nLast Event: 5 minutes ago'
          }
        ]
      }
    }
  },

  // Removing a token
  removeToken: {
    command: '/ca-remove EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    description: 'Stop tracking USDC in this channel',
    expectedResponse: {
      success: true,
      message: 'Stopped tracking **USD Coin** (USDC)'
    }
  },

  // Event notification
  eventNotification: {
    trigger: 'Token transaction detected by polling',
    embed: {
      title: '💰 USDC Purchase',
      description: 'Swapped tokens',
      fields: [
        { name: 'Amount', value: '1,234.5678 USDC' },
        { name: 'From', value: '7Xg2...3mK9' },
        { name: 'To', value: '8Bh4...5nL2' }
      ],
      button: { label: 'View Transaction', url: 'https://solscan.io/tx/...' }
    }
  }
};

// Popular Solana tokens for testing
const popularTokens = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  SOL: 'So11111111111111111111111111111111111111112',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  MNGO: 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac'
};

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 Buybot Service Examples\n');
  
  // Run all examples
  await getTokenExample();
  await getTransactionsExample();
  await checkTokenTradeability();
  
  console.log('\n📝 Discord Usage Examples:');
  console.log(JSON.stringify(discordUsageExamples, null, 2));
  
  console.log('\n🪙 Popular Tokens:');
  console.log(JSON.stringify(popularTokens, null, 2));
}

export {
  initializeHelius,
  getTokenExample,
  getTransactionsExample,
  parseTransactionType,
  formatTokenAmount,
  formatAddress,
  checkTokenTradeability,
  discordUsageExamples,
  popularTokens
};
