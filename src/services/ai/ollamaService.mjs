/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import ollama from 'ollama';

export class OllamaService {
  constructor({
    logger,
    configService,
  }) {
    this.model = configService.get('ai.ollama.defaultModel') || 'llama3.2';
    this.apiKey = process.env.OLLAMA_API_KEY;
    this.defaultChatOptions = {
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 1.0,
      frequency_penalty: 0,
      presence_penalty: 0,
    };
    this.logger = logger || console;
    this.logger.info(`Initialized OllamaService with default model: ${this.model}`);
  }

  async modelIsAvailable(model) {
    try {
      const response = await ollama.listModels();
      return response.models.some(m => m.name === model);
    } catch (error) {
      console.error(`Error checking model availability: ${error.message}`);
      return false;
    }
  }

  async chat(messages, options = {}) {
    const mergedOptions = {
      ...this.defaultChatOptions,
      ...options,
    };

    try {
      const response = await ollama.chat({
        model: this.model,
        messages,
        ...mergedOptions,
      });
      if (!response || !response.message || !response.message.content) {
        console.error('Invalid response from Ollama during chat.');
        return null;
      }
  return { text: response.message.content.trim(), raw: response, model: this.model, provider: 'ollama', error: null };
    } catch (error) {
      console.error('Error while chatting with Ollama:', error);
  return { text: null, raw: null, model: this.model, provider: 'ollama', error: { code: 'CHAT_ERROR', message: error.message } };
    }
  }

  async generateCompletion(prompt, options = {}) {
    const mergedOptions = {
      model: this.model,
      prompt,
      ...this.defaultChatOptions,
      ...options,
    };

    try {
      const response = await ollama.generate(mergedOptions);
      if (!response || !response.response || response.response.length === 0) {
        console.error('Invalid response from Ollama during completion generation.');
        return null;
      }
  return { text: response.response.trim(), raw: response, model: this.model, provider: 'ollama', error: null };
    } catch (error) {
      console.error('Error while generating completion from Ollama:', error);
  return { text: null, raw: null, model: this.model, provider: 'ollama', error: { code: 'COMPLETION_ERROR', message: error.message } };
    }
  }

  async analyzeImage(imageBase64, mimeType, prompt = "Describe this image in detail.", options = {}) {
    try {
      const response = await ollama.generate({
        model: this.model,
        prompt,
        images: [{ data: imageBase64, mimeType }],
        ...options,
      });

      if (!response || !response.response || response.response.length === 0) {
        console.error('Invalid response from Ollama during image analysis.');
        return null;
      }

      return response.response.trim();
    } catch (error) {
      console.error('Error analyzing image with Ollama:', error);
      return null;
    }
  }
}