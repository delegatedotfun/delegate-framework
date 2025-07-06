import { Transaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { throwError } from "../../utils/error-handling";
import { HeliusConfig, SendTransactionOptions, Logger, RpcRequest, RpcResponse, GetLatestBlockhashOptions } from "../types";

export class HeliusClient {
    private static readonly DEFAULT_TIMEOUT = 30000;
    private static readonly DEFAULT_RETRIES = 3;
    private static readonly DEFAULT_RPC_URL = "https://mainnet.helius-rpc.com";
    private static readonly DEFAULT_ENHANCED_API_URL = "https://api.helius.xyz/v0";
    
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
        transaction: Transaction, 
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
     * Get the balance of a public key
     * @param publicKey - The public key to check balance for
     * @returns Balance in lamports
     */
    public async getBalance(publicKey: PublicKey): Promise<any> {
        return this.makeRequest('getBalance', [publicKey.toString()]);
    }

    /**
     * Get account information
     * @param publicKey - The public key to get account info for
     * @param encoding - Optional encoding (default: 'base64')
     * @returns Account information
     */
    public async getAccountInfo(publicKey: PublicKey, encoding: 'base64' | 'base58' = 'base64'): Promise<any> {
        return this.makeRequest('getAccountInfo', [
            publicKey.toString(),
            { encoding }
        ]);
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
     * @returns Transactions
     */
    public async getTransactions(publicKey: PublicKey): Promise<any> {
        // Use enhanced API endpoint for getTransactions
        return this.makeRequest('getTransactions', [
            publicKey.toString()
        ], this.config.enhancedApiUrl);
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
        return this.makeRequest('getTokenAccounts', [{
            mint: mint.toString(),
            owner: publicKey.toString()
        }]);
    }

    /**
     * Get token accounts by owner
     * @param publicKey - The public key to get token accounts from
     * @returns Token accounts
     */
    public async getTokenAccounts(publicKey: PublicKey): Promise<any> {
        return this.makeRequest('getTokenAccounts', [{
            owner: publicKey.toString()
        }]);
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
    public async simulateTransaction(transaction: Transaction): Promise<any> {
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
}