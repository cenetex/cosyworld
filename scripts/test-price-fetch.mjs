#!/usr/bin/env node
/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Test script to verify price fetching from DexScreener
 * Usage: node scripts/test-price-fetch.mjs <token_address>
 */

import { createHelius } from 'helius-sdk';

const RATI_ADDRESS = 'Dt9ciT99NhjGmyVBo7vcNWDG8YStP25P1rq3pump';

/**
 * Get token price from DexScreener API
 */
async function getPriceFromDexScreener(tokenAddress) {
  try {
    console.log(`\n🔍 Fetching price from DexScreener for ${tokenAddress}...`);
    
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!response.ok) {
      console.log(`❌ DexScreener API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data || !data.pairs || data.pairs.length === 0) {
      console.log(`❌ No pairs found on DexScreener`);
      return null;
    }

    console.log(`✅ Found ${data.pairs.length} pairs on DexScreener`);
    
    // Get the most liquid pair
    const bestPair = data.pairs.reduce((best, pair) => {
      const liquidity = pair.liquidity?.usd || 0;
      const bestLiquidity = best?.liquidity?.usd || 0;
      return liquidity > bestLiquidity ? pair : best;
    }, data.pairs[0]);

    if (!bestPair || !bestPair.priceUsd) {
      console.log(`❌ No valid price found`);
      return null;
    }

    console.log(`\n📊 DexScreener Data:`);
    console.log(`   Price: $${bestPair.priceUsd}`);
    console.log(`   Market Cap: $${bestPair.marketCap?.toLocaleString() || 'N/A'}`);
    console.log(`   FDV: $${bestPair.fdv?.toLocaleString() || 'N/A'}`);
    console.log(`   Liquidity: $${bestPair.liquidity?.usd?.toLocaleString() || 'N/A'}`);
    console.log(`   DEX: ${bestPair.dexId}`);
    console.log(`   Pair: ${bestPair.baseToken?.symbol}/${bestPair.quoteToken?.symbol}`);
    
    return {
      usdPrice: parseFloat(bestPair.priceUsd),
      marketCap: bestPair.fdv || bestPair.marketCap,
      liquidity: bestPair.liquidity?.usd,
    };
  } catch (error) {
    console.error(`❌ Failed to fetch from DexScreener:`, error.message);
    return null;
  }
}

/**
 * Get token info from Helius
 */
async function getTokenInfoFromHelius(tokenAddress) {
  try {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      console.log('❌ HELIUS_API_KEY not set');
      return null;
    }

    console.log(`\n🔍 Fetching token info from Helius...`);
    const helius = createHelius({ apiKey: heliusApiKey });
    
    const asset = await helius.getAsset({ id: tokenAddress });
    
    if (!asset) {
      console.log(`❌ No asset data returned from Helius`);
      return null;
    }

    const supply = asset.token_info?.supply;
    const decimals = asset.token_info?.decimals || 9;
    const pricePerToken = asset.token_info?.price_info?.price_per_token;

    console.log(`\n📊 Helius Data:`);
    console.log(`   Name: ${asset.content?.metadata?.name || 'Unknown'}`);
    console.log(`   Symbol: ${asset.content?.metadata?.symbol || 'Unknown'}`);
    console.log(`   Decimals: ${decimals}`);
    console.log(`   Supply: ${supply ? (supply / Math.pow(10, decimals)).toLocaleString() : 'N/A'}`);
    console.log(`   Price: ${pricePerToken ? '$' + pricePerToken : 'N/A'}`);
    
    if (supply && pricePerToken) {
      const marketCap = (supply / Math.pow(10, decimals)) * pricePerToken;
      console.log(`   Market Cap: $${marketCap.toLocaleString()}`);
    }

    return {
      name: asset.content?.metadata?.name || 'Unknown',
      symbol: asset.content?.metadata?.symbol || 'Unknown',
      decimals,
      supply,
      usdPrice: pricePerToken,
    };
  } catch (error) {
    console.error(`❌ Failed to fetch from Helius:`, error.message);
    return null;
  }
}

/**
 * Main test function
 */
async function main() {
  const tokenAddress = process.argv[2] || RATI_ADDRESS;
  
  console.log(`\n🧪 Testing price fetch for token: ${tokenAddress}\n`);
  console.log('='.repeat(60));

  // Try Helius first
  const heliusData = await getTokenInfoFromHelius(tokenAddress);
  
  // Then try DexScreener
  const dexScreenerData = await getPriceFromDexScreener(tokenAddress);
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📝 Summary:');
  console.log(`   Helius has price: ${heliusData?.usdPrice ? '✅ YES' : '❌ NO'}`);
  console.log(`   DexScreener has price: ${dexScreenerData?.usdPrice ? '✅ YES' : '❌ NO'}`);
  
  if (dexScreenerData?.usdPrice && !heliusData?.usdPrice) {
    console.log(`\n💡 DexScreener can be used as fallback for this token!`);
  }
  
  console.log('\n');
}

main().catch(console.error);
