/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import { ensureAdmin } from '../middleware/authCookie.js';
import { ReplicateService } from '../../../ai/replicateService.mjs';

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const maskSecret = (value) => {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 6) return '***';
  return `${value.slice(0, 4)}...${value.slice(-2)}`;
};

const interpretIncoming = (value, { allowEmpty = false } = {}) => {
  if (value === undefined || value === null) {
    return { action: 'skip' };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return allowEmpty ? { action: 'clear' } : { action: 'skip' };
    }
    if (trimmed === 'KEEP_EXISTING') {
      return { action: 'skip' };
    }
    return { action: 'set', value: trimmed };
  }
  return { action: 'set', value };
};

const parseForSample = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'KEEP_EXISTING') return null;
  return trimmed;
};

export default function createAdminReplicateRouter(services) {
  const router = express.Router();
  const { secretsService, configService, logger } = services;

  const getSecret = async (key) => {
    try {
      if (secretsService?.getAsync) {
        const value = await secretsService.getAsync(key, { envFallback: true });
        if (value) return value;
      } else if (secretsService?.get) {
        const value = await secretsService.get(key);
        if (value) return value;
      }
    } catch (error) {
      logger?.warn?.(`[admin:replicate] Failed to get secret ${key}: ${error?.message || error}`);
    }
    return process.env[key] || null;
  };

  const setSecret = async (key, value) => {
    if (!secretsService) {
      process.env[key] = value;
      return;
    }
    await secretsService.set(key, value);
    process.env[key] = value;
  };

  const clearSecret = async (key) => {
    if (secretsService?.delete) {
      await secretsService.delete(key);
    }
    delete process.env[key];
  };

  router.use(ensureAdmin);
  router.use(express.json({ limit: '2mb' }));

  router.get('/config', asyncHandler(async (req, res) => {
    const token = await getSecret('REPLICATE_API_TOKEN');
    const baseModel = await getSecret('REPLICATE_BASE_MODEL') || 'black-forest-labs/flux-dev-lora';
    const loraWeights = await getSecret('REPLICATE_LORA_WEIGHTS') || await getSecret('REPLICATE_MODEL');
    const loraTrigger = await getSecret('REPLICATE_LORA_TRIGGER') || await getSecret('LORA_TRIGGER_WORD');
    const style = configService?.config?.ai?.replicate?.style || '';

    res.json({
      tokenConfigured: !!token,
      tokenMasked: token ? maskSecret(token) : null,
      baseModel,
      loraWeights: loraWeights || null,
      loraTrigger: loraTrigger || null,
      style
    });
  }));

  router.post('/config', asyncHandler(async (req, res) => {
    const { apiToken, baseModel, loraWeights, loraTrigger } = req.body || {};
    const updates = [];

    const tokenDecision = interpretIncoming(apiToken, { allowEmpty: true });
    if (tokenDecision.action === 'set') {
      await setSecret('REPLICATE_API_TOKEN', tokenDecision.value);
      updates.push('apiToken');
    } else if (tokenDecision.action === 'clear') {
      await clearSecret('REPLICATE_API_TOKEN');
      updates.push('apiTokenCleared');
    }

    const baseDecision = interpretIncoming(baseModel, { allowEmpty: true });
    if (baseDecision.action === 'set') {
      await setSecret('REPLICATE_BASE_MODEL', baseDecision.value);
      updates.push('baseModel');
    } else if (baseDecision.action === 'clear') {
      await clearSecret('REPLICATE_BASE_MODEL');
      updates.push('baseModelCleared');
    }

    const weightsDecision = interpretIncoming(loraWeights, { allowEmpty: true });
    if (weightsDecision.action === 'set') {
      await setSecret('REPLICATE_LORA_WEIGHTS', weightsDecision.value);
      await setSecret('REPLICATE_MODEL', weightsDecision.value);
      updates.push('loraWeights');
    } else if (weightsDecision.action === 'clear') {
      await clearSecret('REPLICATE_LORA_WEIGHTS');
      await clearSecret('REPLICATE_MODEL');
      updates.push('loraWeightsCleared');
    }

    const triggerDecision = interpretIncoming(loraTrigger, { allowEmpty: true });
    if (triggerDecision.action === 'set') {
      await setSecret('REPLICATE_LORA_TRIGGER', triggerDecision.value);
      await setSecret('LORA_TRIGGER_WORD', triggerDecision.value);
      updates.push('loraTrigger');
    } else if (triggerDecision.action === 'clear') {
      await clearSecret('REPLICATE_LORA_TRIGGER');
      await clearSecret('LORA_TRIGGER_WORD');
      updates.push('loraTriggerCleared');
    }

    try {
      await configService?.loadConfig?.();
    } catch (error) {
      logger?.warn?.('[admin:replicate] Failed to reload config after update', error?.message || error);
    }

    res.json({ success: true, updated: updates });
  }));

  router.post('/sample', asyncHandler(async (req, res) => {
    const { apiToken, baseModel, loraWeights, loraTrigger, prompt, aspectRatio } = req.body || {};
    let resolvedToken = parseForSample(apiToken) || await getSecret('REPLICATE_API_TOKEN');
    if (!resolvedToken) {
      return res.status(400).json({ error: 'Replicate API token is required to generate a sample image.' });
    }

    const resolvedBaseModel = parseForSample(baseModel) || await getSecret('REPLICATE_BASE_MODEL') || 'black-forest-labs/flux-dev-lora';
    const resolvedWeights = parseForSample(loraWeights) || await getSecret('REPLICATE_LORA_WEIGHTS') || await getSecret('REPLICATE_MODEL') || null;
    const resolvedTrigger = parseForSample(loraTrigger) || await getSecret('REPLICATE_LORA_TRIGGER') || await getSecret('LORA_TRIGGER_WORD') || '';

    const samplePrompt = typeof prompt === 'string' && prompt.trim()
      ? prompt.trim()
      : 'A cozy avatar portrait bathed in warm tavern light, painterly watercolor finish.';
    const ratio = typeof aspectRatio === 'string' && aspectRatio.trim() ? aspectRatio.trim() : '1:1';

    const style = configService?.config?.ai?.replicate?.style || '';
    const tempConfigService = {
      config: {
        ai: {
          replicate: {
            apiToken: resolvedToken,
            model: resolvedBaseModel,
            lora_weights: resolvedWeights,
            loraTriggerWord: resolvedTrigger,
            style
          }
        }
      }
    };

    const replicateService = new ReplicateService({ configService: tempConfigService, logger });
    replicateService.apiToken = resolvedToken;

    const imageUrl = await replicateService.generateImage(samplePrompt, [], { aspect_ratio: ratio });
    if (!imageUrl) {
      return res.status(502).json({ error: 'Replicate did not return an image.' });
    }

    res.json({ success: true, imageUrl });
  }));

  return router;
}
