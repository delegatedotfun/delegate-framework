import { QuoteResponse } from "@jup-ag/api";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Represents a single transfer within a transaction
 */
export interface Transfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount?: number;
  tokenAmount?: number;
  mint?: string;
}

/**
 * Represents a complete Solana transaction with transfers
 */
export interface Transaction {
  signature: string;
  slot: number;
  timestamp: number;
  description: string;
  nativeTransfers: Transfer[];
  tokenTransfers: Transfer[];
}

/**
 * Configuration interface for HeliusClient
 */
export interface HeliusConfig {
    apiKey: string;
    rpcUrl?: string;
    enhancedApiUrl?: string;
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
 * Options for getting transactions
 */
export interface GetTransactionsOptions {
    limit?: number;
    before?: string;  // Fetch transactions before this signature (backward pagination)
    until?: string;   // Fetch transactions until this signature (exclusive, backward pagination)
    debug?: boolean;  // Enable detailed debug logging including batch signatures
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

/**
 * Options for native SOL transfers
 */
export interface NativeTransferOptions extends SendTransactionOptions {
    amount: number; // in lamports
}

/**
 * Options for SPL token transfers
 */
export interface TokenTransferOptions extends SendTransactionOptions {
    amount: number; // raw token amount (not adjusted for decimals)
    decimals?: number; // token decimals for amount conversion
}

/**
 * Options for getting account info with enhanced parsing
 */
export interface GetAccountInfoOptions {
    encoding?: 'base64' | 'base58' | 'jsonParsed';
    parseMetaplexMetadata?: boolean;
    includeOffChainMetadata?: boolean;
}

/**
 * Metaplex Creator information
 */
export interface MetaplexCreator {
    address: string;
    verified: boolean;
    share: number;
}

/**
 * Metaplex Collection information
 */
export interface MetaplexCollection {
    verified: boolean;
    key: string;
}

/**
 * Parsed Metaplex metadata structure
 */
export interface MetaplexMetadata {
    name: string;
    symbol: string;
    uri: string;
    sellerFeeBasisPoints: number;
    creators?: MetaplexCreator[];
    collection?: MetaplexCollection;
    uses?: {
        useMethod: string;
        remaining: number;
        total: number;
    };
    isMutable: boolean;
    editionNonce?: number;
    tokenStandard?: string;
    collectionDetails?: {
        __kind: string;
        [key: string]: any;
    };
    offChainMetadata?: any;
}