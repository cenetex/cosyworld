/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';
import { encrypt } from '../../../../utils/encryption.mjs';
import { ObjectId } from 'mongodb';

const DEFAULT_TOKEN_EXPIRY = 7200; // 2 hours in seconds
const AUTH_SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

// Accepts a services object with xService and databaseService
export default function xauthRoutes(services) {
    const router = express.Router();
    const xService = services.xService;

    router.get('/auth-url', async (req, res) => {
        const { avatarId } = req.query;
        
        // Check for regular headers first, then x-prefixed headers
        const walletAddress = req.headers['x-wallet-address'];
        const signature = req.headers['x-signature'];
        const message = req.headers['x-message'];
        
        console.log('Received headers:', { 
            walletAddress, 
            signature, 
            message,
            'raw headers': req.headers
        });
        
        if (!avatarId) {
            return res.status(400).json({ error: 'Missing avatarId parameter' });
        }
    
        if (!walletAddress || !signature || !message) {
            return res.status(401).json({ error: 'Missing walletAddress, signature, or message in headers' });
        }

        // Ensure X integration config is present
        if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !process.env.X_CALLBACK_URL) {
            console.error('X auth config missing', {
              X_CLIENT_ID: process.env.X_CLIENT_ID,
              X_CLIENT_SECRET: !!process.env.X_CLIENT_SECRET,
              X_CALLBACK_URL: process.env.X_CALLBACK_URL
            });
            return res.status(500).json({ error: 'X integration is not configured on server' });
        }
    
        try {
            const db = await services.databaseService.getDatabase();
            // Use xService for signature verification
            if (!services.xService.verifyWalletSignature(message, signature, walletAddress)) {
                console.log('Signature verification failed:', { message, signature, walletAddress });
                return res.status(401).json({ error: 'Invalid signature' });
            }
            
            console.log('Signature verification result: true', { walletAddress });
            
            // Check if this wallet has claimed the avatar
            const claimRecord = await db.collection('avatar_claims').findOne({ 
                avatarId: ObjectId.createFromHexString(avatarId), // Ensure avatarId is treated as ObjectId
                walletAddress // Use walletAddress as is, without normalization
            });

            if (claimRecord) {
                // Ensure the walletAddress is stored in its original case
                await db.collection('avatar_claims').updateOne(
                    { _id: claimRecord._id },
                    { $set: { walletAddress } }
                );
            }
            
            console.log('Claim record check:', { 
                found: !!claimRecord, 
                avatarId, 
                walletAddress: walletAddress,
                claimRecord: claimRecord || 'Not found'
            });
            
            if (!claimRecord) {
                // Try to find the claim to check if a different wallet claimed it
                const anyClaimRecord = await db.collection('avatar_claims').findOne({ avatarId });
                console.log('Any claim record:', { found: !!anyClaimRecord, record: anyClaimRecord || 'None' });
                
                return res.status(403).json({ error: 'Unauthorized: Wallet does not match the claimer of the avatar' });
            }
            
            // Initialize or get the x_auth record
            let authRecord = await db.collection('x_auth').findOne({ avatarId });
            
            if (!authRecord) {
                // Create a new record if it doesn't exist
                await db.collection('x_auth').insertOne({
                    avatarId,
                    walletAddress: walletAddress,
                    createdAt: new Date()
                });
                authRecord = { avatarId, walletAddress: walletAddress };
            } else {
                // Update the wallet address if it doesn't match
                if (authRecord.walletAddress !== walletAddress) {
                    await db.collection('x_auth').updateOne(
                        { avatarId },
                        { $set: { walletAddress: walletAddress } }
                    );
                    authRecord.walletAddress = walletAddress;
                }
            }
    
            const state = crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + AUTH_SESSION_TIMEOUT);
    
            const client = new TwitterApi({
                clientId: process.env.X_CLIENT_ID,
                clientSecret: process.env.X_CLIENT_SECRET,
            });
    
            // Let the library generate codeChallenge from the codeVerifier.
            const { url, codeVerifier } = client.generateOAuth2AuthLink(process.env.X_CALLBACK_URL, {
                scope: [
                    'tweet.read', 
                    'tweet.write', 
                    'users.read', 
                    'follows.write', 
                    'like.write', 
                    'block.write', 
                    'offline.access',
                    'media.write'
                ].join(' '),
                state,
            });
    
            // Clean up old entries for this avatarId
            await db.collection('x_auth_temp').deleteMany({ avatarId });
    
            // Store the codeVerifier and state for later token exchange.
            await db.collection('x_auth_temp').insertOne({
                avatarId,
                codeVerifier,
                state,
                createdAt: new Date(),
                expiresAt,
            });
    
            console.log('Generated auth URL:', url, { avatarId, state, codeVerifier });
            res.json({ url, state });
        } catch (error) {
            console.error('Auth URL generation failed:', error.message, { avatarId });
            // Return actual error message for debugging
            const msg = error.message || 'Failed to generate authorization URL';
            res.status(500).json({ error: msg });
        }
    });

    router.get('/callback', async (req, res) => {
        const { code, state } = req.query;
        const db = await services.databaseService.getDatabase();

        if (!code || !state) {
            console.error('Callback missing parameters:', { code: !!code, state: !!state });
            return res.status(400).json({ error: 'Missing code or state parameter' });
        }

        try {
            const db = await services.databaseService.getDatabase();
            const sanitizedState = state.trim();
            const storedAuth = await db.collection('x_auth_temp').findOne({ state: sanitizedState });

            if (!storedAuth) {
                console.error('No session found for state:', sanitizedState);
                return res.status(400).json({ error: 'Invalid or unknown state' });
            }

            if (new Date() > new Date(storedAuth.expiresAt)) {
                console.error('Session expired:', { state: sanitizedState, expiresAt: storedAuth.expiresAt });
                await db.collection('x_auth_temp').deleteOne({ state: sanitizedState });
                return res.status(400).json({ error: 'Authentication session expired' });
            }

            const client = new TwitterApi({
                clientId: process.env.X_CLIENT_ID,
                clientSecret: process.env.X_CLIENT_SECRET,
            });

            console.log('Token exchange details:', {
                code,
                codeVerifier: storedAuth.codeVerifier,
                redirectUri: process.env.X_CALLBACK_URL,
                avatarId: storedAuth.avatarId,
            });

            const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
                code,
                codeVerifier: storedAuth.codeVerifier,
                redirectUri: process.env.X_CALLBACK_URL,
            });

            const expiresAt = new Date(Date.now() + (expiresIn || DEFAULT_TOKEN_EXPIRY) * 1000);
            await db.collection('x_auth').updateOne(
                { avatarId: storedAuth.avatarId },
                {
                    $set: {
                        accessToken: encrypt(accessToken),
                        refreshToken: encrypt(refreshToken),
                        expiresAt,
                        updatedAt: new Date(),
                    },
                },
                { upsert: true }
            );

            await db.collection('x_auth_temp').deleteOne({ state: sanitizedState });
            console.log('Authentication successful:', { avatarId: storedAuth.avatarId });

            res.send(`
                <script>
                    window.opener.postMessage({ type: 'X_AUTH_SUCCESS' }, '*');
                    window.close();
                </script>
            `);
        } catch (error) {
            console.error('Callback error:', {
                message: error.message,
                code: error.code,
                data: error.data || 'No additional data provided',
                state,
            });
            res.send(`
                <script>
                    window.opener.postMessage({ type: 'X_AUTH_ERROR', error: '${error.message}' }, '*');
                    window.close();
                </script>
            `);
        }
    });

    router.get('/status/:avatarId', async (req, res) => {
        const { avatarId } = req.params;

        try {
            const db = await services.databaseService.getDatabase();
            const auth = await db.collection('x_auth').findOne({ avatarId });
            if (!auth) {
                return res.json({ authorized: false });
            }

            const now = new Date();
            if (now >= new Date(auth.expiresAt) && auth.refreshToken) {
                try {
                    // Use xService for token refresh
                    const { expiresAt } = await xService.refreshAccessToken(auth);
                    return res.json({ authorized: true, expiresAt });
                } catch (error) {
                    return res.json({ authorized: false, error: 'Token refresh failed', requiresReauth: true });
                }
            }

            const client = new TwitterApi(auth.accessToken);
            await client.v2.me();
            res.json({ authorized: true, expiresAt: auth.expiresAt });
        } catch (error) {
            console.error('Status check failed:', error.message, { avatarId });
            if (error.code === 401) {
                await db.collection('x_auth').deleteOne({ avatarId });
                return res.json({ authorized: false, error: 'Token invalid', requiresReauth: true });
            }
            res.status(500).json({ error: 'Status check failed' });
        }
    });

    router.get('/verify-wallet/:avatarId', async (req, res) => {
        const { avatarId } = req.params;

        try {
            const auth = await db.collection('x_auth').findOne({ avatarId });
            if (!auth) {
                return res.json({ authorized: false });
            }

            const now = new Date();
            if (now >= new Date(auth.expiresAt) && auth.refreshToken) {
                try {
                    // Use xService for token refresh
                    const { expiresAt } = await xService.refreshAccessToken(auth);
                    return res.json({ authorized: true, walletAddress: auth.walletAddress, expiresAt });
                } catch (error) {
                    return res.json({ authorized: false, error: 'Token refresh failed', requiresReauth: true });
                }
            }

            const client = new TwitterApi(auth.accessToken);
            await client.v2.me();
            res.json({
                authorized: now < new Date(auth.expiresAt),
                walletAddress: auth.walletAddress || null,
                expiresAt: auth.expiresAt,
            });
        } catch (error) {
            console.error('Wallet verification failed:', error.message, { avatarId });
            if (error.code === 401) {
                await db.collection('x_auth').deleteOne({ avatarId });
                return res.json({ authorized: false, error: 'Token invalid', requiresReauth: true });
            }
            res.status(500).json({ error: 'Wallet verification failed' });
        }
    });

    router.post('/connect-wallet', async (req, res) => {
        const { avatarId, walletAddress, signature, message } = req.body;
        const db = await services.databaseService.getDatabase();

        if (!avatarId || !walletAddress || !signature || !message) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        try {
            const db = await services.databaseService.getDatabase();
            // Use xService for signature verification
            if (!services.xService.verifyWalletSignature(message, signature, walletAddress)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }

            const result = await db.collection('x_auth').updateOne(
                { avatarId },
                { $set: { walletAddress, updatedAt: new Date() } }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ error: 'Authentication record not found' });
            }

            console.log('Wallet connected:', { avatarId, walletAddress });
            res.json({ success: true });
        } catch (error) {
            console.error('Wallet connection failed:', error.message, { avatarId });
            res.status(500).json({ error: 'Failed to connect wallet' });
        }
    });

    router.post('/disconnect/:avatarId', async (req, res) => {
        const { avatarId } = req.params;

        try {
            const db = await services.databaseService.getDatabase();
            const result = await db.collection('x_auth').deleteOne({ avatarId });
            console.log('Disconnect result:', { avatarId, deleted: result.deletedCount > 0 });
            res.json({ success: true, disconnected: result.deletedCount > 0 });
        } catch (error) {
            console.error('Disconnect failed:', error.message, { avatarId });
            res.status(500).json({ error: 'Failed to disconnect' });
        }
    });

    return router;
}