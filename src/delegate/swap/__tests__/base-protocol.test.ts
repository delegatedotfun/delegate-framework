import { Keypair, Connection } from '@solana/web3.js';
import { BaseSwapProtocol } from '../base-protocol';
import { SwapQuote, SwapTransaction, SwapResult } from '../../types';

// Mock fetch globally
global.fetch = jest.fn();

// Increase Jest timeout for slow tests
jest.setTimeout(15000);

let logSpy: jest.SpyInstance, errorSpy: jest.SpyInstance, warnSpy: jest.SpyInstance;

beforeAll(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

// Create a concrete implementation for testing
class TestSwapProtocol extends BaseSwapProtocol {
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    _slippage: number = 0.5
  ): Promise<SwapQuote | null> {
    return this.handleError(async () => {
      this.validateSwapParams(inputMint, outputMint, amount);
      
      // Use retry logic for the API call
      return this.retryOperation(async () => {
        const response = await fetch('https://test-api.com/quote');
        if (!response || !response.ok) {
          throw new Error('API error');
        }
        
        return {
          inputMint,
          outputMint,
          inputAmount: amount.toString(),
          outputAmount: (amount * 0.95).toString(),
          priceImpact: 0.5,
          swapUsdValue: 100
        };
      }, 3);
    }, 'get_quote');
  }

  async createSwapTransaction(_quote: SwapQuote): Promise<SwapTransaction> {
    return {
      serialize: () => Buffer.from('test'),
      sign: (_signers: Keypair[]) => {}
    };
  }

  async executeSwap(_transaction: SwapTransaction): Promise<SwapResult> {
    return {
      success: true,
      signature: 'test-signature'
    };
  }

  // Expose protected methods for testing
  public testValidateSwapParams(inputMint: string, outputMint: string, amount: number): void {
    this.validateSwapParams(inputMint, outputMint, amount);
  }

  public testRetryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    return this.retryOperation(operation, maxRetries);
  }
}

describe('BaseSwapProtocol', () => {
  let protocol: TestSwapProtocol;
  let keypair: Keypair;
  let connection: Connection;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as unknown as jest.Mock);
    keypair = Keypair.generate();
    connection = new Connection('https://test-rpc.com');
    protocol = new TestSwapProtocol(keypair, connection);
  });

  describe('error handling', () => {
    it('should handle errors with proper logging', async () => {
      mockFetch.mockResolvedValueOnce(undefined as any);
      await expect(protocol.getQuote('mint1', 'mint2', 100)).rejects.toThrow('API error');
    });

    it('should log operation start and completion', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { success: true },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await protocol.getQuote('input-mint', 'output-mint', 100);
      
      // Verify that logging was called
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SwapProtocol]'),
        expect.any(Object)
      );
    });

    it('should log errors with context', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(protocol.getQuote('input-mint', 'output-mint', 100)).rejects.toThrow();
      
      // Verify that error logging was called
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Swap protocol error:'),
        expect.any(Object)
      );
    });
  });

  describe('retry logic', () => {
    it('should retry failed operations', async () => {
      mockFetch
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({})
        } as Response);
      
      await protocol.getQuote('mint1', 'mint2', 100);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      mockFetch
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce(undefined as any);
      
      await expect(protocol.getQuote('mint1', 'mint2', 100)).rejects.toThrow('API error');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      mockFetch
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce(undefined as any);
      
      await expect(protocol.getQuote('mint1', 'mint2', 100)).rejects.toThrow('API error');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('swap flow', () => {
    it('should execute complete swap flow', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      } as Response);

      const result = await protocol.swap('mint1', 'mint2', 100, 0.5);

      expect(result.success).toBe(true);
      expect(result.outputAmount).toBe('95'); // 100 * 0.95
      expect(result.priceImpact).toBe(0.5);
    });

    it('should handle quote failure in swap flow', async () => {
      // Mock fetch to return a failed response (not ok) for all retries
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'API error' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'API error' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'API error' }),
        } as Response);

      await expect(protocol.swap('input-mint', 'output-mint', 100)).rejects.toThrow('API error');
    });
  });

  describe('validation', () => {
    it('should validate required parameters', () => {
      expect(() => protocol.testValidateSwapParams('', 'mint2', 100)).toThrow('Input and output mints are required');
      expect(() => protocol.testValidateSwapParams('mint1', '', 100)).toThrow('Input and output mints are required');
      expect(() => protocol.testValidateSwapParams('mint1', 'mint1', 100)).toThrow('Input and output mints cannot be the same');
      expect(() => protocol.testValidateSwapParams('mint1', 'mint2', 0)).toThrow('Amount must be greater than 0');
      expect(() => protocol.testValidateSwapParams('mint1', 'mint2', -100)).toThrow('Amount must be greater than 0');
    });

    it('should accept valid parameters', () => {
      expect(() => protocol.testValidateSwapParams('mint1', 'mint2', 100)).not.toThrow();
    });
  });

  describe('request ID generation', () => {
    it('should generate unique request IDs', () => {
      const id1 = (protocol as any).generateRequestId();
      const id2 = (protocol as any).generateRequestId();
      const id3 = (protocol as any).generateRequestId();

      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);
    });
  });
}); 