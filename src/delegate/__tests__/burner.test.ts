import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, burnChecked, getMint } from "@solana/spl-token";
import { Burner } from "../burner";
import { BurnerDelegateOptions } from "../types";
import { DELEGATE_TYPES } from "../constants";

// Mock SPL token functions
jest.mock("@solana/spl-token", () => ({
    getOrCreateAssociatedTokenAccount: jest.fn(),
    burnChecked: jest.fn(),
    getMint: jest.fn(),
}));

// Mock bs58
jest.mock("bs58", () => ({
    decode: jest.fn(),
}));

const mockGetOrCreateAssociatedTokenAccount = getOrCreateAssociatedTokenAccount as jest.MockedFunction<typeof getOrCreateAssociatedTokenAccount>;
const mockBurnChecked = burnChecked as jest.MockedFunction<typeof burnChecked>;
const mockGetMint = getMint as jest.MockedFunction<typeof getMint>;
const mockBs58Decode = require("bs58").decode as jest.MockedFunction<any>;

// Helper to flush timers and microtasks until a promise settles
async function waitForPromiseToSettleWithTimers(promise: Promise<any>, maxIterations = 10) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    let i = 0;
    while (!settled && i < maxIterations) {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
        i++;
    }
    return promise;
}

describe('Burner', () => {
    let burner: Burner;
    let connection: Connection;
    let signerKeypair: Keypair;
    let testKeypair: Keypair;
    let testTokenAddress: string;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        connection = new Connection('http://localhost:8899');
        signerKeypair = Keypair.generate();
        testKeypair = Keypair.generate();
        testTokenAddress = '11111111111111111111111111111111';

        burner = new Burner(connection, signerKeypair);

        // Setup default mocks
        mockBs58Decode.mockReturnValue(testKeypair.secretKey);
        mockGetOrCreateAssociatedTokenAccount.mockResolvedValue({
            address: testKeypair.publicKey,
            mint: new PublicKey(testTokenAddress),
            owner: testKeypair.publicKey,
            amount: 1000000n,
            delegate: null,
            isNative: false,
            delegatedAmount: 0n,
            closeAuthority: null,
            isInitialized: true,
            isFrozen: false,
            rentExemptReserve: 1000000n,
            tlvData: Buffer.alloc(0),
        });
        mockGetMint.mockResolvedValue({
            address: new PublicKey(testTokenAddress),
            mintAuthority: testKeypair.publicKey,
            supply: 1000000000n,
            decimals: 6,
            isInitialized: true,
            freezeAuthority: null,
            tlvData: Buffer.alloc(0),
        });
        mockBurnChecked.mockResolvedValue('test-signature-123');
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('constructor', () => {
        it('should initialize burner delegate', () => {
            expect(burner.connection).toBe(connection);
            expect(burner.signerKeypair).toBe(signerKeypair);
        });
    });

    describe('validateOptions', () => {
        const validOptions: BurnerDelegateOptions = {
            type: DELEGATE_TYPES.BURNER,
            tokenAddress: '11111111111111111111111111111111',
            numTokens: 100,
            privateKey: 'test-private-key',
        };

        it('should validate correct options', () => {
            expect(() => burner.validateOptions(validOptions)).not.toThrow();
        });

        it('should throw for missing tokenAddress', () => {
            const invalidOptions = { ...validOptions, tokenAddress: '' };
            expect(() => burner.validateOptions(invalidOptions)).toThrow('tokenAddress must be a non-empty string');
        });

        it('should throw for invalid token address format', () => {
            const invalidOptions = { ...validOptions, tokenAddress: 'invalid-address' };
            expect(() => burner.validateOptions(invalidOptions)).toThrow('Invalid token address format');
        });

        it('should throw for negative numTokens', () => {
            const invalidOptions = { ...validOptions, numTokens: -1 };
            expect(() => burner.validateOptions(invalidOptions)).toThrow('numTokens must be at least 0');
        });

        it('should throw for missing privateKey', () => {
            const invalidOptions = { ...validOptions, privateKey: '' };
            expect(() => burner.validateOptions(invalidOptions)).toThrow('privateKey must be a non-empty string');
        });

        it('should throw for invalid private key format', () => {
            mockBs58Decode.mockImplementation(() => {
                throw new Error('Invalid base58');
            });
            expect(() => burner.validateOptions(validOptions)).toThrow('Invalid private key format');
        });
    });

    describe('executeDelegate', () => {
        const validOptions: BurnerDelegateOptions = {
            type: DELEGATE_TYPES.BURNER,
            tokenAddress: '11111111111111111111111111111111',
            numTokens: 100,
            privateKey: 'test-private-key',
        };

        it('should successfully burn tokens', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            const result = await burner.executeDelegate(validOptions);

            expect(result).toEqual({
                success: true,
                signatures: ['test-signature-123'],
                burnedAmount: '100000000',
                tokenMint: '11111111111111111111111111111111',
            });

            expect(mockBs58Decode).toHaveBeenCalledWith('test-private-key');
            expect(mockGetOrCreateAssociatedTokenAccount).toHaveBeenCalledWith(
                connection,
                testKeypair,
                new PublicKey(testTokenAddress),
                testKeypair.publicKey,
                true
            );
            expect(mockGetMint).toHaveBeenCalledWith(connection, new PublicKey(testTokenAddress));
            expect(mockBurnChecked).toHaveBeenCalledWith(
                connection,
                testKeypair,
                testKeypair.publicKey,
                new PublicKey(testTokenAddress),
                testKeypair,
                expect.any(Object), // BN object
                6
            );

            expect(consoleSpy).toHaveBeenCalledWith(
                '[Delegate] burner_execution_started:',
                expect.objectContaining({
                    operation: 'burner_execution_started',
                    requestId: 1,
                })
            );

            expect(consoleSpy).toHaveBeenCalledWith(
                '[Delegate] burner_execution_completed:',
                expect.objectContaining({
                    operation: 'burner_execution_completed',
                    requestId: 1,
                    signatures: ['test-signature-123'],
                    burnedAmount: '100000000',
                    tokenMint: '11111111111111111111111111111111',
                })
            );

            consoleSpy.mockRestore();
        });

        it('should handle getOrCreateAssociatedTokenAccount failure with retry', async () => {
            const error = new Error('Token account creation failed');
            mockGetOrCreateAssociatedTokenAccount
                .mockRejectedValueOnce(error)
                .mockRejectedValueOnce(error)
                .mockResolvedValue({
                    address: testKeypair.publicKey,
                    mint: new PublicKey(testTokenAddress),
                    owner: testKeypair.publicKey,
                    amount: 1000000n,
                    delegate: null,
                    isNative: false,
                    delegatedAmount: 0n,
                    closeAuthority: null,
                    isInitialized: true,
                    isFrozen: false,
                    rentExemptReserve: 1000000n,
                    tlvData: Buffer.alloc(0),
                });

            const promise = burner.executeDelegate(validOptions);
            const result = await waitForPromiseToSettleWithTimers(promise, 10);

            expect(result.success).toBe(true);
            expect(mockGetOrCreateAssociatedTokenAccount).toHaveBeenCalledTimes(3);
        }, 20000);

        it('should handle getMint failure with retry', async () => {
            const error = new Error('Failed to get mint info');
            mockGetMint
                .mockRejectedValueOnce(error)
                .mockResolvedValue({
                    address: new PublicKey(testTokenAddress),
                    mintAuthority: testKeypair.publicKey,
                    supply: 1000000000n,
                    decimals: 6,
                    isInitialized: true,
                    freezeAuthority: null,
                    tlvData: Buffer.alloc(0),
                });

            const promise = burner.executeDelegate(validOptions);
            const result = await waitForPromiseToSettleWithTimers(promise, 10);

            expect(result.success).toBe(true);
            expect(mockGetMint).toHaveBeenCalledTimes(2);
        }, 20000);

        it('should handle burnChecked failure with retry', async () => {
            const error = new Error('Burn transaction failed');
            mockBurnChecked
                .mockRejectedValueOnce(error)
                .mockResolvedValue('test-signature-123');

            const promise = burner.executeDelegate(validOptions);
            const result = await waitForPromiseToSettleWithTimers(promise, 10);

            expect(result.success).toBe(true);
            expect(mockBurnChecked).toHaveBeenCalledTimes(2);
        }, 20000);

        it('should throw error when decimals is -1', async () => {
            mockGetMint.mockResolvedValue({
                address: new PublicKey(testTokenAddress),
                mintAuthority: testKeypair.publicKey,
                supply: 1000000000n,
                decimals: -1,
                isInitialized: true,
                freezeAuthority: null,
                tlvData: Buffer.alloc(0),
            });

            await expect(burner.executeDelegate(validOptions)).rejects.toThrow('Failed to get token decimals');
        });

        it('should handle validation errors', async () => {
            const invalidOptions = { ...validOptions, tokenAddress: 'invalid-address' };

            await expect(burner.executeDelegate(invalidOptions)).rejects.toThrow('Invalid token address format');
        });

        it('should handle private key decode errors', async () => {
            mockBs58Decode.mockImplementation(() => {
                throw new Error('Invalid base58');
            });

            await expect(burner.executeDelegate(validOptions)).rejects.toThrow('Invalid private key format');
        });

        it('should handle persistent failures after max retries', async () => {
            const error = new Error('Persistent failure');
            mockGetOrCreateAssociatedTokenAccount.mockRejectedValue(error);

            const promise = burner.executeDelegate(validOptions);
            await expect(waitForPromiseToSettleWithTimers(promise, 30)).rejects.toThrow('Persistent failure');
            expect(mockGetOrCreateAssociatedTokenAccount).toHaveBeenCalledTimes(5);
        }, 20000);

        it('should calculate burn amount correctly for different decimals', async () => {
            mockGetMint.mockResolvedValue({
                address: new PublicKey(testTokenAddress),
                mintAuthority: testKeypair.publicKey,
                supply: 1000000000n,
                decimals: 9, // Different decimals
                isInitialized: true,
                freezeAuthority: null,
                tlvData: Buffer.alloc(0),
            });

            const promise = burner.executeDelegate(validOptions);
            const result = await waitForPromiseToSettleWithTimers(promise, 10);

            expect(result.burnedAmount).toBe('100000000000'); // 100 * 10^9
        }, 20000);

        it('should handle zero tokens to burn', async () => {
            const zeroOptions = { ...validOptions, numTokens: 0 };

            const result = await burner.executeDelegate(zeroOptions);

            expect(result.burnedAmount).toBe('0');
            expect(mockBurnChecked).toHaveBeenCalledWith(
                connection,
                testKeypair,
                testKeypair.publicKey,
                new PublicKey(testTokenAddress),
                testKeypair,
                expect.any(Object), // BN object with value 0
                6
            );
        });
    });

    describe('calculateBurnAmount', () => {
        it('should calculate burn amount correctly', () => {
            const result = (burner as any).calculateBurnAmount(100, 6);
            expect(result.toString()).toBe('100000000'); // 100 * 10^6
        });

        it('should handle zero amount', () => {
            const result = (burner as any).calculateBurnAmount(0, 6);
            expect(result.toString()).toBe('0');
        });

        it('should handle different decimals', () => {
            const result = (burner as any).calculateBurnAmount(50, 9);
            expect(result.toString()).toBe('50000000000'); // 50 * 10^9
        });
    });

    describe('error handling', () => {
        it('should log errors with context', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
            const error = new Error('Test error');
            mockGetOrCreateAssociatedTokenAccount.mockRejectedValue(error);

            const testOptions: BurnerDelegateOptions = {
                type: DELEGATE_TYPES.BURNER,
                tokenAddress: '11111111111111111111111111111111',
                numTokens: 100,
                privateKey: 'test-private-key',
            };

            const promise = burner.executeDelegate(testOptions);
            await expect(waitForPromiseToSettleWithTimers(promise, 30)).rejects.toThrow('Test error');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Delegate operation failed:',
                expect.objectContaining({
                    error: 'Test error',
                    requestId: 1,
                    timestamp: expect.any(String)
                })
            );

            consoleErrorSpy.mockRestore();
        }, 20000);
    });
}); 