import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, Account, createTransferCheckedInstruction } from "@solana/spl-token";
import { DistributorDelegateOptions, DistributorDelegateResult } from "./types";
import { BaseDelegate } from "./base-delegate";
import { HeliusClient } from "../solana/clients/helius";

export class Distributor extends BaseDelegate<DistributorDelegateOptions, DistributorDelegateResult> {
    private readonly heliusClient: HeliusClient;

    constructor(connection: Connection, signerKeypair: Keypair, heliusClient: HeliusClient, feeTakerKeypair?: Keypair) {
        super(connection, signerKeypair, feeTakerKeypair);
        this.heliusClient = heliusClient;
    }

    async executeDelegate(delegateOptions: DistributorDelegateOptions): Promise<DistributorDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('distributor_execution_started', { requestId });
            
            this.validateOptions(delegateOptions);

            // Get recipients based on distribution type
            const recipients = await this.getRecipients(delegateOptions);
            
            if (recipients.length === 0) {
                throw new Error("No recipients found for distribution");
            }

            const signatures: string[] = [];
            const recipientResults: DistributorDelegateResult['recipients'] = [];

            // Setup token account if needed
            let senderTokenAccount: Account | null = null;
            let mint: PublicKey | null = null;
            
            if (delegateOptions.tokenAddress) {
                mint = new PublicKey(delegateOptions.tokenAddress);
                senderTokenAccount = await this.retryOperation(async () => {
                    return await getOrCreateAssociatedTokenAccount(
                        this.connection, 
                        this.signerKeypair, 
                        mint!, 
                        this.signerKeypair.publicKey, 
                        true
                    );
                }, 3);
            }

            // Process each recipient
            for (let i = 0; i < recipients.length; i++) {
                const recipientAddress = recipients[i];
                
                if (!recipientAddress) {
                    this.logOperation('recipient_skipped', { requestId, reason: 'undefined_address' });
                    continue;
                }
                
                try {
                    const result = await this.processRecipient(
                        recipientAddress, 
                        delegateOptions, 
                        recipients.length, 
                        mint, 
                        senderTokenAccount
                    );
                    
                    signatures.push(result.signature);
                    recipientResults.push(result);
                    
                    this.logOperation('recipient_processed', { 
                        requestId, 
                        recipientAddress,
                        signature: result.signature 
                    });
                } catch (error) {
                    await this.handleError(error instanceof Error ? error : new Error(String(error)), { 
                        requestId, 
                        recipientAddress 
                    });
                    
                    // For multi distribution, continue with next recipient
                    if (delegateOptions.distributionType === 'multi') {
                        this.logOperation('recipient_skipped', { requestId, recipientAddress });
                        continue;
                    } else {
                        // For single and holders distribution, throw error
                        throw error;
                    }
                }
            }

            this.logOperation('distributor_execution_completed', { requestId, signatures });
            
            return {
                success: true,
                signatures,
                recipients: recipientResults
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }

    validateOptions(delegateOptions: DistributorDelegateOptions): void {
        this.validateNumberField(delegateOptions.numTokens, 'numTokens', 0);

        if (delegateOptions.tokenAddress) {
            this.validatePublicKey(delegateOptions.tokenAddress, 'tokenAddress');
        }

        switch (delegateOptions.distributionType) {
            case 'single':
                if (!delegateOptions.singleAddress) {
                    throw new Error("singleAddress is required for single distribution");
                }
                this.validatePublicKey(delegateOptions.singleAddress, 'singleAddress');
                break;
                
            case 'multi':
                if (!delegateOptions.multipleAddresses || delegateOptions.multipleAddresses.length === 0) {
                    throw new Error("multipleAddresses array is required for multi distribution");
                }
                for (const address of delegateOptions.multipleAddresses) {
                    this.validatePublicKey(address, 'multipleAddresses');
                }
                break;
                
            case 'holders':
                if (!delegateOptions.distributionMethod) {
                    throw new Error("distributionMethod is required for holders distribution");
                }
                if (delegateOptions.distributionMethod === 'topx') {
                    if (!delegateOptions.topX || delegateOptions.topX <= 0) {
                        throw new Error("topX must be greater than 0 for topx distribution method");
                    }
                    if (!delegateOptions.holderOfWhichToken) {
                        throw new Error("holderOfWhichToken is required for holders distribution");
                    }
                    this.validatePublicKey(delegateOptions.holderOfWhichToken, 'holderOfWhichToken');
                }
                break;
                
            default:
                throw new Error(`Invalid distribution type: ${delegateOptions.distributionType}`);
        }
    }

    private async getRecipients(delegateOptions: DistributorDelegateOptions): Promise<string[]> {
        switch (delegateOptions.distributionType) {
            case 'single':
                if (!delegateOptions.singleAddress) {
                    throw new Error("singleAddress is required for single distribution");
                }
                return [delegateOptions.singleAddress];
                
            case 'multi':
                if (!delegateOptions.multipleAddresses) {
                    throw new Error("multipleAddresses is required for multi distribution");
                }
                return delegateOptions.multipleAddresses;
                
            case 'holders':
                if (delegateOptions.distributionMethod === 'topx') {
                    if (!delegateOptions.holderOfWhichToken) {
                        throw new Error("holderOfWhichToken is required for holders distribution");
                    }
                    if (!delegateOptions.topX) {
                        throw new Error("topX is required for topx distribution method");
                    }
                    return await this.getTopHolders(delegateOptions.holderOfWhichToken, delegateOptions.topX);
                } else {
                    throw new Error("Distribution method 'all' not yet implemented");
                }
                
            default:
                throw new Error(`Invalid distribution type: ${delegateOptions.distributionType}`);
        }
    }

    private async getTopHolders(tokenAddress: string, topX: number): Promise<string[]> {
        try {
            const holdersData = await this.retryOperation(async () => {
                return await this.heliusClient.getTopHolders(tokenAddress);
            }, 3);

            if (!holdersData || !Array.isArray(holdersData)) {
                throw new Error("Invalid response from getTopHolders");
            }

            // Extract owner addresses from the largest accounts
            const topHolders = holdersData.slice(0, topX);
            const ownerAddresses: string[] = [];

            for (const holder of topHolders) {
                if (holder && holder.address) {
                    // Get the owner of this token account using Helius API
                    const owner = await this.retryOperation(async () => {
                        return await this.heliusClient.getTokenAccountOwner(holder.address);
                    }, 3);

                    if (owner) {
                        ownerAddresses.push(owner);
                    }
                }
            }

            return ownerAddresses;
        } catch (error) {
            this.logOperation('get_top_holders_failed', { 
                tokenAddress, 
                error: error instanceof Error ? error.message : String(error) 
            });
            throw new Error(`Failed to get top holders for token ${tokenAddress}: ${error}`);
        }
    }

    private async processRecipient(
        recipientAddress: string,
        delegateOptions: DistributorDelegateOptions,
        numRecipients: number,
        mint: PublicKey | null,
        senderTokenAccount: Account | null
    ): Promise<DistributorDelegateResult['recipients'][0]> {
        const recipientPubkey = new PublicKey(recipientAddress);
        const transaction = new Transaction();

        if (delegateOptions.tokenAddress && mint && senderTokenAccount) {
            // Token transfer
            const receivingTokenAccount = await this.retryOperation(async () => {
                return await getOrCreateAssociatedTokenAccount(
                    this.connection, 
                    this.signerKeypair, 
                    mint, 
                    recipientPubkey, 
                    true
                );
            }, 3);

            const decimals = await this.getTokenDecimals(delegateOptions.tokenAddress);
            const amountToTransfer = Math.floor(this.calculateAmountToTransfer(delegateOptions.numTokens, numRecipients, decimals));

            transaction.add(
                createTransferCheckedInstruction(
                    senderTokenAccount.address,
                    mint,
                    receivingTokenAccount.address,
                    this.signerKeypair.publicKey,
                    amountToTransfer,
                    decimals
                )
            );
        } else {
            // SOL transfer
            const amountPerRecipient = Math.floor(delegateOptions.numTokens / numRecipients * LAMPORTS_PER_SOL);
            
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: this.signerKeypair.publicKey,
                    toPubkey: recipientPubkey,
                    lamports: amountPerRecipient,
                })
            );
        }

        transaction.feePayer = this.signerKeypair.publicKey;
        
        const blockhash = await this.retryOperation(async () => {
            return (await this.connection.getLatestBlockhash()).blockhash;
        }, 3);
        
        transaction.recentBlockhash = blockhash;
        transaction.sign(this.signerKeypair);

        const signature = await this.retryOperation(async () => {
            return await this.connection.sendTransaction(transaction, [this.signerKeypair], {
                skipPreflight: false,
                maxRetries: 3,
            });
        }, 3);

        // Wait for confirmation
        await this.retryOperation(async () => {
            const latestBlockhash = await this.connection.getLatestBlockhash();
            await this.connection.confirmTransaction({
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                signature
            });
            return true;
        }, 3);

        const amount = delegateOptions.tokenAddress 
            ? delegateOptions.numTokens / numRecipients
            : delegateOptions.numTokens / numRecipients;

        return {
            address: recipientAddress,
            amount,
            signature
        };
    }

    private async getTokenDecimals(_: string): Promise<number> {
        // This is a mock implementation - in a real scenario, you would fetch from the token mint
        return 6; // Default to 6 decimals
    }

    private calculateAmountToTransfer(totalAmount: number, numRecipients: number, decimals: number): number {
        const amountPerRecipient = totalAmount / numRecipients;
        return amountPerRecipient * Math.pow(10, decimals);
    }
}