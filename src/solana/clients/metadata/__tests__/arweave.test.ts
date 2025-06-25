import { ArweaveClient, ArweaveConfig } from '../arweave';
import { Logger } from '../../../types';
import Bundlr from '@bundlr-network/client';
import { Keypair } from '@solana/web3.js';
import BigNumber from 'bignumber.js';

// Mock Bundlr
jest.mock('@bundlr-network/client');
const MockBundlr = Bundlr as jest.MockedClass<typeof Bundlr>;

// Mock fetch
global.fetch = jest.fn();

// Mock bs58
jest.mock('bs58', () => ({
  decode: jest.fn(() => new Uint8Array(64).fill(1)),
}));

// Mock Keypair.fromSecretKey
const testKeypair = Keypair.generate();
jest.spyOn(Keypair, 'fromSecretKey').mockImplementation(() => testKeypair);

// Patch ArweaveClient static delays for fast tests
afterAll(() => {
  // Restore static values if needed
  (ArweaveClient as any).VERIFICATION_RETRIES = 5;
  (ArweaveClient as any).VERIFICATION_DELAY = 3000;
  (ArweaveClient as any).FUNDING_RETRIES = 20;
  (ArweaveClient as any).FUNDING_DELAY = 2000;
});

beforeAll(() => {
  (ArweaveClient as any).VERIFICATION_RETRIES = 2;
  (ArweaveClient as any).VERIFICATION_DELAY = 5;
  (ArweaveClient as any).FUNDING_RETRIES = 2;
  (ArweaveClient as any).FUNDING_DELAY = 5;
});

describe('ArweaveClient', () => {
  let client: ArweaveClient;
  let mockLogger: jest.Mocked<Logger>;
  let mockBundlrInstance: jest.Mocked<InstanceType<typeof Bundlr>>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock Bundlr instance
    mockBundlrInstance = {
      address: 'test-bundlr-address',
      getPrice: jest.fn(),
      getLoadedBalance: jest.fn(),
      fund: jest.fn(),
      upload: jest.fn(),
    } as any;

    MockBundlr.mockImplementation(() => mockBundlrInstance);

    // Mock fetch
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn(),
    });

    const config: ArweaveConfig = {
      privateKey: testKeypair.secretKey.toString(),
      logger: mockLogger,
      timeout: 10,
      retries: 2,
    };

    client = new ArweaveClient(config);
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      const config: ArweaveConfig = {
        privateKey: testKeypair.secretKey.toString(),
      };
      
      const client = new ArweaveClient(config);
      const clientConfig = client.getConfig();
      
      expect(clientConfig.network).toBe('mainnet-beta');
      expect(clientConfig.bundlrUrl).toBe('https://node1.bundlr.network');
      expect(clientConfig.timeout).toBe(60000);
      expect(clientConfig.retries).toBe(3);
    });

    it('should create client with custom config', () => {
      const config: ArweaveConfig = {
        privateKey: testKeypair.secretKey.toString(),
        network: 'devnet',
        bundlrUrl: 'https://custom.bundlr.network',
        timeout: 30,
        retries: 5,
        logger: mockLogger,
      };
      
      const client = new ArweaveClient(config);
      const clientConfig = client.getConfig();
      
      expect(clientConfig.network).toBe('devnet');
      expect(clientConfig.bundlrUrl).toBe('https://custom.bundlr.network');
      expect(clientConfig.timeout).toBe(30);
      expect(clientConfig.retries).toBe(5);
    });

    it('should throw error if private key is missing', () => {
      expect(() => {
        new ArweaveClient({} as ArweaveConfig);
      }).toThrow('Private key is required for Arweave client');
    });
  });

  describe('uploadMetadata', () => {
    const testMetadata = { name: 'Test Token', symbol: 'TEST' };

    beforeEach(() => {
      mockBundlrInstance.getPrice.mockResolvedValue(new BigNumber(1000));
      mockBundlrInstance.getLoadedBalance.mockResolvedValue(new BigNumber(2000));
      mockBundlrInstance.upload.mockResolvedValue({ id: 'test-tx-id' });
    });

    it('should upload metadata successfully', async () => {
      const result = await client.uploadMetadata(testMetadata);
      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://arweave.net/test-tx-id');
      expect(result.txId).toBe('test-tx-id');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Preparing metadata upload'),
        expect.objectContaining({ dataSize: expect.any(Number), bundlrUrl: expect.any(String) })
      );
    });

    it('should handle upload failure', async () => {
      mockBundlrInstance.upload.mockRejectedValue(new Error('Upload failed'));
      const result = await client.uploadMetadata(testMetadata);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Upload failed');
    });

    it('should handle verification failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      const result = await client.uploadMetadata(testMetadata);
      expect(result.success).toBe(false);
      expect(
        typeof result.error === 'string' && (
          result.error.includes('not found after verification attempts') ||
          result.error.includes('timed out')
        )
      ).toBe(true);
    });

    it('should retry with fallback node on primary failure', async () => {
      mockBundlrInstance.upload.mockRejectedValueOnce(new Error('Primary failed'));
      mockBundlrInstance.upload.mockResolvedValueOnce({ id: 'fallback-tx-id' });
      const result = await client.uploadMetadata(testMetadata);
      expect(result.success).toBe(true);
      expect(result.txId).toBe('fallback-tx-id');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Primary node failed')
      );
    });

    it('should handle timeout', async () => {
      // Simulate a long operation by making upload hang
      mockBundlrInstance.upload.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ id: 'late-tx-id' }), 100)));
      const timeoutConfig: ArweaveConfig = {
        privateKey: testKeypair.secretKey.toString(),
        timeout: 1, // 1ms timeout
        logger: mockLogger,
        retries: 1,
      };
      const timeoutClient = new ArweaveClient(timeoutConfig);
      // Patch delays for this client
      (timeoutClient.constructor as any).VERIFICATION_RETRIES = 1;
      (timeoutClient.constructor as any).VERIFICATION_DELAY = 1;
      const result = await timeoutClient.uploadMetadata(testMetadata);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('uploadImage', () => {
    const testImageBuffer = Buffer.from('test-image-data');
    const testContentType = 'image/png';

    beforeEach(() => {
      mockBundlrInstance.getPrice.mockResolvedValue(new BigNumber(2000));
      mockBundlrInstance.getLoadedBalance.mockResolvedValue(new BigNumber(3000));
      mockBundlrInstance.upload.mockResolvedValue({ id: 'image-tx-id' });
    });

    it('should upload image successfully', async () => {
      const result = await client.uploadImage(testImageBuffer, testContentType);
      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://arweave.net/image-tx-id');
      expect(result.txId).toBe('image-tx-id');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Request'),
        expect.objectContaining({ contentType: testContentType, dataSize: testImageBuffer.length })
      );
    });

    it('should handle image upload failure', async () => {
      mockBundlrInstance.upload.mockRejectedValue(new Error('Image upload failed'));
      const result = await client.uploadImage(testImageBuffer, testContentType);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Image upload failed');
    });

    it('should handle empty image buffer', async () => {
      const result = await client.uploadImage(Buffer.alloc(0), testContentType);
      expect(result.success).toBe(true);
      expect(mockBundlrInstance.getPrice).toHaveBeenCalledWith(0);
    });
  });

  describe('getUploadCost', () => {
    beforeEach(() => {
      mockBundlrInstance.getPrice.mockResolvedValue(new BigNumber(1500));
    });

    it('should calculate upload cost successfully', async () => {
      const dataSize = 1024;
      const result = await client.getUploadCost(dataSize);
      expect(result.cost).toBe(1500);
      expect(result.dataSize).toBe(dataSize);
      expect(mockBundlrInstance.getPrice).toHaveBeenCalledWith(dataSize);
    });

    it('should handle cost calculation failure', async () => {
      mockBundlrInstance.getPrice.mockRejectedValue(new Error('Cost calculation failed'));
      await expect(client.getUploadCost(1024)).rejects.toThrow('Cost calculation failed');
    });

    it('should handle zero data size', async () => {
      const result = await client.getUploadCost(0);
      expect(result.cost).toBe(1500);
      expect(result.dataSize).toBe(0);
    });
  });

  describe('funding logic', () => {
    it('should skip funding if sufficient balance', async () => {
      const requiredAmount = new BigNumber(1000);
      mockBundlrInstance.getLoadedBalance.mockResolvedValue(new BigNumber(2000));
      await client['fundAndConfirm'](mockBundlrInstance, requiredAmount);
      expect(mockBundlrInstance.fund).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Sufficient balance, no funding needed',
        expect.any(Object)
      );
    });

    it('should fund account when balance is insufficient', async () => {
      const requiredAmount = new BigNumber(2000);
      mockBundlrInstance.getLoadedBalance
        .mockResolvedValueOnce(new BigNumber(500)) // Initial balance
        .mockResolvedValue(new BigNumber(2500)); // After funding
      await client['fundAndConfirm'](mockBundlrInstance, requiredAmount);
      expect(mockBundlrInstance.fund).toHaveBeenCalledWith(
        expect.any(BigNumber)
      );
    });

    it('should handle funding timeout', async () => {
      const requiredAmount = new BigNumber(2000);
      mockBundlrInstance.getLoadedBalance
        .mockResolvedValueOnce(new BigNumber(500))
        .mockResolvedValue(new BigNumber(1500)); // Never reaches required amount
      await expect(
        client['fundAndConfirm'](mockBundlrInstance, requiredAmount)
      ).rejects.toThrow('Funding confirmation timed out');
    }, 100);
  });

  describe('verification logic', () => {
    it('should verify upload successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
      const result = await client['verifyUpload']('https://arweave.net/test-id');
      expect(result).toBe(true);
    });

    it('should fail verification after retries', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
      const result = await client['verifyUpload']('https://arweave.net/test-id');
      expect(result).toBe(false);
    }, 100);

    it('should handle network errors during verification', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
      const result = await client['verifyUpload']('https://arweave.net/test-id');
      expect(result).toBe(false);
    }, 100);
  });

  describe('retry logic', () => {
    it('should retry failed operations', async () => {
      const retryConfig: ArweaveConfig = {
        privateKey: testKeypair.secretKey.toString(),
        retries: 2,
        logger: mockLogger,
        timeout: 10,
      };
      const retryClient = new ArweaveClient(retryConfig);
      (retryClient.constructor as any).VERIFICATION_RETRIES = 1;
      (retryClient.constructor as any).VERIFICATION_DELAY = 1;
      mockBundlrInstance.getPrice
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce(new BigNumber(1000));
      const result = await retryClient.getUploadCost(1024);
      expect(result.cost).toBe(1000);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1 failed'),
        expect.any(Error)
      );
    });

    it('should fail after max retries', async () => {
      const retryConfig: ArweaveConfig = {
        privateKey: testKeypair.secretKey.toString(),
        retries: 2,
        logger: mockLogger,
        timeout: 10,
      };
      const retryClient = new ArweaveClient(retryConfig);
      (retryClient.constructor as any).VERIFICATION_RETRIES = 1;
      (retryClient.constructor as any).VERIFICATION_DELAY = 1;
      mockBundlrInstance.getPrice.mockRejectedValue(new Error('Persistent failure'));
      await expect(retryClient.getUploadCost(1024)).rejects.toThrow('Persistent failure');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed after 2 attempts'),
        expect.any(Error)
      );
    });
  });

  describe('error handling', () => {
    it('should handle Bundlr client creation failure', async () => {
      MockBundlr.mockImplementationOnce(() => undefined as any);
      await expect(client.getUploadCost(1024)).rejects.toThrow(/Bundlr client creation failed|Failed to get price from Bundlr/);
    });

    it('should handle invalid private key', async () => {
      const invalidConfig: ArweaveConfig = {
        privateKey: 'invalid-key',
        logger: mockLogger,
        timeout: 10,
        retries: 1,
      };
      const invalidClient = new ArweaveClient(invalidConfig);
      // Mock bs58.decode to throw error
      const bs58 = require('bs58');
      bs58.decode.mockImplementationOnce(() => { throw new Error('Invalid base58'); });
      await expect(invalidClient.getUploadCost(1024)).rejects.toThrow('Invalid base58');
    });
  });

  describe('configuration', () => {
    it('should return configuration values', () => {
      const config = client.getConfig();
      expect(config.network).toBe('mainnet-beta');
      expect(config.bundlrUrl).toBe('https://node1.bundlr.network');
      expect(config.timeout).toBe(10);
      expect(config.retries).toBe(2);
    });
  });
}); 