/**
 * Copyright (c) 2019-2025 Cenetex Inc.
 * Licensed under the MIT License.
 * 
 * @file src/services/web/server/middleware/x402.js
 * @description Express middleware for x402 payment verification
 */

/**
 * Create x402 payment middleware
 * @param {Object} options
 * @param {Object} options.x402Service - X402 payment service
 * @param {number|Function} options.price - Price in USDC (6 decimals) or function(req) => price
 * @param {string} [options.sellerAddress] - Override seller address
 * @param {Function} [options.onPaymentReceived] - Callback(req, paymentData)
 * @param {boolean} [options.optional=false] - Whether payment is optional
 * @returns {Function} Express middleware
 */
export function requirePayment(options) {
  const {
    x402Service,
    price,
    sellerAddress,
    onPaymentReceived,
    optional = false,
  } = options;

  if (!x402Service) {
    throw new Error('x402Service is required');
  }

  if (!price && !optional) {
    throw new Error('price is required (or set optional=true)');
  }

  return async (req, res, next) => {
    try {
      // Get price (could be dynamic based on request)
      const priceAmount = typeof price === 'function' ? price(req) : price;

      // Parse x402 metadata from header
      const metadataHeader = req.headers['x-x402-metadata'];
      let paymentPayload = null;

      if (metadataHeader) {
        try {
          // Decode base64 JSON
          const decoded = Buffer.from(metadataHeader, 'base64').toString('utf8');
          paymentPayload = JSON.parse(decoded);
        } catch (error) {
          return res.status(400).json({
            error: 'Invalid X-x402-Metadata header',
            message: error.message,
          });
        }
      }

      // If no payment and not optional, return 402
      if (!paymentPayload && !optional) {
        const paymentRequired = x402Service.generatePaymentRequired({
          amount: priceAmount,
          destination: sellerAddress,
          resource: req.path,
        });

        return res.status(402).json({
          error: 'Payment Required',
          message: 'This endpoint requires payment',
          payment: paymentRequired,
        });
      }

      // If payment provided, verify it
      if (paymentPayload) {
        const verification = await x402Service.verifyPayment({
          paymentPayload,
          expectedAmount: priceAmount,
          sellerAddress,
          metadata: {
            agentId: req.agentId,
            endpoint: req.path,
            method: req.method,
            timestamp: new Date(),
          },
        });

        if (!verification.verified) {
          return res.status(402).json({
            error: 'Payment verification failed',
            message: verification.reason || 'Payment could not be verified',
            payment: x402Service.generatePaymentRequired({
              amount: priceAmount,
              destination: sellerAddress,
              resource: req.path,
            }),
          });
        }

        // Payment verified - attach to request
        req.payment = {
          verified: true,
          settlementId: verification.settlementId,
          transactionId: verification.transactionId,
          amount: priceAmount,
        };

        // Call payment received callback
        if (onPaymentReceived) {
          try {
            await onPaymentReceived(req, req.payment);
          } catch (error) {
            req.log?.error('[x402Middleware] Payment callback error:', error);
          }
        }

        // Settle payment asynchronously (don't block request)
        if (verification.settlementId) {
          setImmediate(() => {
            x402Service.settlePayment({
              settlementId: verification.settlementId,
            }).catch((error) => {
              req.log?.error('[x402Middleware] Settlement error:', error);
            });
          });
        }
      }

      // Continue to route handler
      next();
    } catch (error) {
      req.log?.error('[x402Middleware] Error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  };
}

/**
 * Create middleware for agent-to-agent payments
 * Routes payment to service provider's wallet
 * 
 * @param {Object} options
 * @param {Object} options.x402Service - X402 payment service
 * @param {Object} options.agentWalletService - Agent wallet service
 * @param {number|Function} options.price - Price in USDC (6 decimals) or function(req) => price
 * @param {Function} [options.onPaymentReceived] - Callback(req, paymentData)
 * @returns {Function} Express middleware
 */
export function requireAgentPayment(options) {
  const {
    x402Service,
    agentWalletService,
    price,
    onPaymentReceived,
  } = options;

  if (!x402Service || !agentWalletService) {
    throw new Error('x402Service and agentWalletService are required');
  }

  if (!price) {
    throw new Error('price is required');
  }

  return async (req, res, next) => {
    try {
      // Get service provider agent ID (from route or query)
      const providerAgentId = req.params.agentId || req.query.agentId;
      
      if (!providerAgentId) {
        return res.status(400).json({
          error: 'Missing service provider',
          message: 'Agent ID is required',
        });
      }

      // Get or create wallet for provider
      const providerWallet = await agentWalletService.getOrCreateWallet(providerAgentId);
      
      // Get price
      const priceAmount = typeof price === 'function' ? price(req) : price;

      // Use regular x402 middleware with provider's address
      return requirePayment({
        x402Service,
        price: priceAmount,
        sellerAddress: providerWallet.address,
        onPaymentReceived: async (req, payment) => {
          // Credit provider's wallet (in production, this happens on-chain)
          await agentWalletService.fundWallet(providerAgentId, priceAmount);
          
          req.log?.info(
            `[x402Middleware] Agent ${providerAgentId} received ${priceAmount / 1e6} USDC`
          );

          // Call custom callback
          if (onPaymentReceived) {
            await onPaymentReceived(req, payment);
          }
        },
      })(req, res, next);
    } catch (error) {
      req.log?.error('[x402Middleware] Agent payment error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  };
}
