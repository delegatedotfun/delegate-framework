import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { QuoteResponse } from "@jup-ag/api";
import { throwError } from "../../utils/error-handling";
import { JupiterConfig, Logger, SwapParams } from "../types";

export class JupiterClient {
    private static readonly DEFAULT_TIMEOUT = 30000;
    private static readonly DEFAULT_RETRIES = 3;
    private static readonly DEFAULT_QUOTE_API_URL = "https://quote-api.jup.ag/v6";
    
    private readonly config: Omit<Required<JupiterConfig>, 'logger'> & { logger?: Logger };
    private readonly logger?: Logger;
    private requestId = 0;

    constructor(config: JupiterConfig) {
        this.config = {
            quoteApiUrl: JupiterClient.DEFAULT_QUOTE_API_URL,
            timeout: JupiterClient.DEFAULT_TIMEOUT,
            retries: JupiterClient.DEFAULT_RETRIES,
            ...config,
        };
        this.logger = this.config.logger;
    }

    /**
     * Get a quote for swapping tokens
     * @param fromMint - The input token mint
     * @param toMint - The output token mint
     * @param amount - The amount to swap (in smallest unit)
     * @param slippageBps - Slippage tolerance in basis points (default: 100 = 1%)
     * @returns Quote response from Jupiter
     */
    public async getQuote(
        fromMint: PublicKey, 
        toMint: PublicKey, 
        amount: number | string, 
        slippageBps: number = 100
    ): Promise<QuoteResponse> {
        // Validate inputs
        if (!fromMint || !toMint) {
            throwError('Invalid mint addresses provided', 'Jupiter Quote Error');
        }
        
        if (!amount || Number(amount) <= 0) {
            throwError('Invalid amount provided', 'Jupiter Quote Error');
        }
        
        if (slippageBps < 0 || slippageBps > 10000) {
            throwError('Slippage must be between 0 and 10000 basis points', 'Jupiter Quote Error');
        }

        return this.makeRequest(async () => {
            const url = `${this.config['quoteApiUrl']}/quote?inputMint=${fromMint.toBase58()}&outputMint=${toMint.toBase58()}&amount=${amount}&slippageBps=${slippageBps}`;
            
            this.logger?.debug('Requesting Jupiter quote', {
                fromMint: fromMint.toBase58(),
                toMint: toMint.toBase58(),
                amount,
                slippageBps,
                url,
            });

            const response = await fetch(url);
            
            if (!response || typeof response.ok !== 'boolean') {
                throw new Error('No response received from Jupiter');
            }

            if (!response.ok) {
                throwError(`HTTP ${response.status}: ${response.statusText}`, 'Jupiter API Error');
            }

            const quoteResponse: QuoteResponse = await response.json();
            
            this.logger?.debug('Jupiter quote received', {
                inAmount: quoteResponse.inAmount,
                outAmount: quoteResponse.outAmount,
                priceImpactPct: quoteResponse.priceImpactPct,
                otherAmountThreshold: quoteResponse.otherAmountThreshold,
            });

            return quoteResponse;
        }, 'getQuote');
    }

    /**
     * Get a swap transaction from Jupiter
     * @param quoteResponse - The quote response from getQuote
     * @param swapParams - Additional swap parameters
     * @returns Versioned transaction ready for signing
     */
    public async getSwapTransaction(
        quoteResponse: QuoteResponse, 
        swapParams: SwapParams
    ): Promise<VersionedTransaction> {
        if (!quoteResponse) {
            throwError('Quote response is required', 'Jupiter Swap Error');
        }
        if (!swapParams) {
            throwError('Swap parameters are required', 'Jupiter Swap Error');
        }
        return this.makeRequest(async () => {
            this.logger?.debug('Requesting Jupiter swap transaction', {
                userPublicKey: swapParams.userPublicKey,
            });
            const response = await fetch(`${this.config['quoteApiUrl']}/swap`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(swapParams),
            });
            if (!response || typeof response.ok !== 'boolean') {
                throw new Error('No response received from Jupiter');
            }
            if (!response.ok) {
                const errorText = await response.text();
                throwError(`HTTP ${response.status}: ${errorText}`, 'Jupiter Swap Error');
            }
            const { swapTransaction } = await response.json();
            if (!swapTransaction) {
                throwError('No swap transaction received from Jupiter', 'Jupiter Swap Error');
            }
            this.logger?.debug('Jupiter swap transaction received', {
                transactionSize: swapTransaction.length,
            });
            return VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        }, 'getSwapTransaction');
    }

    /**
     * Make a request with retry logic and error handling
     * @param operation - The operation to perform
     * @param operationName - Name of the operation for logging
     * @returns Result of the operation
     */
    private async makeRequest<T>(
        operation: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        const requestId = ++this.requestId;
        this.logger?.debug(`Request ${requestId} started: ${operationName}`);

        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= this.config['retries']; attempt++) {
            try {
                const result = await Promise.race([
                    operation(),
                    new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Operation timed out after ${this.config['timeout']}ms`));
                        }, this.config['timeout']);
                    }),
                ]);

                this.logger?.debug(`Request ${requestId} completed: ${operationName}`, { result });
                return result;
            } catch (error) {
                // If error is not an Error instance, wrap it
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`Request ${requestId} attempt ${attempt} failed: ${operationName}`, lastError);

                if (attempt === this.config['retries']) {
                    this.logger?.error(`Request ${requestId} failed after ${attempt} attempts: ${operationName}`, lastError);
                    throwError(lastError, `Jupiter API Request Failed (${operationName})`);
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
    public getConfig(): Readonly<Omit<Required<JupiterConfig>, 'logger'> & { logger?: Logger }> {
        return this.config;
    }
}
