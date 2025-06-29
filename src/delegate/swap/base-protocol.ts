import { Keypair } from "@solana/web3.js";
import { SwapQuote, SwapTransaction, SwapResult } from "../types";

export abstract class BaseSwapProtocol {
    protected keypair: Keypair;
    protected connection: any;
    protected requestId = 0;
  
    constructor(keypair: Keypair, connection?: any) {
      this.keypair = keypair;
      this.connection = connection;
    }

    /**
     * Framework-style error handling wrapper
     */
    protected async handleError<T>(
      operation: () => Promise<T>,
      context: string
    ): Promise<T> {
      const requestId = this.generateRequestId();
      
      try {
        this.logOperation(`${context}_started`, { requestId });
        const result = await operation();
        this.logOperation(`${context}_completed`, { requestId });
        return result;
      } catch (error) {
        await this.logError(error instanceof Error ? error : new Error(String(error)), { requestId, context });
        throw error;
      }
    }

    /**
     * Framework-style retry operation
     */
    protected async retryOperation<T>(
      operation: () => Promise<T>,
      maxRetries: number = 3
    ): Promise<T> {
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

    /**
     * Framework-style error logging
     */
    protected async logError(error: Error, context?: Record<string, any>): Promise<void> {
      const errorContext = {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        ...context
      };

      this.logOperation('error_occurred', errorContext);
      console.error('Swap protocol error:', errorContext);
    }

    /**
     * Framework-style operation logging
     */
    protected logOperation(operation: string, data?: Record<string, any>): void {
      const logData = {
        operation,
        timestamp: new Date().toISOString(),
        signer: this.keypair.publicKey.toBase58(),
        ...data
      };

      console.log(`[SwapProtocol] ${operation}:`, logData);
    }

    /**
     * Generate unique request ID
     */
    protected generateRequestId(): number {
      return ++this.requestId;
    }
  
    /**
     * Get a quote for swapping from one token to another
     */
    abstract getQuote(
      inputMint: string,
      outputMint: string,
      amount: number,
      slippage?: number
    ): Promise<SwapQuote | null>;
  
    /**
     * Create a swap transaction from a quote
     */
    abstract createSwapTransaction(
      quote: SwapQuote,
      slippage?: number
    ): Promise<SwapTransaction>;
  
    /**
     * Execute a swap transaction
     */
    abstract executeSwap(
      transaction: SwapTransaction
    ): Promise<SwapResult>;
  
    /**
     * Complete swap flow: quote -> transaction -> execute
     */
    async swap(
      inputMint: string,
      outputMint: string,
      amount: number,
      slippage: number = 0.5
    ): Promise<SwapResult> {
      return this.handleError(async () => {
        // Get quote
        const quote = await this.getQuote(inputMint, outputMint, amount, slippage);
        if (!quote) {
          return {
            success: false,
            error: 'Failed to get swap quote'
          };
        }
  
        // Create transaction
        const transaction = await this.createSwapTransaction(quote, slippage);
        
        // Execute transaction
        const result = await this.executeSwap(transaction);
        
        return {
          ...result,
          outputAmount: quote.outputAmount,
          priceImpact: quote.priceImpact
        };
      }, 'swap_flow');
    }
  
    /**
     * Validate swap parameters
     */
    protected validateSwapParams(
      inputMint: string,
      outputMint: string,
      amount: number
    ): void {
      if (!inputMint || !outputMint) {
        throw new Error('Input and output mints are required');
      }
      
      if (inputMint === outputMint) {
        throw new Error('Input and output mints cannot be the same');
      }
      
      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }
    }
  } 