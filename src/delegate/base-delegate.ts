import { Connection, Keypair } from "@solana/web3.js";
import { Delegate, DelegateUtilities } from "./base";
import { BaseDelegateOptions, BaseDelegateResult } from "./types";

export abstract class BaseDelegate<T extends BaseDelegateOptions = BaseDelegateOptions, R extends BaseDelegateResult = BaseDelegateResult> 
    implements Delegate<T, R>, DelegateUtilities {
    
    public readonly signerKeypair: Keypair;
    public readonly connection: Connection;
    public readonly feeTakerKeypair?: Keypair;
    protected requestId = 0;

    constructor(connection: Connection, signerKeypair: Keypair, feeTakerKeypair?: Keypair) {
        this.connection = connection;
        this.signerKeypair = signerKeypair;
        this.feeTakerKeypair = feeTakerKeypair;
    }

    abstract executeDelegate(delegateOptions: T): Promise<R>;
    abstract validateOptions(delegateOptions: T): void;

    async retryOperation<U>(operation: () => Promise<U>, maxRetries: number = 3): Promise<U> {
        let lastError: Error;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                this.logOperation('retry_attempt_failed', {
                    error: lastError.message,
                    attempt,
                    maxRetries
                });

                if (attempt === maxRetries) {
                    throw lastError;
                }

                // Exponential backoff: wait 2^attempt seconds
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError!;
    }

    async handleError(error: Error, context?: Record<string, any>): Promise<void> {
        const errorContext = {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            ...context
        };

        this.logOperation('error_occurred', errorContext);
        
        // Could be extended to send to external logging service
        console.error('Delegate operation failed:', errorContext);
    }

    logOperation(operation: string, data?: Record<string, any>): void {
        const logData = {
            operation,
            timestamp: new Date().toISOString(),
            signer: this.signerKeypair.publicKey.toBase58(),
            ...data
        };

        console.log(`[Delegate] ${operation}:`, logData);
    }

    protected generateRequestId(): number {
        return ++this.requestId;
    }

    protected validatePublicKey(publicKeyString: string, fieldName: string): void {
        try {
            new (require("@solana/web3.js").PublicKey)(publicKeyString);
        } catch (error) {
            throw new Error(`Invalid ${fieldName}: ${publicKeyString}, must be a valid public key`);
        }
    }

    protected validateRequiredField(value: any, fieldName: string): void {
        if (!value) {
            throw new Error(`${fieldName} is required`);
        }
    }

    protected validateStringField(value: string, fieldName: string, minLength: number = 1): void {
        if (typeof value !== 'string') {
            throw new Error(`${fieldName} must be a non-empty string`);
        }
        if (value.length < minLength) {
            throw new Error(`${fieldName} must be a non-empty string`);
        }
    }

    protected validateNumberField(value: number, fieldName: string, min?: number, max?: number): void {
        if (typeof value !== 'number' || isNaN(value)) {
            throw new Error(`${fieldName} must be a valid number`);
        }
        if (min !== undefined && value < min) {
            throw new Error(`${fieldName} must be at least ${min}`);
        }
        if (max !== undefined && value > max) {
            throw new Error(`${fieldName} must be at most ${max}`);
        }
    }
} 