/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 */

// import Arweave only when needed; currently unused to satisfy lint
import fetch from 'node-fetch';

export class ArweaveService {
    constructor({
        configService,
        databaseService,
        logger
    }) {
        this.configService = configService;
        this.databaseService = databaseService;
        this.logger = logger;
        //this.arweave = new Arweave({ host: this.configService.get('arweave.host'), port: this.configService.get('arweave.port'), protocol: this.configService.get('arweave.protocol') });
    }
    
    async initialize() {
    }

    async getTransactionData(transactionId) {
        try {
            const tx = await this.arweave.transactions.get(transactionId);
            return tx;
        } catch (error) {
            this.logger.error(`Error fetching transaction data: ${error}`);
            throw error;
        }
    }

    async uploadData(data) {
        try {
            const transaction = await this.arweave.createTransaction({ data });
            await this.arweave.transactions.sign(transaction);
            const response = await this.arweave.transactions.post(transaction);
            return response;
        } catch (error) {
            this.logger.error(`Error uploading data: ${error}`);
            throw error;
        }
    }
    async getData(transactionId) {
        try {
            const _transaction = await this.arweave.transactions.get(transactionId);
            const data = await this.arweave.transactions.getData(transactionId, { decode: true, string: true });
            return data;
        } catch (error) {
            this.logger.error(`Error fetching data: ${error}`);
            throw error;
        }
    }

    async getTransactionStatus(transactionId) {
        try {
            const s = await this.arweave.transactions.getStatus(transactionId);
            return s;
        } catch (error) {
            this.logger.error(`Error fetching transaction status: ${error}`);
            throw error;
        }
    }

    async getTransactionConfirmation(transactionId) {
        try {
            const confirmation = await this.arweave.transactions.getConfirmation(transactionId);
            return confirmation;
        } catch (error) {
            this.logger.error(`Error fetching transaction confirmation: ${error}`);
            throw error;
        }
    }

    async getTransactionTags(transactionId) {
        try {
            const transaction = await this.arweave.transactions.get(transactionId);
            return transaction.tags;
        } catch (error) {
            this.logger.error(`Error fetching transaction tags: ${error}`);
            throw error;
        }
    }

    async getTransactionOwner(transactionId) {
        try {
            const t = await this.arweave.transactions.get(transactionId);
            return t.owner;
        } catch (error) {
            this.logger.error(`Error fetching transaction owner: ${error}`);
            throw error;
        }
    }

    /**
     * Upload avatar metadata to Arweave with NFT tags
     * @param {Object} avatar - Avatar object
     * @param {Object} metadata - NFT metadata (Base or Solana format)
     * @param {Object} options - Upload options
     * @param {string} options.chain - 'base' or 'solana'
     * @returns {Object} Transaction details {txId, url, status}
     */
    async uploadAvatarMetadata(avatar, metadata, options = {}) {
        const { chain = 'base' } = options;
        
        try {
            const jsonData = JSON.stringify(metadata, null, 2);
            
            // Create transaction with tags for filtering
            const transaction = await this.arweave.createTransaction({ 
                data: jsonData 
            });
            
            // Add NFT-specific tags
            transaction.addTag('Content-Type', 'application/json');
            transaction.addTag('App-Name', 'CosyWorld');
            transaction.addTag('Type', 'NFT-Metadata');
            transaction.addTag('Chain', chain);
            transaction.addTag('Avatar-ID', avatar._id?.toString() || avatar.id);
            transaction.addTag('Avatar-Name', avatar.name || 'Unknown');
            
            if (chain === 'base') {
                transaction.addTag('Standard', 'ERC-721');
            } else if (chain === 'solana') {
                transaction.addTag('Standard', 'Metaplex');
            }
            
            // Sign and post transaction
            await this.arweave.transactions.sign(transaction);
            const response = await this.arweave.transactions.post(transaction);
            
            const txId = transaction.id;
            const url = `https://arweave.net/${txId}`;
            
            this.logger?.info?.(`[ArweaveService] Uploaded ${chain} metadata for avatar: ${avatar.name} (TX: ${txId})`);
            
            return {
                txId,
                url,
                status: response.status,
                statusText: response.statusText,
                chain,
                type: 'metadata'
            };
        } catch (error) {
            this.logger?.error?.(`[ArweaveService] Error uploading avatar metadata: ${error}`);
            throw error;
        }
    }

    /**
     * Upload avatar image to Arweave
     * @param {string} imageUrl - URL of the image to upload
     * @param {Object} avatar - Avatar object for tagging
     * @returns {Object} Transaction details {txId, url, status}
     */
    async uploadAvatarImage(imageUrl, avatar) {
        try {
            // Fetch image data
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            
            const imageBuffer = await response.buffer();
            const contentType = response.headers.get('content-type') || 'image/png';
            
            // Create transaction
            const transaction = await this.arweave.createTransaction({ 
                data: imageBuffer 
            });
            
            // Add tags
            transaction.addTag('Content-Type', contentType);
            transaction.addTag('App-Name', 'CosyWorld');
            transaction.addTag('Type', 'Avatar-Image');
            transaction.addTag('Avatar-ID', avatar._id?.toString() || avatar.id);
            transaction.addTag('Avatar-Name', avatar.name || 'Unknown');
            
            // Sign and post
            await this.arweave.transactions.sign(transaction);
            const postResponse = await this.arweave.transactions.post(transaction);
            
            const txId = transaction.id;
            const url = `https://arweave.net/${txId}`;
            
            this.logger?.info?.(`[ArweaveService] Uploaded image for avatar: ${avatar.name} (TX: ${txId})`);
            
            return {
                txId,
                url,
                status: postResponse.status,
                statusText: postResponse.statusText,
                contentType,
                type: 'image'
            };
        } catch (error) {
            this.logger?.error?.(`[ArweaveService] Error uploading avatar image: ${error}`);
            throw error;
        }
    }

    /**
     * Upload complete NFT deployment to Arweave
     * Uploads both image and metadata, returns both transaction details
     * @param {Object} avatar - Avatar object
     * @param {Object} metadata - Complete deployment manifest with base/solana metadata
     * @returns {Object} Complete deployment result
     */
    async uploadNftDeployment(avatar, metadata) {
        try {
            this.logger?.info?.(`[ArweaveService] Starting NFT deployment for avatar: ${avatar.name}`);
            
            // First upload the image
            const imageUrl = avatar.avatarImageUrl || avatar.generatedImageUrl;
            if (!imageUrl) {
                throw new Error('Avatar has no image URL');
            }
            
            const imageUpload = await this.uploadAvatarImage(imageUrl, avatar);
            
            // Update metadata with Arweave image URL
            const baseMetadata = {
                ...metadata.base,
                image: imageUpload.url
            };
            
            const solanaMetadata = {
                ...metadata.solana,
                image: imageUpload.url,
                properties: {
                    ...metadata.solana.properties,
                    files: [
                        {
                            uri: imageUpload.url,
                            type: imageUpload.contentType
                        }
                    ]
                }
            };
            
            // Upload both metadata manifests
            const [baseUpload, solanaUpload] = await Promise.all([
                this.uploadAvatarMetadata(avatar, baseMetadata, { chain: 'base' }),
                this.uploadAvatarMetadata(avatar, solanaMetadata, { chain: 'solana' })
            ]);
            
            this.logger?.info?.(`[ArweaveService] Completed NFT deployment for avatar: ${avatar.name}`);
            
            return {
                avatar: {
                    id: avatar._id?.toString() || avatar.id,
                    name: avatar.name
                },
                image: imageUpload,
                base: baseUpload,
                solana: solanaUpload,
                deployed: new Date().toISOString()
            };
        } catch (error) {
            this.logger?.error?.(`[ArweaveService] Error deploying NFT: ${error}`);
            throw error;
        }
    }

}