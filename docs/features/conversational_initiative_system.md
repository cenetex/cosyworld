# Conversational Initiative System Recommendations

## Overview
This document outlines a proposal to enhance the conversational mechanics of CosyWorld by introducing a D&D-inspired **Initiative System**. This system treats conversations as "encounters," allowing avatars to participate in a structured, turn-based manner based on their statistics (e.g., Dexterity, Charisma) rather than purely on "heat" or presence scoring.

## Goals
1.  **Structured Participation**: Avatars respond in a predictable, stat-based order.
2.  **Inclusive Conversations**: Allow avatars not directly addressed to "join" the conversation naturally.
3.  **Preserve Affinity**: Maintain the "sticky" affinity for avatars actively engaged with a user.
4.  **Simplification**: Replace opaque "heat" calculations with transparent initiative rolls.

## Core Concepts

### 1. The "Encounter"
A conversation in a channel is treated as an **Encounter**.
-   **Start**: Triggered by a user mention, a reply to an avatar, or an ambient event.
-   **State**: Tracks participants, initiative order, current turn index, and round number.
-   **End**: Ends after a period of inactivity (timeout) or explicit termination.

### 2. Initiative Roll
When an avatar joins an encounter, they roll for initiative.
-   **Formula**: `d20 + Modifier`
-   **Modifier**: Derived from avatar stats.
    -   *Default*: `Dexterity` (reaction speed).
    -   *Social*: `Charisma` (social presence) or `Intelligence` (witty retort) could be used for specific contexts.
-   **Tie-Breaker**: Higher stat wins.

### 3. Turn Order
Avatars act in descending order of their initiative roll.
-   The system cycles through the list.
-   If an avatar is on cooldown or has nothing to say (decided by AI), they "pass" their turn.

## Proposed Architecture Changes

### 1. New Service: `EncounterService`
(Or extension of `PresenceService`)
Responsible for managing the state of active encounters in each channel.

**State Structure:**
```javascript
{
  channelId: "12345",
  status: "active", // active, cooldown
  startedAt: Date,
  lastTurnAt: Date,
  round: 1,
  currentTurnIndex: 0,
  participants: [
    {
      avatarId: "avatar_1",
      initiative: 18,
      joinedAt: Date,
      lastActedAt: Date
    },
    {
      avatarId: "avatar_2",
      initiative: 12,
      joinedAt: Date,
      lastActedAt: Date
    }
  ]
}
```

**Methods:**
-   `startEncounter(channelId, initialParticipants)`
-   `joinEncounter(channelId, avatarId)`: Rolls initiative and inserts into order.
-   `nextTurn(channelId)`: Advances the turn index.
-   `getCurrentTurn(channelId)`: Returns the avatar whose turn it is.
-   `endEncounter(channelId)`

### 2. Updates to `AvatarService`
Add methods to calculate initiative modifiers and perform rolls.

```javascript
async rollInitiative(avatar) {
  const d20 = Math.floor(Math.random() * 20) + 1;
  const modifier = this.getStatModifier(avatar, 'dexterity'); // or charisma
  return d20 + modifier;
}
```

### 3. Integration into `ResponseCoordinator`
Modify `selectResponders` to prioritize the Initiative System while respecting Sticky Affinity.

**Revised Priority Logic:**

1.  **Reply Detected (Priority 0)**:
    -   *Unchanged*. If a user replies to a specific avatar, that avatar MUST respond.
    -   *Action*: The replied-to avatar is automatically added to the Encounter (if not present) and takes an "Immediate Turn" (interrupting the order, or moving to top).

2.  **Sticky Affinity (Priority 1)**:
    -   *Unchanged*. If a user has a strong affinity with an avatar, that avatar responds.
    -   *Action*: Ensure the sticky avatar is in the Encounter.

3.  **Encounter Turn (Priority 2)**:
    -   *New Logic*.
    -   Check `EncounterService.getCurrentTurn(channelId)`.
    -   If it's Avatar A's turn:
        -   Check if Avatar A is eligible (in channel, not on cooldown).
        -   Ask `DecisionMaker`: "Does Avatar A want to speak?"
        -   If **YES**: Avatar A responds. `EncounterService.nextTurn()`.
        -   If **NO**: `EncounterService.nextTurn()` and recurse to next avatar (up to a limit).

4.  **Ambient/New Encounter (Priority 3)**:
    -   If no encounter is active, and a trigger occurs (e.g., mention):
        -   Start new Encounter.
        -   Roll initiative for all eligible avatars in channel (or a subset).
        -   Execute first turn.

### 4. Joining Mechanics
-   **Passive Joining**: At the start of each round, or when a keyword is mentioned, other avatars in the channel can "roll to join" (e.g., Perception check vs DC).
-   **Summoning**: Explicit summons add the avatar to the encounter immediately.

## Implementation Roadmap

1.  **Phase 1: Foundation**
    -   Implement `EncounterService` to track state.
    -   Add `rollInitiative` to `AvatarService`.
    -   Create unit tests for initiative sorting.

2.  **Phase 2: Integration**
    -   Modify `ResponseCoordinator.selectResponders` to query `EncounterService`.
    -   Replace `PresenceService.recordTurn` logic with `EncounterService.nextTurn`.

3.  **Phase 3: Refinement**
    -   Tune initiative modifiers.
    -   Implement "Pass" logic (AI decides to stay silent).
    -   Add visual indicators (optional) or debug logs for initiative order.

## Benefits
-   **Predictability**: Debugging conversation flow becomes easier ("Why did X respond? Because they rolled an 18").
-   **RPG Flavor**: Aligns with the "CosyWorld" RPG/D&D theme.
-   **Fairness**: Prevents one "loud" avatar from dominating if their stats don't justify it.
