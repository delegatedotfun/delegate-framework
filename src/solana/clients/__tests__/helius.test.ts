let warnSpy: jest.SpyInstance;

beforeAll(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  warnSpy.mockRestore();
});

import { HeliusClient } from '../helius';
import { PublicKey, Transaction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Mock fetch globally
global.fetch = jest.fn();

// Increase Jest timeout for slow tests
jest.setTimeout(15000);

describe('HeliusClient', () => {
  let client: HeliusClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let mockLogger: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    client = new HeliusClient({
      apiKey: 'test-api-key',
      rpcUrl: 'https://test.helius-rpc.com',
      timeout: 5000,
      retries: 2,
      logger: mockLogger,
    });
  });

  describe('constructor', () => {
    it('should create client with default configuration', () => {
      const defaultClient = new HeliusClient({ apiKey: 'test' });
      const config = defaultClient.getConfig();
      
      expect(config.rpcUrl).toBe('https://mainnet.helius-rpc.com');
      expect(config.enhancedApiUrl).toBe('https://api.helius.xyz/v0');
      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(3);
    });

    it('should create client with custom configuration', () => {
      const config = client.getConfig();
      
      expect(config.apiKey).toBe('test-api-key');
      expect(config.rpcUrl).toBe('https://test.helius-rpc.com');
      expect(config.enhancedApiUrl).toBe('https://api.helius.xyz/v0');
      expect(config.timeout).toBe(5000);
      expect(config.retries).toBe(2);
      expect(config.logger).toBe(mockLogger);
    });

    it('should create client with custom enhanced API URL', () => {
      const customClient = new HeliusClient({
        apiKey: 'test',
        enhancedApiUrl: 'https://custom-enhanced-api.helius.xyz/v1'
      });
      const config = customClient.getConfig();
      
      expect(config.enhancedApiUrl).toBe('https://custom-enhanced-api.helius.xyz/v1');
    });
  });

  describe('getBalance', () => {
    it('should successfully get balance', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: 1000000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const balance = await client.getBalance(publicKey);

      expect(balance).toBe(1000000);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.helius-rpc.com?api-key=test-api-key',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: ['11111111111111111111111111111111'],
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getBalance(publicKey)).rejects.toThrow('Helius API Error (getBalance)');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getBalance(publicKey)).rejects.toThrow('Helius API Request Failed (getBalance)');
    });

    it('should retry on failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: 1000000,
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const balance = await client.getBalance(publicKey);

      expect(balance).toBe(1000000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should timeout after specified duration', async () => {
      // Mock a fetch that never resolves
      (fetch as jest.MockedFunction<typeof fetch>).mockImplementationOnce(() => new Promise(() => {}));

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getBalance(publicKey)).rejects.toThrow('No response received from fetch');
    });
  });

  describe('getAccountInfo', () => {
    it('should successfully get account info', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'base64data', owner: '11111111111111111111111111111111' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const accountInfo = await client.getAccountInfo(publicKey, 'base64');

      expect(accountInfo).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: ['11111111111111111111111111111111', { encoding: 'base64' }],
          }),
        })
      );
    });

    it('should parse Metaplex metadata when requested', async () => {
      // Mock metadata account data (simplified for test)
      const mockMetadataData = Buffer.alloc(150);
      mockMetadataData.writeUInt32LE(4, 65); // name length
      mockMetadataData.write('Test', 69); // name
      mockMetadataData.writeUInt32LE(3, 73); // symbol length
      mockMetadataData.write('TST', 77); // symbol
      mockMetadataData.writeUInt32LE(20, 80); // uri length
      mockMetadataData.write('https://example.com', 84); // uri
      mockMetadataData.writeUInt16LE(500, 104); // seller fee basis points
      mockMetadataData.writeUInt8(0, 106); // no creators
      mockMetadataData.writeUInt8(0, 107); // no collection
      mockMetadataData.writeUInt8(0, 108); // no uses
      mockMetadataData.writeUInt8(1, 109); // isMutable = true

      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            data: [mockMetadataData.toString('base64')],
            owner: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
            executable: false,
            lamports: 1000000,
            rentEpoch: 361,
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const metadata = await client.getAccountInfo(publicKey, { 
        parseMetaplexMetadata: true 
      });

      expect(metadata.name).toBe('Test');
      expect(metadata.symbol).toBe('TST');
      expect(metadata.uri).toBe('https://example.com');
      expect(metadata.sellerFeeBasisPoints).toBe(500);
      expect(metadata.isMutable).toBe(true);
    });

    it('should derive metadata account from mint address', async () => {
      // Mock mint account info
      const mockMintResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            data: 'base64data',
            owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            executable: false,
            lamports: 1000000,
            rentEpoch: 361,
          },
        },
      };

      // Mock metadata account info
      const mockMetadataData = Buffer.alloc(150);
      mockMetadataData.writeUInt32LE(4, 65);
      mockMetadataData.write('Test', 69);
      mockMetadataData.writeUInt32LE(3, 73);
      mockMetadataData.write('TST', 77);
      mockMetadataData.writeUInt32LE(20, 80);
      mockMetadataData.write('https://example.com', 84);
      mockMetadataData.writeUInt16LE(500, 104);
      mockMetadataData.writeUInt8(0, 106);
      mockMetadataData.writeUInt8(0, 107);
      mockMetadataData.writeUInt8(0, 108);
      mockMetadataData.writeUInt8(1, 109);

      const mockMetadataResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          value: {
            data: [mockMetadataData.toString('base64')],
            owner: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
            executable: false,
            lamports: 1000000,
            rentEpoch: 361,
          },
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMintResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadataResponse,
        } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const metadata = await client.getAccountInfo(publicKey, { 
        parseMetaplexMetadata: true 
      });

      expect(metadata.name).toBe('Test');
      expect(metadata.symbol).toBe('TST');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle backward compatibility with string encoding parameter', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { data: 'base64data', owner: '11111111111111111111111111111111' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const accountInfo = await client.getAccountInfo(publicKey, 'base58');

      expect(accountInfo).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: ['11111111111111111111111111111111', { encoding: 'base58' }],
          }),
        })
      );
    });
  });

  describe('getTransaction', () => {
    it('should successfully get transaction', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { slot: 12345, transaction: { signatures: ['sig'] } },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const signature = 'test-signature';
      const transaction = await client.getTransaction(signature, 'confirmed');

      expect(transaction).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTransaction',
            params: [signature, { commitment: 'confirmed' }],
          }),
        })
      );
    });
  });

  describe('getTransactions', () => {
    it('should successfully get transactions using enhanced API endpoint', async () => {
      const mockResponse = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactions(publicKey);

      expect(transactions).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should get transactions with limit option', async () => {
      const mockResponse = [{ signature: 'sig1', slot: 12345 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactions(publicKey, { limit: 10 });

      expect(transactions).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=10',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should get transactions with backward pagination options', async () => {
      const mockResponse = [{ signature: 'sig2', slot: 12346 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactions(publicKey, { 
        limit: 5, 
        before: 'sig1', 
        until: 'sig3' 
      });

      expect(transactions).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=5&before=sig1&until=sig3',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });



    it('should get transactions with only before parameter', async () => {
      const mockResponse = [{ signature: 'sig2', slot: 12346 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactions(publicKey, { 
        before: 'sig1'
      });

      expect(transactions).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&before=sig1',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should get transactions with only until parameter', async () => {
      const mockResponse = [{ signature: 'sig2', slot: 12346 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactions(publicKey, { 
        until: 'sig3'
      });

      expect(transactions).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&until=sig3',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should validate limit parameter', async () => {
      const publicKey = new PublicKey('11111111111111111111111111111111');
      
      await expect(client.getTransactions(publicKey, { limit: 0 })).rejects.toThrow('Limit must be greater than 0');
      await expect(client.getTransactions(publicKey, { limit: -1 })).rejects.toThrow('Limit must be greater than 0');
    });

    it('should validate before parameter', async () => {
      const publicKey = new PublicKey('11111111111111111111111111111111');
      
      await expect(client.getTransactions(publicKey, { before: '' })).rejects.toThrow('Before parameter must be a non-empty string');
      await expect(client.getTransactions(publicKey, { before: null as any })).rejects.toThrow('Before parameter must be a non-empty string');
    });

    it('should validate until parameter', async () => {
      const publicKey = new PublicKey('11111111111111111111111111111111');
      
      await expect(client.getTransactions(publicKey, { until: '' })).rejects.toThrow('Until parameter must be a non-empty string');
      await expect(client.getTransactions(publicKey, { until: null as any })).rejects.toThrow('Until parameter must be a non-empty string');
    });



    it('should log warning when both before and until are provided', async () => {
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const clientWithLogger = new HeliusClient({
        apiKey: 'test-api-key',
        logger: mockLogger
      });

      const mockResponse = [{ signature: 'sig2', slot: 12346 }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      await clientWithLogger.getTransactions(publicKey, { 
        before: 'sig1', 
        until: 'sig3' 
      });

      expect(mockLogger.warn).toHaveBeenCalledWith('Both before and until parameters are provided. This may result in unexpected behavior.');
    });



    it('should get all transactions with automatic pagination', async () => {
      // First batch - full page
      const firstBatch = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 },
        { signature: 'sig3', slot: 12347 }
      ];

      // Second batch - partial page (end of data)
      const secondBatch = [
        { signature: 'sig4', slot: 12348 },
        { signature: 'sig5', slot: 12349 }
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => firstBatch,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => secondBatch,
        } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const allTransactions = await client.getAllTransactions(publicKey, { limit: 3 });

      expect(allTransactions).toEqual([
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 },
        { signature: 'sig3', slot: 12347 },
        { signature: 'sig4', slot: 12348 },
        { signature: 'sig5', slot: 12349 }
      ]);

      // Verify first call (no before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=3',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Verify second call (with before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=3&before=sig3',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should get all transactions with default batch size', async () => {
      // Single batch with default limit (100)
      const mockResponse = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const allTransactions = await client.getAllTransactions(publicKey);

      expect(allTransactions).toEqual([
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=100',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });



    it('should handle empty result in getAllTransactions', async () => {
      const mockResponse: any[] = [];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const allTransactions = await client.getAllTransactions(publicKey);

      expect(allTransactions).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors in getAllTransactions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getAllTransactions(publicKey)).rejects.toThrow('Network Error');
    });

    it('should handle network errors in getAllTransactions', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getAllTransactions(publicKey)).rejects.toThrow('Network Error');
    });

    it('should handle API errors for getTransactions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTransactions(publicKey)).rejects.toThrow('Network Error');
    });

    it('should handle network errors for getTransactions', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTransactions(publicKey)).rejects.toThrow('Network Error');
    });

    it('should retry on getTransactions failure', async () => {
      const mockResponse = [{ signature: 'sig1', slot: 12345 }];

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactions(publicKey);

      expect(transactions).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSlot', () => {
    it('should successfully get slot', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: 12345,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const slot = await client.getSlot('processed');

      expect(slot).toBe(12345);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getSlot',
            params: [{ commitment: 'processed' }],
          }),
        })
      );
    });
  });

  describe('getClusterNodes', () => {
    it('should successfully get cluster nodes', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: [{ pubkey: 'node1', gossip: 'gossip1' }],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const nodes = await client.getClusterNodes();

      expect(nodes).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getClusterNodes',
            params: [],
          }),
        })
      );
    });
  });

  describe('getVersion', () => {
    it('should successfully get version', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { 'solana-core': '1.16.0' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const version = await client.getVersion();

      expect(version).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getVersion',
            params: [],
          }),
        })
      );
    });
  });

  describe('simulateTransaction', () => {
    it('should successfully simulate transaction', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          err: null,
          logs: ['Program 11111111111111111111111111111111 invoke [1]'],
          accounts: [
            {
              lamports: 1000000,
              owner: '11111111111111111111111111111111',
              executable: false,
              rentEpoch: 361,
            },
          ],
          unitsConsumed: 200000,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      transaction.add({
        keys: [{ pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: true, isWritable: true }],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.from([]),
      });

      const simulation = await client.simulateTransaction(transaction);

      expect(simulation).toEqual(mockResponse.result);
      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(typeof callBody.params[0]).toBe('string');
      expect(callBody.params[0].length).toBeGreaterThan(0);
    });

    it('should handle simulation errors', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          err: { InstructionError: [0, { Custom: 1 }] },
          logs: ['Program 11111111111111111111111111111111 invoke [1]'],
          accounts: [],
          unitsConsumed: 0,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      transaction.add({
        keys: [{ pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: true, isWritable: true }],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.from([]),
      });

      const simulation = await client.simulateTransaction(transaction);

      expect(simulation).toEqual(mockResponse.result);
      expect(simulation.err).toBeDefined();
    });

    it('should handle API errors during simulation', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      transaction.add({
        keys: [{ pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: true, isWritable: true }],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.from([]),
      });

      await expect(client.simulateTransaction(transaction)).rejects.toThrow('Helius API Error (simulateTransaction)');
    });

    it('should handle network errors during simulation', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      transaction.add({
        keys: [{ pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: true, isWritable: true }],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.from([]),
      });

      await expect(client.simulateTransaction(transaction)).rejects.toThrow('Helius API Request Failed (simulateTransaction)');
    });

    it('should retry on simulation failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          err: null,
          logs: ['Program 11111111111111111111111111111111 invoke [1]'],
          accounts: [],
          unitsConsumed: 200000,
        },
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      transaction.add({
        keys: [{ pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: true, isWritable: true }],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.from([]),
      });

      const simulation = await client.simulateTransaction(transaction);

      expect(simulation).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle empty transaction', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          err: null,
          logs: [],
          accounts: [],
          unitsConsumed: 0,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      const simulation = await client.simulateTransaction(transaction);

      expect(simulation).toEqual(mockResponse.result);
      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(typeof callBody.params[0]).toBe('string');
      expect(callBody.params[0].length).toBeGreaterThan(0);
    });

    it('should properly serialize transaction to base58', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { err: null, logs: [], accounts: [], unitsConsumed: 0 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = new PublicKey('11111111111111111111111111111111');
      transaction.add({
        keys: [{ pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: true, isWritable: true }],
        programId: new PublicKey('11111111111111111111111111111111'),
        data: Buffer.from([1, 2, 3, 4]),
      });

      await client.simulateTransaction(transaction);

      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      const decoded = Buffer.from(bs58.decode(callBody.params[0]));
      const expected = transaction.serialize({ requireAllSignatures: false });
      expect(decoded.equals(expected)).toBe(true);
    });
  });

  describe('getTokenAccount', () => {
    it('should successfully get token account', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: [{
            account: {
              data: 'base64data',
              executable: false,
              lamports: 1000000,
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              rentEpoch: 361,
            },
            pubkey: '11111111111111111111111111111111',
          }],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const owner = new PublicKey('11111111111111111111111111111111');
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC mint
      const tokenAccount = await client.getTokenAccount(owner, mint);

      expect(tokenAccount).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
              '11111111111111111111111111111111',
              { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
              { encoding: 'base64' }
            ],
          }),
        })
      );
    });

    it('should handle API errors for token account', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const owner = new PublicKey('11111111111111111111111111111111');
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      await expect(client.getTokenAccount(owner, mint)).rejects.toThrow('Helius API Error (getTokenAccountsByOwner)');
    });

    it('should handle network errors for token account', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const owner = new PublicKey('11111111111111111111111111111111');
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      await expect(client.getTokenAccount(owner, mint)).rejects.toThrow('Helius API Request Failed (getTokenAccountsByOwner)');
    });

    it('should retry on token account failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { value: [] },
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const owner = new PublicKey('11111111111111111111111111111111');
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const tokenAccount = await client.getTokenAccount(owner, mint);

      expect(tokenAccount).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTokenAccounts', () => {
    it('should successfully get token accounts by owner', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: [
            {
              account: {
                data: 'base64data1',
                executable: false,
                lamports: 1000000,
                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                rentEpoch: 361,
              },
              pubkey: '11111111111111111111111111111111',
            },
            {
              account: {
                data: 'base64data2',
                executable: false,
                lamports: 2000000,
                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                rentEpoch: 361,
              },
              pubkey: '22222222222222222222222222222222',
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const owner = new PublicKey('11111111111111111111111111111111');
      const tokenAccounts = await client.getTokenAccounts(owner);

      expect(tokenAccounts).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
              '11111111111111111111111111111111',
              { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
              { encoding: 'base64' }
            ],
          }),
        })
      );
    });

    it('should handle empty token accounts result', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { value: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const owner = new PublicKey('11111111111111111111111111111111');
      const tokenAccounts = await client.getTokenAccounts(owner);

      expect(tokenAccounts).toEqual(mockResponse.result);
      expect(tokenAccounts.value).toHaveLength(0);
    });

    it('should handle API errors for token accounts', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const owner = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTokenAccounts(owner)).rejects.toThrow('Helius API Error (getTokenAccountsByOwner)');
    });
  });

  describe('getTokenAccountBalance', () => {
    it('should successfully get token account balance', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000',
            decimals: 9,
            uiAmount: 1.0,
            uiAmountString: '1',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = new PublicKey('11111111111111111111111111111111');
      const balance = await client.getTokenAccountBalance(tokenAccount);

      expect(balance).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountBalance',
            params: ['11111111111111111111111111111111'],
          }),
        })
      );
    });

    it('should handle zero balance', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '0',
            decimals: 9,
            uiAmount: 0,
            uiAmountString: '0',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = new PublicKey('11111111111111111111111111111111');
      const balance = await client.getTokenAccountBalance(tokenAccount);

      expect(balance).toEqual(mockResponse.result);
      expect(balance.value.amount).toBe('0');
      expect(balance.value.uiAmount).toBe(0);
    });

    it('should handle large balance values', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '999999999999999999',
            decimals: 18,
            uiAmount: 0.999999999999999999,
            uiAmountString: '0.999999999999999999',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = new PublicKey('11111111111111111111111111111111');
      const balance = await client.getTokenAccountBalance(tokenAccount);

      expect(balance).toEqual(mockResponse.result);
      expect(balance.value.amount).toBe('999999999999999999');
      expect(balance.value.decimals).toBe(18);
    });

    it('should handle API errors for token account balance', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTokenAccountBalance(tokenAccount)).rejects.toThrow('Helius API Error (getTokenAccountBalance)');
    });

    it('should handle network errors for token account balance', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const tokenAccount = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTokenAccountBalance(tokenAccount)).rejects.toThrow('Helius API Request Failed (getTokenAccountBalance)');
    });

    it('should retry on token account balance failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000',
            decimals: 9,
            uiAmount: 1.0,
            uiAmountString: '1',
          },
        },
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const tokenAccount = new PublicKey('11111111111111111111111111111111');
      const balance = await client.getTokenAccountBalance(tokenAccount);

      expect(balance).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('logging', () => {
    it('should log requests and responses when logger is provided', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: 1000000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      await client.getBalance(publicKey);

      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1:', expect.any(Object));
      expect(mockLogger.debug).toHaveBeenCalledWith('Response 1:', mockResponse);
    });

    it('should log errors when logger is provided', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getBalance(publicKey)).rejects.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith('Request 1 attempt 1 failed:', expect.any(Error));
      expect(mockLogger.error).toHaveBeenCalledWith('Request 1 failed after 2 attempts:', expect.any(Error));
    });
  });

  describe('request ID tracking', () => {
    it('should increment request IDs', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: 1000000,
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      
      await client.getBalance(publicKey);
      await client.getBalance(publicKey);

      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1:', expect.any(Object));
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 2:', expect.any(Object));
    });
  });

  describe('getTopHolders', () => {
    it('should successfully get top token holders', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: [
            {
              address: '11111111111111111111111111111111',
              amount: '1000000000',
              decimals: 9,
              uiAmount: 1.0,
              uiAmountString: '1',
            },
            {
              address: '22222222222222222222222222222222',
              amount: '500000000',
              decimals: 9,
              uiAmount: 0.5,
              uiAmountString: '0.5',
            },
          ],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC mint
      const holders = await client.getTopHolders(tokenAddress);

      expect(holders).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenLargestAccounts',
            params: [tokenAddress],
          }),
        })
      );
    });

    it('should handle empty holders result', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { value: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const holders = await client.getTopHolders(tokenAddress);

      expect(holders).toEqual(mockResponse.result);
      expect(holders.value).toHaveLength(0);
    });

    it('should handle API errors for top holders', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      await expect(client.getTopHolders(tokenAddress)).rejects.toThrow('Helius API Error (getTokenLargestAccounts)');
    });

    it('should handle network errors for top holders', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      await expect(client.getTopHolders(tokenAddress)).rejects.toThrow('Helius API Request Failed (getTokenLargestAccounts)');
    });

    it('should retry on top holders failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { value: [] },
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const holders = await client.getTopHolders(tokenAddress);

      expect(holders).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTokenAccountOwner', () => {
    it('should successfully get token account owner', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: {
            parsed: {
              info: {
                owner: '11111111111111111111111111111111',
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                state: 'initialized',
                tokenAmount: {
                  amount: '1000000000',
                  decimals: 9,
                  uiAmount: 1.0,
                  uiAmountString: '1',
                },
              },
              type: 'account',
            },
          },
          executable: false,
          lamports: 1000000,
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          rentEpoch: 361,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = '11111111111111111111111111111111';
      const owner = await client.getTokenAccountOwner(tokenAccount);

      expect(owner).toBe('11111111111111111111111111111111');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: [tokenAccount, { encoding: 'jsonParsed' }],
          }),
        })
      );
    });

    it('should handle invalid token account data', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: null, // Account doesn't exist
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = '11111111111111111111111111111111';

      await expect(client.getTokenAccountOwner(tokenAccount)).rejects.toThrow('Invalid token account data');
    });

    it('should handle malformed token account data', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: {
            parsed: {
              info: {
                // Missing owner field
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              },
            },
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = '11111111111111111111111111111111';

      await expect(client.getTokenAccountOwner(tokenAccount)).rejects.toThrow('Invalid token account data');
    });

    it('should handle non-parsed account data', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: 'base64data', // Not parsed
          executable: false,
          lamports: 1000000,
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          rentEpoch: 361,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = '11111111111111111111111111111111';

      await expect(client.getTokenAccountOwner(tokenAccount)).rejects.toThrow('Invalid token account data');
    });

    it('should handle API errors for token account owner', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAccount = '11111111111111111111111111111111';

      await expect(client.getTokenAccountOwner(tokenAccount)).rejects.toThrow('Helius API Error (getAccountInfo)');
    });

    it('should handle network errors for token account owner', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const tokenAccount = '11111111111111111111111111111111';

      await expect(client.getTokenAccountOwner(tokenAccount)).rejects.toThrow('Helius API Request Failed (getAccountInfo)');
    });

    it('should retry on token account owner failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: {
            parsed: {
              info: {
                owner: '11111111111111111111111111111111',
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              },
            },
          },
        },
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const tokenAccount = '11111111111111111111111111111111';
      const owner = await client.getTokenAccountOwner(tokenAccount);

      expect(owner).toBe('11111111111111111111111111111111');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTokenSupply', () => {
    it('should successfully get token supply', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000000000000000000',
            decimals: 9,
            uiAmount: 1000000000,
            uiAmountString: '1000000000',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC mint
      const supply = await client.getTokenSupply(tokenAddress);

      expect(supply).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenSupply',
            params: [tokenAddress],
          }),
        })
      );
    });

    it('should handle API errors for token supply', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      await expect(client.getTokenSupply(tokenAddress)).rejects.toThrow('Helius API Error (getTokenSupply)');
    });

    it('should handle network errors for token supply', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      await expect(client.getTokenSupply(tokenAddress)).rejects.toThrow('Helius API Request Failed (getTokenSupply)');
    });

    it('should retry on token supply failure', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000000000000000000',
            decimals: 9,
            uiAmount: 1000000000,
            uiAmountString: '1000000000',
          },
        },
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const supply = await client.getTokenSupply(tokenAddress);

      expect(supply).toEqual(mockResponse.result);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTokenInfo', () => {
    it('should successfully get token info with decimals', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000000000000000000',
            decimals: 9,
            uiAmount: 1000000000,
            uiAmountString: '1000000000',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const tokenInfo = await client.getTokenInfo(tokenAddress);

      expect(tokenInfo).toEqual({ decimals: 9 });
    });

    it('should return null when decimals not found', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000000000000000000',
            // Missing decimals
            uiAmount: 1000000000,
            uiAmountString: '1000000000',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const tokenInfo = await client.getTokenInfo(tokenAddress);

      expect(tokenInfo).toBeNull();
    });

    it('should return null when API error occurs', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const tokenInfo = await client.getTokenInfo(tokenAddress);

      expect(tokenInfo).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Failed to get token info for ${tokenAddress}:`,
        expect.any(Error)
      );
    });

    it('should return null when network error occurs', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const tokenInfo = await client.getTokenInfo(tokenAddress);

      expect(tokenInfo).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Failed to get token info for ${tokenAddress}:`,
        expect.any(Error)
      );
    });

    it('should handle different decimal values', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: {
            amount: '1000000000000000000000000',
            decimals: 18, // Different decimal value
            uiAmount: 1,
            uiAmountString: '1',
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const tokenInfo = await client.getTokenInfo(tokenAddress);

      expect(tokenInfo).toEqual({ decimals: 18 });
    });
  });

  describe('getAsset', () => {
    it('should successfully get asset data', async () => {
      const mockResponse = [
        {
          onChainMetadata: {
            metadata: {
              name: 'Test NFT',
              symbol: 'TNFT',
              uri: 'https://example.com/metadata.json',
            },
            tokenStandard: 'NonFungible',
            mint: '11111111111111111111111111111111',
          },
          offChainMetadata: {
            metadata: {
              name: 'Test NFT',
              symbol: 'TNFT',
              description: 'A test NFT',
              image: 'https://example.com/image.png',
            },
            uri: 'https://example.com/metadata.json',
          },
          legacyMetadata: null,
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const assetId = '11111111111111111111111111111111';
      const assetData = await client.getAsset(assetId);

      expect(assetData).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/token-metadata?api-key=test-api-key',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mintAccounts: [assetId],
            includeOffChain: true,
            disableCache: false
          })
        })
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({}),
      } as Response);

      const assetId = '11111111111111111111111111111111';

      await expect(client.getAsset(assetId)).rejects.toThrow('Network Error: No response received from fetch');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const assetId = '11111111111111111111111111111111';

      await expect(client.getAsset(assetId)).rejects.toThrow('Network Error: No response received from fetch');
    });

    it('should retry on failure', async () => {
      const mockResponse = [
        {
          onChainMetadata: {
            metadata: {
              name: 'Test NFT',
              symbol: 'TNFT',
            },
            tokenStandard: 'NonFungible',
            mint: '11111111111111111111111111111111',
          },
        }
      ];

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const assetId = '11111111111111111111111111111111';
      const assetData = await client.getAsset(assetId);

      expect(assetData).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should timeout after specified duration', async () => {
      // Mock a fetch that never resolves
      (fetch as jest.MockedFunction<typeof fetch>).mockImplementationOnce(() => new Promise(() => {}));

      const assetId = '11111111111111111111111111111111';

      await expect(client.getAsset(assetId)).rejects.toThrow('Network Error: No response received from fetch');
    });
  });

  describe('getWalletTokenData', () => {
    it('should successfully get wallet token data', async () => {
      const walletAddress = '11111111111111111111111111111111';
      
      // Mock SOL account info response
      const solAccountResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: 'base64data',
          executable: false,
          lamports: 1000000,
          owner: '11111111111111111111111111111111',
          rentEpoch: 361,
        },
      };

      // Mock SPL token accounts response
      const splTokenResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          context: { slot: 12345 },
          value: [
            {
              account: {
                data: 'base64data1',
                executable: false,
                lamports: 1000000,
                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                rentEpoch: 361,
              },
              pubkey: '22222222222222222222222222222222',
            },
          ],
        },
      };

      // Mock Token-2022 accounts response
      const token2022Response = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          context: { slot: 12345 },
          value: [
            {
              account: {
                data: 'base64data2',
                executable: false,
                lamports: 2000000,
                owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                rentEpoch: 361,
              },
              pubkey: '33333333333333333333333333333333',
            },
          ],
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => solAccountResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => splTokenResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => token2022Response,
        } as Response);

      const walletData = await client.getWalletTokenData(walletAddress);

      expect(walletData).toEqual({
        owner: walletAddress,
        solAccountInfo: solAccountResponse.result,
        tokenAccounts: {
          context: splTokenResponse.result.context,
          value: [
            ...splTokenResponse.result.value,
            ...token2022Response.result.value,
          ],
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle API errors for wallet token data', async () => {
      const walletAddress = '11111111111111111111111111111111';
      
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'Method not found' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await expect(client.getWalletTokenData(walletAddress)).rejects.toThrow('Helius API Error (getAccountInfo)');
    });

    it('should handle network errors for wallet token data', async () => {
      const walletAddress = '11111111111111111111111111111111';
      
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getWalletTokenData(walletAddress)).rejects.toThrow('Helius API Request Failed (getAccountInfo)');
    });

    it('should handle empty token accounts', async () => {
      const walletAddress = '11111111111111111111111111111111';
      
      // Mock SOL account info response
      const solAccountResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: 'base64data',
          executable: false,
          lamports: 1000000,
          owner: '11111111111111111111111111111111',
          rentEpoch: 361,
        },
      };

      // Mock empty SPL token accounts response
      const splTokenResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          context: { slot: 12345 },
          value: [],
        },
      };

      // Mock empty Token-2022 accounts response
      const token2022Response = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          context: { slot: 12345 },
          value: [],
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => solAccountResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => splTokenResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => token2022Response,
        } as Response);

      const walletData = await client.getWalletTokenData(walletAddress);

      expect(walletData).toEqual({
        owner: walletAddress,
        solAccountInfo: solAccountResponse.result,
        tokenAccounts: {
          context: splTokenResponse.result.context,
          value: [],
        },
      });
    });

    it('should retry on wallet token data failure', async () => {
      const walletAddress = '11111111111111111111111111111111';
      
      // Mock SOL account info response
      const solAccountResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          data: 'base64data',
          executable: false,
          lamports: 1000000,
          owner: '11111111111111111111111111111111',
          rentEpoch: 361,
        },
      };

      // Mock SPL token accounts response
      const splTokenResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          context: { slot: 12345 },
          value: [],
        },
      };

      // Mock Token-2022 accounts response
      const token2022Response = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          context: { slot: 12345 },
          value: [],
        },
      };

      // First call fails, subsequent calls succeed
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => solAccountResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => splTokenResponse,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => token2022Response,
        } as Response);

      const walletData = await client.getWalletTokenData(walletAddress);

      expect(walletData).toEqual({
        owner: walletAddress,
        solAccountInfo: solAccountResponse.result,
        tokenAccounts: {
          context: splTokenResponse.result.context,
          value: [],
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('getTransactionsWithLimit', () => {
    it('should get specific number of transactions with pagination', async () => {
      // First batch - full page
      const firstBatch = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 },
        { signature: 'sig3', slot: 12347 }
      ];

      // Second batch - partial page to reach total limit
      const secondBatch = [
        { signature: 'sig4', slot: 12348 },
        { signature: 'sig5', slot: 12349 }
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => firstBatch,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => secondBatch,
        } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactionsWithLimit(publicKey, 5, {}, 3);

      expect(transactions).toEqual([
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 },
        { signature: 'sig3', slot: 12347 },
        { signature: 'sig4', slot: 12348 },
        { signature: 'sig5', slot: 12349 }
      ]);

      // Verify first call (no before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=3',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Verify second call (with before parameter, adjusted batch size)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=2&before=sig3',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should get transactions with limit when total is less than batch size', async () => {
      const mockResponse = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactionsWithLimit(publicKey, 2, {}, 100);

      expect(transactions).toEqual([
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=2',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });



    it('should handle empty result in getTransactionsWithLimit', async () => {
      const mockResponse: any[] = [];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactionsWithLimit(publicKey, 10);

      expect(transactions).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors in getTransactionsWithLimit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTransactionsWithLimit(publicKey, 10)).rejects.toThrow('Network Error');
    });

    it('should handle network errors in getTransactionsWithLimit', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const publicKey = new PublicKey('11111111111111111111111111111111');

      await expect(client.getTransactionsWithLimit(publicKey, 10)).rejects.toThrow('Network Error');
    });

    it('should validate batch size parameter', async () => {
      const publicKey = new PublicKey('11111111111111111111111111111111');
      
      await expect(client.getTransactionsWithLimit(publicKey, 10, {}, 0)).rejects.toThrow('Batch size must be between 1 and 100');
      await expect(client.getTransactionsWithLimit(publicKey, 10, {}, -1)).rejects.toThrow('Batch size must be between 1 and 100');
      await expect(client.getTransactionsWithLimit(publicKey, 10, {}, 101)).rejects.toThrow('Batch size must be between 1 and 100');
    });

    it('should use default batch size of 10 when not specified', async () => {
      const mockResponse = [
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactionsWithLimit(publicKey, 2);

      expect(transactions).toEqual([
        { signature: 'sig1', slot: 12345 },
        { signature: 'sig2', slot: 12346 }
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=2',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should properly paginate for large limits with custom batch size', async () => {
      // Simulate fetching 1000 transactions with batch size of 50 (20 API calls)
      const batchSize = 50;
      const totalLimit = 1000;
      const numBatches = Math.ceil(totalLimit / batchSize);
      
      // Create mock responses for each batch
      for (let i = 0; i < numBatches; i++) {
        const startIndex = i * batchSize;
        const endIndex = Math.min(startIndex + batchSize, totalLimit);
        const batchSizeActual = endIndex - startIndex;
        
        const batchTransactions = Array.from({ length: batchSizeActual }, (_, j) => ({
          signature: `sig${startIndex + j + 1}`,
          slot: 12345 + startIndex + j
        }));

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => batchTransactions,
        } as Response);
      }

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactionsWithLimit(publicKey, totalLimit, {}, batchSize);

      // Verify we got the expected number of transactions
      expect(transactions).toHaveLength(totalLimit);
      
      // Verify the first and last transactions
      expect(transactions[0]).toEqual({ signature: 'sig1', slot: 12345 });
      expect(transactions[totalLimit - 1]).toEqual({ signature: `sig${totalLimit}`, slot: 12345 + totalLimit - 1 });

      // Verify the number of API calls made
      expect(mockFetch).toHaveBeenCalledTimes(numBatches);

      // Verify the first call (no before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=50',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Verify the second call (with before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=50&before=sig50',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Verify the last call
      expect(mockFetch).toHaveBeenNthCalledWith(
        numBatches,
        `https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=50&before=sig${(numBatches - 1) * batchSize}`,
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should handle real-world pagination scenario with limited available transactions', async () => {
      // Simulate a wallet with only 296 transactions available
      const availableTransactions = 296;
      const requestedLimit = 10000;
      const batchSize = 100;
      const numBatches = Math.ceil(availableTransactions / batchSize); // 3 batches: 100, 100, 96
      
      // Create mock responses for each batch
      for (let i = 0; i < numBatches; i++) {
        const startIndex = i * batchSize;
        const endIndex = Math.min(startIndex + batchSize, availableTransactions);
        const batchSizeActual = endIndex - startIndex;
        
        const batchTransactions = Array.from({ length: batchSizeActual }, (_, j) => ({
          signature: `sig${startIndex + j + 1}`,
          slot: 12345 + startIndex + j
        }));

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => batchTransactions,
        } as Response);
      }

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const transactions = await client.getTransactionsWithLimit(publicKey, requestedLimit, {}, batchSize);

      // Verify we got all available transactions (296), not the requested limit (10000)
      expect(transactions).toHaveLength(availableTransactions);
      
      // Verify the first and last transactions
      expect(transactions[0]).toEqual({ signature: 'sig1', slot: 12345 });
      expect(transactions[availableTransactions - 1]).toEqual({ signature: `sig${availableTransactions}`, slot: 12345 + availableTransactions - 1 });

      // Verify the number of API calls made (should be 3, not more)
      expect(mockFetch).toHaveBeenCalledTimes(numBatches);

      // Verify the first call (no before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=100',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Verify the second call (with before parameter)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=100&before=sig100',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Verify the third call (final batch, requests 100 but gets 96)
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'https://api.helius.xyz/v0/addresses/11111111111111111111111111111111/transactions?api-key=test-api-key&limit=100&before=sig200',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });
  });

  describe('Transaction Pagination', () => {
    it('should handle pagination gaps correctly', async () => {
      const client = new HeliusClient({
        apiKey: 'test-api-key',
        logger: mockLogger
      });

      // Mock the getTransactions method to simulate pagination with gaps
      const batch1 = [
        { signature: 'sig1', slot: 1, timestamp: 1000, description: 'tx1', nativeTransfers: [], tokenTransfers: [] },
        { signature: 'sig2', slot: 2, timestamp: 1001, description: 'tx2', nativeTransfers: [], tokenTransfers: [] },
      ];
      
      const batch2 = [
        { signature: 'sig5', slot: 5, timestamp: 1004, description: 'tx5', nativeTransfers: [], tokenTransfers: [] }, // Note: sig3, sig4 are missing
        { signature: 'sig6', slot: 6, timestamp: 1005, description: 'tx6', nativeTransfers: [], tokenTransfers: [] },
      ];

      // Mock the makeRestRequest method to return different batches
      const mockMakeRestRequest = jest.fn()
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2);

      (client as any).makeRestRequest = mockMakeRestRequest;

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const result = await client.getTransactionsWithLimit(publicKey, 10, {}, 2);

      expect(result).toHaveLength(4);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Potential gap detected between batches')
      );
    });

    it('should use robust pagination method when gaps are detected', async () => {
      const client = new HeliusClient({
        apiKey: 'test-api-key',
        logger: mockLogger
      });

      // Mock the getTransactions method to simulate pagination with gaps
      const batch1 = [
        { signature: 'sig1', slot: 1, timestamp: 1000, description: 'tx1', nativeTransfers: [], tokenTransfers: [] },
        { signature: 'sig2', slot: 2, timestamp: 1001, description: 'tx2', nativeTransfers: [], tokenTransfers: [] },
      ];

      // Mock the makeRestRequest method to return different batches
      const mockMakeRestRequest = jest.fn()
        .mockResolvedValueOnce(batch1);

      (client as any).makeRestRequest = mockMakeRestRequest;

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const result = await client.getTransactionsWithLimitRobust(publicKey, 10, {}, 2);

      expect(result).toHaveLength(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Robust Batch')
      );
    });

    it('should analyze pagination behavior correctly', async () => {
      const client = new HeliusClient({
        apiKey: 'test-api-key',
        logger: mockLogger
      });

      // Mock the getTransactions method to simulate pagination with gaps
      const batch1 = [
        { signature: 'sig1', slot: 1, timestamp: 1000, description: 'tx1', nativeTransfers: [], tokenTransfers: [] },
        { signature: 'sig2', slot: 2, timestamp: 1001, description: 'tx2', nativeTransfers: [], tokenTransfers: [] },
      ];

      // Mock the makeRestRequest method to return different batches
      const mockMakeRestRequest = jest.fn()
        .mockResolvedValueOnce(batch1);

      (client as any).makeRestRequest = mockMakeRestRequest;

      const publicKey = new PublicKey('11111111111111111111111111111111');
      const analysis = await client.analyzeTransactionPagination(publicKey, 10, 2);

      expect(analysis.totalTransactions).toBe(2);
      expect(analysis.batches).toBe(2);
      expect(analysis.gaps).toHaveLength(0);
      expect(analysis.recommendations).toBeDefined();
    });
  });
});

describe('HeliusClient Transfer Methods', () => {
    let client: HeliusClient;
    let mockKeypair: Keypair;
    let mockToPublicKey: PublicKey;
    let mockMint: PublicKey;

    beforeEach(() => {
        client = new HeliusClient({
            apiKey: 'test-api-key',
            rpcUrl: 'https://test.helius-rpc.com',
            enhancedApiUrl: 'https://test.api.helius.xyz/v0'
        });

        // Create mock keypair and public keys
        mockKeypair = Keypair.generate();
        mockToPublicKey = new PublicKey('11111111111111111111111111111111');
        mockMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC mint

        // Reset fetch mock
        (fetch as jest.Mock).mockReset();
    });

    describe('sendNativeTransfer', () => {
        it('should send native SOL transfer successfully', async () => {
            const mockSignature = 'test-signature-123';
            const amount = 1000000; // 0.001 SOL

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            // Mock the sendTransaction method
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendNativeTransfer(
                mockKeypair,
                mockToPublicKey,
                amount
            );

            expect(result).toBe(mockSignature);
            expect(client.getLatestBlockhash).toHaveBeenCalled();
            expect(client.sendTransaction).toHaveBeenCalledWith(
                expect.any(Transaction),
                {}
            );

            // Verify the transaction was constructed correctly
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.instructions).toHaveLength(1);
            expect(transactionCall.instructions[0].programId.toString()).toBe('11111111111111111111111111111111'); // System Program
        });

        it('should send native SOL transfer with custom options', async () => {
            const mockSignature = 'test-signature-456';
            const amount = 2000000; // 0.002 SOL
            const options = {
                skipPreflight: true,
                preflightCommitment: 'finalized' as const
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendNativeTransfer(
                mockKeypair,
                mockToPublicKey,
                amount,
                options
            );

            expect(result).toBe(mockSignature);
            expect(client.sendTransaction).toHaveBeenCalledWith(
                expect.any(Transaction),
                options
            );
        });

        it('should handle sendTransaction errors', async () => {
            const error = new Error('Transaction failed');
            
            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'sendTransaction').mockRejectedValue(error);

            await expect(
                client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000)
            ).rejects.toThrow('Transaction failed');
        });

        it('should handle getLatestBlockhash errors', async () => {
            const error = new Error('Failed to get blockhash');
            jest.spyOn(client, 'getLatestBlockhash').mockRejectedValue(error);

            await expect(
                client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000)
            ).rejects.toThrow('Failed to get blockhash');
        });

        it('should handle zero amount transfer', async () => {
            const mockSignature = 'test-signature-zero';
            
            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendNativeTransfer(
                mockKeypair,
                mockToPublicKey,
                0
            );

            expect(result).toBe(mockSignature);
            
            // Verify the transaction was constructed with zero amount
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.instructions).toHaveLength(1);
            const instruction = transactionCall.instructions[0];
            expect(instruction.data).toBeDefined();
        });

        it('should handle very large amount transfer', async () => {
            const mockSignature = 'test-signature-large';
            const largeAmount = Number.MAX_SAFE_INTEGER;
            
            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendNativeTransfer(
                mockKeypair,
                mockToPublicKey,
                largeAmount
            );

            expect(result).toBe(mockSignature);
        });

        it('should properly set transaction fee payer', async () => {
            const mockSignature = 'test-signature-fee-payer';
            
            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            await client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000);

            // Verify the transaction was constructed correctly
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.feePayer?.toString()).toBe(mockKeypair.publicKey.toString());
            expect(transactionCall.recentBlockhash).toBe('11111111111111111111111111111111');
        });

        it('should handle network timeout during blockhash retrieval', async () => {
            const error = new Error('Network timeout');
            jest.spyOn(client, 'getLatestBlockhash').mockRejectedValue(error);

            await expect(
                client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000)
            ).rejects.toThrow('Network timeout');
        });

        it('should verify blockhash is set before signing', async () => {
            const mockSignature = 'test-signature-blockhash-verify';
            const mockBlockhash = '11111111111111111111111111111111'; // Valid base58 string
            
            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: mockBlockhash,
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            await client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000);

            // Verify the transaction was constructed correctly
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.recentBlockhash).toBe(mockBlockhash);
            expect(transactionCall.recentBlockhash).toBeDefined();
            expect(transactionCall.recentBlockhash).not.toBeNull();
        });

        it('should handle invalid blockhash response', async () => {
            // Mock getLatestBlockhash to return invalid response
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: null,
                lastValidBlockHeight: 1000
            });

            await expect(
                client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000)
            ).rejects.toThrow('Failed to get valid blockhash after 3 attempts');
        });

        it('should handle missing blockhash response', async () => {
            // Mock getLatestBlockhash to return undefined
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue(undefined);

            await expect(
                client.sendNativeTransfer(mockKeypair, mockToPublicKey, 1000000)
            ).rejects.toThrow('Failed to get valid blockhash after 3 attempts');
        });
    });

    describe('sendTokenTransfer', () => {
        it('should send SPL token transfer successfully', async () => {
            const mockSignature = 'token-signature-123';
            const amount = 1000000; // 1 USDC
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111111',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: '1000000'
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: 1000000,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            // Mock getTokenAccount to return a valid token account
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendTokenTransfer(
                mockToPublicKey,
                mockKeypair,
                amount,
                mockMint
            );

            expect(result).toBe(mockSignature);
            expect(client.getLatestBlockhash).toHaveBeenCalled();
            expect(client.getTokenAccount).toHaveBeenCalledWith(mockKeypair.publicKey, mockMint);
            expect(client.sendTransaction).toHaveBeenCalledWith(
                expect.any(Transaction),
                {}
            );

            // Verify the transaction was constructed correctly
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.instructions).toHaveLength(1);
            expect(transactionCall.instructions[0].programId.toString()).toBe(TOKEN_PROGRAM_ID.toString());
        });

        it('should send SPL token transfer with custom options', async () => {
            const mockSignature = 'token-signature-456';
            const amount = 2000000; // 2 USDC
            const options = {
                skipPreflight: false,
                preflightCommitment: 'confirmed' as const
            };
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111112',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: '2000000'
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: 2000000,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendTokenTransfer(
                mockToPublicKey,
                mockKeypair,
                amount,
                mockMint,
                options
            );

            expect(result).toBe(mockSignature);
            expect(client.sendTransaction).toHaveBeenCalledWith(
                expect.any(Transaction),
                options
            );
        });

        it('should throw error when no token account found', async () => {
            // Mock getTokenAccount to return empty result
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue({ value: [] });

            await expect(
                client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint)
            ).rejects.toThrow(`No token account found for owner ${mockKeypair.publicKey.toString()} and mint ${mockMint.toString()}`);
        });

        it('should throw error when token account response is invalid', async () => {
            // Mock getTokenAccount to return null
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(null);

            await expect(
                client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint)
            ).rejects.toThrow(`No token account found for owner ${mockKeypair.publicKey.toString()} and mint ${mockMint.toString()}`);
        });

        it('should handle getTokenAccount errors', async () => {
            const error = new Error('Failed to get token account');
            jest.spyOn(client, 'getTokenAccount').mockRejectedValue(error);

            await expect(
                client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint)
            ).rejects.toThrow('Failed to get token account');
        });

        it('should handle sendTransaction errors', async () => {
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111113',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: '1000000'
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: 1000000,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            const error = new Error('Token transfer failed');
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockRejectedValue(error);

            await expect(
                client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint)
            ).rejects.toThrow('Token transfer failed');
        });

        it('should handle getLatestBlockhash errors', async () => {
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111114',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: '1000000'
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: 1000000,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            const error = new Error('Failed to get blockhash');
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'getLatestBlockhash').mockRejectedValue(error);

            await expect(
                client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint)
            ).rejects.toThrow('Failed to get blockhash');
        });

        it('should handle zero amount token transfer', async () => {
            const mockSignature = 'token-signature-zero';
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111115',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: '0'
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: 0,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendTokenTransfer(
                mockToPublicKey,
                mockKeypair,
                0,
                mockMint
            );

            expect(result).toBe(mockSignature);
        });

        it('should handle very large amount token transfer', async () => {
            const mockSignature = 'token-signature-large';
            const largeAmount = Number.MAX_SAFE_INTEGER;
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111116',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: largeAmount.toString()
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: largeAmount,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendTokenTransfer(
                mockToPublicKey,
                mockKeypair,
                largeAmount,
                mockMint
            );

            expect(result).toBe(mockSignature);
        });

        it('should properly set transaction fee payer for token transfer', async () => {
            const mockSignature = 'token-signature-fee-payer';
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [{
                    pubkey: '11111111111111111111111111111117',
                    account: {
                        data: {
                            parsed: {
                                info: {
                                    mint: mockMint.toString(),
                                    owner: mockKeypair.publicKey.toString(),
                                    amount: '1000000'
                                }
                            }
                        },
                        owner: TOKEN_PROGRAM_ID.toString(),
                        lamports: 1000000,
                        executable: false,
                        rentEpoch: 0
                    }
                }]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            await client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint);

            // Verify the transaction was constructed correctly
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.feePayer?.toString()).toBe(mockKeypair.publicKey.toString());
            expect(transactionCall.recentBlockhash).toBe('11111111111111111111111111111111');
        });

        it('should handle token account with multiple accounts (use first one)', async () => {
            const mockSignature = 'token-signature-multiple';
            const mockTokenAccount = {
                context: { slot: 1 },
                value: [
                    {
                        pubkey: '11111111111111111111111111111118',
                        account: {
                            data: {
                                parsed: {
                                    info: {
                                        mint: mockMint.toString(),
                                        owner: mockKeypair.publicKey.toString(),
                                        amount: '1000000'
                                    }
                                }
                            },
                            owner: TOKEN_PROGRAM_ID.toString(),
                            lamports: 1000000,
                            executable: false,
                            rentEpoch: 0
                        }
                    },
                    {
                        pubkey: '11111111111111111111111111111119',
                        account: {
                            data: {
                                parsed: {
                                    info: {
                                        mint: mockMint.toString(),
                                        owner: mockKeypair.publicKey.toString(),
                                        amount: '2000000'
                                    }
                                }
                            },
                            owner: TOKEN_PROGRAM_ID.toString(),
                            lamports: 2000000,
                            executable: false,
                            rentEpoch: 0
                        }
                    }
                ]
            };

            // Mock getLatestBlockhash for transaction signing
            jest.spyOn(client, 'getLatestBlockhash').mockResolvedValue({
                blockhash: '11111111111111111111111111111111',
                lastValidBlockHeight: 1000
            });
            
            jest.spyOn(client, 'getTokenAccount').mockResolvedValue(mockTokenAccount);
            jest.spyOn(client, 'sendTransaction').mockResolvedValue(mockSignature);

            const result = await client.sendTokenTransfer(
                mockToPublicKey,
                mockKeypair,
                1000000,
                mockMint
            );

            expect(result).toBe(mockSignature);
            
            // Verify the first token account was used
            const transactionCall = (client.sendTransaction as jest.Mock).mock.calls[0][0];
            expect(transactionCall.instructions).toHaveLength(1);
        });

        it('should handle network timeout during token account retrieval', async () => {
            const error = new Error('Network timeout');
            jest.spyOn(client, 'getTokenAccount').mockRejectedValue(error);

            await expect(
                client.sendTokenTransfer(mockToPublicKey, mockKeypair, 1000000, mockMint)
            ).rejects.toThrow('Network timeout');
        });
    });

    describe('Integration tests', () => {
        it('should handle real transaction serialization', async () => {
            const mockSignature = 'real-signature-123';
            const amount = 1000000;

            // Mock getLatestBlockhash for transaction signing
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    jsonrpc: '2.0',
                    id: 1,
                    result: {
                        blockhash: '11111111111111111111111111111111',
                        lastValidBlockHeight: 1000
                    }
                })
            });

            // Mock the actual RPC call
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    jsonrpc: '2.0',
                    id: 2,
                    result: mockSignature
                })
            });

            const result = await client.sendNativeTransfer(
                mockKeypair,
                mockToPublicKey,
                amount
            );

            expect(result).toBe(mockSignature);
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('test.helius-rpc.com'),
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: expect.stringContaining('sendTransaction')
                })
            );
        });


    });
}); 