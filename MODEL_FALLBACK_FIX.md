# Model Fallback Fix - "Model Not Found" Error Handling

## Problem
When an avatar's assigned AI model becomes unavailable (returns 404 "Model not found" error from OpenRouter), the avatar would fail to respond silently, with empty responses being suppressed. This resulted in:
- Avatars unable to respond to messages
- No automatic recovery mechanism
- Model assignments becoming stale over time as providers deprecate models

Example error log:
```
[OpenRouter][Chat] error {
  "status": 404,
  "code": 404,
  "type": null,
  "providerMessage": "Provider returned error",
  "userMessage": "Model not found"
}
[ConversationManager] AI chat returned for Kael Cipher, result type: object, is null/undefined: false
[AI][sendResponse] Suppressing non-text output for Kael Cipher; preview=""
```

## Solution
Implemented automatic model fallback mechanism that:
1. Detects 404 "Model not found" errors in OpenRouter responses
2. Selects a new random model from the available model pool
3. Updates the avatar's model in the database
4. Retries the request with the new model automatically

## Changes Made

### 1. OpenRouter AI Service (`src/services/ai/openrouterAIService.mjs`)

Added 404 error detection and fallback model selection in the `chat()` method:

```javascript
// Handle model not found error (404) by selecting a new random model
if (status === 404 && parsed.userMessage === 'Model not found' && retries > 0) {
  this.logger.warn(`[OpenRouter][Chat] Model '${mergedOptions.model}' not found (404), selecting fallback model...`);
  
  try {
    // Select a new random model from available models
    const fallbackModel = await this.selectRandomModel();
    
    if (fallbackModel && fallbackModel !== mergedOptions.model) {
      this.logger.info(`[OpenRouter][Chat] Fallback model selected: '${fallbackModel}' (was: '${mergedOptions.model}')`);
      
      // Return special response indicating model needs to be updated
      return options.returnEnvelope 
        ? { 
            text: '', 
            raw: null, 
            model: fallbackModel, 
            provider: 'openrouter', 
            error: { 
              code: 'MODEL_NOT_FOUND_FALLBACK', 
              message: 'Model not found, fallback selected',
              originalModel: mergedOptions.model,
              fallbackModel: fallbackModel
            } 
          } 
        : null;
    }
  } catch (fallbackError) {
    this.logger.error(`[OpenRouter][Chat] Failed to select fallback model: ${fallbackError.message}`);
  }
}
```

### 2. Conversation Manager (`src/services/chat/conversationManager.mjs`)

Added fallback handling in three key methods that use avatar models:

#### a) `sendResponse()` - Avatar chat responses
```javascript
// Handle model not found fallback
if (result && typeof result === 'object' && result.error?.code === 'MODEL_NOT_FOUND_FALLBACK') {
  const { fallbackModel, originalModel } = result.error;
  this.logger.warn?.(`[ConversationManager] Model '${originalModel}' not found for ${avatar.name}, updating to fallback model '${fallbackModel}'`);
  
  // Update avatar's model to the fallback
  avatar.model = fallbackModel;
  try {
    await this.avatarService.updateAvatar(avatar);
    this.logger.info?.(`[ConversationManager] Updated ${avatar.name}'s model to ${fallbackModel}`);
  } catch (updateError) {
    this.logger.error?.(`[ConversationManager] Failed to update avatar model: ${updateError.message}`);
  }
  
  // Retry the chat with the new model
  chatOptions.model = fallbackModel;
  this.logger.info?.(`[ConversationManager] Retrying chat for ${avatar.name} with fallback model ${fallbackModel}`);
  result = await ai.chat(chatMessages, chatOptions);
  resultReasoning = (result && typeof result === 'object' && result.reasoning) ? String(result.reasoning) : '';
}
```

#### b) `generateNarrative()` - Avatar narratives
Similar fallback handling for narrative generation.

#### c) `getChannelSummary()` - Channel summaries
Similar fallback handling for summary generation.

### 3. Return Envelope Support

Modified all avatar model AI calls to use `returnEnvelope: true` option:
```javascript
const chatOptions = { model: avatar.model, max_tokens: 1024, corrId, returnEnvelope: true };
```

This allows the conversation manager to:
- Detect error codes in responses
- Access metadata about the response
- Handle fallback scenarios gracefully

## Benefits

1. **Automatic Recovery**: Avatars automatically recover when their models become unavailable
2. **Zero Downtime**: No manual intervention required to fix broken avatars
3. **Persistent Fix**: Avatar model is updated in the database, preventing future errors
4. **Transparent Logging**: Clear log messages show when fallbacks occur
5. **Graceful Degradation**: If fallback selection fails, error is logged and handled

## Example Log Flow

Before fix:
```
[OpenRouter][Chat] error { "status": 404, "userMessage": "Model not found" }
[AI][sendResponse] Suppressing non-text output for Kael Cipher
```

After fix:
```
[OpenRouter][Chat] Model 'agentica-org/deepcoder-14b-preview:free' not found (404), selecting fallback model...
[OpenRouter][Chat] Fallback model selected: 'google/gemini-2.0-flash-exp:free' (was: 'agentica-org/deepcoder-14b-preview:free')
[ConversationManager] Model 'agentica-org/deepcoder-14b-preview:free' not found for Kael Cipher, updating to fallback model 'google/gemini-2.0-flash-exp:free'
[ConversationManager] Updated Kael Cipher's model to google/gemini-2.0-flash-exp:free
[ConversationManager] Retrying chat for Kael Cipher with fallback model google/gemini-2.0-flash-exp:free
[ConversationManager] AI chat returned for Kael Cipher... [success]
```

## Testing

To test this fix:
1. Assign an avatar a non-existent model (e.g., `test/invalid-model`)
2. Try to trigger a response from that avatar
3. Observe logs showing fallback model selection
4. Verify avatar responds successfully with new model
5. Check database to confirm model was updated

## Future Enhancements

Possible improvements:
- Model compatibility scoring (prefer similar tier models for fallback)
- Fallback history tracking to avoid problematic models
- Proactive model validation on startup
- Model deprecation notifications
