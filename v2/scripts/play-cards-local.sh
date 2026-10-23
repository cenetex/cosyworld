#!/usr/bin/env bash
# Play the card table on a local Ollama model. No provider key is needed.
#
#   ollama pull gemma3:4b
#   npm run play:cards:local
#
# COSYWORLD_LOCAL_MODEL picks another pulled model (gemma3:12b, llama3.1:8b).
# OLLAMA_URL points at a non-default Ollama server.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODEL="${COSYWORLD_LOCAL_MODEL:-gemma3:4b}"
OLLAMA="${OLLAMA_URL:-http://127.0.0.1:11434}"
PORT="${COSYWORLD_CARD_LOCAL_PORT:-3110}"

if ! tags="$(curl -sf --max-time 3 "$OLLAMA/api/tags")"; then
  echo "Ollama is not answering at $OLLAMA. Start it with: ollama serve" >&2
  exit 1
fi
if ! grep -q "\"name\":\"$MODEL\"" <<<"$tags"; then
  echo "Ollama does not have $MODEL yet. Pull it with: ollama pull $MODEL" >&2
  exit 1
fi

# Hosted keys, registries and character maps stay out of a local table.
unset COSYWORLD_AI_API_KEY OPENROUTER_API_KEY OPENAI_API_KEY COSYWORLD_AI_PROVIDER
unset COSYWORLD_AI_REGISTRY_JSON COSYWORLD_CARD_CHARACTER_MODELS_JSON
unset COSYWORLD_CARD_TEXT_MODEL COSYWORLD_CARD_REFLECTION_MODEL
unset COSYWORLD_CARD_ESCALATION_MODEL COSYWORLD_DEPLOY_PROFILE

export COSYWORLD_PRIMARY_GAME=cards
export COSYWORLD_V2_ADDR="127.0.0.1:$PORT"
export COSYWORLD_AI_BASE_URL="$OLLAMA/v1"
export COSYWORLD_AI_MODEL="$MODEL"
export COSYWORLD_CARD_TEXT_PROFILE="${COSYWORLD_CARD_TEXT_PROFILE:-local}"

echo "CosyWorld card table on $MODEL: http://127.0.0.1:$PORT/card-game/"
cd "$ROOT/v2/orchestrator-rust"
exec cargo run --release
