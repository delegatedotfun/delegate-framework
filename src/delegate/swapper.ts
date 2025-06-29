/**
 * Framework-ized Swapper for executing token swaps with fallback between protocols
 * 
 * Usage Example:
 * ```typescript
 * const swapper = new Swapper(
 *   privateKey,
 *   'https://mainnet.helius-rpc.com',
 *   'your-api-key',
 *   {
 *     jupiter: {
 *       tokenListUrl: 'https://token.jup.ag/all',
 *       fallbackDecimals: 6
 *     }
 *   }
 * );
 * 
 * const result = await swapper.executeSwap({
 *   fromAsset: 'So11111111111111111111111111111111111111112', // SOL
 *   toAssets: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'], // USDC
 *   numTokens: 0.1, // Optional: specific amount, otherwise uses available balance
 *   slippage: 0.5 // Optional: default 0.5%
 * });
 * 
 * if (result.success) {
 *   console.log(`Swap successful using ${result.protocol}: ${result.signature}`);
 * } else {
 *   console.log(`Swap failed: ${result.error}`);
 * }
 * ```
 */

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import bs58 from 'bs58';
import { JupiterSwap, JupiterSwapConfig } from './swap/jupiter';
import { RaydiumSwap, RaydiumSwapConfig } from './swap/raydium';
import { HeliusClient } from '../solana/clients/helius';
import { BaseDelegate } from './base-delegate';

export interface SwapTask {
  fromAsset: string;
  toAssets: string[];
  numTokens?: number;
  slippage?: number;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  protocol?: string;
  error?: string;
}

export class Swapper extends BaseDelegate {
  private heliusClient: HeliusClient;
  private jupiterSwap: JupiterSwap;
  private raydiumSwap: RaydiumSwap;

  constructor(
    privateKey: string,
    rpcUrl: string,
    apiKey: string,
    config: {
      jupiter?: JupiterSwapConfig;
      raydium?: RaydiumSwapConfig;
    } = {}
  ) {
    const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
    
    super(connection, keypair);
    
    this.heliusClient = new HeliusClient({ apiKey, rpcUrl });
    
    // Initialize swap protocols with HeliusClient
    this.jupiterSwap = new JupiterSwap(keypair, connection, {
      ...config.jupiter,
      heliusClient: this.heliusClient
    });
    
    this.raydiumSwap = new RaydiumSwap(keypair, {
      ...config.raydium,
      heliusClient: this.heliusClient
    });
  }

  /**
   * Execute a swap task with fallback between protocols
   */
  async executeSwap(task: SwapTask): Promise<SwapResult> {
    const requestId = this.generateRequestId();
    
    try {
      this.logOperation('swap_execution_started', { requestId });
      
      // Validate task
      if (!task.fromAsset || !task.toAssets || task.toAssets.length !== 1) {
        throw new Error("Invalid swap task: fromAsset and exactly one toAsset required");
      }

      const fromAsset = task.fromAsset; // Now TypeScript knows this is not undefined
      const toAsset = task.toAssets[0]!; // Assert non-null since we validated length
      const slippage = task.slippage || 0.5; // Default 0.5% slippage

      // Get swap amount
      const swapAmount = await this.getSwapAmount(fromAsset, task.numTokens);

      console.log(`Attempting swap: ${swapAmount} ${fromAsset} -> ${toAsset}`);

      // Try Jupiter first, then Raydium as fallback
      const result = await this.swapWithFallback(fromAsset, toAsset, swapAmount, slippage);

      if (result.success) {
        console.log(`Swap successful using ${result.protocol}: ${result.signature}`);
        this.logOperation('swap_execution_completed', { requestId, protocol: result.protocol, signature: result.signature });
      } else {
        console.log(`Swap failed: ${result.error}`);
        this.logOperation('swap_execution_failed', { requestId, error: result.error });
      }

      return result;
    } catch (error) {
      await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
      throw error;
    }
  }

  /**
   * Get the appropriate swap amount based on asset type and balance
   */
  private async getSwapAmount(fromAsset: string, specifiedAmount?: number): Promise<number> {
    if (specifiedAmount) {
      return specifiedAmount;
    }

    if (fromAsset === "So11111111111111111111111111111111111111112") {
      // SOL - use available balance minus buffer
      const balance = await this.heliusClient.getBalance(this.signerKeypair.publicKey);
      const costBuffer = 0.005 * LAMPORTS_PER_SOL; // Keep 0.005 SOL for fees
      return Math.max(0, (balance - costBuffer) / LAMPORTS_PER_SOL);
    } else {
      // Token - get token balance
      const tokenAccount = await getAssociatedTokenAddress(
        new PublicKey(fromAsset),
        this.signerKeypair.publicKey,
        true
      );
      const balanceInfo = await this.heliusClient.getTokenAccountBalance(tokenAccount);
      return parseFloat(balanceInfo.value.uiAmountString || '0');
    }
  }

  /**
   * Execute swap with fallback between protocols
   */
  private async swapWithFallback(
    fromAsset: string,
    toAsset: string,
    amount: number,
    slippage: number
  ): Promise<SwapResult> {
    // Try Jupiter first
    try {
      const result = await this.retryOperation(
        () => this.executeJupiterSwap(fromAsset, toAsset, amount, slippage),
        3
      );
      
      if (result.success) {
        return { ...result, protocol: 'Jupiter' };
      }
    } catch (error) {
      console.warn("Jupiter swap failed, trying Raydium:", error);
    }

    // Fallback to Raydium
    try {
      const result = await this.retryOperation(
        () => this.executeRaydiumSwap(fromAsset, toAsset, amount, slippage),
        3
      );
      
      if (result.success) {
        return { ...result, protocol: 'Raydium' };
      }
    } catch (error) {
      console.error("Raydium swap also failed:", error);
    }

    return {
      success: false,
      error: "Both Jupiter and Raydium swaps failed"
    };
  }

  /**
   * Execute Jupiter swap
   */
  private async executeJupiterSwap(
    fromAsset: string,
    toAsset: string,
    amount: number,
    slippage: number
  ): Promise<SwapResult> {
    // Get quote
    const quote = await this.jupiterSwap.getQuote(fromAsset, toAsset, amount, slippage);
    if (!quote) {
      throw new Error("Failed to get Jupiter quote");
    }

    // Create transaction
    const transaction = await this.jupiterSwap.createSwapTransaction(quote);
    
    // Execute swap
    const result = await this.jupiterSwap.executeSwap(transaction);
    
    return result;
  }

  /**
   * Execute Raydium swap
   */
  private async executeRaydiumSwap(
    fromAsset: string,
    toAsset: string,
    amount: number,
    slippage: number
  ): Promise<SwapResult> {
    // Get quote
    const quote = await this.raydiumSwap.getQuote(fromAsset, toAsset, amount, slippage);
    if (!quote) {
      throw new Error("Failed to get Raydium quote");
    }

    // Create transaction
    const transaction = await this.raydiumSwap.createSwapTransaction(quote);
    
    // Execute swap
    const result = await this.raydiumSwap.executeSwap(transaction);
    
    return result;
  }

  /**
   * Get current balances for all assets
   */
  async getBalances(): Promise<{
    sol: number;
    tokens: Array<{ mint: string; balance: number; decimals: number }>;
  }> {
    const requestId = this.generateRequestId();
    
    try {
      this.logOperation('balance_check_started', { requestId });
      
      const solBalance = await this.heliusClient.getBalance(this.signerKeypair.publicKey);
      const tokenAccounts = await this.heliusClient.getTokenAccounts(this.signerKeypair.publicKey);

      const tokens = await Promise.all(
        tokenAccounts.value.map(async (account: any) => {
          const balanceInfo = await this.heliusClient.getTokenAccountBalance(account.pubkey);
          return {
            mint: balanceInfo.value.mint,
            balance: parseFloat(balanceInfo.value.uiAmountString || '0'),
            decimals: balanceInfo.value.decimals
          };
        })
      );

      const result = {
        sol: solBalance / LAMPORTS_PER_SOL,
        tokens
      };

      this.logOperation('balance_check_completed', { requestId, tokenCount: tokens.length });
      return result;
    } catch (error) {
      await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
      throw error;
    }
  }

  // Required abstract method implementations
  async executeDelegate(): Promise<any> {
    throw new Error("Use executeSwap instead");
  }

  validateOptions(): void {
    // No validation needed for this delegate
  }
}