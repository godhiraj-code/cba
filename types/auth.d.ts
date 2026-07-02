export interface JWTConfig {
    secret?: string;
    expiresIn?: number;
    algorithm?: 'HS256';
}

export class JWTHandler {
    constructor(config?: JWTConfig);
    generateToken(payload: Record<string, unknown>): string;
    verifyToken(token: string): Record<string, unknown>;
    refreshToken(token: string): string;
}
