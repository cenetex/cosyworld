#!/usr/bin/env node
/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 *
 * Script to check the status of the generated_images collection
 * and provide statistics on image reuse potential
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function checkGeneratedImages() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cosyworld';
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const col = db.collection('generated_images');
    
    // Get basic stats
    const totalImages = await col.countDocuments({});
    console.log(`\n📊 Generated Images Statistics`);
    console.log(`${'='.repeat(40)}`);
    console.log(`Total images indexed: ${totalImages}`);
    
    if (totalImages === 0) {
      console.log('\n⚠️  No images indexed yet. New images will be saved automatically.');
      console.log('   Run your application to start building the image cache.\n');
      return;
    }
    
    // Usage stats
    const usageStats = await col.aggregate([
      { 
        $group: { 
          _id: null, 
          totalReuses: { $sum: '$usageCount' },
          avgReuses: { $avg: '$usageCount' },
          maxReuses: { $max: '$usageCount' }
        } 
      }
    ]).toArray();
    
    if (usageStats.length > 0) {
      const stats = usageStats[0];
      console.log(`Total reuses (cost savings): ${stats.totalReuses || 0}`);
      console.log(`Average reuses per image: ${(stats.avgReuses || 0).toFixed(2)}`);
      console.log(`Most reused image: ${stats.maxReuses || 0} times`);
    }
    
    // By category
    console.log(`\n📁 Images by Category`);
    console.log(`${'─'.repeat(30)}`);
    const byCategory = await col.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    for (const cat of byCategory) {
      console.log(`  ${cat._id || 'unknown'}: ${cat.count}`);
    }
    
    // By purpose
    console.log(`\n🎯 Images by Purpose`);
    console.log(`${'─'.repeat(30)}`);
    const byPurpose = await col.aggregate([
      { $group: { _id: '$purpose', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    for (const p of byPurpose) {
      console.log(`  ${p._id || 'unknown'}: ${p.count}`);
    }
    
    // Dungeon-specific stats
    const dungeonImages = await col.countDocuments({ category: 'dungeon' });
    if (dungeonImages > 0) {
      console.log(`\n🏰 Dungeon Image Cache`);
      console.log(`${'─'.repeat(30)}`);
      console.log(`Total dungeon images: ${dungeonImages}`);
      
      const byTheme = await col.aggregate([
        { $match: { category: 'dungeon' } },
        { $group: { _id: '$metadata.theme', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      
      if (byTheme.length > 0) {
        console.log(`\nBy theme:`);
        for (const t of byTheme) {
          console.log(`  ${t._id || 'unknown'}: ${t.count}`);
        }
      }
      
      const byRoomType = await col.aggregate([
        { $match: { category: 'dungeon' } },
        { $group: { _id: '$metadata.roomType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      
      if (byRoomType.length > 0) {
        console.log(`\nBy room type:`);
        for (const r of byRoomType) {
          console.log(`  ${r._id || 'unknown'}: ${r.count}`);
        }
      }
    }
    
    // Recent images
    console.log(`\n🕐 Recent Images (last 5)`);
    console.log(`${'─'.repeat(30)}`);
    const recent = await col.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .project({ prompt: 1, purpose: 1, category: 1, usageCount: 1, createdAt: 1 })
      .toArray();
    
    for (const img of recent) {
      const promptPreview = (img.prompt || '').slice(0, 50) + (img.prompt?.length > 50 ? '...' : '');
      const date = img.createdAt ? new Date(img.createdAt).toLocaleString() : 'unknown';
      console.log(`  [${img.category}/${img.purpose}] "${promptPreview}"`);
      console.log(`    Created: ${date}, Reuses: ${img.usageCount || 0}`);
    }
    
    // Cost savings estimate
    const estimatedCostPerImage = 0.01; // $0.01 per image generation
    const savings = (usageStats[0]?.totalReuses || 0) * estimatedCostPerImage;
    console.log(`\n💰 Estimated Cost Savings`);
    console.log(`${'─'.repeat(30)}`);
    console.log(`Reused images: ${usageStats[0]?.totalReuses || 0}`);
    console.log(`Estimated savings: $${savings.toFixed(2)} (at $${estimatedCostPerImage}/image)`);
    
    console.log('');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

checkGeneratedImages().catch(console.error);
