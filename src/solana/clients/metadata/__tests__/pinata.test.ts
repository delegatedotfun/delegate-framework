import { PinataClient, PinataConfig } from '../pinata';
import { Logger } from '../../../types';

// Mock fetch
global.fetch = jest.fn();

// Mock FormData and Blob for Node.js environment
global.FormData = jest.fn().mockImplementation(() => ({
  append: jest.fn(),
}));

global.Blob = jest.fn().mockImplementation((content, options) => ({
  size: content[0]?.length || 0,
  type: options?.type || 'application/octet-stream',
}));

describe('PinataClient', () => {
  let client: PinataClient;
  let mockLogger: jest.Mocked<Logger>;
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let mockFormData: jest.Mocked<FormData>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock fetch
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;

    // Mock FormData
    mockFormData = {
      append: jest.fn(),
    } as any;
    (FormData as jest.Mock).mockReturnValue(mockFormData);

    // Create client
    client = new PinataClient({
      jwt: 'test-jwt-token',
      logger: mockLogger,
    });
  });

  describe('constructor', () => {
    it('should create client with default config', () => {
      const client = new PinataClient({ jwt: 'test-jwt' });
      const config = client.getConfig();
      
      expect(config.gateway).toBe('https://gateway.pinata.cloud');
      expect(config.timeout).toBe(60000);
      expect(config.retries).toBe(3);
      expect(config.jwt).toBe('test-jwt');
    });

    it('should create client with custom config', () => {
      const customConfig: PinataConfig = {
        jwt: 'custom-jwt',
        gateway: 'https://custom.gateway.com',
        timeout: 30000,
        retries: 5,
        logger: mockLogger,
      };

      const client = new PinataClient(customConfig);
      const config = client.getConfig();
      
      expect(config.gateway).toBe('https://custom.gateway.com');
      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(5);
      expect(config.jwt).toBe('custom-jwt');
    });

    it('should throw error if JWT is missing', () => {
      expect(() => {
        new PinataClient({ jwt: '' });
      }).toThrow('JWT token is required for Pinata client');
    });
  });

  describe('uploadMetadata', () => {
    it('should upload metadata successfully', async () => {
      const metadata = { name: 'Test NFT', description: 'Test description' };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { cid: 'QmTestCID123' }
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadMetadata(metadata);

      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://gateway.pinata.cloud/ipfs/QmTestCID123');
      expect(result.cid).toBe('QmTestCID123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://uploads.pinata.cloud/v3/files',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-jwt-token',
          },
        })
      );
    });

    it('should handle upload failure', async () => {
      const metadata = { name: 'Test NFT' };
      const mockResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadMetadata(metadata);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pinata API error: 401');
    });

    it('should handle missing CID in response', async () => {
      const metadata = { name: 'Test NFT' };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {} // No CID
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadMetadata(metadata);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No CID returned from Pinata');
    });

    it('should handle network errors', async () => {
      const metadata = { name: 'Test NFT' };
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.uploadMetadata(metadata);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle malformed response', async () => {
      const metadata = { name: 'Test NFT' };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadMetadata(metadata);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid JSON');
    });
  });

  describe('uploadImage', () => {
    it('should upload image successfully', async () => {
      const imageBuffer = Buffer.from('fake-image-data');
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { cid: 'QmImageCID456' }
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadImage(imageBuffer, 'image/png', 'test.png');

      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://gateway.pinata.cloud/ipfs/QmImageCID456');
      expect(result.cid).toBe('QmImageCID456');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://uploads.pinata.cloud/v3/files',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-jwt-token',
          },
        })
      );
    });

    it('should handle image upload failure', async () => {
      const imageBuffer = Buffer.from('fake-image-data');
      const mockResponse = {
        ok: false,
        status: 413,
        text: jest.fn().mockResolvedValue('File too large'),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadImage(imageBuffer, 'image/png');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pinata API error: 413');
    });

    it('should handle empty image buffer', async () => {
      const imageBuffer = Buffer.alloc(0);
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { cid: 'QmEmptyCID789' }
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.uploadImage(imageBuffer, 'image/png');

      expect(result.success).toBe(true);
      expect(result.cid).toBe('QmEmptyCID789');
    });

    it('should handle network errors during image upload', async () => {
      const imageBuffer = Buffer.from('fake-image-data');
      mockFetch.mockRejectedValue(new Error('Connection failed'));

      const result = await client.uploadImage(imageBuffer, 'image/jpeg');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('configuration', () => {
    it('should return configuration values', () => {
      const config = client.getConfig();
      
      expect(config.gateway).toBe('https://gateway.pinata.cloud');
      expect(config.timeout).toBe(60000);
      expect(config.retries).toBe(3);
      expect(config.jwt).toBe('test-jwt-token');
    });

    it('should use custom gateway', async () => {
      const customClient = new PinataClient({
        jwt: 'test-jwt',
        gateway: 'https://custom.ipfs.gateway.com',
      });

      const metadata = { name: 'Test NFT' };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { cid: 'QmCustomCID' }
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await customClient.uploadMetadata(metadata);

      expect(result.success).toBe(true);
      expect(result.uri).toBe('https://custom.ipfs.gateway.com/ipfs/QmCustomCID');
    });
  });
}); 