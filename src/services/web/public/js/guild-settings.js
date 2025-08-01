/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// Guild settings management
class GuildSettingsManager {
  constructor() {
    this.guildConfigs = [];
    this.selectedGuildId = null;
    this.initializeInterface();

    // Make this instance globally accessible for other scripts
    window.guildSettingsManager = this;
  }

  /** Initialize the admin interface */
  async initializeInterface() {
    const guildSettingsContainer = document.getElementById(
      "guild-settings-container",
    );
    if (!guildSettingsContainer) return;

    try {
      this.showMessage("Loading guild configurations...", "info");
      await this.loadGuildConfigs();
      this.initializeGuildSelector();
      this.initializeFormHandlers();
      this.setupManualWhitelistButton();

      // Check for detected guilds after loading configurations
      await this.checkDetectedGuilds();

      document.getElementById("settings-message").classList.add("hidden");

      // Setup refresh button for detected guilds
      const refreshButton = document.getElementById("refresh-detected-guilds");
      if (refreshButton) {
        refreshButton.addEventListener("click", async (e) => {
          e.preventDefault();
          await this.checkDetectedGuilds();
        });
      }
    } catch (error) {
      console.error("Failed to initialize guild settings:", error);
      this.showMessage(
        `Error loading configurations: ${error.message}`,
        "error",
      );
    }
  }

  /** Load guild configurations from the API */
  async loadGuildConfigs() {
    try {
      const response = await fetch("/api/guilds");
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      this.guildConfigs = await response.json();
      this.checkDetectedGuilds();
    } catch (error) {
      console.error("Failed to load guild configurations:", error);
      throw error;
    }
  }

  /** Check for detected guilds and update the UI */
  async checkDetectedGuilds() {
    try {
      const detectedSection = document.getElementById(
        "detected-guilds-section",
      );
      const detectedContainer = document.getElementById(
        "detected-guilds-container",
      );
      const detectedCount = document.getElementById("detected-guilds-count");

      if (!detectedSection || !detectedContainer) return;

      // Show loading state
      detectedContainer.innerHTML = `
        <div class="flex justify-center py-4">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
        </div>
      `;

      // Fetch detected guilds using the consolidated endpoint
      const response = await fetch("/api/guilds/detected");
      if (!response.ok) {
        detectedContainer.innerHTML = `
          <div class="p-4 bg-red-50 text-red-700 rounded-md">
            <p>Failed to fetch detected guilds: ${response.status}</p>
            <p class="text-sm mt-2">This could be because you need to restart the server after adding the API endpoint.</p>
          </div>
        `;
        return;
      }

      const detectedGuilds = await response.json();
      const nonAuthorized = detectedGuilds.filter(
        (guild) => !guild.authorized,
      );

      if (nonAuthorized.length > 0) {
        detectedSection.classList.remove("hidden");
        if (detectedCount) {
          detectedCount.textContent = nonAuthorized.length.toString();
        }

        // Clear and populate container
        detectedContainer.innerHTML = "";

        // Sort by name for consistency
        nonAuthorized
          .sort((a, b) => a.name.localeCompare(b.name))
          .forEach((guild) =>
            detectedContainer.appendChild(this.createDetectedGuildCard(guild))
          );
      } else {
        detectedSection.classList.add("hidden");
        detectedContainer.innerHTML = "";
      }
    } catch (error) {
      console.error("Failed to check for detected guilds:", error);
      this.showMessage(`Error checking for detected guilds: ${error.message}`, "error");
    }
  }

  /** Create a card for a detected guild */
  createDetectedGuildCard(guild) {
    const card = document.createElement("div");
    card.className =
      "border rounded-md p-4 bg-white shadow-sm flex justify-between items-center";
    card.dataset.guildId = guild.id;

    // Handle Discord CDN icon URL 
    let iconUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
    if (guild.icon) {
      iconUrl = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
    }

    const date = guild.detectedAt
      ? new Date(guild.detectedAt).toLocaleString()
      : "Unknown date";

    const memberCountDisplay = guild.memberCount ? 
      `<p class="text-xs text-gray-400">Members: ${guild.memberCount}</p>` : '';

    card.innerHTML = `
      <div class="flex items-center space-x-3">
        <img src="${iconUrl}" alt="${guild.name}" class="w-10 h-10 rounded-full object-cover border border-gray-200" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
        <div>
          <h4 class="font-medium">${guild.name}</h4>
          <p class="text-sm text-gray-500">ID: ${guild.id}</p>
          <p class="text-xs text-gray-400">First detected: ${date}</p>
          ${memberCountDisplay}
        </div>
      </div>
      <button class="authorize-guild-btn px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors">
        Authorize
      </button>
    `;

    // Add loading state handling
    const authorizeButton = card.querySelector(".authorize-guild-btn");
    authorizeButton.addEventListener("click", async () => {
      authorizeButton.disabled = true;
      authorizeButton.textContent = "Authorizing...";
      authorizeButton.classList.add("opacity-75");

      try {
        await this.whitelistDetectedGuild(guild); //Updated to use the original function, renamed below
        this.checkDetectedGuilds(); // Refresh the detected guilds section
      } catch (error) {
        console.error("Failed to authorize guild:", error);
        authorizeButton.textContent = "Authorize";
        authorizeButton.disabled = false;
        authorizeButton.classList.remove("opacity-75");
        this.showMessage(`Failed to authorize guild: ${error.message}`, "error");
      }
    });

    return card;
  }

  /** Whitelist a detected guild with default settings */
  async whitelistDetectedGuild(guild) {
    try {
      const newGuildConfig = {
        guildId: guild.id,
        name: guild.name,
        icon: guild.icon, // Include icon if available
        memberCount: guild.memberCount,
        authorized: true,
        whitelisted: true, // For backward compatibility
        summonEmoji: "✨",
        adminRoles: [],
        features: { breeding: true, combat: true, itemCreation: true },
        prompts: {
          intro:
            "You are now conversing with {avatar_name}, a unique AI character with its own personality and abilities.",
          summon:
            "You are {avatar_name}, responding to being summoned by {user_name}.",
          attack:
            "You are {avatar_name}, attacking {target_name} with your abilities.",
          defend: "You are {avatar_name}, defending against an attack.",
          breed:
            "You are {avatar_name}, breeding with {target_name} to create a new entity.",
        },
        rateLimiting: { messages: 5, interval: 60 },
        toolEmojis: { summon: "🔮", breed: "🏹", attack: "⚔️", defend: "🛡️" },
      };

      // Check if the guild already exists but is not whitelisted
      try {
        const checkResponse = await fetch(`/api/guilds/${guild.id}`);
        if (checkResponse.ok) {
          const existingConfig = await checkResponse.json();

          // Preserve existing settings but set whitelisted to true
          Object.assign(newGuildConfig, existingConfig, { 
            authorized: true,
            whitelisted: true, // For backward compatibility
            // Update these fields with fresh data from detected guild
            name: guild.name,
            icon: guild.icon,
            memberCount: guild.memberCount
          });
        }
      } catch (error) {
        console.warn(`Couldn't check for existing guild config: ${error.message}`);
        // Continue with new guild creation
      }

      const response = await fetch("/api/guilds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newGuildConfig),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      await this.loadGuildConfigs();
      this.initializeGuildSelector();
      this.showMessage(
        `Guild "${guild.name}" has been authorized and configured with default settings.`,
        "success",
      );

      // Clear guild whitelist cache in Discord service
      try {
        await fetch(`/api/guilds/${guild.id}/clear-cache`, {
          method: "POST"
        });
      } catch (cacheError) {
        console.warn("Failed to clear guild cache:", cacheError);
        // Non-critical, so continue
      }

      return true;
    } catch (error) {
      console.error("Failed to authorize guild:", error);
      this.showMessage(`Failed to authorize guild: ${error.message}`, "error");
      throw error;
    }
  }

  /** Initialize the guild selector UI */
  initializeGuildSelector() {
    const container = document.getElementById("guild-cards-container");
    if (!container) return;

    container.innerHTML = "";

    if (this.guildConfigs.length === 0) {
      container.innerHTML = `
        <div class="col-span-full p-4 text-center border border-dashed border-gray-300 rounded-lg">
          <p class="text-gray-500">No guild configurations found</p>
          <p class="mt-2 text-sm text-gray-400">Note: New servers will inherit settings from the first configured server as a template</p>
        </div>
      `;
    } else {
      this.guildConfigs.forEach((guild) =>
        container.appendChild(this.createGuildCard(guild)),
      );
    }

    const addNewGuildButton = document.getElementById("add-new-guild-button");
    if (addNewGuildButton)
      addNewGuildButton.addEventListener("click", () =>
        this.showAddGuildModal(),
      );
  }

  /** Create a guild card for the selector */
  createGuildCard(guild) {
    const guildId = guild.guildId || guild.id;
    const card = document.createElement("div");
    card.className = "border rounded-lg shadow-sm overflow-hidden bg-white";
    card.dataset.guildId = guildId;

    const iconUrl =
      guild.iconUrl || guild.icon
        ? `https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`
        : "https://cdn.discordapp.com/embed/avatars/0.png";
    card.innerHTML = `
      <div class="flex items-center p-4 cursor-pointer hover:bg-gray-50" data-guild-id="${guildId}">
        <div class="flex-shrink-0 h-12 w-12 rounded-full overflow-hidden bg-gray-200">
          <img src="${iconUrl}" alt="${guild.name}" class="h-full w-full object-cover">
        </div>
        <div class="ml-4 flex-1">
          <h3 class="text-lg font-medium text-gray-900">${guild.name}</h3>
          <p class="text-sm text-gray-500">ID: ${guildId}</p>
        </div>
        <div class="ml-4 flex-shrink-0">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${guild.authorized ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}">
            ${guild.authorized ? "Authorized" : "Not Authorized"}
          </span>
        </div>
      </div>
      <div class="flex justify-end p-2">
        <button class="delete-guild-btn text-red-600 hover:text-red-800 text-sm">Delete</button>
      </div>
    `;

    card
      .querySelector("[data-guild-id]")
      .addEventListener("click", () => this.selectGuild(guildId));
    card.querySelector(".delete-guild-btn").addEventListener("click", () => {
      if (
        confirm(
          `Are you sure you want to delete the configuration for "${guild.name}"?`,
        )
      ) {
        this.deleteGuildConfig(guildId);
      }
    });

    return card;
  }

  /** Delete a guild configuration */
  async deleteGuildConfig(guildId) {
    try {
      const response = await fetch(`/api/guilds/${guildId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      this.guildConfigs = this.guildConfigs.filter(
        (g) => (g.guildId || g.id) !== guildId,
      );
      this.initializeGuildSelector();

      if (this.selectedGuildId === guildId) {
        this.selectedGuildId = null;
        document.getElementById("guild-settings-form").classList.add("hidden");
        document
          .getElementById("no-server-selected")
          .classList.remove("hidden");
      }

      this.showMessage("Guild configuration deleted successfully", "success");
    } catch (error) {
      console.error("Failed to delete guild configuration:", error);
      this.showMessage(`Error: ${error.message}`, "error");
    }
  }

  /** Select a guild and populate the form */
  selectGuild(guildId) {
    this.selectedGuildId = guildId;

    document
      .querySelectorAll("#guild-cards-container > div")
      .forEach((card) => {
        card.classList.toggle("ring-2", card.dataset.guildId === guildId);
        card.classList.toggle(
          "ring-indigo-500",
          card.dataset.guildId === guildId,
        );
      });

    document.getElementById("no-server-selected").classList.add("hidden");
    const form = document.getElementById("guild-settings-form");
    form.classList.remove("hidden");

    const guildConfig = this.guildConfigs.find(
      (g) => (g.guildId || g.id) === guildId,
    );
    if (guildConfig) {
      this.populateForm(guildConfig);
    } else {
      this.showMessage("Guild configuration not found", "error");
      form.classList.add("hidden"); // Hide the form if the config isn't found.
      document.getElementById("no-server-selected").classList.remove("hidden"); //Show the message
    }
  }

  /** Populate the settings form with guild data */
  populateForm(guildConfig) {
    document.getElementById("guild-id").value =
      guildConfig.guildId || guildConfig.id || "";
    document.getElementById("guild-name").value = guildConfig.name || "";
    document.getElementById("summoner-role").value =
      guildConfig.summonerRole || "";
    const summonEmojiInput = document.getElementById("tool-emoji-summon");
    if (summonEmojiInput) {
      summonEmojiInput.value = guildConfig.summonEmoji || "✨";
    }
    document.getElementById("admin-roles").value = Array.isArray(
      guildConfig.adminRoles,
    )
      ? guildConfig.adminRoles.join(", ")
      : "";
    document.getElementById("guild-authorized").checked =
      guildConfig.authorized || false;

    const rateLimiting = guildConfig.rateLimiting || {};
    document.getElementById("rate-limit-messages").value =
      rateLimiting.messages || 5;
    document.getElementById("rate-limit-interval").value =
      rateLimiting.interval || 60;

    const toolEmojis = guildConfig.toolEmojis || {};
    const toolEmojiContainer = document.getElementById('tool-emojis-container');
    if(toolEmojiContainer) {
      toolEmojiContainer.innerHTML = '';
      const toolNames = ['summon','breed','attack','defend','move','remember','create','x','item','respond'];
      toolNames.forEach(toolName => {
        const div = document.createElement('div');
        div.className = 'sm:col-span-3';
        div.innerHTML = `
          <label class="block text-sm font-medium text-gray-700">${toolName.charAt(0).toUpperCase()+toolName.slice(1)} Emoji</label>
          <input type="text" id="tool-emoji-${toolName}" class="mt-1 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md" placeholder="" value="${toolEmojis[toolName] || ''}">
        `;
        toolEmojiContainer.appendChild(div);
      });
    }

    const features = guildConfig.features || {};
    document.getElementById("feature-breeding").checked =
      features.breeding || false;
    document.getElementById("feature-combat").checked =
      features.combat || false;
    document.getElementById("feature-item-creation").checked =
      features.itemCreation || false;

    const prompts = guildConfig.prompts || {};
    document.getElementById("intro-prompt").value = prompts.intro || "";
    document.getElementById("summon-prompt").value = prompts.summon || "";
    document.getElementById("attack-prompt").value = prompts.attack || "";
    document.getElementById("defend-prompt").value = prompts.defend || "";
    document.getElementById("breed-prompt").value = prompts.breed || "";

    document.getElementById("feature-view-details").checked = guildConfig.viewDetailsEnabled !== false;

    // Avatar Tribe Restrictions
    const tribeConfig = guildConfig.avatarTribeRestrictions || {};
    document.getElementById("avatar-tribe-mode").value = tribeConfig.default?.mode || "permit";
    document.getElementById("avatar-tribe-exceptions").value = (tribeConfig.default?.emojis || []).join(", ");
    const container = document.getElementById("avatar-tribe-restrictions-channels");
    container.innerHTML = "";
    if (tribeConfig.channels) {
      Object.entries(tribeConfig.channels).forEach(([channelId, cfg]) => {
        this.addAvatarTribeOverride(container, channelId, cfg);
      });
    }
  }

  /** Set up form submission handler */
  initializeFormHandlers() {
    const form = document.getElementById("guild-settings-form");
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await this.saveGuildSettings();
      });
    }
    // Avatar Tribe Overrides: add-new override button
    const addOverrideBtn = document.getElementById("add-avatar-tribe-override");
    if (addOverrideBtn) {
      addOverrideBtn.addEventListener("click", () => {
        this.addAvatarTribeOverride();
      });
    }
  }

  /** Save guild settings to the API */
  async saveGuildSettings() {
    if (!this.selectedGuildId) {
      this.showMessage("No guild selected", "error");
      return;
    }

    try {
      this.showMessage("Saving guild settings...", "info");
      const formData = this.getFormData();

      const response = await fetch(`/api/guilds/${this.selectedGuildId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save guild settings");
      }

      const updatedConfig = await response.json();
      const index = this.guildConfigs.findIndex(
        (g) => (g.guildId || g.id) === this.selectedGuildId,
      );
      if (index !== -1) this.guildConfigs[index] = updatedConfig;
      else this.guildConfigs.push(updatedConfig);

      this.initializeGuildSelector();
      this.showMessage("Guild settings saved successfully", "success");
    } catch (error) {
      console.error("Failed to save guild settings:", error);
      this.showMessage(`Error: ${error.message}`, "error");
    }
  }

  /** Collect data from the settings form */
  getFormData() {
    const data = {
      guildId: document.getElementById("guild-id").value.trim(),
      name: document.getElementById("guild-name").value.trim(),
      summonerRole: document.getElementById("summoner-role").value.trim(),
      summonEmoji: document.getElementById("tool-emoji-summon").value.trim(),
      adminRoles: document
        .getElementById("admin-roles")
        .value.split(",")
        .map((role) => role.trim())
        .filter(Boolean),
      authorized: document.getElementById("guild-authorized").checked,
      whitelisted: document.getElementById("guild-authorized").checked, //for backward compatibility
      rateLimiting: {
        messages:
          parseInt(document.getElementById("rate-limit-messages").value, 10) ||
          5,
        interval:
          parseInt(document.getElementById("rate-limit-interval").value, 10) ||
          60,
      },
      toolEmojis: {},
      features: {
        breeding: document.getElementById("feature-breeding").checked,
        combat: document.getElementById("feature-combat").checked,
        itemCreation: document.getElementById("feature-item-creation").checked,
      },
      prompts: {
        intro: document.getElementById("intro-prompt").value.trim(),
        summon: document.getElementById("summon-prompt").value.trim(),
        attack: document.getElementById("attack-prompt").value.trim(),
        defend: document.getElementById("defend-prompt").value.trim(),
        breed: document.getElementById("breed-prompt").value.trim(),
      },
      viewDetailsEnabled: document.getElementById("feature-view-details").checked
    };
    const toolNames = ['summon','breed','attack','defend','move','remember','create','x','item','respond'];
    toolNames.forEach(toolName => {
      const input = document.getElementById(`tool-emoji-${toolName}`);
      if(input) {
        data.toolEmojis[toolName] = input.value.trim();
      }
    });

    // Avatar Tribe Restrictions
    const defaultMode = document.getElementById("avatar-tribe-mode").value;
    const defaultExceptions = document.getElementById("avatar-tribe-exceptions").value
      .split(",").map(e => e.trim()).filter(Boolean);
    const channelOverrides = {};
    document.getElementById("avatar-tribe-restrictions-channels").querySelectorAll(".avatar-tribe-override-row").forEach(row => {
      const channelId = row.querySelector(".avatar-tribe-channel-id").value.trim();
      const mode = row.querySelector(".avatar-tribe-mode-select").value;
      const exceptions = row.querySelector(".avatar-tribe-exceptions-input").value
        .split(",").map(e => e.trim()).filter(Boolean);
      if (channelId) channelOverrides[channelId] = { mode, emojis: exceptions };
    });
    data.avatarTribeRestrictions = { default: { mode: defaultMode, emojis: defaultExceptions }, channels: channelOverrides };
    return data;
  }

  /** Display a message to the user */
  showMessage(message, type = "info") {
    const messageContainer = document.getElementById("settings-message");
    if (!messageContainer) return;
    messageContainer.innerHTML = message;
    messageContainer.classList.remove(
      "hidden",
      "message-success",
      "message-error",
      "message-info"
    );
    messageContainer.classList.add(`message-${type}`);
    if (type !== "info") {
      setTimeout(() => messageContainer.classList.add("hidden"), 5000);
    }
  }

  /** Set up the manual whitelist button */
  setupManualWhitelistButton() {
    const manualWhitelistButton = document.getElementById(
      "manual-whitelist-button",
    );
    if (!manualWhitelistButton) return;

    manualWhitelistButton.addEventListener("click", () => {
      const guildIdInput = document.getElementById("manual-guild-id");
      const guildNameInput = document.getElementById("manual-guild-name");

      if (!guildIdInput || !guildIdInput.value) {
        this.showMessage("Please enter a Discord server ID", "error");
        return;
      }

      const guildId = guildIdInput.value.trim();
      const guildName = guildNameInput
        ? guildNameInput.value.trim()
        : `Server ${guildId}`;

      if (!/^\d+$/.test(guildId)) {
        this.showMessage("Guild ID must be a numeric string", "error");
        return;
      }

      this.whitelistGuild(guildId, guildName).then(() => {
        if (guildIdInput) guildIdInput.value = "";
        if (guildNameInput) guildNameInput.value = "";
      });
    });
  }

  /** Add a channel override row for avatar tribe restrictions */
  addAvatarTribeOverride(containerElement, channelId = "", config = { mode: "permit", emojis: [] }) {
    const container = containerElement || document.getElementById("avatar-tribe-restrictions-channels");
    const row = document.createElement("div");
    row.className = "avatar-tribe-override-row flex space-x-2 items-center mb-2";
    row.innerHTML = `
      <input type="text" placeholder="Channel ID" class="avatar-tribe-channel-id mt-1 block w-1/4 shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" value="${channelId}">
      <select class="avatar-tribe-mode-select mt-1 block w-1/4 shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500">
        <option value="permit">Permit</option>
        <option value="forbid">Forbid</option>
      </select>
      <input type="text" placeholder="Exceptions (comma-separated)" class="avatar-tribe-exceptions-input mt-1 block flex-1 shadow-sm sm:text-sm border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500" value="${(config.emojis||[]).join(", ")}">
      <button type="button" class="remove-avatar-tribe-override text-red-500 hover:text-red-700">&times;</button>
    `;
    const select = row.querySelector(".avatar-tribe-mode-select");
    select.value = config.mode || "permit";
    row.querySelector(".remove-avatar-tribe-override").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  /** Whitelist a guild manually */
  async whitelistGuild(guildId, guildName) {
    try {
      const newGuildConfig = { guildId, name: guildName, authorized: true, whitelisted: true };
      const response = await fetch("/api/guilds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newGuildConfig),
      });

      if (!response.ok) throw new Error(`HTTP error ${response.status}`);

      await this.loadGuildConfigs();
      this.initializeGuildSelector();
      this.showMessage(
        `Guild "${guildName}" (ID: ${guildId}) authorized successfully!`,
        "success",
      );
    } catch (error) {
      console.error("Failed to authorize guild:", error);
      this.showMessage(`Error authorizing guild: ${error.message}`, "error");
    }
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.guildSettingsManager = new GuildSettingsManager();
});