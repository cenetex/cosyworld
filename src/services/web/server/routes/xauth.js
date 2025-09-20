/**
 * Copyright (c) 2019-2024 Cenetex Inc.
 * Licensed under the MIT License.
 */

import express from 'express';
import { useNonce, issueNonce } from '../middleware/nonceStore.js';
import crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';
import { encrypt, decrypt } from '../../../../utils/encryption.mjs';
import { ObjectId } from 'mongodb';

const DEFAULT_TOKEN_EXPIRY = 7200; // 2 hours in seconds
const AUTH_SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

// Accepts a services object with xService and databaseService
export default function xauthRoutes(services) {
    const router = express.Router();
    const xService = services.xService;
    // Resolve a stable admin identity for X without requiring ADMIN_AVATAR_ID.
    // Fallback uses the default AI chat model name to generate a deterministic id.
    const getAdminAvatarId = () => {
        const envId = (process.env.ADMIN_AVATAR_ID || process.env.ADMIN_AVATAR || '').trim();
        if (envId) return envId;
        try {
            const cfgSvc = services?.configService;
            const aiCfg = cfgSvc?.getAIConfig ? cfgSvc.getAIConfig(process.env.AI_SERVICE) : null;
            const model = aiCfg?.chatModel || aiCfg?.model || process.env.OPENROUTER_CHAT_MODEL || process.env.GOOGLE_AI_CHAT_MODEL || 'default';
            const safe = String(model).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
            return `model:${safe}`;
        } catch {
            return 'model:default';
        }
    };
    const isAdmin = (req) => !!req?.user?.isAdmin;
    const getCallbackUrl = () => {
        const envCb = process.env.X_CALLBACK_URL?.trim();
        if (envCb) return envCb;
        try {
            const base = services?.configService?.get('server.publicUrl') || services?.configService?.get('server.baseUrl') || 'http://localhost:3000';
            return `${base.replace(/\/$/, '')}/api/xauth/callback`;
        } catch {
            return 'http://localhost:3000/api/xauth/callback';
        }
    };

    // Issue nonce for client to sign (separate endpoint)
    router.get('/nonce', (req, res) => {
        const { nonce, exp } = issueNonce();
        res.json({ nonce, expiresAt: exp });
    });

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
        // Parse nonce in message (expect JSON with nonce) ensure single-use
        try {
            const parsed = JSON.parse(message);
            if (!parsed?.nonce || !useNonce(parsed.nonce)) {
                return res.status(400).json({ error: 'Nonce invalid or already used' });
            }
        } catch { return res.status(400).json({ error: 'Invalid signed message JSON' }); }

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
            const { url, codeVerifier } = client.generateOAuth2AuthLink(getCallbackUrl(), {
                scope: [
                    'tweet.read',
                    'tweet.write',
                    'users.read',
                    'follows.write',
                    'like.write',
                    'block.write',
                    'offline.access',
                    'media.write',
                ],
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
            // Audit log
            try { services?.auditLogService?.log?.({ action: 'xauth.request', actor: walletAddress, details: { avatarId, state }, ip: req.ip }); } catch {}
            res.json({ url, state });
        } catch (error) {
            console.error('Auth URL generation failed:', error.message, { avatarId });
            // Return actual error message for debugging
            const msg = error.message || 'Failed to generate authorization URL';
            res.status(500).json({ error: msg });
        }
    });

    // Admin-only: get target admin avatar id for UI
    router.get('/admin/target', async (req, res) => {
        try {
            if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
            const avatarId = getAdminAvatarId();
            // Always return a deterministic target id, even if env is not set
            return res.json({ avatarId });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to fetch admin target' });
        }
    });

    // Admin-only OAuth2 init: bypass wallet signature and claim checks
    router.get('/admin/auth-url', async (req, res) => {
        try {
            if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
            const avatarId = getAdminAvatarId();

            if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !process.env.X_CALLBACK_URL) {
                return res.status(500).json({ error: 'X integration is not configured on server' });
            }

            const db = await services.databaseService.getDatabase();

            // Ensure a base x_auth record exists
            await db.collection('x_auth').updateOne(
                { avatarId },
                { $setOnInsert: { avatarId, createdAt: new Date() }, $set: { updatedAt: new Date() } },
                { upsert: true }
            );

            const state = crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + AUTH_SESSION_TIMEOUT);

            const client = new TwitterApi({
                clientId: process.env.X_CLIENT_ID,
                clientSecret: process.env.X_CLIENT_SECRET,
            });

            const { url, codeVerifier } = client.generateOAuth2AuthLink(getCallbackUrl(), {
                scope: [
                    'tweet.read',
                    'tweet.write',
                    'users.read',
                    'follows.write',
                    'like.write',
                    'block.write',
                    'offline.access',
                    'media.write',
                ],
                state,
            });

            await db.collection('x_auth_temp').deleteMany({ avatarId });
            await db.collection('x_auth_temp').insertOne({ avatarId, codeVerifier, state, createdAt: new Date(), expiresAt });

            try { services?.auditLogService?.log?.({ action: 'xauth.admin.request', actor: req.user?.walletAddress, details: { avatarId, state }, ip: req.ip }); } catch {}
            return res.json({ url, state });
        } catch (error) {
            console.error('Admin auth-url failed:', error);
            return res.status(500).json({ error: 'Failed to generate admin authorization URL' });
        }
    });

    // Admin-only: initiate OAuth for a specific avatar (repair/re-authorize)
    router.get('/admin/auth-url/:avatarId', async (req, res) => {
        try {
            if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
            const avatarId = req.params.avatarId;

            if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

            if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !process.env.X_CALLBACK_URL) {
                return res.status(500).json({ error: 'X integration is not configured on server' });
            }

            const db = await services.databaseService.getDatabase();

            // Ensure a base x_auth record exists for this avatar
            await db.collection('x_auth').updateOne(
                { avatarId },
                { $setOnInsert: { avatarId, createdAt: new Date() }, $set: { updatedAt: new Date() } },
                { upsert: true }
            );

            const state = crypto.randomBytes(16).toString('hex');
            const expiresAt = new Date(Date.now() + AUTH_SESSION_TIMEOUT);

            const client = new TwitterApi({
                clientId: process.env.X_CLIENT_ID,
                clientSecret: process.env.X_CLIENT_SECRET,
            });

            const { url, codeVerifier } = client.generateOAuth2AuthLink(getCallbackUrl(), {
                scope: [
                    'tweet.read',
                    'tweet.write',
                    'users.read',
                    'follows.write',
                    'like.write',
                    'block.write',
                    'offline.access',
                    'media.write',
                ],
                state,
            });

            await db.collection('x_auth_temp').deleteMany({ avatarId });
            await db.collection('x_auth_temp').insertOne({ avatarId, codeVerifier, state, createdAt: new Date(), expiresAt });

            return res.json({ url, state });
        } catch (error) {
            console.error('Admin per-avatar auth-url failed:', error);
            return res.status(500).json({ error: 'Failed to generate authorization URL' });
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
                redirectUri: getCallbackUrl(),
                avatarId: storedAuth.avatarId,
            });

            const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
                code,
                codeVerifier: storedAuth.codeVerifier,
                redirectUri: getCallbackUrl(),
            });

            const expiresAt = new Date(Date.now() + (expiresIn || DEFAULT_TOKEN_EXPIRY) * 1000);
            // Fetch and store lightweight profile to present in admin UI
            let profile = null;
            try {
                const profileClient = new TwitterApi(accessToken);
                const me = await profileClient.v2.me({ 'user.fields': 'profile_image_url,username,name' });
                profile = me?.data || null;
            } catch (e) {
                // Non-fatal: proceed without profile if request fails
                console.warn('xauth profile fetch failed:', e?.message || e);
            }

            await db.collection('x_auth').updateOne(
                { avatarId: storedAuth.avatarId },
                {
                    $set: {
                        accessToken: encrypt(accessToken),
                        refreshToken: encrypt(refreshToken),
                        expiresAt,
                        updatedAt: new Date(),
                        ...(profile ? { profile } : {}),
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

            const client = new TwitterApi(decrypt(auth.accessToken));
            const me = await client.v2.me({
                'user.fields': ['profile_image_url', 'username', 'name', 'id'].join(',')
            });
            const user = me?.data || null;
            res.json({ authorized: true, expiresAt: auth.expiresAt, profile: user });
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
                    return res.json({ authorized: true, walletAddress: auth.walletAddress, expiresAt });
                } catch (error) {
                    return res.json({ authorized: false, error: 'Token refresh failed', requiresReauth: true });
                }
            }

            const client = new TwitterApi(decrypt(auth.accessToken));
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

    // Admin-only: fetch current profile of admin-linked X account (if any)
    router.get('/admin/profile', async (req, res) => {
        try {
            if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
            const avatarId = getAdminAvatarId();
            const db = await services.databaseService.getDatabase();
            const auth = await db.collection('x_auth').findOne({ avatarId });
            if (!auth?.accessToken) return res.json({ authorized: false });
            const client = new TwitterApi(decrypt(auth.accessToken));
            const me = await client.v2.me({ 'user.fields': 'profile_image_url,username,name' });
            return res.json({ authorized: true, expiresAt: auth.expiresAt, profile: me?.data || null });
        } catch (e) {
            console.error('Admin profile fetch failed:', e);
            return res.status(500).json({ error: 'Failed to fetch profile' });
        }
    });

    // Admin-only: disconnect admin-linked X account
    router.post('/admin/disconnect', async (req, res) => {
        try {
            if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
            const avatarId = getAdminAvatarId();
            const db = await services.databaseService.getDatabase();
            const result = await db.collection('x_auth').deleteOne({ avatarId });
            return res.json({ success: true, disconnected: result.deletedCount > 0 });
        } catch (e) {
            console.error('Admin disconnect failed:', e);
            return res.status(500).json({ error: 'Failed to disconnect' });
        }
    });

    return router;
}