import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { AllocatorDelegateOptions, AllocatorDelegateResult } from "./types";
import { BaseDelegate } from "./base-delegate";
import { HeliusClient } from "../solana/clients/helius";
import { JupiterSwap } from "./swap/jupiter";
import { RaydiumSwap } from "./swap/raydium";

export class Allocator extends BaseDelegate<AllocatorDelegateOptions, AllocatorDelegateResult> {
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

    async executeDelegate(delegateOptions: AllocatorDelegateOptions): Promise<AllocatorDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('allocator_execution_started', { requestId });
            
            this.validateOptions(delegateOptions);

            const { allocations, slippageBps = 50, costBuffer = 0.005 } = delegateOptions;
            
            if (!allocations || allocations.length === 0) {
                throw new Error("Allocations are required");
            }

            // Get sender's SOL balance
            const senderBalance = await this.heliusClient.getBalance(this.signerKeypair.publicKey);
            const solBalanceInSol = senderBalance / LAMPORTS_PER_SOL;
            
            this.logOperation('balance_retrieved', { 
                requestId, 
                balance: solBalanceInSol 
            });

            const signatures: string[] = [];
            const allocationResults: AllocatorDelegateResult['allocations'] = [];

            // Process each allocation
            for (let i = 0; i < allocations.length; i++) {
                const allocation = allocations[i];
                
                if (!allocation) {
                    this.logOperation('allocation_skipped', { 
                        requestId, 
                        reason: 'undefined_allocation',
                        index: i
                    });
                    continue;
                }
                
                try {
                    const result = await this.processAllocation(
                        allocation, 
                        solBalanceInSol, 
                        costBuffer, 
                        slippageBps,
                        i + 1,
                        allocations.length
                    );
                    
                    signatures.push(result.signature);
                    allocationResults.push(result);
                    
                    this.logOperation('allocation_processed', { 
                        requestId, 
                        contractAddress: allocation.contractAddress,
                        percentage: allocation.percentage,
                        signature: result.signature 
                    });
                } catch (error) {
                    await this.handleError(error instanceof Error ? error : new Error(String(error)), { 
                        requestId, 
                        contractAddress: allocation.contractAddress 
                    });
                    
                    // Continue with next allocation instead of failing completely
                    this.logOperation('allocation_skipped', { 
                        requestId, 
                        contractAddress: allocation.contractAddress,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    continue;
                }
            }

            this.logOperation('allocator_execution_completed', { requestId, signatures });
            
            return {
                success: true,
                signatures,
                allocations: allocationResults
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }

    validateOptions(delegateOptions: AllocatorDelegateOptions): void {
        if (!delegateOptions.allocations || !Array.isArray(delegateOptions.allocations)) {
            throw new Error("allocations must be a non-empty array");
        }

        if (delegateOptions.allocations.length === 0) {
            throw new Error("At least one allocation is required");
        }

        let totalPercentage = 0;
        for (const allocation of delegateOptions.allocations) {
            if (!allocation.contractAddress) {
                throw new Error("contractAddress is required for each allocation");
            }
            
            this.validatePublicKey(allocation.contractAddress, 'contractAddress');
            
            if (typeof allocation.percentage !== 'number' || allocation.percentage <= 0) {
                throw new Error("percentage must be a positive number for each allocation");
            }
            
            totalPercentage += allocation.percentage;
        }

        if (totalPercentage > 100) {
            throw new Error("Total allocation percentage cannot exceed 100%");
        }

        if (delegateOptions.slippageBps !== undefined) {
            this.validateNumberField(delegateOptions.slippageBps, 'slippageBps', 0, 10000);
        }

        if (delegateOptions.costBuffer !== undefined) {
            this.validateNumberField(delegateOptions.costBuffer, 'costBuffer', 0);
        }
    }

    private async processAllocation(
        allocation: { contractAddress: string; percentage: number },
        solBalanceInSol: number,
        costBuffer: number,
        slippageBps: number,
        currentIndex: number,
        totalAllocations: number
    ): Promise<AllocatorDelegateResult['allocations'][0]> {
        const { contractAddress, percentage } = allocation;
        
        // Calculate amount to allocate
        const amountToAllocate = (solBalanceInSol * (percentage / 100)) - costBuffer;
        
        if (amountToAllocate <= 0) {
            throw new Error(`Insufficient balance for allocation: ${amountToAllocate} SOL`);
        }

        this.logOperation('allocation_calculation', {
            contractAddress,
            percentage,
            amountToAllocate,
            currentIndex,
            totalAllocations
        });

        // Get or create token account for the target token
        const mint = new PublicKey(contractAddress);
        await this.retryOperation(async () => {
            return await getOrCreateAssociatedTokenAccount(
                this.connection,
                this.signerKeypair,
                mint,
                this.signerKeypair.publicKey,
                true
            );
        }, 3);

        // Execute swap from SOL to target token
        const swapResult = await this.executeSwapWithFallback(
            "So11111111111111111111111111111111111111112", // SOL
            contractAddress,
            amountToAllocate,
            slippageBps / 100 // Convert basis points to percentage
        );

        if (!swapResult.success || !swapResult.signature) {
            throw new Error(`Swap failed for ${contractAddress}: ${swapResult.error}`);
        }

        return {
            contractAddress,
            percentage,
            amountAllocated: amountToAllocate,
            signature: swapResult.signature
        };
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
}