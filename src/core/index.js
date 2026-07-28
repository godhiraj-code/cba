'use strict';

const { Starlight } = require('./client');
const { Coordinator } = require('./coordinator');
const { ProtocolHub } = require('./hub');
const { Sentinel } = require('./sentinel');
const { METHODS, OUTCOME_STATUSES, PROTOCOL_VERSION } = require('./contract');
const { ProtocolError, ERROR_CODES } = require('./errors');
const { createTokenAuthenticator, digestToken, TOKEN_DIGEST_ALGORITHM } = require('./auth');

module.exports = {
    Coordinator,
    createTokenAuthenticator,
    digestToken,
    ERROR_CODES,
    METHODS,
    OUTCOME_STATUSES,
    PROTOCOL_VERSION,
    ProtocolError,
    ProtocolHub,
    Sentinel,
    Starlight,
    TOKEN_DIGEST_ALGORITHM
};
