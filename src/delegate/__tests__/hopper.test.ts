import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getMint } from "@solana/spl-token";
import { Hopper } from "../hopper";
import { HopperDelegateOptions } from "../types";
import { DELEGATE_TYPES } from "../constants";
import { HeliusClient } from "../../solana/clients/helius";

// Mock SPL token functions
jest.mock("@solana/spl-token", () => ({
    getOrCreateAssociatedTokenAccount: jest.fn(),
    getMint: jest.fn(),
    createTransferCheckedInstruction: jest.fn(),
}));

// Mock HeliusClient
jest.mock("../../solana/clients/helius");

describe('Hopper', () => {
    let hopper: Hopper;
    let mockConnection: jest.Mocked<Connection>;
    let mockHeliusClient: jest.Mocked<HeliusClient>;
    let keypair: Keypair;

    beforeAll(() => {
        jest.spyOn(Transaction.prototype, 'sign').mockImplementation(function (this: Transaction) { return this; });
        jest.spyOn(require('@solana/spl-token'), 'createTransferCheckedInstruction').mockImplementation(() => ({ dummy: true }));
        jest.spyOn(global, 'setTimeout').mockImplementation((fn: (...args: any[]) => void, _ms?: number) => { fn(); return 0 as any; });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    beforeEach(() => {
        keypair = Keypair.generate();
        mockConnection = {
            getLatestBlockhash: jest.fn(),
            sendTransaction: jest.fn(),
            confirmTransaction: jest.fn(),
        } as any;

        mockHeliusClient = {
            getBalance: jest.fn(),
            getTokenAccountBalance: jest.fn(),
        } as any;

        hopper = new Hopper(mockConnection, keypair, mockHeliusClient);
    });

    describe('validateOptions', () => {
        it('should validate valid SOL hopper options', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 3,
                numTokens: 1.0,
                tokenType: 'sol'
            };

            expect(() => hopper.validateOptions(options)).not.toThrow();
        });

        it('should validate valid token hopper options', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 3,
                numTokens: 100,
                tokenType: 'token',
                tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
            };

            expect(() => hopper.validateOptions(options)).not.toThrow();
        });

        it('should throw error for missing hopDestination', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '',
                numOfHops: 3,
                numTokens: 1.0,
                tokenType: 'sol'
            };

            expect(() => hopper.validateOptions(options)).toThrow('hopDestination is required');
        });

        it('should throw error for invalid hopDestination', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: 'invalid-address',
                numOfHops: 3,
                numTokens: 1.0,
                tokenType: 'sol'
            };

            expect(() => hopper.validateOptions(options)).toThrow('Invalid hopDestination');
        });

        it('should throw error for invalid numOfHops', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 0,
                numTokens: 1.0,
                tokenType: 'sol'
            };

            expect(() => hopper.validateOptions(options)).toThrow('numOfHops must be at least 1');
        });

        it('should throw error for invalid numTokens', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 3,
                numTokens: -1,
                tokenType: 'sol'
            };

            expect(() => hopper.validateOptions(options)).toThrow('numTokens must be at least 0');
        });

        it('should throw error for invalid tokenType', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 3,
                numTokens: 1.0,
                tokenType: 'invalid' as any
            };

            expect(() => hopper.validateOptions(options)).toThrow("tokenType must be either 'sol' or 'token'");
        });

        it('should throw error for missing tokenAddress when tokenType is token', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 3,
                numTokens: 100,
                tokenType: 'token'
            };

            expect(() => hopper.validateOptions(options)).toThrow('tokenAddress is required');
        });

        it('should throw error for invalid tokenAddress when tokenType is token', () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 3,
                numTokens: 100,
                tokenType: 'token',
                tokenAddress: 'invalid-address'
            };

            expect(() => hopper.validateOptions(options)).toThrow('Invalid tokenAddress');
        });
    });

    describe('executeDelegate', () => {
        beforeEach(() => {
            // Mock successful transaction execution
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: 'test-blockhash',
                lastValidBlockHeight: 1000
            });
            mockConnection.sendTransaction.mockResolvedValue('test-signature');
            mockConnection.confirmTransaction.mockResolvedValue({
                context: { slot: 1000 },
                value: { err: null }
            });
        });

        it('should execute SOL hopper successfully', async () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 2,
                numTokens: 1.0,
                tokenType: 'sol'
            };

            mockHeliusClient.getBalance.mockResolvedValue(1000000000); // 1 SOL in lamports

            const result = await hopper.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(2); // 2 hops = 2 signatures
            expect(result.hopMap).toHaveLength(2);
            expect(result.finalDestination).toBe('11111111111111111111111111111111');
            expect(result.totalHops).toBe(2);
        });

        it('should execute token hopper successfully', async () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: Keypair.generate().publicKey.toBase58(),
                numOfHops: 2,
                numTokens: 100,
                tokenType: 'token',
                tokenAddress: Keypair.generate().publicKey.toBase58()
            };

            // Mock token account creation
            (getOrCreateAssociatedTokenAccount as jest.Mock).mockResolvedValue({
                address: Keypair.generate().publicKey
            });

            // Mock token decimals
            (getMint as jest.Mock).mockResolvedValue({
                decimals: 6
            });

            // Mock token balance (high enough)
            mockHeliusClient.getTokenAccountBalance.mockResolvedValue({
                value: { uiAmountString: '100000000' }
            });

            // Mock SOL balance
            mockHeliusClient.getBalance.mockResolvedValue(1000000000); // 1 SOL in lamports

            const result = await hopper.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(4); // 2 hops * 2 transactions each = 4 signatures
            expect(result.hopMap).toHaveLength(2);
            expect(result.finalDestination).toBe(options.hopDestination);
            expect(result.totalHops).toBe(2);
        });

        it('should throw error for missing tokenAddress in token hopper', async () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: Keypair.generate().publicKey.toBase58(),
                numOfHops: 2,
                numTokens: 100,
                tokenType: 'token'
            };

            await expect(hopper.executeDelegate(options)).rejects.toThrow('tokenAddress is required');
        });

        it('should handle insufficient token balance', async () => {
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: Keypair.generate().publicKey.toBase58(),
                numOfHops: 2,
                numTokens: 1000,
                tokenType: 'token',
                tokenAddress: Keypair.generate().publicKey.toBase58()
            };

            // Mock token account creation
            (getOrCreateAssociatedTokenAccount as jest.Mock).mockResolvedValue({
                address: Keypair.generate().publicKey
            });

            // Mock token decimals
            (getMint as jest.Mock).mockResolvedValue({
                decimals: 6
            });

            // Mock insufficient token balance
            mockHeliusClient.getTokenAccountBalance.mockResolvedValue({
                value: { uiAmountString: '100' } // Less than required 1000
            });

            await expect(hopper.executeDelegate(options)).rejects.toThrow('Insufficient token balance');
        });

        it('should handle transaction failure', async () => {
            jest.setTimeout(15000);
            const options: HopperDelegateOptions = {
                type: DELEGATE_TYPES.HOPPER,
                hopDestination: '11111111111111111111111111111111',
                numOfHops: 1,
                numTokens: 1.0,
                tokenType: 'sol'
            };

            mockHeliusClient.getBalance.mockResolvedValue(1000000000);
            mockConnection.sendTransaction.mockRejectedValue(new Error('Transaction failed'));

            await expect(hopper.executeDelegate(options)).rejects.toThrow('Transaction failed');
        });
    });

    describe('private methods', () => {
        it('should calculate amount to transfer correctly', () => {
            const hopperAny = hopper as any;
            const result = hopperAny.calculateAmountToTransfer(100, 2, 6);
            expect(result).toBe(50000000); // 50 tokens * 10^6 decimals
        });

        it('should get token balance correctly', async () => {
            const hopperAny = hopper as any;
            mockHeliusClient.getTokenAccountBalance.mockResolvedValue({
                value: { uiAmountString: '123.456' }
            });

            const result = await hopperAny.getTokenBalance(Keypair.generate().publicKey.toBase58());
            expect(result).toBe(123.456);
        });

        it('should get token decimals correctly', async () => {
            const hopperAny = hopper as any;
            (getMint as jest.Mock).mockResolvedValue({
                decimals: 8
            });

            const result = await hopperAny.getTokenDecimals('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
            expect(result).toBe(8);
        });
    });
}); 