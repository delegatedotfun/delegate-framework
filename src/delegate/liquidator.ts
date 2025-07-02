import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { LiquidatorDelegateOptions, LiquidatorDelegateResult } from "./types";
import { BaseDelegate } from "./base-delegate";
import { HeliusClient } from "../solana/clients/helius";
import { JupiterSwap } from "./swap/jupiter";
import { RaydiumSwap } from "./swap/raydium";

export class Liquidator extends BaseDelegate<LiquidatorDelegateOptions, LiquidatorDelegateResult> {
    private readonly heliusClient: HeliusClient;
    private readonly jupiterSwap: JupiterSwap;
    private readonly raydiumSwap: RaydiumSwap;

    constructor(
        connection: Connection, 
        signerKeypair: Keypair, 
        heliusClient: HeliusClient, 
        feeTakerKeypair?: Keypair
    ) {
        super(connection, signerKeypair, feeTakerKeypair);
        this.heliusClient = heliusClient;
        
        // Initialize swap protocols
        this.jupiterSwap = new JupiterSwap(signerKeypair, connection, { heliusClient });
        this.raydiumSwap = new RaydiumSwap(signerKeypair, { heliusClient });
    }

    async executeDelegate(delegateOptions: LiquidatorDelegateOptions): Promise<LiquidatorDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('liquidator_execution_started', { requestId });
            
            this.validateOptions(delegateOptions);

            const { delegateAddress, tokenAddress, minUsdValue = 1 } = delegateOptions;
            
            this.logOperation('liquidator_setup', { 
                requestId, 
                delegateAddress, 
                targetToken: tokenAddress,
                minUsdValue 
            });

            // Get all token accounts for the delegate address
            const tokenAccounts = await this.getTokenAccounts(delegateAddress);
            
            if (!tokenAccounts || tokenAccounts.length === 0) {
                this.logOperation('no_token_accounts_found', { requestId, delegateAddress });
                return {
                    success: true,
                    signatures: [],
                    liquidatedTokens: [],
                    totalLiquidated: 0
                };
            }

            const signatures: string[] = [];
            const liquidatedTokens: LiquidatorDelegateResult['liquidatedTokens'] = [];
            let totalLiquidated = 0;

            // Process each token account
            for (let i = 0; i < tokenAccounts.length; i++) {
                const tokenAccount = tokenAccounts[i];
                
                if (!tokenAccount) {
                    this.logOperation('token_account_skipped', { 
                        requestId, 
                        reason: 'undefined_account',
                        index: i
                    });
                    continue;
                }

                // Skip frozen accounts
                if (tokenAccount.frozen) {
                    this.logOperation('token_account_skipped', { 
                        requestId, 
                        mint: tokenAccount.mint,
                        reason: 'frozen_account'
                    });
                    continue;
                }

                // Skip USDC (common stablecoin)
                if (tokenAccount.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
                    this.logOperation('token_account_skipped', { 
                        requestId, 
                        mint: tokenAccount.mint,
                        reason: 'usdc_excluded'
                    });
                    continue;
                }

                try {
                    const result = await this.processTokenLiquidation(
                        tokenAccount,
                        tokenAddress,
                        minUsdValue,
                        i + 1,
                        tokenAccounts.length,
                        requestId
                    );
                    
                    if (result.success && result.signature) {
                        signatures.push(result.signature);
                        liquidatedTokens.push({
                            mint: tokenAccount.mint,
                            amount: tokenAccount.amount,
                            signature: result.signature
                        });
                        totalLiquidated++;
                    }
                    
                    this.logOperation('token_liquidation_processed', { 
                        requestId, 
                        mint: tokenAccount.mint,
                        amount: tokenAccount.amount,
                        success: result.success,
                        signature: result.signature 
                    });
                } catch (error) {
                    await this.handleError(error instanceof Error ? error : new Error(String(error)), { 
                        requestId, 
                        mint: tokenAccount.mint 
                    });
                    
                    // Continue with next token account instead of failing completely
                    this.logOperation('token_liquidation_skipped', { 
                        requestId, 
                        mint: tokenAccount.mint,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    continue;
                }
            }

            this.logOperation('liquidator_execution_completed', { 
                requestId, 
                signatures, 
                totalLiquidated 
            });
            
            return {
                success: true,
                signatures,
                liquidatedTokens,
                totalLiquidated
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }

    validateOptions(delegateOptions: LiquidatorDelegateOptions): void {
        this.validateRequiredField(delegateOptions.delegateAddress, 'delegateAddress');
        this.validatePublicKey(delegateOptions.delegateAddress, 'delegateAddress');
        
        this.validateRequiredField(delegateOptions.tokenAddress, 'tokenAddress');
        this.validatePublicKey(delegateOptions.tokenAddress, 'tokenAddress');
        
        if (delegateOptions.minUsdValue !== undefined) {
            this.validateNumberField(delegateOptions.minUsdValue, 'minUsdValue', 0);
        }
    }

    private async getTokenAccounts(delegateAddress: string): Promise<any[]> {
        try {
            const response = await this.heliusClient.getTokenAccounts(new PublicKey(delegateAddress));
            return response.value || [];
        } catch (error) {
            this.logOperation('get_token_accounts_failed', {
                delegateAddress,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    private async processTokenLiquidation(
        tokenAccount: any,
        targetTokenAddress: string,
        minUsdValue: number,
        currentIndex: number,
        totalAccounts: number,
        requestId: number
    ): Promise<{ success: boolean; signature?: string; error?: string }> {
        const { mint: tokenMint, amount: tokenAmount } = tokenAccount;
        
        this.logOperation('liquidation_progress', { 
            requestId, 
            currentIndex, 
            totalAccounts,
            mint: tokenMint,
            amount: tokenAmount
        });

        // Get token decimals
        const decimals = await this.getTokenDecimals(tokenMint);
        if (decimals === -1) {
            throw new Error(`Failed to get decimals for token ${tokenMint}`);
        }

        // Calculate token amount in human readable format
        const tokenAmountInUnits = tokenAmount / Math.pow(10, decimals);

        // Try to get quote from Jupiter first
        let quote = null;
        try {
            quote = await this.jupiterSwap.getQuote(tokenMint, targetTokenAddress, tokenAmountInUnits, 0.5);
        } catch (error) {
            this.logOperation('jupiter_quote_failed', {
                requestId,
                fromToken: tokenMint,
                toToken: targetTokenAddress,
                amount: tokenAmountInUnits,
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // If Jupiter quote failed or price is too low, try Raydium
        if (!quote || (quote.swapUsdValue && quote.swapUsdValue < minUsdValue)) {
            try {
                quote = await this.raydiumSwap.getQuote(tokenMint, targetTokenAddress, tokenAmountInUnits, 0.5);
            } catch (error) {
                this.logOperation('raydium_quote_failed', {
                    requestId,
                    fromToken: tokenMint,
                    toToken: targetTokenAddress,
                    amount: tokenAmountInUnits,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // If no quote available or price is too low, skip
        if (!quote || (quote.swapUsdValue && quote.swapUsdValue < minUsdValue)) {
            this.logOperation('liquidation_skipped_low_value', {
                requestId,
                mint: tokenMint,
                usdValue: quote?.swapUsdValue || 0,
                minUsdValue
            });
            return { success: false, error: 'Price too low or no quote available' };
        }

        // Execute swap with fallback
        const swapResult = await this.executeSwapWithFallback(
            tokenMint,
            targetTokenAddress,
            tokenAmountInUnits,
            0.5 // 0.5% slippage
        );

        return swapResult;
    }

    private async executeSwapWithFallback(
        fromAsset: string,
        toAsset: string,
        amount: number,
        slippage: number
    ): Promise<{ success: boolean; signature?: string; error?: string }> {
        // Try Jupiter first
        try {
            const result = await this.retryOperation(
                () => this.executeJupiterSwap(fromAsset, toAsset, amount, slippage),
                3
            );
            
            if (result.success) {
                return { ...result, signature: result.signature };
            }
        } catch (error) {
            this.logOperation('jupiter_swap_failed', {
                fromAsset,
                toAsset,
                amount,
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Fallback to Raydium
        try {
            const result = await this.retryOperation(
                () => this.executeRaydiumSwap(fromAsset, toAsset, amount, slippage),
                3
            );
            
            if (result.success) {
                return { ...result, signature: result.signature };
            }
        } catch (error) {
            this.logOperation('raydium_swap_failed', {
                fromAsset,
                toAsset,
                amount,
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return {
            success: false,
            error: "Both Jupiter and Raydium swaps failed"
        };
    }

    private async executeJupiterSwap(
        fromAsset: string,
        toAsset: string,
        amount: number,
        slippage: number
    ): Promise<{ success: boolean; signature?: string; error?: string }> {
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

    private async executeRaydiumSwap(
        fromAsset: string,
        toAsset: string,
        amount: number,
        slippage: number
    ): Promise<{ success: boolean; signature?: string; error?: string }> {
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

    private async getTokenDecimals(tokenAddress: string): Promise<number> {
        try {
            const mint = new PublicKey(tokenAddress);
            const mintInfo = await this.retryOperation(async () => {
                return await getMint(this.connection, mint);
            }, 3);
            return mintInfo.decimals;
        } catch (error) {
            this.logOperation('get_token_decimals_failed', {
                tokenAddress,
                error: error instanceof Error ? error.message : String(error)
            });
            return -1;
        }
    }
}