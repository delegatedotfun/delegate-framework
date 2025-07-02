import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, Account, createTransferCheckedInstruction, getMint } from "@solana/spl-token";
import { HopperDelegateOptions, HopperDelegateResult } from "./types";
import { BaseDelegate } from "./base-delegate";
import { HeliusClient } from "../solana/clients/helius";
import { TOKEN_ACCOUNT_RENT, FEE_WALLET_ADDRESS } from "./constants";
import bs58 from "bs58";

export class Hopper extends BaseDelegate<HopperDelegateOptions, HopperDelegateResult> {
    private readonly heliusClient: HeliusClient;

    constructor(
        connection: Connection, 
        signerKeypair: Keypair, 
        heliusClient: HeliusClient, 
        feeTakerKeypair?: Keypair
    ) {
        super(connection, signerKeypair, feeTakerKeypair);
        this.heliusClient = heliusClient;
    }

    async executeDelegate(delegateOptions: HopperDelegateOptions): Promise<HopperDelegateResult> {
        const requestId = this.generateRequestId();
        
        try {
            this.logOperation('hopper_execution_started', { requestId });
            
            this.validateOptions(delegateOptions);

            const { hopDestination, numOfHops, numTokens, tokenType, tokenAddress } = delegateOptions;
            
            const hopDestinationPubkey = new PublicKey(hopDestination);
            const hopMap: { publicKey: string; privateKey: string }[] = [];
            const signatures: string[] = [];

            this.logOperation('hopper_setup', { 
                requestId, 
                numOfHops, 
                tokenType, 
                destination: hopDestination 
            });

            if (tokenType === 'sol') {
                // Native SOL hopper logic
                const result = await this.executeSolHopping(
                    numOfHops, 
                    numTokens, 
                    hopDestinationPubkey, 
                    hopMap, 
                    requestId
                );
                signatures.push(...result.signatures);
            } else {
                // Token hopper logic
                if (!tokenAddress) {
                    throw new Error("tokenAddress is required when tokenType is 'token'");
                }
                
                const result = await this.executeTokenHopping(
                    numOfHops, 
                    numTokens, 
                    tokenAddress, 
                    hopDestinationPubkey, 
                    hopMap, 
                    requestId
                );
                signatures.push(...result.signatures);
            }

            this.logOperation('hopper_execution_completed', { 
                requestId, 
                signatures, 
                totalHops: numOfHops 
            });
            
            return {
                success: true,
                signatures,
                hopMap,
                finalDestination: hopDestination,
                totalHops: numOfHops
            };
            
        } catch (error) {
            await this.handleError(error instanceof Error ? error : new Error(String(error)), { requestId });
            throw error;
        }
    }

    validateOptions(delegateOptions: HopperDelegateOptions): void {
        this.validateRequiredField(delegateOptions.hopDestination, 'hopDestination');
        this.validatePublicKey(delegateOptions.hopDestination, 'hopDestination');
        
        this.validateNumberField(delegateOptions.numOfHops, 'numOfHops', 1, 100);
        this.validateNumberField(delegateOptions.numTokens, 'numTokens', 0);
        
        if (delegateOptions.tokenType !== 'sol' && delegateOptions.tokenType !== 'token') {
            throw new Error("tokenType must be either 'sol' or 'token'");
        }
        
        if (delegateOptions.tokenType === 'token') {
            this.validateRequiredField(delegateOptions.tokenAddress, 'tokenAddress');
            this.validatePublicKey(delegateOptions.tokenAddress!, 'tokenAddress');
        }
    }

    private async executeSolHopping(
        numOfHops: number,
        numTokens: number,
        hopDestination: PublicKey,
        hopMap: { publicKey: string; privateKey: string }[],
        requestId: number
    ): Promise<{ signatures: string[] }> {
        const signatures: string[] = [];
        const rentAndMinBalance = TOKEN_ACCOUNT_RENT + 50000; // Rent + minimum balance
        const costBuffer = Math.max(rentAndMinBalance, 50000); // Ensure we always leave at least rent
        const initialBalance = numTokens * LAMPORTS_PER_SOL;
        let lastHopKeypair = this.signerKeypair;

        for (let i = 0; i < numOfHops; i++) {
            this.logOperation('sol_hop_progress', { 
                requestId, 
                currentHop: i + 1, 
                totalHops: numOfHops 
            });

            const senderBalance = i === 0 ? initialBalance : await this.heliusClient.getBalance(lastHopKeypair.publicKey);
            const newHopKeypair = Keypair.generate();
            
            hopMap.push({
                publicKey: newHopKeypair.publicKey.toBase58(),
                privateKey: bs58.encode(newHopKeypair.secretKey)
            });

            const transaction = new Transaction();
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: lastHopKeypair.publicKey,
                    toPubkey: (i === numOfHops - 1) ? hopDestination : newHopKeypair.publicKey,
                    lamports: senderBalance - costBuffer
                })
            );

            const signature = await this.executeTransaction(transaction, lastHopKeypair, requestId);
            signatures.push(signature);
            
            lastHopKeypair = newHopKeypair;
        }

        return { signatures };
    }

    private async executeTokenHopping(
        numOfHops: number,
        numTokens: number,
        tokenAddress: string,
        hopDestination: PublicKey,
        hopMap: { publicKey: string; privateKey: string }[],
        requestId: number
    ): Promise<{ signatures: string[] }> {
        const signatures: string[] = [];
        const mint = new PublicKey(tokenAddress);
        const decimals = await this.getTokenDecimals(tokenAddress);
        const amountToTransfer = Math.floor(this.calculateAmountToTransfer(numTokens, 1, decimals));
        
        if (decimals === -1) {
            throw new Error("Failed to get token decimals");
        }

        let lastHopKeypair = this.signerKeypair;
        let lastHopTokenAccount: Account | null = null;

        // Get or create initial token account
        lastHopTokenAccount = await this.retryOperation(async () => {
            return await getOrCreateAssociatedTokenAccount(
                this.connection,
                lastHopKeypair,
                mint,
                lastHopKeypair.publicKey,
                true
            );
        }, 5);

        if (!lastHopTokenAccount) {
            throw new Error("Failed to get last hop token account");
        }

        for (let i = 0; i < numOfHops; i++) {
            this.logOperation('token_hop_progress', { 
                requestId, 
                currentHop: i + 1, 
                totalHops: numOfHops 
            });

            const initialBalance = await this.getTokenBalance(lastHopTokenAccount.address.toBase58());
            if (initialBalance < amountToTransfer) {
                throw new Error(`Insufficient token balance. Required: ${amountToTransfer}, Available: ${initialBalance}`);
            }

            const newHopKeypair = Keypair.generate();
            hopMap.push({
                publicKey: newHopKeypair.publicKey.toBase58(),
                privateKey: bs58.encode(newHopKeypair.secretKey)
            });

            const newHopAddress = (i === numOfHops - 1) ? hopDestination : newHopKeypair.publicKey;
            const newHopTokenAccount = await this.retryOperation(async () => {
                return await getOrCreateAssociatedTokenAccount(
                    this.connection,
                    lastHopKeypair,
                    mint,
                    newHopAddress,
                    true
                );
            }, 5);

            if (!newHopTokenAccount) {
                throw new Error("Failed to get new hop token account");
            }

            // Transfer tokens
            const tokenTransaction = new Transaction();
            tokenTransaction.add(
                createTransferCheckedInstruction(
                    lastHopTokenAccount.address,
                    mint,
                    newHopTokenAccount.address,
                    lastHopKeypair.publicKey,
                    amountToTransfer,
                    decimals
                )
            );

            const tokenSignature = await this.executeTransaction(tokenTransaction, lastHopKeypair, requestId);
            signatures.push(tokenSignature);

            // Verify transfer
            const newBalance = await this.getTokenBalance(newHopTokenAccount.address.toBase58());
            if (newBalance < amountToTransfer) {
                throw new Error("Token transfer may have failed - balance not updated");
            }

            // Transfer SOL for fees
            const solTransaction = new Transaction();
            const senderBalance = await this.heliusClient.getBalance(lastHopKeypair.publicKey);
            const costBuffer = TOKEN_ACCOUNT_RENT * 1.5;
            const solToSend = (i === 0 && senderBalance > 0.01 * LAMPORTS_PER_SOL) 
                ? (numOfHops * 0.01 * LAMPORTS_PER_SOL) - costBuffer 
                : senderBalance - costBuffer;

            solTransaction.add(
                SystemProgram.transfer({
                    fromPubkey: lastHopKeypair.publicKey,
                    toPubkey: (i === numOfHops - 1) ? new PublicKey(FEE_WALLET_ADDRESS) : newHopAddress,
                    lamports: solToSend
                })
            );

            const solSignature = await this.executeTransaction(solTransaction, lastHopKeypair, requestId);
            signatures.push(solSignature);

            lastHopKeypair = newHopKeypair;
            lastHopTokenAccount = newHopTokenAccount;
        }

        return { signatures };
    }

    private async executeTransaction(
        transaction: Transaction, 
        signer: Keypair, 
        requestId: number
    ): Promise<string> {
        transaction.feePayer = signer.publicKey;
        
        const blockhash = await this.retryOperation(async () => {
            return (await this.connection.getLatestBlockhash()).blockhash;
        }, 3);
        
        transaction.recentBlockhash = blockhash;
        transaction.sign(signer);

        const signature = await this.retryOperation(async () => {
            return await this.connection.sendTransaction(transaction, [signer], {
                skipPreflight: false,
                maxRetries: 3,
            });
        }, 3);

        await this.retryOperation(async () => {
            await this.connection.confirmTransaction(signature, 'confirmed');
        }, 3);

        this.logOperation('transaction_confirmed', { requestId, signature });
        return signature;
    }

    private async getTokenBalance(tokenAccountAddress: string): Promise<number> {
        const balanceInfo = await this.heliusClient.getTokenAccountBalance(new PublicKey(tokenAccountAddress));
        return parseFloat(balanceInfo.value.uiAmountString || '0');
    }

    private async getTokenDecimals(tokenAddress: string): Promise<number> {
        const mint = new PublicKey(tokenAddress);
        const mintInfo = await this.retryOperation(async () => {
            return await getMint(this.connection, mint);
        }, 3);
        return mintInfo.decimals;
    }

    private calculateAmountToTransfer(numTokens: number, numRecipients: number, decimals: number): number {
        return Math.floor((numTokens / numRecipients) * Math.pow(10, decimals));
    }
}