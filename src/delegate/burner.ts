import { Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, burnChecked, getMint } from "@solana/spl-token";
import { BurnerDelegateOptions, BurnerDelegateResult } from "./types";
import { BaseDelegate } from "./base-delegate";
import bs58 from "bs58";

const BN = require("bn.js");

export class Burner extends BaseDelegate<BurnerDelegateOptions, BurnerDelegateResult> {
    async executeDelegate(delegateOptions: BurnerDelegateOptions): Promise<BurnerDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('burner_execution_started', { requestId });
            
            this.validateOptions(delegateOptions);

            const senderKeypair = Keypair.fromSecretKey(bs58.decode(delegateOptions.privateKey));
            const mint = new PublicKey(delegateOptions.tokenAddress);

            // Get or create associated token account with retry
            const senderTokenAccount = await this.retryOperation(async () => {
                const account = await getOrCreateAssociatedTokenAccount(
                    this.connection,
                    senderKeypair,
                    mint,
                    senderKeypair.publicKey,
                    true
                );
                return account;
            }, 5);

            // Get token decimals with retry
            const decimals = await this.retryOperation(async () => {
                const mintInfo = await getMint(this.connection, mint);
                return mintInfo.decimals;
            }, 3);

            if (decimals === -1) {
                throw new Error("Failed to get token decimals");
            }

            // Calculate amount to burn
            const amountToBurn = this.calculateBurnAmount(delegateOptions.numTokens, decimals);

            // Execute burn transaction with retry
            const burnSignature = await this.retryOperation(async () => {
                const signature = await burnChecked(
                    this.connection,
                    senderKeypair,
                    senderTokenAccount.address,
                    mint,
                    senderKeypair,
                    amountToBurn,
                    decimals
                );
                return signature;
            }, 3);

            this.logOperation('burner_execution_completed', { 
                requestId, 
                signatures: [burnSignature],
                burnedAmount: amountToBurn.toString(),
                tokenMint: mint.toBase58()
            });
            
            return {
                success: true,
                signatures: [burnSignature],
                burnedAmount: amountToBurn.toString(),
                tokenMint: mint.toBase58()
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }

    validateOptions(delegateOptions: BurnerDelegateOptions): void {
        this.validateStringField(delegateOptions.tokenAddress, 'tokenAddress');
        this.validateNumberField(delegateOptions.numTokens, 'numTokens', 0);
        this.validateStringField(delegateOptions.privateKey, 'privateKey');
        
        // Validate token address format
        try {
            new PublicKey(delegateOptions.tokenAddress);
        } catch (error) {
            throw new Error("Invalid token address format");
        }

        // Validate private key format
        try {
            bs58.decode(delegateOptions.privateKey);
        } catch (error) {
            throw new Error("Invalid private key format");
        }
    }

    private calculateBurnAmount(numTokens: number, decimals: number): typeof BN {
        const multiplier = new BN(10).pow(new BN(decimals));
        return new BN(numTokens).mul(multiplier);
    }
}