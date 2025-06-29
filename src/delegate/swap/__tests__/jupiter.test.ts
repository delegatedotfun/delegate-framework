import { JupiterSwap } from '../jupiter';
import { Keypair, Connection } from '@solana/web3.js';
import { HeliusClient } from '../../../solana/clients/helius';

// Mock fetch globally
global.fetch = jest.fn();

// Mock VersionedTransaction.deserialize
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

describe('JupiterSwap', () => {
  let jupiterSwap: JupiterSwap;
  let keypair: Keypair;
  let connection: Connection;
  let heliusClient: HeliusClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let mockConnection: jest.Mocked<Connection>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    
    keypair = Keypair.generate();
    connection = new Connection('https://test-rpc.com');
    heliusClient = new HeliusClient({ apiKey: 'test', rpcUrl: 'https://test-rpc.com' });
    
    // Mock connection methods
    mockConnection = connection as jest.Mocked<Connection>;
    mockConnection.sendTransaction = jest.fn();
    mockConnection.getLatestBlockhash = jest.fn();
    mockConnection.confirmTransaction = jest.fn();
    
    jupiterSwap = new JupiterSwap(keypair, connection, {
      heliusClient,
      tokenListUrl: 'https://token.jup.ag/all',
      fallbackDecimals: 6
    });
  });

  describe('constructor', () => {
    it('should create JupiterSwap with default configuration', () => {
      const defaultSwap = new JupiterSwap(keypair, connection);
      expect(defaultSwap).toBeInstanceOf(JupiterSwap);
    });

    it('should create JupiterSwap with custom configuration', () => {
      const customSwap = new JupiterSwap(keypair, connection, {
        tokenListUrl: 'https://custom-token-list.com',
        fallbackDecimals: 9,
        heliusClient
      });
      expect(customSwap).toBeInstanceOf(JupiterSwap);
    });
  });

  describe('getQuote', () => {
    beforeEach(() => {
      mockFetch.mockImplementation(() => {
        throw new Error('Unexpected fetch call: not mocked!');
      });
    });
    it('should successfully get quote', async () => {
      mockFetch.mockClear();
      // Token list (called twice - once for input token, once for output token)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);
      // Quote (success on first try)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          outAmount: '950000000',
          priceImpactPct: '0.5',
          swapUsdValue: '100'
        })
      } as Response);
      const quote = await jupiterSwap.getQuote(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1.0,
        0.5
      );
      expect(quote).toBeDefined();
      expect(quote?.inputMint).toBe('So11111111111111111111111111111111111111112');
      expect(quote?.outputMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(quote?.inputAmount).toBe('1');
      expect(quote?.outputAmount).toBe('950');
      expect(quote?.priceImpact).toBe('0.5');
      expect(quote?.['jupiterQuote']).toBeDefined();
      expect(mockFetch.mock.calls.length).toBe(3); // 2 token list + 1 quote
    });
    it('should handle API errors with retry', async () => {
      mockFetch.mockClear();
      // Token list (called twice - once for input token, once for output token)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);
      // 2 failures, 1 success for quote
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          outAmount: '950000000',
          priceImpactPct: '0.5',
          swapUsdValue: '100'
        })
      } as Response);
      const quote = await jupiterSwap.getQuote(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1.0,
        0.5
      );
      expect(quote).toBeDefined();
      expect(mockFetch.mock.calls.length).toBe(5); // 2 token list + 3 quote attempts
    });
    it('should return null when quote fails after retries', async () => {
      mockFetch.mockClear();
      // Token list (called twice - once for input token, once for output token)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);
      // 3 failures for quote (retry logic will try 3 times)
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(jupiterSwap.getQuote(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1.0,
        0.5
      )).rejects.toThrow('Network error');
      expect(mockFetch.mock.calls.length).toBe(5); // 2 token list + 3 quote attempts
    });
    it('should validate swap parameters', async () => {
      await expect(jupiterSwap.getQuote('', 'mint2', 100)).rejects.toThrow('Input and output mints are required');
      await expect(jupiterSwap.getQuote('mint1', '', 100)).rejects.toThrow('Input and output mints are required');
      await expect(jupiterSwap.getQuote('mint1', 'mint1', 100)).rejects.toThrow('Input and output mints cannot be the same');
      await expect(jupiterSwap.getQuote('mint1', 'mint2', 0)).rejects.toThrow('Amount must be greater than 0');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('createSwapTransaction', () => {
    it('should successfully create swap transaction', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: '1',
        outputAmount: '950',
        priceImpact: 0.5,
        jupiterQuote: {
          outAmount: '950000000',
          priceImpactPct: '0.5'
        }
      };

      // Mock Jupiter swap response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          swapTransaction: Buffer.from('test-transaction').toString('base64')
        })
      } as Response);

      const transaction = await jupiterSwap.createSwapTransaction(mockQuote);

      expect(transaction).toBeDefined();
      expect(transaction.serialize).toBeDefined();
      expect(transaction.sign).toBeDefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SwapProtocol] jupiter_create_transaction_started'),
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it('should handle missing Jupiter quote data', async () => {
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: '1',
        outputAmount: '950',
        priceImpact: 0.5
        // Missing jupiterQuote
      };

      await expect(jupiterSwap.createSwapTransaction(mockQuote)).rejects.toThrow('Invalid quote: missing Jupiter quote data');
    });

    it('should retry on API failures', async () => {
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: '1',
        outputAmount: '950',
        priceImpact: 0.5,
        jupiterQuote: {
          outAmount: '950000000',
          priceImpactPct: '0.5'
        }
      };

      // First call fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            swapTransaction: Buffer.from('test-transaction').toString('base64')
          })
        } as Response);

      const transaction = await jupiterSwap.createSwapTransaction(mockQuote);

      expect(transaction).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeSwap', () => {
    it('should successfully execute swap', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const mockTransaction = {
        serialize: () => Buffer.from('test'),
        sign: (_signers: Keypair[]) => {}
      };

      // Mock connection responses
      mockConnection.sendTransaction.mockResolvedValue('test-signature');
      mockConnection.getLatestBlockhash.mockResolvedValue({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 1000
      });
      mockConnection.confirmTransaction.mockResolvedValue({
        context: { slot: 1000 },
        value: { err: null }
      });

      const result = await jupiterSwap.executeSwap(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.signature).toBe('test-signature');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SwapProtocol] jupiter_execute_swap_started'),
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it('should retry on transaction failures', async () => {
      const mockTransaction = {
        serialize: () => Buffer.from('test'),
        sign: (_signers: Keypair[]) => {}
      };

      // First sendTransaction fails, second succeeds
      mockConnection.sendTransaction
        .mockRejectedValueOnce(new Error('Transaction failed'))
        .mockResolvedValueOnce('test-signature');

      mockConnection.getLatestBlockhash.mockResolvedValue({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 1000
      });
      mockConnection.confirmTransaction.mockResolvedValue({
        context: { slot: 1000 },
        value: { err: null }
      });

      const result = await jupiterSwap.executeSwap(mockTransaction);

      expect(result.success).toBe(true);
      expect(mockConnection.sendTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTokenInfo', () => {
    it('should get token info from token list', async () => {
      // Mock token list response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);

      const tokenInfo = await (jupiterSwap as any).getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      expect(tokenInfo.decimals).toBe(6);
    });

    it('should fallback to HeliusClient when token not in list', async () => {
      // Mock token list response (token not found)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);

      // Mock HeliusClient response
      jest.spyOn(heliusClient, 'getTokenInfo').mockResolvedValue({ decimals: 8 });

      const tokenInfo = await (jupiterSwap as any).getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      expect(tokenInfo.decimals).toBe(8);
    });

    it('should use fallback decimals when all else fails', async () => {
      // Mock token list response (token not found)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { address: 'So11111111111111111111111111111111111111112', decimals: 9 }
        ]
      } as Response);

      // Mock HeliusClient response (null)
      jest.spyOn(heliusClient, 'getTokenInfo').mockResolvedValue(null);

      const tokenInfo = await (jupiterSwap as any).getTokenInfo('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

      expect(tokenInfo.decimals).toBe(6); // fallbackDecimals
    });
  });
}); 