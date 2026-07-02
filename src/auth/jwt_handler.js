/**
 * Starlight Protocol - JWT Authentication Handler
 * 
 * Phase 1.1: Critical Security Fix
 * 
 * Provides JWT token generation, verification, and expiration handling.
 * Replaces plaintext token storage with industry-standard JWT.
 */

const crypto = require('crypto');

class JWTHandler {
    /**
     * Create JWT handler.
     * @param {object} config - Configuration
     * @param {string} config.secret - JWT secret (required)
     * @param {number} config.expiresIn - Token expiration in seconds (default: 3600)
     * @param {string} config.algorithm - Signing algorithm (default: HS256)
     */
    constructor(config = {}) {
        this.secret = config.secret || process.env.STARLIGHT_JWT_SECRET;

        if (!this.secret) {
            console.warn('[JWTHandler] No JWT secret provided - using random secret (not for production)');
            this.secret = crypto.randomBytes(32).toString('hex');
        }

        this.expiresIn = config.expiresIn || 3600; // 1 hour default
        this.algorithm = config.algorithm || 'HS256';
    }

    /**
     * Generate a JWT token.
     * @param {object} payload - Token payload
     * @returns {string} JWT token
     */
    generateToken(payload) {
        const header = {
            alg: this.algorithm,
            typ: 'JWT'
        };

        const now = Math.floor(Date.now() / 1000);
        const tokenPayload = {
            ...payload,
            iat: now,
            exp: now + this.expiresIn
        };

        const base64Header = this._base64UrlEncode(JSON.stringify(header));
        const base64Payload = this._base64UrlEncode(JSON.stringify(tokenPayload));

        const signature = this._sign(`${base64Header}.${base64Payload}`);

        return `${base64Header}.${base64Payload}.${signature}`;
    }

    /**
     * Verify a JWT token.
     * @param {string} token - JWT token to verify
     * @returns {object} Decoded payload if valid
     * @throws {Error} If token is invalid or expired
     */
    verifyToken(token) {
        if (!token || typeof token !== 'string') {
            throw new Error('Invalid token format');
        }

        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid token structure');
        }

        const [base64Header, base64Payload, signature] = parts;

        const header = JSON.parse(this._base64UrlDecode(base64Header));
        if (header.alg !== this.algorithm || header.typ !== 'JWT') {
            throw new Error('Unsupported token algorithm');
        }

        // Verify signature
        const expectedSignature = this._sign(`${base64Header}.${base64Payload}`);
        if (!this._timingSafeEqual(signature, expectedSignature)) {
            throw new Error('Invalid token signature');
        }

        // Decode payload
        const payload = JSON.parse(this._base64UrlDecode(base64Payload));

        // Check expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            throw new Error('Token has expired');
        }

        return payload;
    }

    /**
     * Refresh a token (generate new token with same payload).
     * @param {string} token - Existing token
     * @returns {string} New token with refreshed expiration
     */
    refreshToken(token) {
        const payload = this.verifyToken(token);
        // Remove timing fields for regeneration
        delete payload.iat;
        delete payload.exp;
        return this.generateToken(payload);
    }

    /**
     * Sign data using HMAC-SHA256.
     * @private
     */
    _sign(data) {
        return crypto
            .createHmac('sha256', this.secret)
            .update(data)
            .digest('base64url');
    }

    /**
     * Base64URL encode.
     * @private
     */
    _base64UrlEncode(str) {
        return Buffer.from(str)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    /**
     * Base64URL decode.
     * @private
     */
    _base64UrlDecode(str) {
        // Add padding if needed
        let padded = str;
        while (padded.length % 4) {
            padded += '=';
        }
        return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    }

    /**
     * Timing-safe string comparison to prevent timing attacks.
     * @private
     */
    _timingSafeEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }
}

module.exports = { JWTHandler };
