export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export class SchemaValidator {
    constructor(options?: { schemaPath?: string });
    validate(message: unknown): ValidationResult;
}

export const SCHEMA_PATH: string;
