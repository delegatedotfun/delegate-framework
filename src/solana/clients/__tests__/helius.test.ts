import { HeliusClient } from '../helius';
import { PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

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
      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(3);
    });

    it('should create client with custom configuration', () => {
      const config = client.getConfig();
      
      expect(config.apiKey).toBe('test-api-key');
      expect(config.rpcUrl).toBe('https://test.helius-rpc.com');
      expect(config.timeout).toBe(5000);
      expect(config.retries).toBe(2);
      expect(config.logger).toBe(mockLogger);
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
}); 