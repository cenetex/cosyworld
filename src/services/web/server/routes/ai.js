/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/web/server/routes/ai.js
 * @description Paid AI service endpoints protected by x402 payments
 */

import express from 'express';
import { requirePayment } from '../middleware/x402.js';

/**
 * Create AI routes with x402 payment protection
 * @param {Object} services - Service container
 * @returns {express.Router}
 */
export default function createAIRoutes(services) {
  const router = express.Router();
  const {
    logger,
    openrouterAIService,
    googleAIService,
    pricingService,
    x402Service,
  } = services;

  if (!pricingService) {
    logger.error('[AI Routes] pricingService not available');
  }

  if (!x402Service) {
    logger.error('[AI Routes] x402Service not available');
  }

  /**
   * POST /api/ai/chat
   * AI chat endpoint with dynamic pricing based on model
   * Free tier: Gemini 2.0 Flash and other :free models
   * Paid tier: GPT-4o, Claude, etc.
   */
  router.post('/chat', async (req, res) => {
    try {
      const { messages, model, maxTokens = 2000 } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages array is required' });
      }

      // Default to free tier model if not specified
      const requestedModel = model || 'google/gemini-2.0-flash-exp:free';

      // Check if model is free tier
      const isFree = pricingService?.isFreeTier(requestedModel) || requestedModel.includes(':free');

      if (!isFree && pricingService && x402Service) {
        // Calculate estimated cost for paid models
        const inputTokens = pricingService.estimateTokens(
          messages.map(m => m.content).join(' ')
        );
        const outputTokens = Math.min(maxTokens, 2000); // Estimate output

        const pricing = pricingService.calculateAIPrice({
          model: requestedModel,
          inputTokens,
          outputTokens,
        });

        // Check for payment
        const metadataHeader = req.headers['x-x402-metadata'];
        
        if (!metadataHeader) {
          // Return 402 Payment Required
          const paymentRequired = x402Service.generatePaymentRequired({
            amount: pricing.totalCostUSDC,
            resource: req.path,
          });

          return res.status(402).json({
            error: 'Payment Required',
            message: `This model (${requestedModel}) requires payment`,
            payment: paymentRequired,
            pricing: {
              model: requestedModel,
              estimatedCost: pricing.totalCostUSD,
              costUSDC: pricing.totalCostUSDC,
              inputTokens,
              outputTokens,
            },
            freeTierAlternative: 'google/gemini-2.0-flash-exp:free',
          });
        }

        // Verify payment
        try {
          const paymentPayload = JSON.parse(
            Buffer.from(metadataHeader, 'base64').toString('utf8')
          );

          const verification = await x402Service.verifyPayment({
            paymentPayload,
            expectedAmount: pricing.totalCostUSDC,
            metadata: {
              endpoint: req.path,
              model: requestedModel,
              estimatedTokens: { input: inputTokens, output: outputTokens },
            },
          });

          if (!verification.verified) {
            return res.status(402).json({
              error: 'Payment verification failed',
              message: verification.reason || 'Payment could not be verified',
            });
          }

          // Payment verified - attach to request
          req.payment = {
            verified: true,
            settlementId: verification.settlementId,
            transactionId: verification.transactionId,
            amount: pricing.totalCostUSDC,
          };

          // Settle payment asynchronously
          if (verification.settlementId) {
            setImmediate(() => {
              x402Service.settlePayment({
                settlementId: verification.settlementId,
              }).catch((error) => {
                logger.error('[AI Routes] Settlement error:', error);
              });
            });
          }
        } catch (error) {
          logger.error('[AI Routes] Payment processing error:', error);
          return res.status(400).json({
            error: 'Invalid payment data',
            message: error.message,
          });
        }
      }

      // Make AI request
      let aiResponse;
      const aiService = requestedModel.includes('google/') || requestedModel.includes('gemini')
        ? googleAIService
        : openrouterAIService;

      if (!aiService) {
        return res.status(500).json({ error: 'AI service not available' });
      }

      try {
        aiResponse = await aiService.createChatCompletion(messages, {
          model: requestedModel,
          maxTokens,
        });
      } catch (error) {
        logger.error('[AI Routes] AI service error:', error);
        return res.status(500).json({
          error: 'AI request failed',
          message: error.message,
        });
      }

      // Return response with payment info
      res.json({
        response: aiResponse.content || aiResponse.choices?.[0]?.message?.content,
        model: requestedModel,
        usage: aiResponse.usage || { inputTokens: 0, outputTokens: 0 },
        free: isFree,
        payment: req.payment || null,
      });
    } catch (error) {
      logger.error('[AI Routes] /chat error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/ai/generate-story
   * Generate a story narrative using AI
   * Fixed price: 0.05 USDC
   */
  router.post(
    '/generate-story',
    requirePayment({
      x402Service,
      price: 50000, // 0.05 USDC
      sellerAddress: services.configService?.config?.payment?.x402?.sellerAddress,
      onPaymentReceived: async (req, payment) => {
        logger.info(`[AI Routes] Story generation paid: ${payment.amount / 1e6} USDC`);
      },
    }),
    async (req, res) => {
      try {
        const { prompt, model = 'openai/gpt-4o', maxTokens = 1500 } = req.body;

        if (!prompt) {
          return res.status(400).json({ error: 'prompt is required' });
        }

        const messages = [
          {
            role: 'system',
            content: 'You are a creative storyteller for a fantasy RPG world. Generate engaging, immersive narratives.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ];

        const aiService = model.includes('google/') || model.includes('gemini')
          ? googleAIService
          : openrouterAIService;

        if (!aiService) {
          return res.status(500).json({ error: 'AI service not available' });
        }

        const aiResponse = await aiService.createChatCompletion(messages, {
          model,
          maxTokens,
        });

        res.json({
          story: aiResponse.content || aiResponse.choices?.[0]?.message?.content,
          model,
          usage: aiResponse.usage,
          payment: req.payment,
        });
      } catch (error) {
        logger.error('[AI Routes] /generate-story error:', error);
        res.status(500).json({
          error: 'Story generation failed',
          message: error.message,
        });
      }
    }
  );

  /**
   * POST /api/ai/generate-item
   * Generate an item description using AI
   * Fixed price: 0.02 USDC
   */
  router.post(
    '/generate-item',
    requirePayment({
      x402Service,
      price: 20000, // 0.02 USDC
      sellerAddress: services.configService?.config?.payment?.x402?.sellerAddress,
      onPaymentReceived: async (req, payment) => {
        logger.info(`[AI Routes] Item generation paid: ${payment.amount / 1e6} USDC`);
      },
    }),
    async (req, res) => {
      try {
        const { prompt, itemType = 'weapon', rarity = 'common' } = req.body;

        if (!prompt) {
          return res.status(400).json({ error: 'prompt is required' });
        }

        const messages = [
          {
            role: 'system',
            content: `You are a game item designer. Create detailed, balanced RPG items. Format: {"name": "...", "description": "...", "stats": {...}}`,
          },
          {
            role: 'user',
            content: `Create a ${rarity} ${itemType}: ${prompt}`,
          },
        ];

        const aiService = openrouterAIService || googleAIService;

        if (!aiService) {
          return res.status(500).json({ error: 'AI service not available' });
        }

        const aiResponse = await aiService.createChatCompletion(messages, {
          model: 'google/gemini-2.0-flash-exp:free', // Use free model for items
          maxTokens: 500,
        });

        res.json({
          item: aiResponse.content || aiResponse.choices?.[0]?.message?.content,
          itemType,
          rarity,
          usage: aiResponse.usage,
          payment: req.payment,
        });
      } catch (error) {
        logger.error('[AI Routes] /generate-item error:', error);
        res.status(500).json({
          error: 'Item generation failed',
          message: error.message,
        });
      }
    }
  );

  /**
   * POST /api/ai/describe-location
   * Generate a location description using AI
   * Fixed price: 0.015 USDC
   */
  router.post(
    '/describe-location',
    requirePayment({
      x402Service,
      price: 15000, // 0.015 USDC
      sellerAddress: services.configService?.config?.payment?.x402?.sellerAddress,
      onPaymentReceived: async (req, payment) => {
        logger.info(`[AI Routes] Location description paid: ${payment.amount / 1e6} USDC`);
      },
    }),
    async (req, res) => {
      try {
        const { locationName, theme = 'fantasy', mood = 'mysterious' } = req.body;

        if (!locationName) {
          return res.status(400).json({ error: 'locationName is required' });
        }

        const messages = [
          {
            role: 'system',
            content: 'You are a world builder. Create vivid, atmospheric location descriptions for RPG environments.',
          },
          {
            role: 'user',
            content: `Describe this ${theme} location with a ${mood} mood: ${locationName}`,
          },
        ];

        const aiService = openrouterAIService || googleAIService;

        if (!aiService) {
          return res.status(500).json({ error: 'AI service not available' });
        }

        const aiResponse = await aiService.createChatCompletion(messages, {
          model: 'google/gemini-2.0-flash-exp:free', // Use free model
          maxTokens: 400,
        });

        res.json({
          description: aiResponse.content || aiResponse.choices?.[0]?.message?.content,
          locationName,
          theme,
          mood,
          usage: aiResponse.usage,
          payment: req.payment,
        });
      } catch (error) {
        logger.error('[AI Routes] /describe-location error:', error);
        res.status(500).json({
          error: 'Location description failed',
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /api/ai/pricing
   * Get pricing information for AI models
   */
  router.get('/pricing', async (req, res) => {
    try {
      if (!pricingService) {
        return res.status(500).json({ error: 'Pricing service not available' });
      }

      const tiers = pricingService.getPricingTiers();
      const exampleModels = [
        { model: 'openai/gpt-4o', tokens: { input: 1000, output: 500 } },
        { model: 'anthropic/claude-3.5-sonnet', tokens: { input: 1000, output: 500 } },
        { model: 'google/gemini-2.0-flash-exp:free', tokens: { input: 1000, output: 500 } },
      ];

      const examples = exampleModels.map(({ model, tokens }) => ({
        model,
        ...pricingService.calculateAIPrice({
          model,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
        }),
      }));

      res.json({
        tiers,
        examples,
        endpoints: {
          chat: 'Dynamic pricing based on model',
          generateStory: '0.05 USDC',
          generateItem: '0.02 USDC',
          describeLocation: '0.015 USDC',
        },
      });
    } catch (error) {
      logger.error('[AI Routes] /pricing error:', error);
      res.status(500).json({
        error: 'Failed to fetch pricing',
        message: error.message,
      });
    }
  });

  return router;
}
