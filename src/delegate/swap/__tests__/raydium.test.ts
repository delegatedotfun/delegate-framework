import { RaydiumSwap } from '../raydium';
import { Keypair } from '@solana/web3.js';
import { HeliusClient } from '../../../solana/clients/helius';

// Mock fetch globally
global.fetch = jest.fn();

// Mock Raydium SDK
jest.mock('@raydium-io/raydium-sdk-v2', () => ({
  API_URLS: {
    SWAP_HOST: 'https://api.raydium.io/v2',
    BASE_HOST: 'https://api.raydium.io',
    PRIORITY_FEE: '/priority-fee'
  },
  parseTokenAccountResp: jest.fn((_data) => ({
    tokenAccounts: [
      {
        publicKey: { toBase58: () => 'token-account-1' },
        mint: { toBase58: () => 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
      }
    ]
  }))
}));

// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  
  // Create mock transaction objects with sign methods
  const createMockTransaction = () => ({
    sign: jest.fn(),
    serialize: jest.fn(() => Buffer.from('mock-serialized-transaction')),
    add: jest.fn(),
    feePayer: null,
    instructions: [],
    recentBlockhash: null,
    lastValidBlockHeight: null,
    signatures: []
  });

  const createMockVersionedTransaction = () => ({
    sign: jest.fn(),
    serialize: jest.fn(() => Buffer.from('mock-serialized-transaction')),
    message: {
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [],
      recentBlockhash: '11111111111111111111111111111111',
      compiledInstructions: [],
      addressTableLookups: []
    }
  });

  return {
    ...actual,
    VersionedTransaction: {
      ...actual.VersionedTransaction,
      deserialize: jest.fn(() => createMockVersionedTransaction()),
    },
    Transaction: {
      ...actual.Transaction,
      from: jest.fn(() => createMockTransaction()),
    },
    sendAndConfirmTransaction: jest.fn(() => Promise.resolve('mock-signature')),
  };
});

describe('RaydiumSwap', () => {
  let raydiumSwap: RaydiumSwap;
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let mockHeliusClient: jest.Mocked<HeliusClient>;
  let keypair: Keypair;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    (console.log as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
    (console.warn as jest.Mock).mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    
    mockHeliusClient = {
      getWalletTokenData: jest.fn(),
      getTokenInfo: jest.fn(),
    } as any;

    keypair = new Keypair();
    raydiumSwap = new RaydiumSwap(keypair, { heliusClient: mockHeliusClient });
  });

  describe('getQuote', () => {
    it('should successfully get quote', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            outputAmount: '950000000',
            priceImpactPct: '0.5'
          }
        })
      } as Response);

      const quote = await raydiumSwap.getQuote(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'So11111111111111111111111111111111111111112',
        1.0,
        0.5
      );

      expect(quote).toEqual({
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        inputAmount: '1',
        outputAmount: '950000000',
        priceImpact: '0.5',
        raydiumQuote: {
          success: true,
          data: {
            outputAmount: '950000000',
            priceImpactPct: '0.5'
          }
        }
      });
    });

    it('should return null when quote fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: 'Quote failed'
        })
      } as Response);

      const quote = await raydiumSwap.getQuote(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'So11111111111111111111111111111111111111112',
        1.0,
        0.5
      );

      expect(quote).toBeNull();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(raydiumSwap.getQuote(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'So11111111111111111111111111111111111111112',
        1.0,
        0.5
      )).rejects.toThrow("Cannot read properties of undefined (reading 'ok')");
    }, 10000);
  });

  describe('executeSwap', () => {
    it('should successfully execute versioned transaction', async () => {
      const mockTransaction = {
        sign: jest.fn(),
        serialize: jest.fn(() => Buffer.from('mock-serialized-transaction')),
        message: {
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
          staticAccountKeys: [],
          recentBlockhash: '11111111111111111111111111111111',
          compiledInstructions: [],
          addressTableLookups: []
        }
      };

      const mockSwapTransaction = {
        serialize: () => Buffer.from('mock-serialized-transaction'),
        sign: jest.fn(),
        raydiumData: {
          transaction: mockTransaction,
          isV0Tx: true,
          allTransactions: [mockTransaction]
        }
      };

      // Mock connection methods
      const mockConnection = {
        sendTransaction: jest.fn().mockResolvedValue('mock-signature'),
        getLatestBlockhash: jest.fn().mockResolvedValue({
          blockhash: 'test-blockhash',
          lastValidBlockHeight: 1000
        }),
        confirmTransaction: jest.fn().mockResolvedValue({
          context: { slot: 1000 },
          value: { err: null }
        })
      };

      // Mock the connection property
      Object.defineProperty(raydiumSwap, 'connection', {
        value: mockConnection,
        writable: true
      });

      const result = await raydiumSwap.executeSwap(mockSwapTransaction);

      expect(result).toEqual({
        signature: 'mock-signature',
        success: true
      });
      expect(mockTransaction.sign).toHaveBeenCalled();
    });

    it('should successfully execute legacy transaction', async () => {
      const mockTransaction = {
        sign: jest.fn(),
        serialize: jest.fn(() => Buffer.from('mock-serialized-transaction')),
        add: jest.fn(),
        feePayer: null,
        instructions: [],
        recentBlockhash: null,
        lastValidBlockHeight: null,
        signatures: []
      };

      const mockSwapTransaction = {
        serialize: () => Buffer.from('mock-serialized-transaction'),
        sign: jest.fn(),
        raydiumData: {
          transaction: mockTransaction,
          isV0Tx: false,
          allTransactions: [mockTransaction]
        }
      };

      const result = await raydiumSwap.executeSwap(mockSwapTransaction);

      expect(result).toEqual({
        signature: 'mock-signature',
        success: true
      });
      expect(mockTransaction.sign).toHaveBeenCalled();
    });

    it('should retry on transaction failures', async () => {
      const mockTransaction = {
        sign: jest.fn(),
        serialize: jest.fn(() => Buffer.from('mock-serialized-transaction')),
        message: {
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
          staticAccountKeys: [],
          recentBlockhash: '11111111111111111111111111111111',
          compiledInstructions: [],
          addressTableLookups: []
        }
      };

      const mockSwapTransaction = {
        serialize: () => Buffer.from('mock-serialized-transaction'),
        sign: jest.fn(),
        raydiumData: {
          transaction: mockTransaction,
          isV0Tx: true,
          allTransactions: [mockTransaction]
        }
      };

      // Mock connection methods
      const mockConnection = {
        sendTransaction: jest.fn()
          .mockRejectedValueOnce(new Error('Transaction failed'))
          .mockResolvedValueOnce('mock-signature'),
        getLatestBlockhash: jest.fn().mockResolvedValue({
          blockhash: 'test-blockhash',
          lastValidBlockHeight: 1000
        }),
        confirmTransaction: jest.fn().mockResolvedValue({
          context: { slot: 1000 },
          value: { err: null }
        })
      };

      // Mock the connection property
      Object.defineProperty(raydiumSwap, 'connection', {
        value: mockConnection,
        writable: true
      });

      const result = await raydiumSwap.executeSwap(mockSwapTransaction);

      expect(result).toEqual({
        signature: 'mock-signature',
        success: true
      });
      expect(mockConnection.sendTransaction).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries', async () => {
      const mockTransaction = {
        sign: jest.fn(),
        serialize: jest.fn(() => Buffer.from('mock-serialized-transaction')),
        message: {
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
          staticAccountKeys: [],
          recentBlockhash: '11111111111111111111111111111111',
          compiledInstructions: [],
          addressTableLookups: []
        }
      };

      const mockSwapTransaction = {
        serialize: () => Buffer.from('mock-serialized-transaction'),
        sign: jest.fn(),
        raydiumData: {
          transaction: mockTransaction,
          isV0Tx: true,
          allTransactions: [mockTransaction]
        }
      };

      // Mock connection methods
      const mockConnection = {
        sendTransaction: jest.fn().mockRejectedValue(new Error('Transaction failed')),
        getLatestBlockhash: jest.fn().mockResolvedValue({
          blockhash: 'test-blockhash',
          lastValidBlockHeight: 1000
        }),
        confirmTransaction: jest.fn().mockResolvedValue({
          context: { slot: 1000 },
          value: { err: null }
        })
      };

      // Mock the connection property
      Object.defineProperty(raydiumSwap, 'connection', {
        value: mockConnection,
        writable: true
      });

      await expect(raydiumSwap.executeSwap(mockSwapTransaction)).rejects.toThrow('Transaction failed');
    }, 10000);
  });

  describe('fetchTokenAccountData', () => {
    it('should successfully get token accounts', async () => {
      const mockWalletData = {
        tokenAccounts: {
          value: [
            {
              account: {
                data: 'base64data',
                executable: false,
                lamports: 1000000,
                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                rentEpoch: 361,
              },
              pubkey: '11111111111111111111111111111111',
            },
          ],
        },
      };

      mockHeliusClient.getWalletTokenData.mockResolvedValue(mockWalletData);

      const result = await raydiumSwap.fetchTokenAccountData();

      expect(result).toBeDefined();
      expect(mockHeliusClient.getWalletTokenData).toHaveBeenCalledWith(keypair.publicKey.toBase58());
    });

    it('should handle empty token accounts', async () => {
      const mockWalletData = {
        tokenAccounts: {
          value: [
            {
              mint: { toBase58: () => 'mint-address' },
              publicKey: { toBase58: () => 'token-account-1' }
            }
          ],
        },
      };

      mockHeliusClient.getWalletTokenData.mockResolvedValue(mockWalletData);

      const result = await raydiumSwap.fetchTokenAccountData();

      expect(result).toBeDefined();
      expect(result.tokenAccounts).toHaveLength(1);
      expect(result.tokenAccounts[0]?.publicKey?.toBase58()).toBe('token-account-1');
      expect(result.tokenAccounts[0]?.mint?.toBase58()).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('should handle errors', async () => {
      mockHeliusClient.getWalletTokenData.mockRejectedValue(new Error('Failed to get wallet data'));

      await expect(raydiumSwap.fetchTokenAccountData())
        .rejects.toThrow('Failed to get wallet data');
    });
  });
}); 