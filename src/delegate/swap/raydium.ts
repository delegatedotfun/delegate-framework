import { Keypair, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BaseSwapProtocol } from './base-protocol';
import { SwapQuote, SwapTransaction, SwapResult } from '../types';
import { API_URLS, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2';
import { HeliusClient } from '../../solana/clients/helius';

export interface RaydiumSwapConfig {
  heliusClient?: HeliusClient; // Optional Helius client for RPC calls
}

export class RaydiumSwap extends BaseSwapProtocol {
  private heliusClient?: HeliusClient;

  constructor(keypair: Keypair, config: RaydiumSwapConfig = {}) {
    super(keypair);
    this.heliusClient = config.heliusClient;
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippage: number = 0.5
  ): Promise<SwapQuote | null> {
    return this.handleError(async () => {
      this.validateSwapParams(inputMint, outputMint, amount);

      const txVersion = 'V0';
      const slippageBps = slippage * 100;

      const swapComputeResponse = await this.retryOperation(async () => {
        const response = await fetch(
          `${API_URLS.SWAP_HOST}/compute/swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&txVersion=${txVersion}`
        );

        if (!response.ok) {
          throw new Error(`Raydium API error: ${response.statusText}`);
        }

        return response.json();
      }, 3);

      if (swapComputeResponse.success && swapComputeResponse.data) {
        return {
          inputMint,
          outputMint,
          inputAmount: amount.toString(),
          outputAmount: swapComputeResponse.data.outputAmount,
          priceImpact: swapComputeResponse.data.priceImpactPct,
          raydiumQuote: swapComputeResponse // Store original Raydium quote
        };
      }

      return null;
    }, 'raydium_get_quote');
  }

  async createSwapTransaction(
    quote: SwapQuote
  ): Promise<SwapTransaction> {
    return this.handleError(async () => {
      if (!quote['raydiumQuote']) {
        throw new Error('Invalid quote: missing Raydium quote data');
      }

      const txVersion = 'V0';
      const isV0Tx = txVersion === 'V0';

      // Get token accounts
      const { tokenAccounts } = await this.fetchTokenAccountData();
      const inputTokenAcc = tokenAccounts.find((a: any) => a.mint.toBase58() === quote.inputMint)?.publicKey;
      const outputTokenAcc = tokenAccounts.find((a: any) => a.mint.toBase58() === quote.outputMint)?.publicKey;

      const [isInputSol, isOutputSol] = [
        quote.inputMint === NATIVE_MINT.toBase58(),
        quote.outputMint === NATIVE_MINT.toBase58()
      ];

      // Get priority fee
      const feeResponse = await this.retryOperation(async () => {
        const response = await fetch(`${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`);
        if (!response.ok) {
          throw new Error(`Raydium API error: ${response.statusText}`);
        }
        return response.json();
      }, 3);

      // Create swap transaction
      const swapTransactionsResponse = await this.retryOperation(async () => {
        const response = await fetch(`${API_URLS.SWAP_HOST}/transaction/swap-base-in`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            computeUnitPriceMicroLamports: String(feeResponse.data.default.h),
            swapResponse: quote['raydiumQuote'],
            txVersion,
            wallet: this.keypair.publicKey.toBase58(),
            wrapSol: isInputSol,
            unwrapSol: isOutputSol,
            inputAccount: isInputSol ? undefined : inputTokenAcc?.toBase58(),
            outputAccount: isOutputSol ? undefined : outputTokenAcc?.toBase58(),
          }),
        });

        if (!response.ok) {
          throw new Error(`Raydium API error: ${response.statusText}`);
        }

        return response.json();
      }, 3);

      // Create transaction objects
      const allTxBuf = swapTransactionsResponse.data.map((tx: any) => Buffer.from(tx.transaction, 'base64'));
      const allTransactions = allTxBuf.map((txBuf: Buffer) =>
        isV0Tx ? VersionedTransaction.deserialize(txBuf) : Transaction.from(txBuf)
      );

      // Return the first transaction (Raydium usually returns single transaction)
      const transaction = allTransactions[0];

      return {
        serialize: () => Buffer.from(transaction.serialize()),
        sign: (signers: Keypair[]) => {
          if (isV0Tx) {
            (transaction as VersionedTransaction).sign(signers);
          } else {
            (transaction as Transaction).sign(...signers);
          }
        },
        // Store additional data for execution
        raydiumData: {
          transaction,
          isV0Tx,
          allTransactions
        }
      };
    }, 'raydium_create_transaction');
  }

  async executeSwap(transaction: SwapTransaction): Promise<SwapResult> {
    return this.handleError(async () => {
      const raydiumData = (transaction as any).raydiumData;

      if (!raydiumData) {
        throw new Error('Invalid transaction: missing Raydium data');
      }

      const { transaction: tx, isV0Tx } = raydiumData;

      if (isV0Tx) {
        // Handle versioned transaction
        const vtx = tx as VersionedTransaction;
        vtx.sign([this.keypair]);
        
        const txId = await this.retryOperation(async () => {
          return await this.connection.sendTransaction(vtx, { skipPreflight: true });
        }, 3);

        const { lastValidBlockHeight, blockhash } = await this.retryOperation(async () => {
          return await this.connection.getLatestBlockhash({
            commitment: 'finalized',
          });
        }, 3);

        await this.retryOperation(async () => {
          return await this.connection.confirmTransaction(
            {
              blockhash,
              lastValidBlockHeight,
              signature: txId,
            },
            'confirmed'
          );
        }, 3);

        return {
          success: true,
          signature: txId
        };
      } else {
        // Handle legacy transaction
        const legacyTx = tx as Transaction;
        legacyTx.sign(this.keypair);
        
        const txId = await this.retryOperation(async () => {
          return await sendAndConfirmTransaction(this.connection, legacyTx, [this.keypair], { skipPreflight: true });
        }, 3);
        
        return {
          success: true,
          signature: txId
        };
      }
    }, 'raydium_execute_swap');
  }

  public async fetchTokenAccountData() {
    if (this.heliusClient) {
      // Use HeliusClient if available
      const walletData = await this.heliusClient.getWalletTokenData(this.keypair.publicKey.toBase58());
      
      // Parse the data using Raydium's parser
      const tokenAccountData = parseTokenAccountResp({
        owner: this.keypair.publicKey,
        solAccountResp: walletData.solAccountInfo,
        tokenAccountResp: walletData.tokenAccounts,
      });
      
      return tokenAccountData;
    } else {
      // Fallback to direct RPC calls if no HeliusClient provided
      const solAccountResp = await this.connection.getAccountInfo(this.keypair.publicKey)
      const tokenAccountResp = await this.connection.getTokenAccountsByOwner(this.keypair.publicKey, { programId: TOKEN_PROGRAM_ID })
      const token2022Req = await this.connection.getTokenAccountsByOwner(this.keypair.publicKey, { programId: TOKEN_2022_PROGRAM_ID })
      
      const tokenAccountData = parseTokenAccountResp({
        owner: this.keypair.publicKey,
        solAccountResp,
        tokenAccountResp: {
          context: tokenAccountResp.context,
          value: [...tokenAccountResp.value, ...token2022Req.value],
        },
      })
      
      return tokenAccountData
    }
  }
} 