import { SplClient } from '../spl';
import { Connection, PublicKey } from '@solana/web3.js';

// Mock Connection
jest.mock('@solana/web3.js', () => ({
  ...jest.requireActual('@solana/web3.js'),
  Connection: jest.fn(),
}));

describe('SplClient', () => {
  let client: SplClient;
  let mockConnection: jest.Mocked<Connection>;
  let mockLogger: jest.Mocked<any>;
  let mockProgramId: PublicKey;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConnection = {
      getRecentPrioritizationFees: jest.fn(),
    } as any;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockProgramId = new PublicKey('11111111111111111111111111111111');

    client = new SplClient({
      connection: mockConnection,
      programId: mockProgramId,
      timeout: 5000,
      retries: 2,
      logger: mockLogger,
    });
  });

  describe('constructor', () => {
    it('should create client with default configuration', () => {
      const defaultClient = new SplClient({
        connection: mockConnection,
        programId: mockProgramId,
      });
      const config = defaultClient.getConfig();
      
      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(3);
    });

    it('should create client with custom configuration', () => {
      const config = client.getConfig();
      
      expect(config.connection).toBe(mockConnection);
      expect(config.timeout).toBe(5000);
      expect(config.retries).toBe(2);
      expect(config.logger).toBe(mockLogger);
    });
  });

  describe('getPriorityFee', () => {
    it('should successfully calculate priority fee from recent fees with default options', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: 1000 },
        { slot: 1001, prioritizationFee: 500 },
        { slot: 1002, prioritizationFee: 2000 },
        { slot: 1003, prioritizationFee: 300 },
        { slot: 1004, prioritizationFee: 1500 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee();

      // With default 99.99999th percentile and 5 fees, should get the highest fee (2000)
      expect(fee).toBe(2000);
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith('Priority fee calculation', {
        recentFeesCount: 5,
        percentile: 0.9999999,
        calculatedFee: 2000,
        finalFee: 2000,
      });
    });

    it('should successfully calculate priority fee with custom options', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: 1000 },
        { slot: 1001, prioritizationFee: 500 },
        { slot: 1002, prioritizationFee: 2000 },
        { slot: 1003, prioritizationFee: 300 },
        { slot: 1004, prioritizationFee: 1500 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee({
        percentile: 0.95,
        defaultCuPrice: 0.5,
      });

      // With 95th percentile and 5 fees, should get the highest fee (2000)
      expect(fee).toBe(2000);
      expect(mockLogger.debug).toHaveBeenCalledWith('Priority fee calculation', {
        recentFeesCount: 5,
        percentile: 0.95,
        calculatedFee: 2000,
        finalFee: 2000,
      });
    });

    it('should return default fee when no recent fees available', async () => {
      mockConnection.getRecentPrioritizationFees.mockResolvedValue([]);

      const fee = await client.getPriorityFee({ defaultCuPrice: 0.5 });

      expect(fee).toBe(0.5);
      expect(mockLogger.warn).toHaveBeenCalledWith('No recent prioritization fees found, using default');
    });

    it('should use default fee when calculated fee is lower', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: 0.1 },
        { slot: 1001, prioritizationFee: 0.2 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee({ defaultCuPrice: 0.5 });

      // Should use defaultCuPrice (0.5) since calculated fee (0.2) is lower
      expect(fee).toBe(0.5);
    });

    it('should handle single fee correctly', async () => {
      const mockFees = [{ slot: 1000, prioritizationFee: 1000 }];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee();

      expect(fee).toBe(1000);
    });

    it('should handle network errors with retry', async () => {
      const mockFees = [{ slot: 1000, prioritizationFee: 1000 }];

      // First call fails, second succeeds
      mockConnection.getRecentPrioritizationFees
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockFees);

      const fee = await client.getPriorityFee();

      expect(fee).toBe(1000);
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(2);
    });

    it('should timeout after specified duration', async () => {
      mockConnection.getRecentPrioritizationFees.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([]), 10000))
      );
      await expect(client.getPriorityFee()).rejects.toThrow('timed out');
    }, 15000);

    it('should handle all retries failing', async () => {
      mockConnection.getRecentPrioritizationFees.mockRejectedValue(new Error('Network error'));
      await expect(client.getPriorityFee()).rejects.toThrow('Network error');
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(2); // retries + 1
    });

    it('should calculate correct percentile for different fee counts', async () => {
      // Test with 10 fees, 95th percentile should get the 1st highest (index 0)
      const mockFees = Array.from({ length: 10 }, (_, i) => ({ 
        slot: 1000 + i,
        prioritizationFee: 1000 - i * 100 
      }));

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee({ percentile: 0.95 });

      // 95th percentile of 10 items = 10 * (1 - 0.95) = 0.5, floor = 0, so highest fee
      expect(fee).toBe(1000);
    });

    it('should handle edge case with very high percentile', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: 1000 },
        { slot: 1001, prioritizationFee: 500 },
        { slot: 1002, prioritizationFee: 2000 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee({ percentile: 0.999999 });

      // Should get the highest fee due to very high percentile
      expect(fee).toBe(2000);
    });
  });

  describe('logging', () => {
    it('should log successful requests when logger is provided', async () => {
      const mockFees = [{ slot: 1000, prioritizationFee: 1000 }];
      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      await client.getPriorityFee();

      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 started: getPriorityFee');
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 completed: getPriorityFee', { result: 1000 });
    });

    it('should log errors when logger is provided', async () => {
      mockConnection.getRecentPrioritizationFees.mockRejectedValue(new Error('Network error'));
      await expect(client.getPriorityFee()).rejects.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith('Request 1 attempt 1 failed: getPriorityFee', expect.any(Error));
      expect(mockLogger.error).toHaveBeenCalledWith('Request 1 failed after 2 attempts: getPriorityFee', expect.any(Error));
    });

    it('should log retry attempts', async () => {
      const mockFees = [{ slot: 1000, prioritizationFee: 1000 }];

      mockConnection.getRecentPrioritizationFees
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockFees);

      await client.getPriorityFee();

      expect(mockLogger.warn).toHaveBeenCalledWith('Request 1 attempt 1 failed: getPriorityFee', expect.any(Error));
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 completed: getPriorityFee', { result: 1000 });
    });
  });

  describe('request ID tracking', () => {
    it('should increment request IDs', async () => {
      const mockFees = [{ slot: 1000, prioritizationFee: 1000 }];
      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      await client.getPriorityFee();
      await client.getPriorityFee();

      expect(mockLogger.debug).toHaveBeenCalledWith('Request 1 started: getPriorityFee');
      expect(mockLogger.debug).toHaveBeenCalledWith('Request 2 started: getPriorityFee');
    });
  });

  describe('edge cases', () => {
    it('should handle fees with zero values', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: 0 },
        { slot: 1001, prioritizationFee: 100 },
        { slot: 1002, prioritizationFee: 0 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee();

      expect(fee).toBe(100); // Should get the highest non-zero fee
    });

    it('should handle fees with negative values', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: -100 },
        { slot: 1001, prioritizationFee: 500 },
        { slot: 1002, prioritizationFee: -50 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee();

      expect(fee).toBe(500); // Should get the highest positive fee
    });

    it('should handle very large fee values', async () => {
      const mockFees = [
        { slot: 1000, prioritizationFee: Number.MAX_SAFE_INTEGER },
        { slot: 1001, prioritizationFee: 1000 },
      ];

      mockConnection.getRecentPrioritizationFees.mockResolvedValue(mockFees);

      const fee = await client.getPriorityFee();

      expect(fee).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
}); 