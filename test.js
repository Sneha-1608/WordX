import { rateLimiter } from './server/middleware.js';
import * as llmOrchestrator from './server/llm-orchestrator.js';

async function test() {
  try {
    console.log('Testing translation batch...');
    
    const mockSegments = Array.from({length: 20}).map((_, i) => ({
      id: "uuid-" + i,
      index: i,
      sourceText: `Hello world, this is a test segment ${i} to test concurrency and rate limits.`,
      targetText: null,
      matchType: "NEW",
      tmScore: 0
    }));

    await llmOrchestrator.translateBatch({
      projectId: -1, // Mock project
      segments: mockSegments,
      sourceLang: 'en',
      targetLang: 'hi_IN'
    });
    console.log("Success!");
  } catch (err) {
    console.error("Caught error:", err);
  }
}

test();
