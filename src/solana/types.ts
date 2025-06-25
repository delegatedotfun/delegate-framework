import { QuoteResponse } from "@jup-ag/api";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Configuration interface for HeliusClient
 */
export interface HeliusConfig {
    apiKey: string;
    rpcUrl?: string;
    timeout?: number;
    retries?: number;
    logger?: Logger;
}

/**
 * Configuration interface for SplClient
 */
export interface SplConfig {
    connection: Connection;
    programId: PublicKey;
    timeout?: number;
    retries?: number;
    logger?: Logger;
}

/**
 * Configuration interface for JupiterClient
 */
export interface JupiterConfig {
    quoteApiUrl?: string;
    timeout?: number;
    retries?: number;
    logger?: Logger;
}

/**
 * Options for getting the latest blockhash
 */
export interface GetLatestBlockhashOptions {
    commitment?: 'processed' | 'confirmed' | 'finalized';
    minContextSlot?: number;
}

/**
 * Logger interface for debugging and monitoring
 */
export interface Logger {
    debug(message: string, data?: any): void;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, data?: any): void;
}

/**
 * RPC request interface
 */
export interface RpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params: any[];
}
  
/**
 * RPC response interface
 */
export interface RpcResponse<T = any> {
    jsonrpc: '2.0';
    id: number;
    result?: T;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
} 

/**
 * Options for getting priority fee
 */
export interface GetPriorityFeeOptions {
    percentile?: number;
    defaultCuPrice?: number;
}

export interface SwapParams {
    quoteResponse: QuoteResponse;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    feeAccount?: string;
    dynamicComputeUnitLimit?: boolean;
    prioritizationFeeLamports?: string;
}

/**
 * Options for sending transactions
 */
export interface SendTransactionOptions {
    skipPreflight?: boolean;
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
    encoding?: 'base58' | 'base64';
}