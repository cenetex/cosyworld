import { describe, it, expect } from 'vitest';
import { OpenRouterAIService } from '../../../src/services/ai/openrouterAIService.mjs';

describe('OpenRouterAIService.supportsVisionModel', () => {
  const supports = model => OpenRouterAIService.prototype.supportsVisionModel.call({}, model);

  it('detects common vision/multimodal model slugs', () => {
    expect(supports('meta-llama/llama-3.2-11b-vision-instruct')).toBe(true);
    expect(supports('qwen/qwen3-vl-8b-instruct')).toBe(true);
    expect(supports('openai/gpt-5-image')).toBe(true);
    expect(supports('x-ai/grok-2-vision-1212')).toBe(true);
  });

  it('covers OpenAI and Gemini slugs that omit vision keywords', () => {
    expect(supports('openai/gpt-4o')).toBe(true);
    expect(supports('openai/gpt-4.1-mini')).toBe(true);
    expect(supports('google/gemini-2.0-flash-001')).toBe(true);
  });

  it('returns false for typical text-only models', () => {
    expect(supports('meta-llama/llama-3.2-1b-instruct')).toBe(false);
    expect(supports('deepseek/deepseek-r1')).toBe(false);
  });
});
