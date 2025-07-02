jest.mock("../swap/jupiter");
jest.mock("../swap/raydium");

import { Connection, Keypair } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { Liquidator } from "../liquidator";
import { LiquidatorDelegateOptions } from "../types";
import { DELEGATE_TYPES } from "../constants";
import { HeliusClient } from "../../solana/clients/helius";
import { JupiterSwap } from "../swap/jupiter";
import { RaydiumSwap } from "../swap/raydium";

// Mock SPL token functions
jest.mock("@solana/spl-token", () => ({
    getMint: jest.fn(),
}));

// Mock HeliusClient
jest.mock("../../solana/clients/helius");

describe('Liquidator', () => {
    let liquidator: Liquidator;
    let mockConnection: jest.Mocked<Connection>;
    let mockHeliusClient: jest.Mocked<HeliusClient>;
    let mockJupiterSwap: jest.Mocked<JupiterSwap>;
    let mockRaydiumSwap: jest.Mocked<RaydiumSwap>;

    beforeEach(() => {
        mockConnection = {
            getLatestBlockhash: jest.fn(),
            sendTransaction: jest.fn(),
            confirmTransaction: jest.fn(),
        } as any;

        mockHeliusClient = {
            getTokenAccounts: jest.fn(),
            getBalance: jest.fn(),
            getTokenAccountBalance: jest.fn(),
        } as any;

        mockJupiterSwap = {
            getQuote: jest.fn(),
            createSwapTransaction: jest.fn(),
            executeSwap: jest.fn(),
        } as any;

        mockRaydiumSwap = {
            getQuote: jest.fn(),
            createSwapTransaction: jest.fn(),
            executeSwap: jest.fn(),
        } as any;

        (JupiterSwap as jest.Mock).mockImplementation(() => mockJupiterSwap);
        (RaydiumSwap as jest.Mock).mockImplementation(() => mockRaydiumSwap);

        liquidator = new Liquidator(
            mockConnection,
            Keypair.generate(),
            mockHeliusClient
        );
    });

    beforeAll(() => {
        jest.spyOn(global, 'setTimeout').mockImplementation((fn: (...args: any[]) => void, _ms?: number) => { fn(); return 0 as any; });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    describe('validateOptions', () => {
        it('should validate required fields', () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            expect(() => liquidator.validateOptions(options)).not.toThrow();
        });

        it('should throw error for missing delegateAddress', () => {
            const options: any = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            expect(() => liquidator.validateOptions(options)).toThrow('delegateAddress is required');
        });

        it('should throw error for missing tokenAddress', () => {
            const options: any = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
            };

            expect(() => liquidator.validateOptions(options)).toThrow('tokenAddress is required');
        });

        it('should throw error for invalid delegateAddress', () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: 'invalid-address',
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            expect(() => liquidator.validateOptions(options)).toThrow('Invalid delegateAddress: invalid-address, must be a valid public key');
        });

        it('should throw error for invalid tokenAddress', () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: 'invalid-address',
            };

            expect(() => liquidator.validateOptions(options)).toThrow('Invalid tokenAddress: invalid-address, must be a valid public key');
        });

        it('should throw error for negative minUsdValue', () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
                minUsdValue: -1,
            };

            expect(() => liquidator.validateOptions(options)).toThrow('minUsdValue must be at least 0');
        });
    });

    describe('executeDelegate', () => {
        it('should return empty result when no token accounts found', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [] });

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toEqual([]);
            expect(result.liquidatedTokens).toEqual([]);
            expect(result.totalLiquidated).toBe(0);
        });

        it('should skip frozen token accounts', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            const frozenTokenAccount = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 1000000,
                frozen: true,
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [frozenTokenAccount] });

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(0);
        });

        it('should skip USDC token accounts', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            const usdcTokenAccount = {
                mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                amount: 1000000,
                frozen: false,
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [usdcTokenAccount] });

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(0);
        });

        it('should skip tokens with low USD value', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
                minUsdValue: 5,
            };

            const tokenAccount = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 1000000,
                frozen: false,
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [tokenAccount] });
            (getMint as jest.Mock).mockResolvedValue({ decimals: 6 });
            mockJupiterSwap.getQuote.mockResolvedValue({
                inputMint: tokenAccount.mint,
                outputMint: options.tokenAddress,
                inputAmount: '1000000',
                outputAmount: '500000',
                swapUsdValue: 0.5,
            });

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(0);
        });

        it('should handle token liquidation successfully', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            const tokenAccount = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 1000000,
                frozen: false,
            };

            const mockQuote = {
                inputMint: tokenAccount.mint,
                outputMint: options.tokenAddress,
                inputAmount: '1000000',
                outputAmount: '2000000',
                swapUsdValue: 10,
            };

            const mockSwapResult = {
                success: true,
                signature: 'mock-signature',
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [tokenAccount] });
            (getMint as jest.Mock).mockResolvedValue({ decimals: 6 });
            mockJupiterSwap.getQuote.mockResolvedValue(mockQuote);
            mockJupiterSwap.createSwapTransaction.mockResolvedValue({} as any);
            mockJupiterSwap.executeSwap.mockResolvedValue(mockSwapResult);

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toEqual(['mock-signature']);
            expect(result.liquidatedTokens).toHaveLength(1);
            expect(result.liquidatedTokens[0]!.mint).toBe(tokenAccount.mint);
            expect(result.liquidatedTokens[0]!.signature).toBe('mock-signature');
            expect(result.totalLiquidated).toBe(1);
        });

        it('should fallback to Raydium when Jupiter fails', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            const tokenAccount = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 1000000,
                frozen: false,
            };

            const mockQuote = {
                inputMint: tokenAccount.mint,
                outputMint: options.tokenAddress,
                inputAmount: '1000000',
                outputAmount: '2000000',
                swapUsdValue: 10,
            };

            const mockSwapResult = {
                success: true,
                signature: 'mock-signature',
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [tokenAccount] });
            (getMint as jest.Mock).mockResolvedValue({ decimals: 6 });
            mockJupiterSwap.getQuote.mockRejectedValue(new Error('Jupiter failed'));
            mockRaydiumSwap.getQuote.mockResolvedValue(mockQuote);
            mockRaydiumSwap.createSwapTransaction.mockResolvedValue({} as any);
            mockRaydiumSwap.executeSwap.mockResolvedValue(mockSwapResult);

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(1);
        });

        it('should handle errors gracefully and continue processing', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            const tokenAccount1 = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 1000000,
                frozen: false,
            };

            const tokenAccount2 = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 2000000,
                frozen: false,
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [tokenAccount1, tokenAccount2] });
            (getMint as jest.Mock).mockResolvedValue({ decimals: 6 });
            
            // First token fails, second succeeds
            mockJupiterSwap.getQuote.mockImplementation((fromMint) => {
                if (fromMint === tokenAccount1.mint) {
                    return Promise.reject(new Error('First token failed'));
                }
                return Promise.resolve({
                    inputMint: tokenAccount2.mint,
                    outputMint: options.tokenAddress,
                    inputAmount: '2000000',
                    outputAmount: '4000000',
                    swapUsdValue: 10,
                });
            });
            mockJupiterSwap.createSwapTransaction.mockResolvedValue({} as any);
            mockJupiterSwap.executeSwap.mockResolvedValue({ success: true, signature: 'mock-signature' });

            const result = await liquidator.executeDelegate(options);

            console.log('DEBUG result:', result);
            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(1);
        });

        it('should handle getTokenAccounts failure', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            mockHeliusClient.getTokenAccounts.mockRejectedValue(new Error('Failed to get token accounts'));

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(0);
        });

        it('should handle getTokenDecimals failure', async () => {
            const options: LiquidatorDelegateOptions = {
                type: DELEGATE_TYPES.LIQUIDATOR,
                delegateAddress: Keypair.generate().publicKey.toBase58(),
                tokenAddress: Keypair.generate().publicKey.toBase58(),
            };

            const tokenAccount = {
                mint: Keypair.generate().publicKey.toBase58(),
                amount: 1000000,
                frozen: false,
            };

            mockHeliusClient.getTokenAccounts.mockResolvedValue({ value: [tokenAccount] });
            (getMint as jest.Mock).mockRejectedValue(new Error('Failed to get mint'));

            const result = await liquidator.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.totalLiquidated).toBe(0);
        });
    });
}); 