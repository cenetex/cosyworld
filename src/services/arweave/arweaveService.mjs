/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

// import Arweave only when needed; currently unused to satisfy lint

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

}