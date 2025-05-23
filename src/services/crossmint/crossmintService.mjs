// services/marketplace/crossmintService.mjs
import axios from 'axios';
import crypto from 'crypto';

export class CrossmintService {
  constructor() {
    const  apiKey = process.env.CROSSMINT_API_KEY;
    const  collectionId = process.env.CROSSMINT_COLLECTION_ID;
    const  baseUrl = process.env.CROSSMINT_BASE_URL
        ?? 'https://staging.crossmint.com/api/2022-06-09';
    this.apiKey       = apiKey;
    this.collectionId = collectionId;
    this.baseUrl      = baseUrl.replace(/\/$/, '');
    this.http         = axios.create({
      baseURL: this.baseUrl,
      headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' }
    });
  }

  /* -------------------------------------------------------------------- */
  /*                              Templates                               */
  /* -------------------------------------------------------------------- */

  /** Create or upsert a template (1‑of‑1) for an avatar / item / location */
  async upsertTemplate(avatar) {
    const templateId = avatar.templateId
      ?? crypto.createHash('sha256').update(avatar.name).digest('hex').slice(0, 32);

    const body = {
      metadata: {
        name:        avatar.name,
        image:       avatar.imageUrl,
        description: avatar.description
          ?? `A unique CosyWorld ${avatar.kind ?? 'avatar'} named ${avatar.name}`,
        attributes: [
          { trait_type: 'Emoji',    value: avatar.emoji    ?? '✨' },
          { trait_type: 'Created',  value: new Date(avatar.createdAt ?? Date.now())
                                           .toISOString().split('T')[0] },
          { trait_type: 'Rarity',   value: this.#rarity(avatar) }
        ]
      },
      onChain: { tokenId: avatar.tokenId ?? null },
      supply:  { limit: 1 }
    };

    // idempotent PUT keeps it “upsert”
    const { data } = await this.http.put(
      `/collections/${this.collectionId}/templates/${templateId}`,
      body
    );

    return { templateId: data.templateId, raw: data };
  }

  /* -------------------------------------------------------------------- */
  /*                               Minting                                */
  /* -------------------------------------------------------------------- */

  /** Direct mint to a wallet (or e‑mail) */
  async mint(templateId, recipientWallet) {
    const { data } = await this.http.post(
      `/collections/${this.collectionId}/nfts`,
      { templateId, recipient: `eth:${recipientWallet}` }
    );
    return { mintId: data.id, raw: data };
  }

  /** Airdrop = mint + internal transfer; Crossmint treats it the same */
  async airdrop(templateId, recipientWallet) {
    return this.mint(templateId, recipientWallet);
  }

  /* -------------------------------------------------------------------- */
  /*                                Sales                                 */
  /* -------------------------------------------------------------------- */

  /**
   * Generates a checkout URL so users can self‑mint (credit‑card / crypto)
   * Requires that NFT Checkout is enabled for the collection in the console.
   * You may append utm params or wrap in a QR code generator upstream.
   */
  async getCheckoutUrl(templateId, options = {}) {
    // Crossmint’s pattern: https://www.crossmint.com/checkout/{collectionId}?template={templateId}
    // You can embed this in an <iframe> or QR.
    const prodBase = this.baseUrl.includes('staging')
      ? 'https://staging.crossmint.com/checkout'
      : 'https://www.crossmint.com/checkout';

    const url = new URL(`${prodBase}/${this.collectionId}`);
    url.searchParams.set('template', templateId);
    if (options.recipient) url.searchParams.set('recipient', options.recipient);
    if (options.email)     url.searchParams.set('email', options.email);
    return url.toString();
  }

  /* -------------------------------------------------------------------- */
  /*                               Status                                 */
  /* -------------------------------------------------------------------- */

  async getMintStatus(mintId) {
    const { data } = await this.http.get(
      `/collections/${this.collectionId}/nfts/${mintId}`
    );
    return { status: data.status, raw: data };
  }

  /* -------------------------------------------------------------------- */
  /*                            Helper logic                              */
  /* -------------------------------------------------------------------- */

  #rarity({ messageCount = 0 }) {
    if (messageCount >= 50) return 'Legendary';
    if (messageCount >= 20) return 'Rare';
    if (messageCount >= 5)  return 'Uncommon';
    return 'Common';
  }
}
