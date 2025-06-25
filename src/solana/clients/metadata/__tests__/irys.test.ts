import { IrysClient, IrysConfig } from '../irys';
import { Logger } from '../../../types';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import os from 'os';

// Mock Irys modules
jest.mock('@irys/upload');
jest.mock('@irys/upload-solana');

// Mock fs and os
jest.mock('fs');
jest.mock('os');

// Mock fetch
global.fetch = jest.fn();

// Mock bs58
jest.mock('bs58', () => ({
  decode: jest.fn(() => new Uint8Array(64).fill(1)),
}));

// Mock Keypair.fromSecretKey
const testKeypair = Keypair.generate();
jest.spyOn(Keypair, 'fromSecretKey').mockImplementation(() => testKeypair);

// Import Uploader after mocks are set up
const { Uploader } = require('@irys/upload');
// const { Solana } = require('@irys/upload-solana'); // Not used directly

// Mock fs and os
const MockFs = fs as jest.Mocked<typeof fs>;
const MockOs = os as jest.Mocked<typeof os>;

// Patch IrysClient static delays for fast tests
afterAll(() => {
  (IrysClient as any).VERIFICATION_RETRIES = 5;
  (IrysClient as any).VERIFICATION_DELAY = 3000;
});

beforeAll(() => {
  (IrysClient as any).VERIFICATION_RETRIES = 2;
  (IrysClient as any).VERIFICATION_DELAY = 5;
});

describe('IrysClient', () => {
  let client: IrysClient;
  let mockLogger: jest.Mocked<Logger>;
  let mockIrysUploader: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock Irys uploader
    mockIrysUploader = {
      address: 'test-irys-address',
      getPrice: jest.fn(),
      getLoadedBalance: jest.fn(),
      fund: jest.fn(),
      upload: jest.fn(),
      uploadFile: jest.fn(),
    };
    // Ensure fund is a fresh mock for each test
    mockIrysUploader.fund = jest.fn();

    // Patch the manual mock for Uploader to always return the local mockIrysUploader
    (Uploader as jest.Mock).mockReturnValue({
      withWallet: jest.fn().mockResolvedValue(mockIrysUploader)
    });

    // Mock fs
    MockFs.writeFileSync.mockImplementation(() => {});
    MockFs.existsSync.mockReturnValue(true);
    MockFs.unlinkSync.mockImplementation(() => {});

    // Mock os
    MockOs.tmpdir.mockReturnValue('/tmp');

    // Mock fetch
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn(),
    });

    const config: IrysConfig = {
      privateKey: testKeypair.secretKey.toString(),
      logger: mockLogger,
      timeout: 10,
      retries: 2,
    };

    client = new IrysClient(config);
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      const config: IrysConfig = {
        privateKey: testKeypair.secretKey.toString(),
      };
      
      const client = new IrysClient(config);
      const clientConfig = client.getConfig();
      
      expect(clientConfig.network).toBe('mainnet-beta');
      expect(clientConfig.minBalanceSol).toBe(0.02);
      expect(clientConfig.timeout).toBe(60000);
      expect(clientConfig.retries).toBe(3);
    });

    it('should create client with custom config', () => {
      const config: IrysConfig = {
        privateKey: testKeypair.secretKey.toString(),
        network: 'devnet',
        minBalanceSol: 0.05,
        timeout: 30,
        retries: 5,
        logger: mockLogger,
      };
      
      const client = new IrysClient(config);
      const clientConfig = client.getConfig();
      
      expect(clientConfig.network).toBe('devnet');
      expect(clientConfig.minBalanceSol).toBe(0.05);
      expect(clientConfig.timeout).toBe(30);
      expect(clientConfig.retries).toBe(5);
    });

    it('should throw error if private key is missing', () => {
      expect(() => {
        new IrysClient({} as IrysConfig);
      }).toThrow('Private key is required for Irys client');
    });
  });

  describe('uploadMetadata', () => {
    const testMetadata = { name: 'Test Token', symbol: 'TEST' };

    beforeEach(() => {
      mockIrysUploader.getLoadedBalance.mockResolvedValue('2000000000'); // 2 SOL
      mockIrysUploader.upload.mockResolvedValue({ id: 'test-tx-id' });
    });

    it('should upload metadata successfully', async () => {
      const result = await client.uploadMetadata(testMetadata);

      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://arweave.net/test-tx-id');
      expect(result.txId).toBe('test-tx-id');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Preparing metadata upload'),
        expect.objectContaining({ dataSize: expect.any(Number) })
      );
    });

    it('should handle upload failure', async () => {
      mockIrysUploader.upload.mockRejectedValue(new Error('Upload failed'));

      const result = await client.uploadMetadata(testMetadata);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Upload failed');
    });

    it('should handle missing receipt ID', async () => {
      mockIrysUploader.upload.mockResolvedValue({});

      const result = await client.uploadMetadata(testMetadata);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No ID returned from Irys upload');
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

    it('should handle timeout', async () => {
      // Simulate a long operation by making upload hang
      mockIrysUploader.upload.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ id: 'late-tx-id' }), 100)));
      const timeoutConfig: IrysConfig = {
        privateKey: testKeypair.secretKey.toString(),
        timeout: 1, // 1ms timeout
        logger: mockLogger,
        retries: 1,
      };
      const timeoutClient = new IrysClient(timeoutConfig);
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
    const testMimeType = 'image/png';

    beforeEach(() => {
      mockIrysUploader.getLoadedBalance.mockResolvedValue('3000000000'); // 3 SOL
      mockIrysUploader.uploadFile.mockResolvedValue({ id: 'image-tx-id' });
    });

    it('should upload image successfully', async () => {
      const result = await client.uploadImage(testImageBuffer, testMimeType);

      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://arweave.net/image-tx-id');
      expect(result.txId).toBe('image-tx-id');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Request'),
        expect.objectContaining({ 
          mimeType: testMimeType,
          dataSize: testImageBuffer.length 
        })
      );
      expect(MockFs.writeFileSync).toHaveBeenCalled();
      expect(MockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should handle image upload failure', async () => {
      mockIrysUploader.uploadFile.mockRejectedValue(new Error('Image upload failed'));

      const result = await client.uploadImage(testImageBuffer, testMimeType);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Image upload failed');
      expect(MockFs.unlinkSync).toHaveBeenCalled(); // Should clean up temp file
    });

    it('should handle missing receipt ID', async () => {
      mockIrysUploader.uploadFile.mockResolvedValue({});

      const result = await client.uploadImage(testImageBuffer, testMimeType);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No ID returned from Irys uploadFile');
    });

    it('should handle empty image buffer', async () => {
      const result = await client.uploadImage(Buffer.alloc(0), testMimeType);

      expect(result.success).toBe(true);
      expect(MockFs.writeFileSync).toHaveBeenCalledWith(expect.any(String), Buffer.alloc(0));
    });

    it('should clean up temp file on error', async () => {
      MockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      const result = await client.uploadImage(testImageBuffer, testMimeType);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Write failed');
      expect(MockFs.unlinkSync).toHaveBeenCalled(); // Should clean up temp file
    });
  });

  describe('getUploadCost', () => {
    beforeEach(() => {
      mockIrysUploader.getPrice.mockResolvedValue(1500);
    });

    it('should calculate upload cost successfully', async () => {
      const dataSize = 1024;
      const result = await client.getUploadCost(dataSize);

      expect(result.cost).toBe(1500);
      expect(result.dataSize).toBe(dataSize);
      expect(mockIrysUploader.getPrice).toHaveBeenCalledWith(dataSize);
    });

    it('should handle cost calculation failure', async () => {
      mockIrysUploader.getPrice.mockRejectedValue(new Error('Cost calculation failed'));

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
      mockIrysUploader.getLoadedBalance.mockResolvedValue('2500000000'); // 2.5 SOL

      await client['fundIrysIfNeeded'](mockIrysUploader);

      expect(mockIrysUploader.fund).not.toHaveBeenCalled();
    });
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
      const retryConfig: IrysConfig = {
        privateKey: testKeypair.secretKey.toString(),
        retries: 2,
        logger: mockLogger,
        timeout: 10,
      };
      const retryClient = new IrysClient(retryConfig);
      (retryClient.constructor as any).VERIFICATION_RETRIES = 1;
      (retryClient.constructor as any).VERIFICATION_DELAY = 1;
      mockIrysUploader.getPrice
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce(1000);

      const result = await retryClient.getUploadCost(1024);

      expect(result.cost).toBe(1000);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1 failed'),
        expect.any(Error)
      );
    });

    it('should fail after max retries', async () => {
      const retryConfig: IrysConfig = {
        privateKey: testKeypair.secretKey.toString(),
        retries: 2,
        logger: mockLogger,
        timeout: 10,
      };
      const retryClient = new IrysClient(retryConfig);
      (retryClient.constructor as any).VERIFICATION_RETRIES = 1;
      (retryClient.constructor as any).VERIFICATION_DELAY = 1;
      mockIrysUploader.getPrice.mockRejectedValue(new Error('Persistent failure'));

      await expect(retryClient.getUploadCost(1024)).rejects.toThrow('Persistent failure');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed after 2 attempts'),
        expect.any(Error)
      );
    });
  });

  describe('error handling', () => {
    it('should handle invalid private key', async () => {
      const invalidConfig: IrysConfig = {
        privateKey: 'invalid-key',
        logger: mockLogger,
        timeout: 10,
        retries: 1,
      };
      const invalidClient = new IrysClient(invalidConfig);

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
      expect(config.minBalanceSol).toBe(0.02);
      expect(config.timeout).toBe(10);
      expect(config.retries).toBe(2);
    });
  });
}); 