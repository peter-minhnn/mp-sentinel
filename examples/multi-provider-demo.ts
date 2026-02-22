/**
 * Multi-Provider Demo
 * Demonstrates how to use different AI providers with MP Sentinel
 */

import * as dotenv from 'dotenv';
import { AIConfig, AIProviderFactory } from '../src/services/ai/index.js';

// Load environment variables
dotenv.config();


async function demonstrateProviders() {
  console.log('🤖 MP Sentinel Multi-Provider Demo\n');

  // Show current configuration
  try {
    const config = AIConfig.fromEnvironment();
    console.log('✅ Current Configuration:');
    console.log(`   Provider: ${config.provider}`);
    console.log(`   Model: ${config.model}`);
    console.log(`   Temperature: ${config.temperature}`);
    console.log(`   Max Tokens: ${config.maxTokens}\n`);
  } catch (error) {
    console.log('❌ No AI provider configured');
    console.log('   Set AI_PROVIDER and corresponding API key in .env\n');
  }

  // Show available providers and their recommended models
  console.log('📋 Available Providers:\n');

  const providers: Array<'gemini' | 'openai' | 'anthropic' | 'grok'> = ['gemini', 'openai', 'anthropic', 'grok'];
  
  for (const provider of providers) {
    const models = AIProviderFactory.getRecommendedModels(provider);
    const defaultModel = AIProviderFactory.getDefaultModel(provider);
    
    console.log(`${getProviderIcon(provider)} ${provider.toUpperCase()}`);
    console.log(`   Default: ${defaultModel}`);
    console.log(`   Recommended: ${models.join(', ')}`);
    console.log('');
  }

  // Show example configurations
  console.log('💡 Example Configurations:\n');
  
  console.log('# Using Gemini (Default)');
  console.log('AI_PROVIDER=gemini');
  console.log('GEMINI_API_KEY=your_key_here\n');
  
  console.log('# Using OpenAI GPT-5.2 (Best for coding)');
  console.log('AI_PROVIDER=openai');
  console.log('AI_MODEL=gpt-5.2');
  console.log('OPENAI_API_KEY=sk-...\n');
  
  console.log('# Using Claude Sonnet (Best for agents)');
  console.log('AI_PROVIDER=anthropic');
  console.log('AI_MODEL=claude-sonnet-4-6');
  console.log('ANTHROPIC_API_KEY=sk-ant-...\n');
  
  console.log('# Using Grok (Fast reasoning)');
  console.log('AI_PROVIDER=grok');
  console.log('AI_MODEL=grok-4-1-fast-reasoning');
  console.log('GROK_API_KEY=xai-...\n');
}

function getProviderIcon(provider: string): string {
  const icons: Record<string, string> = {
    gemini: '🔷',
    openai: '🟢',
    anthropic: '🟣',
    grok: '❌',
  };
  return icons[provider] || '⚪';
}

// Run demo
demonstrateProviders().catch(console.error);
