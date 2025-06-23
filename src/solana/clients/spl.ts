import { Connection } from "@solana/web3.js";
import { throwError } from "../../utils/error-handling";
import { SplConfig, Logger, GetPriorityFeeOptions } from "../types";

export class SplClient {
    private static readonly DEFAULT_TIMEOUT = 30000;
    private static readonly DEFAULT_RETRIES = 3;
    private static readonly DEFAULT_PERCENTILE = 0.9999999; // 99.99999th percentile
    private static readonly DEFAULT_CU_PRICE = 0.1;
    
    private readonly config: Omit<Required<SplConfig>, 'logger' | 'connection' | 'programId' | 'percentile' | 'defaultCuPrice'> & { 
        connection: Connection; 
        logger?: Logger; 
    };
    private readonly connection: Connection;
    private readonly logger?: Logger;
    private requestId = 0;

    constructor(config: SplConfig) {
        this.config = {
            timeout: SplClient.DEFAULT_TIMEOUT,
            retries: SplClient.DEFAULT_RETRIES,
            ...config,
        };
        this.connection = this.config.connection;
        this.logger = this.config.logger;
    }

    /**
     * Get priority fee based on recent network activity
     * @param options - Optional configuration for fee calculation
     * @param options.percentile - Percentile to use for fee calculation (0-1, default: 0.9999999)
     * @param options.defaultCuPrice - Default fee when no data is available (default: 0.1)
     * @returns Priority fee in microLamports per compute unit
     */
    public async getPriorityFee(options: GetPriorityFeeOptions = {}): Promise<number> {
        const {
            percentile = SplClient.DEFAULT_PERCENTILE,
            defaultCuPrice = SplClient.DEFAULT_CU_PRICE,
        } = options;

        return this.makeRequest(async () => {
            const recentFees = await this.connection.getRecentPrioritizationFees();
            
            if (recentFees.length === 0) {
                this.logger?.warn('No recent prioritization fees found, using default');
                return defaultCuPrice;
            }

            const sortedFees = recentFees
                .map((f) => f.prioritizationFee)
                .sort((a, b) => b - a);

            const topPercentileIndex = Math.floor(sortedFees.length * (1 - percentile));
            const calculatedFee = sortedFees[topPercentileIndex] || defaultCuPrice;
            
            const finalFee = Math.max(calculatedFee, defaultCuPrice);
            
            this.logger?.debug('Priority fee calculation', {
                recentFeesCount: recentFees.length,
                percentile,
                calculatedFee,
                finalFee,
            });

            return finalFee;
        }, 'getPriorityFee');
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

        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                const result = await Promise.race([
                    operation(),
                    new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Operation timed out after ${this.config.timeout}ms`));
                        }, this.config.timeout);
                    }),
                ]);

                this.logger?.debug(`Request ${requestId} completed: ${operationName}`, { result });
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger?.warn(`Request ${requestId} attempt ${attempt} failed: ${operationName}`, lastError);

                if (attempt === this.config.retries) {
                    this.logger?.error(`Request ${requestId} failed after ${attempt} attempts: ${operationName}`, lastError);
                    throwError(lastError, `SPL Client Request Failed (${operationName})`);
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
    public getConfig(): Readonly<Omit<Required<SplConfig>, 'logger' | 'connection' | 'programId' | 'percentile' | 'defaultCuPrice'> & { 
        connection: Connection; 
        logger?: Logger; 
    }> {
        return this.config;
    }
}