import Bundlr from "@bundlr-network/client";
import { Keypair } from "@solana/web3.js";
import bs58 from 'bs58';
import BigNumber from 'bignumber.js';
import { throwError } from "../../../utils/error-handling";
import { Logger } from "../../types";

export interface ArweaveConfig {
  privateKey: string; // Base58 encoded private key
  network?: 'mainnet-beta' | 'devnet' | 'testnet';
  bundlrUrl?: string;
  rpcUrl?: string;
  timeout?: number;
  retries?: number;
  logger?: Logger;
}

export interface ArweaveUploadResult {
  success: boolean;
  uri?: string;
  error?: string;
  txId?: string;
}

export interface ArweaveCostResult {
  cost: number; // Cost in lamports
  dataSize: number;
}

export class ArweaveClient {
  private static readonly DEFAULT_TIMEOUT = 60000; // 60 seconds for uploads
  private static readonly DEFAULT_RETRIES = 3;
  private static readonly DEFAULT_BUNDLR_URL = "https://node1.bundlr.network";
  private static readonly FALLBACK_BUNDLR_URL = "https://node2.bundlr.network";
  private static readonly VERIFICATION_RETRIES = 5;
  private static readonly VERIFICATION_DELAY = 3000; // 3 seconds
  private static readonly FUNDING_RETRIES = 20;
  private static readonly FUNDING_DELAY = 2000; // 2 seconds
  private static readonly FUNDING_BUFFER = 1.2; // 20% buffer

  private readonly config: Omit<Required<ArweaveConfig>, 'logger' | 'privateKey'> & { 
    logger?: Logger; 
    privateKey: string;
  };
  private readonly logger?: Logger;
  private requestId = 0;

  constructor(config: ArweaveConfig) {
    if (!config.privateKey) {
      throwError('Private key is required for Arweave client', 'Arweave Config Error');
    }

    this.config = {
      network: 'mainnet-beta',
      bundlrUrl: ArweaveClient.DEFAULT_BUNDLR_URL,
      rpcUrl: '',
      timeout: ArweaveClient.DEFAULT_TIMEOUT,
      retries: ArweaveClient.DEFAULT_RETRIES,
      ...config,
    };
    this.logger = this.config.logger;
  }

  /**
   * Upload metadata to Arweave using Bundlr Network
   * @param metadata - The metadata object to upload
   * @returns Promise<ArweaveUploadResult>
   */
  public async uploadMetadata(metadata: any): Promise<ArweaveUploadResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: uploadMetadata`);

    try {
      const data = Buffer.from(JSON.stringify(metadata, null, 2));
      this.logger?.debug('Preparing metadata upload', {
        dataSize: data.length,
        bundlrUrl: this.config.bundlrUrl,
      });

      return await this.makeRequest(async () => {
        return await this.performUpload(data, {
          tags: [
            { name: "Content-Type", value: "application/json" },
            { name: "App-Name", value: "Delegate-Framework" },
            { name: "App-Version", value: "1.0.0" }
          ]
        }, 'metadata');
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
   * Upload image to Arweave using Bundlr Network
   * @param imageBuffer - The image buffer to upload
   * @param contentType - The MIME type of the image (e.g., "image/png", "image/jpeg")
   * @returns Promise<ArweaveUploadResult>
   */
  public async uploadImage(
    imageBuffer: Buffer, 
    contentType: string
  ): Promise<ArweaveUploadResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: uploadImage`, {
      contentType,
      dataSize: imageBuffer.length,
    });

    try {
      return await this.makeRequest(async () => {
        return await this.performUpload(imageBuffer, {
          tags: [
            { name: "Content-Type", value: contentType },
            { name: "App-Name", value: "Delegate-Framework" },
            { name: "App-Version", value: "1.0.0" }
          ]
        }, 'image');
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
   * Get the cost estimate for uploading data to Arweave
   * @param dataSize - Size of data in bytes
   * @returns Promise<ArweaveCostResult>
   */
  public async getUploadCost(dataSize: number): Promise<ArweaveCostResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: getUploadCost`, { dataSize });

    try {
      return await this.makeRequest(async () => {
        const bundlr = await this.createBundlrClient();
        if (!bundlr) throw new Error('Bundlr client creation failed');
        const price = await bundlr.getPrice(dataSize);
        if (!price) throw new Error('Failed to get price from Bundlr');
        this.logger?.debug('Upload cost calculated', {
          dataSize,
          cost: price.toNumber(),
        });

        return {
          cost: price.toNumber(),
          dataSize
        };
      }, 'getUploadCost');
    } catch (error) {
      this.logger?.error(`Request ${requestId} failed: getUploadCost`, error);
      throwError(error, 'Arweave Cost Calculation Failed');
    }
  }

  /**
   * Perform the actual upload with retry logic
   * @param data - Data to upload
   * @param options - Upload options
   * @param type - Type of upload for logging
   * @returns Promise<ArweaveUploadResult>
   */
  private async performUpload(
    data: Buffer, 
    options: any, 
    type: string
  ): Promise<ArweaveUploadResult> {
    // Try primary node first, then fallback
    const result1 = await this.tryUpload(data, options, type, this.config.bundlrUrl);
    if (result1.success) return result1;

    this.logger?.warn(`Primary node failed, retrying with fallback node for ${type} upload`);
    const result2 = await this.tryUpload(data, options, type, ArweaveClient.FALLBACK_BUNDLR_URL);
    return result2;
  }

  /**
   * Try upload to a specific Bundlr node
   * @param data - Data to upload
   * @param options - Upload options
   * @param type - Type of upload for logging
   * @param bundlrUrl - Bundlr node URL
   * @returns Promise<ArweaveUploadResult>
   */
  private async tryUpload(
    data: Buffer, 
    options: any, 
    type: string, 
    bundlrUrl: string
  ): Promise<ArweaveUploadResult> {
    try {
      const bundlr = await this.createBundlrClient(bundlrUrl);
      
      this.logger?.debug(`Uploading ${type} to Arweave via ${bundlrUrl}`, {
        dataSize: data.length,
        bundlrAddress: bundlr.address,
      });

      const price = await bundlr.getPrice(data.length);
      await this.fundAndConfirm(bundlr, price);

      const tx = await bundlr.upload(data, options);
      const uri = `https://arweave.net/${tx.id}`;

      this.logger?.debug(`${type} upload completed`, {
        txId: tx.id,
        uri,
      });

      // Verify the upload is accessible
      const verified = await this.verifyUpload(uri);
      if (!verified) {
        return {
          success: false,
          error: `Arweave ${type} upload not found after verification attempts via ${bundlrUrl}`,
          uri,
          txId: tx.id
        };
      }

      return {
        success: true,
        uri,
        txId: tx.id
      };
    } catch (error) {
      this.logger?.error(`Error uploading ${type} to Arweave via ${bundlrUrl}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create a Bundlr client instance
   * @param bundlrUrl - Optional custom Bundlr URL
   * @returns Promise<Bundlr>
   */
  private async createBundlrClient(bundlrUrl?: string): Promise<InstanceType<typeof Bundlr>> {
    try {
      const privateKeyBytes = bs58.decode(this.config.privateKey);
      const keypair = Keypair.fromSecretKey(privateKeyBytes);

      const bundlr = new Bundlr(
        bundlrUrl || this.config.bundlrUrl, 
        "solana", 
        keypair.secretKey,
        this.config.rpcUrl ? { providerUrl: this.config.rpcUrl } : undefined
      );

      this.logger?.debug('Bundlr client created', {
        bundlrUrl: bundlrUrl || this.config.bundlrUrl,
        fundingAccount: keypair.publicKey.toBase58(),
        bundlrAddress: bundlr.address,
      });

      if (!bundlr) {
        throw new Error('Bundlr client creation failed');
      }
      return bundlr;
    } catch (error) {
      throwError(error, 'Bundlr Client Creation Failed');
    }
  }

  /**
   * Verify that an Arweave upload is accessible
   * @param uri - The Arweave URI to verify
   * @returns Promise<boolean>
   */
  private async verifyUpload(uri: string): Promise<boolean> {
    for (let i = 0; i < ArweaveClient.VERIFICATION_RETRIES; i++) {
      try {
        const response = await fetch(uri);
        if (response.ok) {
          this.logger?.debug('Arweave upload verified successfully', { uri });
          return true;
        }
      } catch (error) {
        this.logger?.debug(`Verification attempt ${i + 1} failed`, { uri, error });
      }
      await this.delay(ArweaveClient.VERIFICATION_DELAY);
    }
    return false;
  }

  /**
   * Fund the Bundlr account and wait for confirmation
   * @param bundlr - The Bundlr client instance
   * @param requiredAmount - The total amount required for the upload
   */
  private async fundAndConfirm(bundlr: InstanceType<typeof Bundlr>, requiredAmount: BigNumber): Promise<void> {
    const currentBalance = await bundlr.getLoadedBalance();

    if (currentBalance.isGreaterThanOrEqualTo(requiredAmount)) {
      this.logger?.debug('Sufficient balance, no funding needed', {
        currentBalance: currentBalance.toString(),
        requiredAmount: requiredAmount.toString(),
      });
      return;
    }

    const amountToFund = requiredAmount.minus(currentBalance);
    const bufferedAmountToFund = amountToFund.multipliedBy(ArweaveClient.FUNDING_BUFFER).integerValue();

    if (bufferedAmountToFund.isLessThanOrEqualTo(0)) {
      return;
    }

    this.logger?.debug('Funding Bundlr account', {
      amountToFund: bufferedAmountToFund.toString(),
      currentBalance: currentBalance.toString(),
      requiredAmount: requiredAmount.toString(),
    });

    try {
      await bundlr.fund(bufferedAmountToFund);
      this.logger?.debug('Funding transaction sent, waiting for confirmation');

      for (let i = 0; i < ArweaveClient.FUNDING_RETRIES; i++) {
        await this.delay(ArweaveClient.FUNDING_DELAY);
        const newBalance = await bundlr.getLoadedBalance();
        
        if (newBalance.isGreaterThanOrEqualTo(requiredAmount)) {
          this.logger?.debug('Funding confirmed', {
            newBalance: newBalance.toString(),
            requiredAmount: requiredAmount.toString(),
          });
          return;
        }

        this.logger?.debug(`Waiting for funding confirmation`, {
          attempt: i + 1,
          balance: newBalance.toString(),
          required: requiredAmount.toString(),
        });
      }

      throw new Error('Funding confirmation timed out after 40 seconds');
    } catch (error) {
      throwError(error, 'Bundlr Funding Failed');
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
  public getConfig(): Readonly<Omit<Required<ArweaveConfig>, 'logger' | 'privateKey'> & { 
    logger?: Logger; 
    privateKey: string;
  }> {
    return this.config;
  }
} 