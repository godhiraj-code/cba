'use strict';

const crypto = require('node:crypto');

const TOKEN_DIGEST_ALGORITHM = 'sha256';

function digestToken(token) {
    if (typeof token !== 'string' || token.length < 16) {
        throw new TypeError('authentication tokens must contain at least 16 characters');
    }
    return crypto.createHash(TOKEN_DIGEST_ALGORITHM).update(token, 'utf8').digest('hex');
}

function createTokenAuthenticator(tokenDigests) {
    const allowed = new Set(tokenDigests || []);
    for (const digest of allowed) {
        if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
            throw new TypeError('tokenDigests must contain SHA-256 hex digests');
        }
    }
    return registration => {
        if (typeof registration.token !== 'string' || registration.token.length < 16) return false;
        const candidateHex = digestToken(registration.token);
        const candidate = Buffer.from(candidateHex, 'hex');
        for (const digest of allowed) {
            if (crypto.timingSafeEqual(candidate, Buffer.from(digest, 'hex'))) {
                return `token:${digest.toLowerCase()}`;
            }
        }
        return false;
    };
}

module.exports = { TOKEN_DIGEST_ALGORITHM, createTokenAuthenticator, digestToken };
