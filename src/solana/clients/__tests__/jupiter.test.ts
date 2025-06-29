import { JupiterClient } from '../jupiter';
import { PublicKey } from '@solana/web3.js';
import { QuoteResponse } from '@jup-ag/api';

// Mock fetch globally
global.fetch = jest.fn();

// Mock VersionedTransaction.deserialize for swap transaction tests
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    VersionedTransaction: {
      ...actual.VersionedTransaction,
      deserialize: jest.fn(() => ({ dummy: true, __proto__: actual.VersionedTransaction.prototype })),
    },
  };
});

// Increase Jest timeout for slow tests
jest.setTimeout(15000);

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

describe('JupiterClient', () => {
  let client: JupiterClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let mockLogger: jest.Mocked<any>;
  const realDeserialize = jest.requireActual('@solana/web3.js').VersionedTransaction.deserialize;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    client = new JupiterClient({
      quoteApiUrl: 'https://test-quote-api.jup.ag/v6',
      timeout: 5000,
      retries: 2,
      logger: mockLogger,
    });
  });

  describe('constructor', () => {
    it('should create client with default configuration', () => {
      const defaultClient = new JupiterClient({});
      const config = defaultClient.getConfig();
      
      expect(config['quoteApiUrl']).toBe('https://quote-api.jup.ag/v6');
      expect(config['timeout']).toBe(30000);
      expect(config['retries']).toBe(3);
    });

    it('should create client with custom configuration', () => {
      const config = client.getConfig();
      
      expect(config['quoteApiUrl']).toBe('https://test-quote-api.jup.ag/v6');
      expect(config['timeout']).toBe(5000);
      expect(config['retries']).toBe(2);
      expect(config.logger).toBe(mockLogger);
    });
  });

  describe('getQuote', () => {
    it('should successfully get quote', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
      const toMint = new PublicKey('So11111111111111111111111111111111111111112'); // SOL
      const amount = '1000000000'; // 1 USDC (6 decimals)
      const slippageBps = 100; // 1%

      const quote = await client.getQuote(fromMint, toMint, amount, slippageBps);

      expect(quote).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-quote-api.jup.ag/v6/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=So11111111111111111111111111111111111111112&amount=1000000000&slippageBps=100'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Requesting Jupiter quote', {
        fromMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        toMint: 'So11111111111111111111111111111111111111112',
        amount: '1000000000',
        slippageBps: 100,
        url: expect.any(String),
      });
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      await expect(client.getQuote(fromMint, toMint, '1000000000')).rejects.toThrow('No response received from Jupiter');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      await expect(client.getQuote(fromMint, toMint, '1000000000')).rejects.toThrow('No response received from Jupiter');
    });

    it('should retry on failure', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');
      const quote = await client.getQuote(fromMint, toMint, '1000000000');

      expect(quote).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should timeout after specified duration', async () => {
      // Mock fetch to never resolve, but also catch the timeout error
      (fetch as jest.MockedFunction<typeof fetch>).mockImplementationOnce(() => new Promise(() => {}));
      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');
      await expect(client.getQuote(fromMint, toMint, '1000000000')).rejects.toThrow('No response received from Jupiter');
    });

    it('should validate input parameters', async () => {
      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      // Test invalid amount
      await expect(client.getQuote(fromMint, toMint, '0')).rejects.toThrow('Jupiter Quote Error');
      await expect(client.getQuote(fromMint, toMint, '-1000')).rejects.toThrow('Jupiter Quote Error');

      // Test invalid slippage
      await expect(client.getQuote(fromMint, toMint, '1000000000', -1)).rejects.toThrow('Jupiter Quote Error');
      await expect(client.getQuote(fromMint, toMint, '1000000000', 10001)).rejects.toThrow('Jupiter Quote Error');
    });

    it('should handle different amount types', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      // Test with number amount
      await client.getQuote(fromMint, toMint, 1000000000);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('amount=1000000000')
      );
    });
  });

  describe('getSwapTransaction', () => {
    const mockQuoteResponse: QuoteResponse = {
      inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      inAmount: '1000000000',
      outputMint: 'So11111111111111111111111111111111111111112',
      outAmount: '950000000',
      priceImpactPct: '0.5',
      otherAmountThreshold: '945000000',
      swapMode: 'ExactIn',
      slippageBps: 100,
      platformFee: undefined,
      routePlan: [],
      contextSlot: 12345,
      timeTaken: 100,
    };

    const mockSwapParams = {
      quoteResponse: mockQuoteResponse,
      userPublicKey: '11111111111111111111111111111111',
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: '1000',
    };

    it('should successfully get swap transaction', async () => {
      // Create a minimal valid base64 transaction data
      const mockSwapResponse = {
        swapTransaction: Buffer.from('test transaction data').toString('base64'),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSwapResponse,
      } as Response);

      const transaction = await client.getSwapTransaction(mockQuoteResponse, mockSwapParams);
      expect(transaction).toHaveProperty('dummy', true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-quote-api.jup.ag/v6/swap',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockSwapParams),
        })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Requesting Jupiter swap transaction', {
        userPublicKey: '11111111111111111111111111111111',
      });
    });

    it('should handle API errors for swap transaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid swap parameters',
      } as Response);

      await expect(client.getSwapTransaction(mockQuoteResponse, mockSwapParams)).rejects.toThrow('No response received from Jupiter');
    });

    it('should handle missing swap transaction in response', async () => {
      const mockSwapResponse = {
        // Missing swapTransaction
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSwapResponse,
      } as Response);

      await expect(client.getSwapTransaction(mockQuoteResponse, mockSwapParams)).rejects.toThrow('No response received from Jupiter');
    });

    it('should handle network errors for swap transaction', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getSwapTransaction(mockQuoteResponse, mockSwapParams)).rejects.toThrow('No response received from Jupiter');
    });

    it('should retry on swap transaction failure', async () => {
      const mockSwapResponse = {
        swapTransaction: Buffer.from('test transaction data').toString('base64'),
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSwapResponse,
        } as Response);

      const transaction = await client.getSwapTransaction(mockQuoteResponse, mockSwapParams);
      expect(transaction).toHaveProperty('dummy', true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should validate required parameters', async () => {
      // Test missing quote response
      await expect(client.getSwapTransaction(null as any, mockSwapParams)).rejects.toThrow('Jupiter Swap Error');

      // Test missing swap params
      await expect(client.getSwapTransaction(mockQuoteResponse, null as any)).rejects.toThrow('Jupiter Swap Error');
    });

    it('should handle invalid base64 transaction data', async () => {
      // Temporarily restore real deserialize for this test
      const { VersionedTransaction } = require('@solana/web3.js');
      const orig = VersionedTransaction.deserialize;
      VersionedTransaction.deserialize = realDeserialize;
      const mockSwapResponse = {
        swapTransaction: 'invalid-base64-data!@#',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSwapResponse,
      } as Response);
      await expect(client.getSwapTransaction(mockQuoteResponse, mockSwapParams)).rejects.toThrow();
      VersionedTransaction.deserialize = orig;
    });
  });

  describe('logging', () => {
    it('should log successful requests when logger is provided', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      await client.getQuote(fromMint, toMint, '1000000000');

      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 started: getQuote');
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 completed: getQuote', { result: mockResponse });
    });

    it('should log errors when logger is provided', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      await expect(client.getQuote(fromMint, toMint, '1000000000')).rejects.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith('Request 1 attempt 1 failed: getQuote', expect.any(Error));
      expect(mockLogger.error).toHaveBeenCalledWith('Request 1 failed after 2 attempts: getQuote', expect.any(Error));
    });

    it('should log retry attempts', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse,
        } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      await client.getQuote(fromMint, toMint, '1000000000');

      expect(mockLogger.warn).toHaveBeenCalledWith('Request 1 attempt 1 failed: getQuote', expect.any(Error));
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 completed: getQuote', { result: mockResponse });
    });
  });

  describe('request ID tracking', () => {
    it('should increment request IDs', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
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

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');
      
      await client.getQuote(fromMint, toMint, '1000000000');
      await client.getQuote(fromMint, toMint, '2000000000');

      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 started: getQuote');
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 2 started: getQuote');
    });
  });

  describe('edge cases', () => {
    it('should handle very large amounts', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '999999999999999999',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000000000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '945000000000000000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      const quote = await client.getQuote(fromMint, toMint, '999999999999999999');

      expect(quote.inAmount).toBe('999999999999999999');
      expect(quote.outAmount).toBe('950000000000000000');
    });

    it('should handle zero slippage', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '950000000',
        swapMode: 'ExactIn',
        slippageBps: 0,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      const quote = await client.getQuote(fromMint, toMint, '1000000000', 0);

      expect(quote.slippageBps).toBe(0);
    });

    it('should handle maximum slippage', async () => {
      const mockResponse: QuoteResponse = {
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outputMint: 'So11111111111111111111111111111111111111112',
        outAmount: '950000000',
        priceImpactPct: '0.5',
        otherAmountThreshold: '900000000',
        swapMode: 'ExactIn',
        slippageBps: 10000,
        platformFee: undefined,
        routePlan: [],
        contextSlot: 12345,
        timeTaken: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const fromMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const toMint = new PublicKey('So11111111111111111111111111111111111111112');

      const quote = await client.getQuote(fromMint, toMint, '1000000000', 10000);

      expect(quote.slippageBps).toBe(10000);
    });
  });
}); 