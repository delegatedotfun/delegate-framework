import { Transaction as SolanaTransaction, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferInstruction } from "@solana/spl-token";
import bs58 from "bs58";
import { throwError } from "../../utils/error-handling";
import { HeliusConfig, SendTransactionOptions, Logger, RpcRequest, RpcResponse, GetLatestBlockhashOptions, GetTransactionsOptions, Transaction, GetAccountInfoOptions, MetaplexMetadata } from "../types";

export class HeliusClient {
    private static readonly DEFAULT_TIMEOUT = 30000;
    private static readonly DEFAULT_RETRIES = 3;
    private static readonly DEFAULT_RPC_URL = "https://mainnet.helius-rpc.com";
    private static readonly DEFAULT_ENHANCED_API_URL = "https://api.helius.xyz/v0";
    private static readonly METAPLEX_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
    
    private readonly config: Omit<Required<HeliusConfig>, 'logger'> & { logger?: Logger };
    private readonly logger?: Logger;
    private requestId = 0;

    constructor(config: HeliusConfig) {
        this.config = {
            rpcUrl: HeliusClient.DEFAULT_RPC_URL,
            enhancedApiUrl: HeliusClient.DEFAULT_ENHANCED_API_URL,
            timeout: HeliusClient.DEFAULT_TIMEOUT,
            retries: HeliusClient.DEFAULT_RETRIES,
            ...config,
        };
        this.logger = this.config.logger;
    }

    /**
     * Send a transaction to the Solana network
     * @param transaction - The transaction to send
     * @param options - Optional configuration for the transaction
     * @returns Transaction signature
     */
    public async sendTransaction(
        transaction: SolanaTransaction, 
        options: SendTransactionOptions = {}
    ): Promise<string> {
        return this.makeRequest('sendTransaction', [
            bs58.encode(transaction.serialize()),
            {
                encoding: options.encoding || 'base58',
                skipPreflight: options.skipPreflight ?? false,
                preflightCommitment: options.preflightCommitment || 'confirmed',
            }
        ]);
    }

    /**
     * Send native SOL transfer
     * @param from - Source wallet keypair
     * @param to - Destination wallet public key
     * @param amount - Amount in lamports
     * @param options - Optional transaction options
     * @returns Transaction signature
     */
    public async sendNativeTransfer(
        from: Keypair,
        to: PublicKey,
        amount: number,
        options: SendTransactionOptions = {}
    ): Promise<string> {
        const transaction = new SolanaTransaction();
        
        try {
            // Get recent blockhash with retry mechanism
            this.logger?.debug('Fetching recent blockhash for native transfer...');
            const blockhashResponse = await this.getLatestBlockhashWithRetry();
            
            // Extract blockhash from the correct response structure
            let blockhash: string;
            
            if (blockhashResponse?.value?.blockhash) {
                // JSON-RPC response structure: { value: { blockhash: "...", lastValidBlockHeight: ... } }
                blockhash = blockhashResponse.value.blockhash;
            } else if (blockhashResponse?.blockhash) {
                // Direct blockhash property (backward compatibility)
                blockhash = blockhashResponse.blockhash;
            } else {
                throw new Error(`Invalid blockhash response structure: ${JSON.stringify(blockhashResponse)}`);
            }
            
            // Comprehensive validation
            if (!blockhash) {
                throw new Error('Blockhash is null or undefined');
            }
            
            if (typeof blockhash !== 'string') {
                throw new Error(`Blockhash is not a string: ${typeof blockhash}`);
            }
            
            if (blockhash.length === 0) {
                throw new Error('Blockhash is empty string');
            }
            
            // Validate blockhash format (base58, typical length)
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(blockhash)) {
                throw new Error(`Invalid blockhash format: ${blockhash}`);
            }
            
            this.logger?.debug(`Blockhash obtained: ${blockhash}`);
            
            // CORRECT ORDER: Set fee payer first, then add instructions, then set blockhash
            transaction.feePayer = from.publicKey;
            
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: from.publicKey,
                    toPubkey: to,
                    lamports: amount,
                })
            );
            
            // Set the blockhash AFTER adding instructions
            transaction.recentBlockhash = blockhash;
            
            // Verify transaction state before signing
            this.logger?.debug('Transaction state before signing:', {
                hasBlockhash: !!transaction.recentBlockhash,
                blockhash: transaction.recentBlockhash,
                feePayer: transaction.feePayer?.toString(),
                instructions: transaction.instructions.length
            });

            // Verify blockhash is set before signing
            if (!transaction.recentBlockhash) {
                throw new Error('Transaction blockhash not set before signing');
            }

            // Sign the transaction
            transaction.sign(from);

            return this.sendTransaction(transaction, options);
        } catch (error) {
            this.logger?.error('Error in sendNativeTransfer:', error);
            throw error;
        }
    }

    /**
     * Send SPL token transfer
     * @param to - Destination token account public key
     * @param owner - Owner keypair of the source token account
     * @param amount - Amount to transfer
     * @param mint - Token mint address
     * @param options - Optional transaction options
     * @returns Transaction signature
     */
    public async sendTokenTransfer(
        to: PublicKey,
        owner: Keypair,
        amount: number,
        mint: PublicKey,
        options: SendTransactionOptions = {}
    ): Promise<string> {
        const transaction = new SolanaTransaction();
        
        try {
            // Get the source token account for this owner and mint
            const sourceTokenAccount = await this.getTokenAccount(owner.publicKey, mint);
            
            if (!sourceTokenAccount || !sourceTokenAccount.value || sourceTokenAccount.value.length === 0) {
                throw new Error(`No token account found for owner ${owner.publicKey.toString()} and mint ${mint.toString()}`);
            }
            
            const fromTokenAccount = new PublicKey(sourceTokenAccount.value[0].pubkey);
            
            // Get recent blockhash with retry mechanism
            this.logger?.debug('Fetching recent blockhash for token transfer...');
            const blockhashResponse = await this.getLatestBlockhashWithRetry();
            
            // Extract blockhash from the correct response structure
            let blockhash: string;
            
            if (blockhashResponse?.value?.blockhash) {
                // JSON-RPC response structure: { value: { blockhash: "...", lastValidBlockHeight: ... } }
                blockhash = blockhashResponse.value.blockhash;
            } else if (blockhashResponse?.blockhash) {
                // Direct blockhash property (backward compatibility)
                blockhash = blockhashResponse.blockhash;
            } else {
                throw new Error(`Invalid blockhash response structure: ${JSON.stringify(blockhashResponse)}`);
            }
            
            // Comprehensive validation
            if (!blockhash) {
                throw new Error('Blockhash is null or undefined');
            }
            
            if (typeof blockhash !== 'string') {
                throw new Error(`Blockhash is not a string: ${typeof blockhash}`);
            }
            
            if (blockhash.length === 0) {
                throw new Error('Blockhash is empty string');
            }
            
            // Validate blockhash format (base58, typical length)
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(blockhash)) {
                throw new Error(`Invalid blockhash format: ${blockhash}`);
            }
            
            this.logger?.debug(`Blockhash obtained: ${blockhash}`);
            
            // Set fee payer first
            transaction.feePayer = owner.publicKey;
            
            // Add token transfer instruction
            transaction.add(
                createTransferInstruction(
                    fromTokenAccount,
                    to,
                    owner.publicKey,
                    amount,
                    [],
                    TOKEN_PROGRAM_ID
                )
            );
            
            // Set the blockhash AFTER adding instructions
            transaction.recentBlockhash = blockhash;
            
            // Verify transaction state before signing
            this.logger?.debug('Transaction state before signing:', {
                hasBlockhash: !!transaction.recentBlockhash,
                blockhash: transaction.recentBlockhash,
                feePayer: transaction.feePayer?.toString(),
                instructions: transaction.instructions.length
            });

            // Verify blockhash is set before signing
            if (!transaction.recentBlockhash) {
                throw new Error('Transaction blockhash not set before signing');
            }

            // Sign the transaction
            transaction.sign(owner);

            return this.sendTransaction(transaction, options);
        } catch (error) {
            this.logger?.error('Error in sendTokenTransfer:', error);
            throw error;
        }
    }

    /**
     * Get the balance of a public key
     * @param publicKey - The public key to check balance for
     * @returns Balance in lamports
     */
    public async getBalance(publicKey: PublicKey): Promise<any> {
        return this.makeRequest('getBalance', [publicKey.toString()]);
    }

    /**
     * Get account information with enhanced Metaplex metadata parsing
     * @param publicKey - The public key to get account info for
     * @param encodingOrOptions - Optional encoding or configuration options
     * @returns Account information with optional parsed Metaplex metadata
     */
    public async getAccountInfo(publicKey: PublicKey, encodingOrOptions?: 'base64' | 'base58' | GetAccountInfoOptions): Promise<any> {
        let options: GetAccountInfoOptions;
        
        if (typeof encodingOrOptions === 'string') {
            options = { encoding: encodingOrOptions };
        } else {
            options = encodingOrOptions || { encoding: 'base64' };
        }
        const { encoding = 'base64', parseMetaplexMetadata = false, includeOffChainMetadata = false } = options;
        
        // Get basic account info
        const accountInfo = await this.makeRequest('getAccountInfo', [
            publicKey.toString(),
            { encoding }
        ]);

        // If Metaplex metadata parsing is requested and this is a metadata account
        if (parseMetaplexMetadata && accountInfo?.value?.owner === HeliusClient.METAPLEX_METADATA_PROGRAM_ID) {
            return this.parseMetaplexMetadata(accountInfo, includeOffChainMetadata);
        }

        // If parseMetaplexMetadata is true but this isn't a metadata account, try to derive metadata from mint
        if (parseMetaplexMetadata && accountInfo?.value?.owner !== HeliusClient.METAPLEX_METADATA_PROGRAM_ID) {
            try {
                const metadataAccount = await this.getMetaplexMetadataAccount(publicKey);
                if (metadataAccount) {
                    return this.parseMetaplexMetadata(metadataAccount, includeOffChainMetadata);
                }
            } catch (error) {
                this.logger?.debug('Failed to derive metadata account from mint:', error);
            }
        }

        return accountInfo;
    }

    /**
     * Get transaction details
     * @param signature - Transaction signature
     * @param commitment - Optional commitment level
     * @returns Transaction details
     */
    public async getTransaction(
        signature: string, 
        commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
    ): Promise<any> {
        return this.makeRequest('getTransaction', [
            signature,
            { commitment }
        ]);
    }

    /**
     * Get transactions for a public key
     * @param publicKey - The public key to get transactions for
     * @param options - Optional configuration for transaction retrieval
     * @returns Array of Transaction objects
     */
    public async getTransactions(publicKey: PublicKey, options: GetTransactionsOptions = {}): Promise<Transaction[]> {
        // Build URL with query parameters
        const baseUrl = this.config.enhancedApiUrl.replace(/\/$/, ''); // Remove trailing slash if present
        const url = new URL(`${baseUrl}/addresses/${publicKey.toString()}/transactions`);
        url.searchParams.set('api-key', this.config.apiKey);

        // Add optional parameters if provided
        if (options.limit !== undefined) {
            if (options.limit <= 0) {
                throw new Error('Limit must be greater than 0');
            }
            url.searchParams.set('limit', options.limit.toString());
        }
        
        if (options.before !== undefined) {
            if (!options.before || typeof options.before !== 'string') {
                throw new Error('Before parameter must be a non-empty string');
            }
            url.searchParams.set('before', options.before);
        }
        
        if (options.until !== undefined) {
            if (!options.until || typeof options.until !== 'string') {
                throw new Error('Until parameter must be a non-empty string');
            }
            url.searchParams.set('until', options.until);
        }

        // Validate parameter combinations
        this.validatePaginationParameters(options);

        const response = await this.makeRestRequest(url.toString());
        
        // Ensure the response is an array of Transaction objects
        if (!Array.isArray(response)) {
            throw new Error('Invalid response format: expected array of transactions');
        }
        
        // Validate that each item has the required Transaction properties
        const transactions: Transaction[] = response.map((item, index) => {
            if (!item || typeof item !== 'object') {
                throw new Error(`Invalid transaction at index ${index}: not an object`);
            }
            
            if (typeof item.signature !== 'string') {
                throw new Error(`Invalid transaction at index ${index}: missing or invalid signature`);
            }
            
            if (typeof item.slot !== 'number') {
                throw new Error(`Invalid transaction at index ${index}: missing or invalid slot`);
            }
            
            if (typeof item.timestamp !== 'number') {
                throw new Error(`Invalid transaction at index ${index}: missing or invalid timestamp`);
            }
            
            if (typeof item.description !== 'string') {
                throw new Error(`Invalid transaction at index ${index}: missing or invalid description`);
            }
            
            // Ensure nativeTransfers and tokenTransfers are arrays
            if (!Array.isArray(item.nativeTransfers)) {
                throw new Error(`Invalid transaction at index ${index}: nativeTransfers must be an array`);
            }
            
            if (!Array.isArray(item.tokenTransfers)) {
                throw new Error(`Invalid transaction at index ${index}: tokenTransfers must be an array`);
            }
            
            return item as Transaction;
        });
        
        return transactions;
    }

    /**
     * Validate pagination parameter combinations
     * @param options - The pagination options to validate
     * @private
     */
    private validatePaginationParameters(options: GetTransactionsOptions): void {
        // Check for conflicting backward pagination parameters
        if (options.before && options.until) {
            this.logger?.warn('Both before and until parameters are provided. This may result in unexpected behavior.');
        }
    }

    /**
     * Get all transactions for a public key with automatic pagination
     * @param publicKey - The public key to get all transactions for
     * @param options - Optional configuration for transaction retrieval (supports all pagination parameters)
     * @returns Array of all Transaction objects
     */
    public async getAllTransactions(publicKey: PublicKey, options: GetTransactionsOptions = {}): Promise<Transaction[]> {
        const allTransactions: Transaction[] = [];
        const batchLimit = options.limit || 100; // Default batch size

        // For backward pagination, we track the oldest signature for next batch
        let paginationSignature: string | null = null;
        let isFirstBatch = true;

        while (true) {
            const batchOptions: GetTransactionsOptions = {
                ...options,
                limit: batchLimit
            };

            // Handle backward pagination
            if (paginationSignature) {
                batchOptions.before = paginationSignature;
                // Remove the original until parameter for subsequent batches
                delete batchOptions.until;
            }
            // For the first batch, keep the original 'before' or 'until' parameter

            const transactions = await this.getTransactions(publicKey, batchOptions);

            if (transactions && transactions.length > 0) {
                this.logger?.debug(`Fetched batch of ${transactions.length} transactions`);
                
                // For subsequent batches, we need to handle potential overlap
                // The 'before' parameter is exclusive, so we might have gaps
                if (!isFirstBatch && allTransactions.length > 0) {
                    const lastPreviousTransaction = allTransactions[allTransactions.length - 1];
                    const firstCurrentTransaction = transactions[0];
                    
                    if (lastPreviousTransaction && firstCurrentTransaction) {
                        const lastPreviousSignature = lastPreviousTransaction.signature;
                        const firstCurrentSignature = firstCurrentTransaction.signature;
                        
                        // Check if there's a gap between batches
                        if (lastPreviousSignature !== firstCurrentSignature) {
                            this.logger?.warn(`Potential gap detected between batches. Last previous: ${lastPreviousSignature}, First current: ${firstCurrentSignature}`);
                        }
                    }
                }
                
                allTransactions.push(...transactions);
                isFirstBatch = false;
                
                // Update pagination signature for backward pagination
                // Use the oldest transaction signature for the next 'before' parameter
                const lastTransaction = transactions[transactions.length - 1];
                if (lastTransaction) {
                    paginationSignature = lastTransaction.signature;
                    this.logger?.debug(`Next pagination signature: ${paginationSignature}`);
                }
                
                // If we got fewer transactions than requested, we've reached the end
                if (transactions.length < batchLimit) {
                    this.logger?.debug(`Reached end of transactions (got ${transactions.length} < ${batchLimit})`);
                    break;
                }
            } else {
                this.logger?.debug('No more transactions found');
                break;
            }
        }

        this.logger?.info(`Finished fetching all transactions. Total: ${allTransactions.length}`);
        return allTransactions;
    }

    /**
     * Get a specific number of transactions for a public key with automatic pagination
     * @param publicKey - The public key to get transactions for
     * @param totalLimit - Total number of transactions to fetch
     * @param options - Optional configuration for transaction retrieval (supports all pagination parameters)
     * @param batchSize - Number of transactions to fetch per API call (default: 10, max: 100)
     * @returns Array of Transaction objects up to the specified limit
     */
    public async getTransactionsWithLimit(publicKey: PublicKey, totalLimit: number, options: GetTransactionsOptions = {}, batchSize: number = 10): Promise<Transaction[]> {
        if (batchSize <= 0 || batchSize > 100) {
            throw new Error('Batch size must be between 1 and 100');
        }
        
        const transactions: Transaction[] = [];
        let batchCount = 0;
        let consecutiveEmptyBatches = 0;
        const maxConsecutiveEmptyBatches = 3; // Stop after 3 consecutive empty batches

        // For backward pagination, we track the oldest signature for next batch
        let paginationSignature: string | null = null;
        let isFirstBatch = true;
        let lastBatchSize = 0;

        while (transactions.length < totalLimit) {
            batchCount++;
            const remainingLimit = totalLimit - transactions.length;
            const currentBatchLimit = Math.min(batchSize, remainingLimit);
            
            const batchOptions: GetTransactionsOptions = {
                ...options,
                limit: currentBatchLimit
            };

            // Handle backward pagination
            if (paginationSignature) {
                batchOptions.before = paginationSignature;
                // Remove the original until parameter for subsequent batches
                delete batchOptions.until;
            }
            // For the first batch, keep the original 'before' or 'until' parameter

            this.logger?.debug(`Batch ${batchCount}: Requesting ${currentBatchLimit} transactions${paginationSignature ? ` before ${paginationSignature}` : ''}`);

            const batchTransactions = await this.getTransactions(publicKey, batchOptions);

            if (batchTransactions && batchTransactions.length > 0) {
                // Reset consecutive empty batches counter
                consecutiveEmptyBatches = 0;
                
                // For subsequent batches, we need to handle potential overlap
                // The 'before' parameter is exclusive, so we might have gaps
                if (!isFirstBatch && transactions.length > 0) {
                    const lastPreviousTransaction = transactions[transactions.length - 1];
                    const firstCurrentTransaction = batchTransactions[0];
                    
                    if (lastPreviousTransaction && firstCurrentTransaction) {
                        const lastPreviousSignature = lastPreviousTransaction.signature;
                        const firstCurrentSignature = firstCurrentTransaction.signature;
                        
                        // Check if there's a gap between batches
                        if (lastPreviousSignature !== firstCurrentSignature) {
                            this.logger?.warn(`Potential gap detected between batches. Last previous: ${lastPreviousSignature}, First current: ${firstCurrentSignature}`);
                            
                            // If we detect a gap, we might need to adjust our pagination strategy
                            // For now, we'll continue but log the issue
                        }
                    }
                }
                
                transactions.push(...batchTransactions);
                isFirstBatch = false;
                lastBatchSize = batchTransactions.length;
                
                this.logger?.debug(`Batch ${batchCount}: Received ${batchTransactions.length} transactions. Total so far: ${transactions.length}`);
                
                // Update pagination signature for backward pagination
                // Use the oldest transaction signature for the next 'before' parameter
                const lastTransaction = batchTransactions[batchTransactions.length - 1];
                if (lastTransaction) {
                    paginationSignature = lastTransaction.signature;
                    this.logger?.debug(`Batch ${batchCount}: Next pagination signature: ${paginationSignature}`);
                }
                
                // If we got fewer transactions than requested, we've reached the end
                if (batchTransactions.length < currentBatchLimit) {
                    this.logger?.debug(`Batch ${batchCount}: Reached end of transactions (got ${batchTransactions.length} < ${currentBatchLimit})`);
                    break;
                }
            } else {
                consecutiveEmptyBatches++;
                this.logger?.warn(`Batch ${batchCount}: No transactions found. Consecutive empty batches: ${consecutiveEmptyBatches}`);
                
                // If we've had multiple consecutive empty batches, we might be at the end
                // or there might be an issue with our pagination
                if (consecutiveEmptyBatches >= maxConsecutiveEmptyBatches) {
                    this.logger?.warn(`Stopping after ${maxConsecutiveEmptyBatches} consecutive empty batches`);
                    break;
                }
                
                // If this is not the first batch and we got an empty response,
                // we might need to try a different pagination strategy
                if (!isFirstBatch && lastBatchSize > 0) {
                    this.logger?.warn(`Empty batch after receiving ${lastBatchSize} transactions in previous batch. This might indicate a pagination issue.`);
                }
                
                break;
            }
        }

        this.logger?.info(`Finished fetching transactions with limit. Total: ${transactions.length}/${totalLimit} in ${batchCount} batches`);
        
        // Log a warning if we didn't reach the requested limit
        if (transactions.length < totalLimit) {
            this.logger?.warn(`Only retrieved ${transactions.length} transactions out of ${totalLimit} requested. This might indicate missing transactions due to pagination gaps.`);
        }
        
        return transactions;
    }

    /**
     * Get transactions with limit using a more robust pagination strategy
     * This method attempts to handle potential gaps in transaction history by using
     * a combination of 'before' and 'until' parameters and retry logic
     * @param publicKey - The public key to get transactions for
     * @param totalLimit - Total number of transactions to fetch
     * @param options - Optional configuration for transaction retrieval
     * @param batchSize - Number of transactions to fetch per API call (default: 50, max: 100)
     * @returns Array of Transaction objects up to the specified limit
     */
    public async getTransactionsWithLimitRobust(publicKey: PublicKey, totalLimit: number, options: GetTransactionsOptions = {}, batchSize: number = 50): Promise<Transaction[]> {
        if (batchSize <= 0 || batchSize > 100) {
            throw new Error('Batch size must be between 1 and 100');
        }
        
        const transactions: Transaction[] = [];
        let batchCount = 0;
        let paginationSignature: string | null = null;
        let retryCount = 0;
        const maxRetries = 3;

        while (transactions.length < totalLimit && retryCount < maxRetries) {
            batchCount++;
            const remainingLimit = totalLimit - transactions.length;
            const currentBatchLimit = Math.min(batchSize, remainingLimit);
            
            const batchOptions: GetTransactionsOptions = {
                ...options,
                limit: currentBatchLimit
            };

            // Handle backward pagination
            if (paginationSignature) {
                batchOptions.before = paginationSignature;
                // Remove the original until parameter for subsequent batches
                delete batchOptions.until;
            }

            this.logger?.debug(`Robust Batch ${batchCount}: Requesting ${currentBatchLimit} transactions${paginationSignature ? ` before ${paginationSignature}` : ''}`);

            try {
                const batchTransactions = await this.getTransactions(publicKey, batchOptions);

                if (batchTransactions && batchTransactions.length > 0) {
                    // Check for potential gaps
                    if (transactions.length > 0 && batchTransactions.length > 0) {
                        const lastPreviousTransaction = transactions[transactions.length - 1];
                        const firstCurrentTransaction = batchTransactions[0];
                        
                        if (lastPreviousTransaction && firstCurrentTransaction) {
                            const lastPreviousSignature = lastPreviousTransaction.signature;
                            const firstCurrentSignature = firstCurrentTransaction.signature;
                            
                            if (lastPreviousSignature !== firstCurrentSignature) {
                                this.logger?.warn(`Gap detected in robust method. Last previous: ${lastPreviousSignature}, First current: ${firstCurrentSignature}`);
                                
                                // Try to fill the gap by requesting transactions between these signatures
                                try {
                                    const gapOptions: GetTransactionsOptions = {
                                        ...options,
                                        limit: Math.min(100, totalLimit - transactions.length),
                                        before: lastPreviousSignature,
                                        until: firstCurrentSignature
                                    };
                                    
                                    this.logger?.debug(`Attempting to fill gap with until parameter: ${firstCurrentSignature}`);
                                    const gapTransactions = await this.getTransactions(publicKey, gapOptions);
                                    
                                    if (gapTransactions && gapTransactions.length > 0) {
                                        this.logger?.info(`Successfully filled gap with ${gapTransactions.length} transactions`);
                                        transactions.push(...gapTransactions);
                                    }
                                } catch (gapError) {
                                    this.logger?.warn('Failed to fill gap:', gapError);
                                }
                            }
                        }
                    }
                    
                    transactions.push(...batchTransactions);
                    retryCount = 0; // Reset retry count on successful batch
                    
                    this.logger?.debug(`Robust Batch ${batchCount}: Received ${batchTransactions.length} transactions. Total so far: ${transactions.length}`);
                    
                    // Update pagination signature for backward pagination
                    const lastTransaction = batchTransactions[batchTransactions.length - 1];
                    if (lastTransaction) {
                        paginationSignature = lastTransaction.signature;
                        this.logger?.debug(`Robust Batch ${batchCount}: Next pagination signature: ${paginationSignature}`);
                    }
                    
                    // If we got fewer transactions than requested, we've reached the end
                    if (batchTransactions.length < currentBatchLimit) {
                        this.logger?.debug(`Robust Batch ${batchCount}: Reached end of transactions (got ${batchTransactions.length} < ${currentBatchLimit})`);
                        break;
                    }
                } else {
                    retryCount++;
                    this.logger?.warn(`Robust Batch ${batchCount}: No transactions found. Retry ${retryCount}/${maxRetries}`);
                    
                    if (retryCount >= maxRetries) {
                        this.logger?.warn(`Stopping after ${maxRetries} consecutive empty batches`);
                        break;
                    }
                    
                    // Wait before retrying
                    await this.delay(Math.pow(2, retryCount) * 1000);
                }
            } catch (error) {
                retryCount++;
                this.logger?.error(`Robust Batch ${batchCount} failed:`, error);
                
                if (retryCount >= maxRetries) {
                    this.logger?.error(`Stopping after ${maxRetries} consecutive failures`);
                    break;
                }
                
                // Wait before retrying
                await this.delay(Math.pow(2, retryCount) * 1000);
            }
        }

        this.logger?.info(`Finished robust transaction fetching. Total: ${transactions.length}/${totalLimit} in ${batchCount} batches`);
        
        if (transactions.length < totalLimit) {
            this.logger?.warn(`Only retrieved ${transactions.length} transactions out of ${totalLimit} requested using robust method.`);
        }
        
        return transactions;
    }

    /**
     * Diagnostic method to analyze transaction pagination behavior
     * This method helps identify gaps and understand the pagination patterns
     * @param publicKey - The public key to analyze
     * @param sampleSize - Number of transactions to analyze (default: 1000)
     * @param batchSize - Batch size for analysis (default: 100)
     * @returns Analysis results including gap detection and pagination statistics
     */
    public async analyzeTransactionPagination(publicKey: PublicKey, sampleSize: number = 1000, batchSize: number = 100): Promise<{
        totalTransactions: number;
        batches: number;
        gaps: Array<{ before: string; after: string; estimatedGapSize: number }>;
        averageBatchSize: number;
        paginationIssues: string[];
        recommendations: string[];
    }> {
        this.logger?.info(`Starting pagination analysis for ${publicKey.toString()}`);
        
        const transactions: Transaction[] = [];
        let batchCount = 0;
        let paginationSignature: string | null = null;
        const gaps: Array<{ before: string; after: string; estimatedGapSize: number }> = [];
        const paginationIssues: string[] = [];
        const recommendations: string[] = [];

        while (transactions.length < sampleSize) {
            batchCount++;
            const remainingLimit = sampleSize - transactions.length;
            const currentBatchLimit = Math.min(batchSize, remainingLimit);
            
            const batchOptions: GetTransactionsOptions = {
                limit: currentBatchLimit
            };

            if (paginationSignature) {
                batchOptions.before = paginationSignature;
            }

            this.logger?.debug(`Analysis Batch ${batchCount}: Requesting ${currentBatchLimit} transactions`);

            try {
                const batchTransactions = await this.getTransactions(publicKey, batchOptions);

                if (batchTransactions && batchTransactions.length > 0) {
                    // Check for gaps between batches
                    if (transactions.length > 0 && batchTransactions.length > 0) {
                        const lastPreviousTransaction = transactions[transactions.length - 1];
                        const firstCurrentTransaction = batchTransactions[0];
                        
                        if (lastPreviousTransaction && firstCurrentTransaction) {
                            const lastPreviousSignature = lastPreviousTransaction.signature;
                            const firstCurrentSignature = firstCurrentTransaction.signature;
                            
                            if (lastPreviousSignature !== firstCurrentSignature) {
                                gaps.push({
                                    before: lastPreviousSignature,
                                    after: firstCurrentSignature,
                                    estimatedGapSize: 0 // Will be calculated if we can fetch gap transactions
                                });
                                
                                paginationIssues.push(`Gap detected between batches ${batchCount - 1} and ${batchCount}`);
                                
                                // Try to estimate gap size
                                try {
                                    const gapOptions: GetTransactionsOptions = {
                                        limit: 100,
                                        before: lastPreviousSignature,
                                        until: firstCurrentSignature
                                    };
                                    
                                    const gapTransactions = await this.getTransactions(publicKey, gapOptions);
                                    if (gapTransactions && gapTransactions.length > 0) {
                                        const lastGap = gaps[gaps.length - 1];
                                        if (lastGap) {
                                            lastGap.estimatedGapSize = gapTransactions.length;
                                            this.logger?.info(`Gap contains approximately ${gapTransactions.length} transactions`);
                                        }
                                    }
                                } catch (gapError) {
                                    this.logger?.warn('Could not estimate gap size:', gapError);
                                }
                            }
                        }
                    }
                    
                    transactions.push(...batchTransactions);
                    
                    this.logger?.debug(`Analysis Batch ${batchCount}: Received ${batchTransactions.length} transactions. Total so far: ${transactions.length}`);
                    
                    // Update pagination signature
                    const lastTransaction = batchTransactions[batchTransactions.length - 1];
                    if (lastTransaction && lastTransaction.signature) {
                        paginationSignature = lastTransaction.signature;
                    }
                    
                    // If we got fewer transactions than requested, we've reached the end
                    if (batchTransactions.length < currentBatchLimit) {
                        this.logger?.debug(`Analysis: Reached end of transactions (got ${batchTransactions.length} < ${currentBatchLimit})`);
                        break;
                    }
                } else {
                    this.logger?.warn(`Analysis Batch ${batchCount}: No transactions found`);
                    paginationIssues.push(`Empty batch at batch ${batchCount}`);
                    break;
                }
            } catch (error) {
                this.logger?.error(`Analysis Batch ${batchCount} failed:`, error);
                paginationIssues.push(`Batch ${batchCount} failed: ${error instanceof Error ? error.message : String(error)}`);
                break;
            }
        }

        const averageBatchSize = batchCount > 0 ? transactions.length / batchCount : 0;
        
        // Generate recommendations based on analysis
        if (gaps.length > 0) {
            recommendations.push(`Found ${gaps.length} gaps in transaction history. Consider using getTransactionsWithLimitRobust() method.`);
        }
        
        if (averageBatchSize < batchSize * 0.8) {
            recommendations.push(`Average batch size (${averageBatchSize.toFixed(1)}) is significantly lower than requested (${batchSize}). Consider reducing batch size.`);
        }
        
        if (paginationIssues.length > 0) {
            recommendations.push(`Encountered ${paginationIssues.length} pagination issues. Review logs for details.`);
        }
        
        if (transactions.length < sampleSize) {
            recommendations.push(`Only retrieved ${transactions.length} transactions out of ${sampleSize} requested. This may indicate limited transaction history.`);
        }

        const analysis = {
            totalTransactions: transactions.length,
            batches: batchCount,
            gaps,
            averageBatchSize,
            paginationIssues,
            recommendations
        };

        this.logger?.info('Pagination analysis completed:', analysis);
        return analysis;
    }

    /**
     * Get slot information
     * @param commitment - Optional commitment level
     * @returns Current slot
     */
    public async getSlot(commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<number> {
        return this.makeRequest('getSlot', [{ commitment }]);
    }

    /**
     * Get token account
     * @param publicKey - The public key to get token account from
     * @param mint - contract address of the token
     * @returns Token account
     */
    public async getTokenAccount(publicKey: PublicKey, mint: PublicKey): Promise<any> {
        return this.makeRequest('getTokenAccountsByOwner', [
            publicKey.toString(),
            {
                mint: mint.toString()
            },
            {
                encoding: 'base64'
            }
        ]);
    }

    /**
     * Get token accounts by owner
     * @param publicKey - The public key to get token accounts from
     * @returns Token accounts
     */
    public async getTokenAccounts(publicKey: PublicKey): Promise<any> {
        return this.makeRequest('getTokenAccountsByOwner', [
            publicKey.toString(),
            {
                programId: TOKEN_PROGRAM_ID.toString()
            },
            {
                encoding: 'base64'
            }
        ]);
    }

    /**
     * Get token account balance
     * @param publicKey - The token account public key to get balance for
     * @returns Token account balance
     */
    public async getTokenAccountBalance(publicKey: PublicKey): Promise<any> {
        return this.makeRequest('getTokenAccountBalance', [publicKey.toString()]);
    }

    /**
     * Get cluster nodes
     * @returns Information about cluster nodes
     */
    public async getClusterNodes(): Promise<any[]> {
        return this.makeRequest('getClusterNodes', []);
    }

    /**
     * Get version information
     * @returns Solana version information
     */
    public async getVersion(): Promise<any> {
        return this.makeRequest('getVersion', []);
    }

    /**
     * Get latest blockhash
     * @returns Latest blockhash information
     */
    public async getLatestBlockhash(options: GetLatestBlockhashOptions = {}): Promise<any> {
        return this.makeRequest('getLatestBlockhash', [{
            commitment: options.commitment || 'processed',
            minContextSlot: options.minContextSlot || 1000,
        }]);
    }

    /**
     * Get latest blockhash with retry mechanism
     * @param options - Optional configuration for blockhash retrieval
     * @param maxAttempts - Maximum number of retry attempts (default: 3)
     * @returns Latest blockhash information
     */
    public async getLatestBlockhashWithRetry(options: GetLatestBlockhashOptions = {}, maxAttempts: number = 3): Promise<any> {
        let lastError: Error | undefined;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                this.logger?.debug(`Blockhash attempt ${attempt}/${maxAttempts}...`);
                const blockhashResponse = await this.getLatestBlockhash(options);
                
                // Log the actual response structure for debugging
                this.logger?.debug(`Blockhash response structure:`, JSON.stringify(blockhashResponse, null, 2));
                
                // Check for the correct JSON-RPC response structure
                if (blockhashResponse && blockhashResponse.value && blockhashResponse.value.blockhash) {
                    this.logger?.debug(`Blockhash obtained on attempt ${attempt}: ${blockhashResponse.value.blockhash}`);
                    return blockhashResponse;
                }
                
                // Also check for direct blockhash property (backward compatibility)
                if (blockhashResponse && blockhashResponse.blockhash) {
                    this.logger?.debug(`Blockhash obtained on attempt ${attempt} (direct): ${blockhashResponse.blockhash}`);
                    return blockhashResponse;
                }
                
                throw new Error(`Invalid blockhash response structure on attempt ${attempt}: ${JSON.stringify(blockhashResponse)}`);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`Blockhash attempt ${attempt} failed:`, lastError);
                
                if (attempt < maxAttempts) {
                    // Wait before retrying (exponential backoff)
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    this.logger?.debug(`Waiting ${delay}ms before retry...`);
                    await this.delay(delay);
                }
            }
        }
        
        throw new Error(`Failed to get valid blockhash after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
    }

    /**
     * Get top token holders
     * @param tokenAddress - The token mint address
     * @returns Top token holders information
     */
    public async getTopHolders(tokenAddress: string): Promise<any> {
        return this.makeRequest('getTokenLargestAccounts', [tokenAddress]);
    }

    /**
     * Get token account owner
     * @param tokenAccount - The token account address
     * @returns Token account owner address
     */
    public async getTokenAccountOwner(tokenAccount: string): Promise<string> {
        const accountInfo = await this.makeRequest('getAccountInfo', [
            tokenAccount,
            { encoding: 'jsonParsed' }
        ]);

        if (!accountInfo || !accountInfo.data || !accountInfo.data.parsed || !accountInfo.data.parsed.info || !accountInfo.data.parsed.info.owner) {
            throw new Error('Invalid token account data');
        }

        return accountInfo.data.parsed.info.owner;
    }

    /**
     * Get token supply information
     * @param tokenAddress - The token mint address
     * @returns Token supply information including decimals
     */
    public async getTokenSupply(tokenAddress: string): Promise<any> {
        return this.makeRequest('getTokenSupply', [tokenAddress]);
    }

    /**
     * Get token info (decimals) from supply
     * @param tokenAddress - The token mint address
     * @returns Token info with decimals, or null if not found
     */
    public async getTokenInfo(tokenAddress: string): Promise<{ decimals: number } | null> {
        try {
            const supplyInfo = await this.getTokenSupply(tokenAddress);
            const decimals = supplyInfo?.value?.decimals;
            
            if (typeof decimals === 'number') {
                return { decimals };
            }
            
            return null;
        } catch (error) {
            this.logger?.warn(`Failed to get token info for ${tokenAddress}:`, error);
            return null;
        }
    }

    /**
     * Get comprehensive asset data for any Solana NFT or digital asset
     * @param assetId - The asset ID (mint address)
     * @returns Comprehensive asset data including metadata, ownership, and other details
     */
    public async getAsset(assetId: string): Promise<any> {
        // Build URL for the DAS getAsset endpoint
        const baseUrl = this.config.enhancedApiUrl.replace(/\/$/, ''); // Remove trailing slash if present
        const url = new URL(`${baseUrl}/token-metadata`);
        url.searchParams.set('api-key', this.config.apiKey);

        // Make the request with the asset ID in the request body
        const requestBody = {
            mintAccounts: [assetId],
            includeOffChain: true,
            disableCache: false
        };

        return this.makeRestPostRequest(url.toString(), requestBody);
    }

    /**
     * Get comprehensive token account data for a wallet
     * @param walletAddress - The wallet public key
     * @returns Token account data including SOL balance and all token accounts
     */
    public async getWalletTokenData(walletAddress: string): Promise<any> {
        try {
            // Get SOL account info
            const solAccountInfo = await this.getAccountInfo(new PublicKey(walletAddress));
            
            // Get SPL Token accounts
            const splTokenAccounts = await this.makeRequest('getTokenAccountsByOwner', [
                walletAddress,
                { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' } // TOKEN_PROGRAM_ID
            ]);
            
            // Get Token-2022 accounts
            const token2022Accounts = await this.makeRequest('getTokenAccountsByOwner', [
                walletAddress,
                { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' } // TOKEN_2022_PROGRAM_ID
            ]);
            
            return {
                owner: walletAddress,
                solAccountInfo,
                tokenAccounts: {
                    context: splTokenAccounts.context,
                    value: [...splTokenAccounts.value, ...token2022Accounts.value],
                }
            };
        } catch (error) {
            this.logger?.error(`Failed to get wallet token data for ${walletAddress}:`, error);
            throw error;
        }
    }

    /**
     * Simulate a transaction
     * @param transaction - The transaction to simulate
     * @returns Simulation result
     */
    public async simulateTransaction(transaction: SolanaTransaction): Promise<any> {
        return this.makeRequest('simulateTransaction', [
            bs58.encode(transaction.serialize({ requireAllSignatures: false })),
        ]);
    }

    /**
     * Wait for confirmation of a transaction
     * @param signature - Transaction signature
     * @param commitment - Optional commitment level
     * @returns Transaction confirmation information
     */
    public async waitForConfirmation(signature: string, commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'): Promise<any> {
        return this.makeRequest('waitForConfirmation', [
            signature,
            { commitment }
        ]);
    }

    /**
     * Make a raw RPC request
     * @param method - RPC method name
     * @param params - RPC parameters
     * @param baseUrl - Optional base URL (defaults to rpcUrl)
     * @returns RPC response result
     */
    private async makeRequest(method: string, params: any[], baseUrl?: string): Promise<any> {
        const requestId = ++this.requestId;
        const requestBody: RpcRequest = {
            jsonrpc: '2.0',
            id: requestId,
            method,
            params,
        };

        this.logger?.debug(`Request ${requestId}:`, requestBody);

        let lastError: Error | undefined;
        const url = baseUrl || this.config.rpcUrl;

        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                let response: Response | undefined;
                try {
                    response = await Promise.race([
                        fetch(`${url}?api-key=${this.config.apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody),
                            signal: AbortSignal.timeout(this.config.timeout),
                        }),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error(`Operation timed out after ${this.config.timeout}ms`)), this.config.timeout)
                        ),
                    ]);
                } catch (error) {
                    // Network error or timeout
                    throwError(error, `Helius API Request Failed (${method})`);
                }

                if (!response || !('ok' in response)) {
                    throwError('No response received from fetch', `Helius API Request Failed (${method})`);
                }

                if (!response.ok) {
                    throwError(`HTTP ${response.status}: ${response.statusText}`, 'Network Error');
                }

                const data: RpcResponse = await response.json();
                this.logger?.debug(`Response ${requestId}:`, data);

                if (data.error) {
                    throwError(data.error, `Helius API Error (${method})`);
                }

                return data.result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`Request ${requestId} attempt ${attempt} failed:`, lastError);

                // Only retry on network errors or timeouts
                const isTimeout = /timed out/i.test(lastError.message);
                const isNetwork = /network|fetch|Failed to fetch|TypeError|No response received/i.test(lastError.message);
                if (!isTimeout && !isNetwork) {
                    this.logger?.error(`Request ${requestId} failed after ${attempt} attempts:`, lastError);
                    throw lastError;
                }

                if (attempt === this.config.retries) {
                    this.logger?.error(`Request ${requestId} failed after ${attempt} attempts:`, lastError);
                    throwError(lastError, `Helius API Request Failed (${method})`);
                }

                await this.delay(Math.pow(2, attempt - 1) * 1000);
            }
        }

        throw lastError!;
    }

    /**
     * Utility method for delays
     * @param ms - Milliseconds to delay
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get the current configuration
     * @returns Current client configuration
     */
    public getConfig(): Readonly<Omit<Required<HeliusConfig>, 'logger'> & { logger?: Logger }> {
        return this.config;
    }

    /**
     * Make a REST API request (for non-JSON-RPC endpoints)
     * @param url - Full URL to request
     * @returns Response data
     */
    private async makeRestRequest(url: string): Promise<any> {
        const requestId = ++this.requestId;

        this.logger?.debug(`REST Request ${requestId}: ${url}`);

        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                let response: Response | undefined;
                try {
                    response = await Promise.race([
                        fetch(url, {
                            method: 'GET',
                            headers: { 'Content-Type': 'application/json' },
                            signal: AbortSignal.timeout(this.config.timeout),
                        }),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error(`Operation timed out after ${this.config.timeout}ms`)), this.config.timeout)
                        ),
                    ]);
                } catch (error) {
                    // Network error or timeout
                    throw new Error(`Network Error: ${error instanceof Error ? error.message : String(error)}`);
                }

                if (!response || !('ok' in response)) {
                    throw new Error('Network Error: No response received from fetch');
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                this.logger?.debug(`REST Response ${requestId}:`, data);

                return data;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`REST Request ${requestId} attempt ${attempt} failed:`, lastError);

                // Only retry on network errors or timeouts
                const isTimeout = /timed out/i.test(lastError.message);
                const isNetwork = /network|fetch|Failed to fetch|TypeError|No response received/i.test(lastError.message);
                const isHttpError = /^HTTP \d+:/i.test(lastError.message);
                
                if (!isTimeout && !isNetwork && !isHttpError) {
                    this.logger?.error(`REST Request ${requestId} failed after ${attempt} attempts:`, lastError);
                    throw lastError;
                }

                if (attempt === this.config.retries) {
                    this.logger?.error(`REST Request ${requestId} failed after ${attempt} attempts:`, lastError);
                    throw lastError;
                }

                await this.delay(Math.pow(2, attempt - 1) * 1000);
            }
        }

        throw lastError!;
    }

    /**
     * Make a REST API POST request (for non-JSON-RPC endpoints that require POST with body)
     * @param url - Full URL to request
     * @param body - Request body to send
     * @returns Response data
     */
    private async makeRestPostRequest(url: string, body: any): Promise<any> {
        const requestId = ++this.requestId;

        this.logger?.debug(`REST POST Request ${requestId}: ${url}`, body);

        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                let response: Response | undefined;
                try {
                    response = await Promise.race([
                        fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                            signal: AbortSignal.timeout(this.config.timeout),
                        }),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error(`Operation timed out after ${this.config.timeout}ms`)), this.config.timeout)
                        ),
                    ]);
                } catch (error) {
                    // Network error or timeout
                    throw new Error(`Network Error: ${error instanceof Error ? error.message : String(error)}`);
                }

                if (!response || !('ok' in response)) {
                    throw new Error('Network Error: No response received from fetch');
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                this.logger?.debug(`REST POST Response ${requestId}:`, data);

                return data;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`REST POST Request ${requestId} attempt ${attempt} failed:`, lastError);

                // Only retry on network errors or timeouts
                const isTimeout = /timed out/i.test(lastError.message);
                const isNetwork = /network|fetch|Failed to fetch|TypeError|No response received/i.test(lastError.message);
                const isHttpError = /^HTTP \d+:/i.test(lastError.message);
                
                if (!isTimeout && !isNetwork && !isHttpError) {
                    this.logger?.error(`REST POST Request ${requestId} failed after ${attempt} attempts:`, lastError);
                    throw lastError;
                }

                if (attempt === this.config.retries) {
                    this.logger?.error(`REST POST Request ${requestId} failed after ${attempt} attempts:`, lastError);
                    throw lastError;
                }

                await this.delay(Math.pow(2, attempt - 1) * 1000);
            }
        }

        throw lastError!;
    }

    /**
     * Derive the Metaplex metadata account PDA for a given mint
     * @param mint - The mint public key
     * @returns The metadata account public key
     * @private
     */
    private async deriveMetaplexMetadataAccount(mint: PublicKey): Promise<PublicKey> {
        const [metadataAccount] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                new PublicKey(HeliusClient.METAPLEX_METADATA_PROGRAM_ID).toBuffer(),
                mint.toBuffer(),
            ],
            new PublicKey(HeliusClient.METAPLEX_METADATA_PROGRAM_ID)
        );
        return metadataAccount;
    }

    /**
     * Get the Metaplex metadata account for a given mint
     * @param mint - The mint public key
     * @returns Metadata account info or null if not found
     * @private
     */
    private async getMetaplexMetadataAccount(mint: PublicKey): Promise<any> {
        try {
            const metadataAccount = await this.deriveMetaplexMetadataAccount(mint);
            return await this.makeRequest('getAccountInfo', [
                metadataAccount.toString(),
                { encoding: 'base64' }
            ]);
        } catch (error) {
            this.logger?.debug('Failed to get metadata account:', error);
            return null;
        }
    }

    /**
     * Parse Metaplex metadata from account data
     * @param accountInfo - The account info response
     * @param includeOffChainMetadata - Whether to include off-chain metadata
     * @returns Parsed metadata structure
     * @private
     */
    private async parseMetaplexMetadata(accountInfo: any, includeOffChainMetadata: boolean = false): Promise<MetaplexMetadata> {
        if (!accountInfo?.value?.data) {
            throw new Error('No account data found');
        }

        // Decode the base64 data
        const data = Buffer.from(accountInfo.value.data[0], 'base64');
        
        // Parse the metadata structure
        // Metaplex metadata format: [1 byte key] + [32 bytes update authority] + [32 bytes mint] + [variable data]
        const metadataData = data.slice(65);

        // Parse the variable metadata section
        let offset = 0;
        
        // Read name (string)
        const nameLength = metadataData.readUInt32LE(offset);
        offset += 4;
        const name = metadataData.slice(offset, offset + nameLength).toString('utf8').replace(/\0/g, '').trim();
        offset += nameLength;

        // Read symbol (string)
        const symbolLength = metadataData.readUInt32LE(offset);
        offset += 4;
        const symbol = metadataData.slice(offset, offset + symbolLength).toString('utf8').replace(/\0/g, '').trim();
        offset += symbolLength;

        // Read URI (string)
        const uriLength = metadataData.readUInt32LE(offset);
        offset += 4;
        const uri = metadataData.slice(offset, offset + uriLength).toString('utf8').replace(/\0/g, '').trim();
        offset += uriLength;

        // Read seller fee basis points (u16)
        const sellerFeeBasisPoints = metadataData.readUInt16LE(offset);
        offset += 2;

        // Read creators (optional)
        const hasCreators = metadataData[offset] === 1;
        offset += 1;
        
        let creators = undefined;
        if (hasCreators) {
            const creatorsLength = metadataData.readUInt32LE(offset);
            offset += 4;
            creators = [];
            
            for (let i = 0; i < creatorsLength; i++) {
                const creatorAddress = metadataData.slice(offset, offset + 32);
                offset += 32;
                const verified = metadataData[offset] === 1;
                offset += 1;
                const share = metadataData[offset];
                offset += 1;
                
                creators.push({
                    address: new PublicKey(creatorAddress).toString(),
                    verified,
                    share: share || 0
                });
            }
        }

        // Read collection (optional)
        const hasCollection = metadataData[offset] === 1;
        offset += 1;
        
        let collection = undefined;
        if (hasCollection) {
            const collectionKey = metadataData.slice(offset, offset + 32);
            offset += 32;
            const verified = metadataData[offset] === 1;
            offset += 1;
            
            collection = {
                key: new PublicKey(collectionKey).toString(),
                verified
            };
        }

        // Read uses (optional)
        const hasUses = metadataData[offset] === 1;
        offset += 1;
        
        let uses = undefined;
        if (hasUses) {
            const useMethod = metadataData[offset];
            offset += 1;
            const remaining = metadataData.readBigUInt64LE(offset);
            offset += 8;
            const total = metadataData.readBigUInt64LE(offset);
            offset += 8;
            
            uses = {
                useMethod: useMethod === 0 ? 'Burn' : useMethod === 1 ? 'Multiple' : 'Single',
                remaining: Number(remaining),
                total: Number(total)
            };
        }

        // Read isMutable (bool)
        const isMutable = metadataData[offset] === 1;
        offset += 1;

        // Read editionNonce (optional)
        const hasEditionNonce = metadataData[offset] === 1;
        offset += 1;
        
        let editionNonce = undefined;
        if (hasEditionNonce) {
            editionNonce = metadataData[offset];
        }

        // Read tokenStandard (optional)
        const hasTokenStandard = metadataData[offset] === 1;
        offset += 1;
        
        let tokenStandard = undefined;
        if (hasTokenStandard) {
            const standard = metadataData[offset];
            tokenStandard = standard === 0 ? 'NonFungible' : 
                           standard === 1 ? 'FungibleAsset' : 
                           standard === 2 ? 'Fungible' : 
                           standard === 3 ? 'NonFungibleEdition' : 'Unknown';
        }

        // Read collectionDetails (optional)
        const hasCollectionDetails = metadataData[offset] === 1;
        offset += 1;
        
        let collectionDetails = undefined;
        if (hasCollectionDetails) {
            const detailsType = metadataData[offset];
            offset += 1;
            
            if (detailsType === 0) {
                collectionDetails = { __kind: 'V1', size: Number(metadataData.readBigUInt64LE(offset)) };
            } else if (detailsType === 1) {
                collectionDetails = { __kind: 'V2' };
            }
        }

        const metadata: MetaplexMetadata = {
            name,
            symbol,
            uri,
            sellerFeeBasisPoints,
            creators,
            collection,
            uses,
            isMutable,
            editionNonce,
            tokenStandard,
            collectionDetails
        };

        // Optionally fetch off-chain metadata
        if (includeOffChainMetadata && uri) {
            try {
                const offChainResponse = await fetch(uri);
                if (offChainResponse.ok) {
                    metadata.offChainMetadata = await offChainResponse.json();
                }
            } catch (error) {
                this.logger?.warn('Failed to fetch off-chain metadata:', error);
            }
        }

        return metadata;
    }
}