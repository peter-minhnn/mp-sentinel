/**
 * Skills.sh Integration Demo
 * 
 * This example demonstrates how MP Sentinel integrates with skills.sh
 * to enhance code review prompts based on your technology stack.
 */

import {
  fetchSkillsForTechStack,
  buildSkillsPromptSection,
  clearSkillsCache,
} from '../src/services/skills-fetcher.js';

const DEMO_TECH_STACKS = [
  'TypeScript 5.7, Node.js 18 (ESM), React 18',
  'Python 3.11, FastAPI, SQLAlchemy, PostgreSQL',
  'Go 1.21, Gin, GORM, Redis',
  'Java 17, Spring Boot, Hibernate, MySQL',
];

async function runDemo() {
  console.log('🎯 Skills.sh Integration Demo\n');
  console.log('=' .repeat(60));

  for (const techStack of DEMO_TECH_STACKS) {
    console.log(`\n📦 Tech Stack: ${techStack}`);
    console.log('-'.repeat(60));

    const startTime = performance.now();
    const result = await fetchSkillsForTechStack(techStack, 5000);
    const duration = performance.now() - startTime;

    if (result.success) {
      console.log(`✅ Success! Fetched ${result.skills.length} skills in ${duration.toFixed(0)}ms`);
      
      if (result.skills.length > 0) {
        console.log('\n📝 Skills Prompt Section:');
        const promptSection = buildSkillsPromptSection(result.skills);
        console.log(promptSection);
      }
    } else {
      console.log(`⚠️  Failed: ${result.error}`);
      console.log('   Continuing with default prompts (no retry)');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n🧪 Testing Cache...');
  
  // Test cache by fetching the same techStack again
  const techStack = DEMO_TECH_STACKS[0];
  console.log(`\n📦 Re-fetching: ${techStack}`);
  
  const startTime = performance.now();
  const result = await fetchSkillsForTechStack(techStack, 5000);
  const duration = performance.now() - startTime;
  
  console.log(`✅ Cached result fetched in ${duration.toFixed(0)}ms (should be < 1ms)`);

  console.log('\n🧹 Clearing cache...');
  clearSkillsCache();
  console.log('✅ Cache cleared');

  console.log('\n' + '='.repeat(60));
  console.log('\n✨ Demo Complete!\n');
}

// Run demo
runDemo().catch((error) => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
