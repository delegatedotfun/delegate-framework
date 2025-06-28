import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { Distributor } from "../distributor";
import { HeliusClient } from "../../solana/clients/helius";
import { DistributorDelegateOptions, DistributionType } from "../types";

// Mock Solana web3.js
jest.mock("@solana/web3.js", () => ({
    Connection: jest.fn(),
    Keypair: {
        generate: jest.fn(() => ({
            publicKey: { toBase58: () => "mock_public_key" },
            secretKey: new Uint8Array(64)
        }))
    },
    PublicKey: jest.fn((address: string) => ({
        toBase58: () => address,
        toString: () => address
    })),
    LAMPORTS_PER_SOL: 1000000000,
    Transaction: jest.fn(() => ({
        add: jest.fn(),
        feePayer: null,
        recentBlockhash: null,
        sign: jest.fn(),
        serialize: jest.fn(() => Buffer.from("mock_transaction"))
    })),
    SystemProgram: {
        transfer: jest.fn(() => ({ programId: "mock_program_id" }))
    }
}));

// Mock SPL token
jest.mock("@solana/spl-token", () => ({
    getOrCreateAssociatedTokenAccount: jest.fn(),
    Account: jest.fn(),
    createTransferCheckedInstruction: jest.fn(() => ({ programId: "mock_instruction" }))
}));

// Mock Helius client
jest.mock("../../solana/clients/helius", () => ({
    HeliusClient: jest.fn().mockImplementation(() => ({
        getTopHolders: jest.fn(),
        getTokenAccountOwner: jest.fn()
    }))
}));

// Helper to flush all timers and microtasks
async function flushAllTimersAndMicrotasks(maxIterations = 20) {
    for (let i = 0; i < maxIterations; i++) {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
    }
}

describe("Distributor", () => {
    let distributor: Distributor;
    let mockConnection: jest.Mocked<Connection>;
    let mockSignerKeypair: jest.Mocked<Keypair>;
    let mockHeliusClient: jest.Mocked<HeliusClient>;
    let mockFeeTakerKeypair: jest.Mocked<Keypair>;

    const mockPublicKey = "11111111111111111111111111111111";
    const mockTokenAddress = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

    beforeEach(() => {
        jest.clearAllMocks();

        mockConnection = {
            getBalance: jest.fn(),
            getLatestBlockhash: jest.fn(),
            sendTransaction: jest.fn(),
            confirmTransaction: jest.fn(),
            getAccountInfo: jest.fn()
        } as any;

        mockSignerKeypair = {
            publicKey: { toBase58: () => mockPublicKey },
            secretKey: new Uint8Array(64)
        } as any;

        mockHeliusClient = {
            getTopHolders: jest.fn(),
            getTokenAccountOwner: jest.fn()
        } as any;

        mockFeeTakerKeypair = {
            publicKey: { toBase58: () => "fee_taker_public_key" },
            secretKey: new Uint8Array(64)
        } as any;

        distributor = new Distributor(mockConnection, mockSignerKeypair, mockHeliusClient, mockFeeTakerKeypair);
    });

    describe("constructor", () => {
        it("should create a distributor instance", () => {
            expect(distributor).toBeInstanceOf(Distributor);
        });
    });

    describe("validateOptions", () => {
        it("should validate single distribution options", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 100,
                singleAddress: mockPublicKey
            };

            expect(() => distributor.validateOptions(options)).not.toThrow();
        });

        it("should validate multi distribution options", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "multi",
                numTokens: 100,
                multipleAddresses: [mockPublicKey, "22222222222222222222222222222222"]
            };

            expect(() => distributor.validateOptions(options)).not.toThrow();
        });

        it("should validate holders distribution options", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "holders",
                distributionMethod: "topx",
                numTokens: 100,
                topX: 5,
                holderOfWhichToken: mockTokenAddress
            };

            expect(() => distributor.validateOptions(options)).not.toThrow();
        });

        it("should throw error for missing singleAddress in single distribution", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 100
            };

            expect(() => distributor.validateOptions(options)).toThrow("singleAddress is required for single distribution");
        });

        it("should throw error for missing multipleAddresses in multi distribution", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "multi",
                numTokens: 100
            };

            expect(() => distributor.validateOptions(options)).toThrow("multipleAddresses array is required for multi distribution");
        });

        it("should throw error for missing distributionMethod in holders distribution", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "holders",
                numTokens: 100
            };

            expect(() => distributor.validateOptions(options)).toThrow("distributionMethod is required for holders distribution");
        });

        it("should throw error for missing topX in topx distribution", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "holders",
                distributionMethod: "topx",
                numTokens: 100,
                holderOfWhichToken: mockTokenAddress
            };

            expect(() => distributor.validateOptions(options)).toThrow("topX must be greater than 0 for topx distribution method");
        });

        it("should throw error for negative numTokens", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: -100,
                singleAddress: mockPublicKey
            };

            expect(() => distributor.validateOptions(options)).toThrow();
        });

        it.skip("should throw error for invalid public key", () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 100,
                singleAddress: "invalid_public_key"
            };

            expect(() => distributor.validateOptions(options)).toThrow();
        });
    });

    describe("executeDelegate", () => {
        beforeEach(() => {
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: "mock_blockhash",
                lastValidBlockHeight: 1000
            });
            mockConnection.sendTransaction.mockResolvedValue("mock_signature");
            mockConnection.confirmTransaction.mockResolvedValue({ 
                context: { slot: 1000 },
                value: { err: null } 
            });
        });

        it("should execute single SOL distribution successfully", async () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 1, // 1 SOL
                singleAddress: mockPublicKey
            };

            const result = await distributor.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(1);
            expect(result.recipients).toHaveLength(1);
            expect(result.recipients[0]?.address).toBe(mockPublicKey);
            expect(result.recipients[0]?.amount).toBe(1);
        });

        it("should execute multi SOL distribution successfully", async () => {
            const addresses = [mockPublicKey, "22222222222222222222222222222222"];
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "multi",
                numTokens: 2, // 2 SOL total
                multipleAddresses: addresses
            };

            const result = await distributor.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(2);
            expect(result.recipients).toHaveLength(2);
            expect(result.recipients[0]?.amount).toBe(1);
            expect(result.recipients[1]?.amount).toBe(1);
        });

        it("should execute token distribution successfully", async () => {
            const mockTokenAccount = {
                address: { toBase58: () => "token_account_address" }
            } as any;

            (getOrCreateAssociatedTokenAccount as jest.Mock).mockResolvedValue(mockTokenAccount);

            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 1000,
                tokenAddress: mockTokenAddress,
                singleAddress: mockPublicKey
            };

            const result = await distributor.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(1);
            expect(getOrCreateAssociatedTokenAccount).toHaveBeenCalled();
        });

        it("should execute holders distribution successfully", async () => {
            const mockHolders = [
                { address: "holder1_address" },
                { address: "holder2_address" }
            ];

            mockHeliusClient.getTopHolders.mockResolvedValue(mockHolders);
            mockHeliusClient.getTokenAccountOwner
                .mockResolvedValueOnce("owner1_address")
                .mockResolvedValueOnce("owner2_address");

            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "holders",
                distributionMethod: "topx",
                numTokens: 2,
                topX: 2,
                holderOfWhichToken: mockTokenAddress
            };

            const result = await distributor.executeDelegate(options);

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(2);
            expect(mockHeliusClient.getTopHolders).toHaveBeenCalledWith(mockTokenAddress);
            expect(mockHeliusClient.getTokenAccountOwner).toHaveBeenCalledTimes(2);
        });

        it("should handle transaction failures in multi distribution", async () => {
            jest.useFakeTimers();
            const addresses = [mockPublicKey, "22222222222222222222222222222222"];
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "multi",
                numTokens: 2,
                multipleAddresses: addresses
            };

            // First transaction succeeds, second fails
            mockConnection.sendTransaction
                .mockResolvedValueOnce("success_signature")
                .mockRejectedValueOnce(new Error("Transaction failed"));

            const promise = distributor.executeDelegate(options);
            await flushAllTimersAndMicrotasks();
            const result = await promise;

            expect(result.success).toBe(true);
            expect(result.signatures).toHaveLength(2);
            expect(result.recipients).toHaveLength(2);
            jest.useRealTimers();
        });

        it("should throw error for transaction failure in single distribution", async () => {
            jest.useFakeTimers();
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 1,
                singleAddress: mockPublicKey
            };

            mockConnection.sendTransaction.mockRejectedValue(new Error("Transaction failed"));

            const promise = distributor.executeDelegate(options);
            await flushAllTimersAndMicrotasks();
            await expect(promise).rejects.toThrow("Transaction failed");
            jest.useRealTimers();
        });

        it("should throw error for holders distribution failure", async () => {
            jest.useFakeTimers();
            mockHeliusClient.getTopHolders.mockRejectedValue(new Error("API failed"));

            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "holders",
                distributionMethod: "topx",
                numTokens: 1,
                topX: 5,
                holderOfWhichToken: mockTokenAddress
            };

            const promise = distributor.executeDelegate(options);
            await flushAllTimersAndMicrotasks();
            await expect(promise).rejects.toThrow("Failed to get top holders");
            jest.useRealTimers();
        });

        it("should throw error for invalid distribution type", async () => {
            const options = {
                type: "distributor" as const,
                distributionType: "invalid" as DistributionType,
                numTokens: 1
            };

            await expect(distributor.executeDelegate(options)).rejects.toThrow("Invalid distribution type");
        });
    });

    describe("getTopHolders", () => {
        it("should return owner addresses from top holders", async () => {
            const mockHolders = [
                { address: "holder1_address" },
                { address: "holder2_address" }
            ];

            mockHeliusClient.getTopHolders.mockResolvedValue(mockHolders);
            mockHeliusClient.getTokenAccountOwner
                .mockResolvedValueOnce("owner1_address")
                .mockResolvedValueOnce("owner2_address");

            const result = await (distributor as any).getTopHolders(mockTokenAddress, 2);

            expect(result).toEqual(["owner1_address", "owner2_address"]);
            expect(mockHeliusClient.getTopHolders).toHaveBeenCalledWith(mockTokenAddress);
            expect(mockHeliusClient.getTokenAccountOwner).toHaveBeenCalledTimes(2);
        });

        it("should handle API errors gracefully", async () => {
            jest.useFakeTimers();
            mockHeliusClient.getTopHolders.mockRejectedValue(new Error("API failed"));

            const promise = (distributor as any).getTopHolders(mockTokenAddress, 2);
            await flushAllTimersAndMicrotasks();
            await expect(promise).rejects.toThrow("Failed to get top holders");
            jest.useRealTimers();
        });

        it("should handle invalid response data", async () => {
            mockHeliusClient.getTopHolders.mockResolvedValue(null);

            await expect((distributor as any).getTopHolders(mockTokenAddress, 2))
                .rejects.toThrow("Invalid response from getTopHolders");
        });
    });

    describe("processRecipient", () => {
        beforeEach(() => {
            mockConnection.getLatestBlockhash.mockResolvedValue({
                blockhash: "mock_blockhash",
                lastValidBlockHeight: 1000
            });
            mockConnection.sendTransaction.mockResolvedValue("mock_signature");
            mockConnection.confirmTransaction.mockResolvedValue({ 
                context: { slot: 1000 },
                value: { err: null } 
            });
        });

        it("should process SOL transfer successfully", async () => {
            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 1,
                singleAddress: mockPublicKey
            };

            const result = await (distributor as any).processRecipient(
                mockPublicKey,
                options,
                1,
                null,
                null
            );

            expect(result.address).toBe(mockPublicKey);
            expect(result.amount).toBe(1);
            expect(result.signature).toBe("mock_signature");
        });

        it("should process token transfer successfully", async () => {
            const mockTokenAccount = {
                address: { toBase58: () => "token_account_address" }
            } as any;

            (getOrCreateAssociatedTokenAccount as jest.Mock).mockResolvedValue(mockTokenAccount);

            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 1000,
                tokenAddress: mockTokenAddress,
                singleAddress: mockPublicKey
            };

            const result = await (distributor as any).processRecipient(
                mockPublicKey,
                options,
                1,
                new PublicKey(mockTokenAddress),
                mockTokenAccount
            );

            expect(result.address).toBe(mockPublicKey);
            expect(result.amount).toBe(1000);
            expect(result.signature).toBe("mock_signature");
        });

        it("should handle transaction failure", async () => {
            jest.useFakeTimers();
            mockConnection.sendTransaction.mockRejectedValue(new Error("Transaction failed"));

            const options: DistributorDelegateOptions = {
                type: "distributor",
                distributionType: "single",
                numTokens: 1,
                singleAddress: mockPublicKey
            };

            const promise = (distributor as any).processRecipient(
                mockPublicKey,
                options,
                1,
                null,
                null
            );
            await flushAllTimersAndMicrotasks();
            await expect(promise).rejects.toThrow("Transaction failed");
            jest.useRealTimers();
        });
    });
}); 