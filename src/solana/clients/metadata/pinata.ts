import { throwError } from "../../../utils/error-handling";
import { Logger } from "../../types";
import { MetadataClient } from "./base";

export interface PinataConfig {
  jwt: string; // Pinata JWT token
  gateway?: string;
  timeout?: number;
  retries?: number;
  logger?: Logger;
}

export interface PinataUploadResult {
  success: boolean;
  uri?: string;
  error?: string;
  cid?: string;
}

export class PinataClient implements MetadataClient {
  private static readonly DEFAULT_TIMEOUT = 60000; // 60 seconds for uploads
  private static readonly DEFAULT_RETRIES = 3;
  private static readonly DEFAULT_GATEWAY = 'https://gateway.pinata.cloud';
  private static readonly UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files';

  private readonly config: Omit<Required<PinataConfig>, 'logger' | 'jwt'> & { 
    logger?: Logger; 
    jwt: string;
  };
  private readonly logger?: Logger;
  private requestId = 0;

  constructor(config: PinataConfig) {
    if (!config.jwt) {
      throwError('JWT token is required for Pinata client', 'Pinata Config Error');
    }

    this.config = {
      gateway: PinataClient.DEFAULT_GATEWAY,
      timeout: PinataClient.DEFAULT_TIMEOUT,
      retries: PinataClient.DEFAULT_RETRIES,
      ...config,
    };
    this.logger = this.config.logger;
  }

  /**
   * Upload metadata to IPFS using Pinata
   * @param metadata - The metadata object to upload
   * @param fileName - Optional filename for the metadata
   * @returns Promise<PinataUploadResult>
   */
  public async uploadMetadata(
    metadata: any, 
    fileName = 'metadata.json'
  ): Promise<PinataUploadResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: uploadMetadata`, { fileName });

    try {
      const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { 
        type: 'application/json' 
      });
      
      this.logger?.debug('Preparing metadata upload', {
        fileName,
        dataSize: metadataBlob.size,
      });

      return await this.makeRequest(async () => {
        return await this.performUpload(metadataBlob, fileName, 'metadata');
      }, 'uploadMetadata');
    } catch (error) {
      this.logger?.error(`Request ${requestId} failed: uploadMetadata`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Upload image to IPFS using Pinata
   * @param imageBuffer - The image buffer to upload
   * @param mimeType - The MIME type of the image (e.g., "image/png", "image/jpeg")
   * @param fileName - Optional filename for the image
   * @returns Promise<PinataUploadResult>
   */
  public async uploadImage(
    imageBuffer: Buffer, 
    mimeType?: string,
    fileName = 'image'
  ): Promise<PinataUploadResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: uploadImage`, {
      fileName,
      mimeType,
      dataSize: imageBuffer.length,
    });

    try {
      const imageBlob = new Blob([imageBuffer], { type: mimeType });
      
      return await this.makeRequest(async () => {
        return await this.performUpload(imageBlob, fileName, 'image');
      }, 'uploadImage');
    } catch (error) {
      this.logger?.error(`Request ${requestId} failed: uploadImage`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Perform the actual upload with retry logic
   * @param blob - Blob to upload
   * @param fileName - Filename for the upload
   * @param type - Type of upload for logging
   * @returns Promise<PinataUploadResult>
   */
  private async performUpload(
    blob: Blob, 
    fileName: string, 
    type: string
  ): Promise<PinataUploadResult> {
    try {
      const formData = new FormData();
      formData.append('file', blob, fileName);
      formData.append('name', fileName);
      formData.append('network', 'public');

      this.logger?.debug(`Uploading ${type} to IPFS via Pinata`, {
        fileName,
        dataSize: blob.size,
      });

      const response = await fetch(PinataClient.UPLOAD_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.jwt}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Pinata API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      if (result && result.data && result.data.cid) {
        const uri = `${this.config.gateway}/ipfs/${result.data.cid}`;
        
        this.logger?.debug(`${type} upload completed`, {
          cid: result.data.cid,
          uri,
        });

        return {
          success: true,
          uri,
          cid: result.data.cid,
        };
      } else {
        return {
          success: false,
          error: 'No CID returned from Pinata',
        };
      }
    } catch (error) {
      this.logger?.error(`Error uploading ${type} to IPFS via Pinata`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Make a request with retry logic and error handling
   * @param operation - The operation to perform
   * @param operationName - Name of the operation for logging
   * @returns Result of the operation
   */
  private async makeRequest<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: ${operationName}`);

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Operation timed out after ${this.config.timeout}ms`));
            }, this.config.timeout);
          }),
        ]);

        this.logger?.debug(`Request ${requestId} completed: ${operationName}`, { result });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger?.warn(`Request ${requestId} attempt ${attempt} failed: ${operationName}`, lastError);

        if (attempt === this.config.retries) {
          this.logger?.error(`Request ${requestId} failed after ${attempt} attempts: ${operationName}`, lastError);
          throw lastError;
        }

        await this.delay(Math.pow(2, attempt - 1) * 1000);
      }
    }

    throw lastError!;
  }

  /**
   * Utility method for delays
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the current configuration
   * @returns Current client configuration
   */
  public getConfig(): Readonly<Omit<Required<PinataConfig>, 'logger' | 'jwt'> & { 
    logger?: Logger; 
    jwt: string;
  }> {
    return this.config;
  }
}