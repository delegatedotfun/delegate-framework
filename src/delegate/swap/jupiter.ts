import { Keypair, VersionedTransaction, Connection } from '@solana/web3.js';
import { BaseSwapProtocol } from './base-protocol';
import { SwapQuote, SwapTransaction, SwapResult } from '../types';
import { HeliusClient } from '../../solana/clients/helius';

export interface JupiterSwapConfig {
  tokenListUrl?: string; // Configurable token list URL
  fallbackDecimals?: number; // Default decimals if token not found
  heliusClient?: HeliusClient; // Optional Helius client for RPC calls
}

export class JupiterSwap extends BaseSwapProtocol {
  private config: JupiterSwapConfig;
  private heliusClient?: HeliusClient;

  constructor(keypair: Keypair, connection: Connection, config: JupiterSwapConfig = {}) {
    super(keypair, connection);
    this.connection = connection;
    this.config = {
      tokenListUrl: 'https://token.jup.ag/all', // Jupiter's public token list
      fallbackDecimals: 6,
      ...config
    };
    this.heliusClient = config.heliusClient;
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number = 0.2
  ): Promise<SwapQuote | null> {
    return this.handleError(async () => {
      this.validateSwapParams(inputMint, outputMint, amount);

      // Convert to Asset format for Jupiter
      const fromAsset: { contractAddress: string, decimals: number } = { contractAddress: inputMint, decimals: 0 }; // We'll get decimals later
      const toAsset: { contractAddress: string, decimals: number } = { contractAddress: outputMint, decimals: 0 };

      // Get token info to get decimals
      const fromToken = await this.getTokenInfo(inputMint);
      const toToken = await this.getTokenInfo(outputMint);
      
      fromAsset.decimals = fromToken.decimals;
      toAsset.decimals = toToken.decimals;

      const quote = await this.retryOperation(async () => {
        const response = await fetch(
          `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount * Math.pow(10, fromAsset.decimals)}&slippage=${slippage}`
        );
        
        if (!response.ok) {
          throw new Error(`Jupiter API error: ${response.statusText}`);
        }
        
        return response.json();
      }, 3);

      if (quote && quote.outAmount) {
        return {
          inputMint,
          outputMint,
          inputAmount: amount.toString(),
          outputAmount: (parseInt(quote.outAmount) / Math.pow(10, toAsset.decimals)).toString(),
          priceImpact: quote.priceImpactPct,
          swapUsdValue: quote.swapUsdValue,
          jupiterQuote: quote // Store original Jupiter quote
        };
      }

      return null;
    }, 'jupiter_get_quote');
  }

  async createSwapTransaction(
    quote: SwapQuote
  ): Promise<SwapTransaction> {
    return this.handleError(async () => {
      if (!quote['jupiterQuote']) {
        throw new Error('Invalid quote: missing Jupiter quote data');
      }

      const { swapTransaction } = await this.retryOperation(async () => {
        const response = await fetch('https://quote-api.jup.ag/v6/swap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            quoteResponse: quote['jupiterQuote'],
            userPublicKey: this.keypair.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Jupiter API error: ${response.statusText}`);
        }
        
        return response.json();
      }, 3);

      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      return {
        serialize: () => Buffer.from(transaction.serialize()),
        sign: (signers: Keypair[]) => transaction.sign(signers)
      };
    }, 'jupiter_create_transaction');
  }

  async executeSwap(transaction: SwapTransaction): Promise<SwapResult> {
    return this.handleError(async () => {
      transaction.sign([this.keypair]);
      
      const signature = await this.retryOperation(async () => {
        return await this.connection.sendTransaction(
          transaction as any, // Type assertion needed due to interface
          { skipPreflight: true, maxRetries: 2 }
        );
      }, 3);

      const latestBlockhash = await this.retryOperation(async () => {
        return await this.connection.getLatestBlockhash();
      }, 3);

      await this.retryOperation(async () => {
        return await this.connection.confirmTransaction({
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          signature
        });
      }, 3);

      return {
        success: true,
        signature
      };
    }, 'jupiter_execute_swap');
  }

  private async getTokenInfo(tokenAddress: string): Promise<{ decimals: number }> {
    try {
      // Try Jupiter's public token list first
      const response = await fetch(this.config.tokenListUrl!);
      if (!response.ok) {
        throw new Error(`Failed to fetch token list: ${response.statusText}`);
      }
      
      const tokens = await response.json();
      const token = tokens.find((t: any) => t.address === tokenAddress);
      
      if (token && typeof token.decimals === 'number') {
        return { decimals: token.decimals };
      }
      
      // Fallback: Try to get token info from HeliusClient if available
      if (this.heliusClient) {
        const tokenInfo = await this.heliusClient.getTokenInfo(tokenAddress);
        if (tokenInfo) {
          return tokenInfo;
        }
      }
      
      // Final fallback: use configured default
      console.warn(`Token ${tokenAddress} not found in token list, using default decimals: ${this.config.fallbackDecimals}`);
      return { decimals: this.config.fallbackDecimals! };
      
    } catch (error) {
      console.warn(`Failed to get token info for ${tokenAddress}, using default decimals: ${this.config.fallbackDecimals}`, error);
      return { decimals: this.config.fallbackDecimals! };
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<JupiterSwapConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): JupiterSwapConfig {
    return { ...this.config };
  }
} 