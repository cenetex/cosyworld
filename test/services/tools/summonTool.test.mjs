import { describe, it, expect } from 'vitest';
import { SummonTool } from '../../../src/services/tools/tools/SummonTool.mjs';

const createTool = () => new SummonTool({
  discordService: {},
  mapService: {},
  avatarService: {},
  configService: {},
  databaseService: {},
  aiService: {},
  unifiedAIService: {},
  statService: {},
  presenceService: {},
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  conversationManager: {},
  conversationThreadService: {}
});

describe('SummonTool _shouldResolveCatalogModel', () => {
  it('returns false when a model id is already requested', () => {
    const tool = createTool();
    expect(tool._shouldResolveCatalogModel({
      requestedModelId: 'meta/model',
      avatarName: 'anything',
      freeSummonsDisabled: false,
      pureModelOnly: false,
      allowModelSummons: true
    })).toBe(false);
  });

  it('returns false when avatar name is missing', () => {
    const tool = createTool();
    expect(tool._shouldResolveCatalogModel({
      requestedModelId: null,
      avatarName: '',
      freeSummonsDisabled: true,
      pureModelOnly: true,
      allowModelSummons: true
    })).toBe(false);
  });

  it('returns false when pure model avatars are disabled', () => {
    const tool = createTool();
    expect(tool._shouldResolveCatalogModel({
      requestedModelId: null,
      avatarName: 'Aurora',
      freeSummonsDisabled: true,
      pureModelOnly: true,
      allowModelSummons: false
    })).toBe(false);
  });

  it('returns true when free summons are disabled but pure models allowed', () => {
    const tool = createTool();
    expect(tool._shouldResolveCatalogModel({
      requestedModelId: null,
      avatarName: 'Aurora',
      freeSummonsDisabled: true,
      pureModelOnly: false,
      allowModelSummons: true
    })).toBe(true);
  });

  it('returns true when server is pure-model-only', () => {
    const tool = createTool();
    expect(tool._shouldResolveCatalogModel({
      requestedModelId: null,
      avatarName: 'Aurora',
      freeSummonsDisabled: false,
      pureModelOnly: true,
      allowModelSummons: true
    })).toBe(true);
  });

  it('returns false when free summons are allowed and pure models are just an additional mode', () => {
    const tool = createTool();
    expect(tool._shouldResolveCatalogModel({
      requestedModelId: null,
      avatarName: 'Aurora',
      freeSummonsDisabled: false,
      pureModelOnly: false,
      allowModelSummons: true
    })).toBe(false);
  });
});
