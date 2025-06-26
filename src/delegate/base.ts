import { Connection, Keypair } from "@solana/web3.js";
import { BaseDelegateOptions, BaseDelegateResult } from "./types";

export interface Delegate<T extends BaseDelegateOptions = BaseDelegateOptions, R extends BaseDelegateResult = BaseDelegateResult> {
    signerKeypair: Keypair;
    connection: Connection;
    feeTakerKeypair?: Keypair;
    executeDelegate(delegateOptions: T): Promise<R>;
    validateOptions(delegateOptions: T): void;
}

export interface DelegateUtilities {
    retryOperation<T>(operation: () => Promise<T>, maxRetries?: number): Promise<T>;
    handleError(error: Error, context?: Record<string, any>): Promise<void>;
    logOperation(operation: string, data?: Record<string, any>): void;
}