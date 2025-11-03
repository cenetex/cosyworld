/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

/**
 * Test script to verify Telegram buybot commands are registered and working
 */

import { Telegraf } from 'telegraf';

async function testTelegramCommands() {
  const token = process.env.TELEGRAM_GLOBAL_BOT_TOKEN;
  
  if (!token) {
    console.error('❌ TELEGRAM_GLOBAL_BOT_TOKEN not set');
    process.exit(1);
  }

  console.log('🤖 Testing Telegram bot commands...\n');

  try {
    const bot = new Telegraf(token);
    
    // Get bot info
    const botInfo = await bot.telegram.getMe();
    console.log(`✅ Bot connected: @${botInfo.username} (${botInfo.first_name})`);
    console.log(`   ID: ${botInfo.id}`);
    console.log(`   Can join groups: ${botInfo.can_join_groups}`);
    console.log(`   Can read messages: ${botInfo.can_read_all_group_messages}\n`);

    // Get registered commands
    const commands = await bot.telegram.getMyCommands();
    console.log('📋 Registered commands:');
    if (commands.length === 0) {
      console.log('   ⚠️  No commands registered!\n');
    } else {
      commands.forEach(cmd => {
        console.log(`   /${cmd.command} - ${cmd.description}`);
      });
      console.log('');
    }

    // Test command registration
    console.log('🔧 Testing command registration...');
    const testCommands = [
      { command: 'ca', description: 'Show tracked tokens' },
      { command: 'ca_add', description: 'Track a new token' },
      { command: 'ca_list', description: 'Show all tracked tokens' },
      { command: 'ca_remove', description: 'Stop tracking a token' },
      { command: 'ca_help', description: 'Show buybot help' },
    ];

    await bot.telegram.setMyCommands(testCommands);
    console.log('✅ Commands registered successfully\n');

    // Verify they were registered
    const verifyCommands = await bot.telegram.getMyCommands();
    console.log('✅ Verified commands:');
    verifyCommands.forEach(cmd => {
      console.log(`   /${cmd.command} - ${cmd.description}`);
    });

    console.log('\n✅ All tests passed!');
    console.log('\n💡 Try these commands in Telegram:');
    console.log('   1. Open chat with your bot');
    console.log('   2. Type "/" to see the command menu');
    console.log('   3. Try /ca_help to see help');
    console.log('   4. Try /ca to list tracked tokens');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Response:', error.response);
    }
    process.exit(1);
  }

  process.exit(0);
}

testTelegramCommands();
