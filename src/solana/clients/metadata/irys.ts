import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import os from "os";
import path from "path";
import { throwError } from "../../../utils/error-handling";
import { Logger } from "../../types";

export interface IrysConfig {
  privateKey: string; // Base58 encoded private key
  network?: 'mainnet-beta' | 'devnet' | 'testnet';
  minBalanceSol?: number;
  timeout?: number;
  retries?: number;
  logger?: Logger;
}

export interface IrysUploadResult {
  success: boolean;
  uri?: string;
  error?: string;
  txId?: string;
}

export interface IrysCostResult {
  cost: number; // Cost in lamports
  dataSize: number;
}

export class IrysClient {
  private static readonly DEFAULT_TIMEOUT = 60000; // 60 seconds for uploads
  private static readonly DEFAULT_RETRIES = 3;
  private static readonly DEFAULT_MIN_BALANCE_SOL = 0.02;
  private static readonly VERIFICATION_RETRIES = 5;
  private static readonly VERIFICATION_DELAY = 3000; // 3 seconds

  private readonly config: Omit<Required<IrysConfig>, 'logger' | 'privateKey'> & { 
    logger?: Logger; 
    privateKey: string;
  };
  private readonly logger?: Logger;
  private requestId = 0;

  constructor(config: IrysConfig) {
    if (!config.privateKey) {
      throwError('Private key is required for Irys client', 'Irys Config Error');
    }

    this.config = {
      network: 'mainnet-beta',
      minBalanceSol: IrysClient.DEFAULT_MIN_BALANCE_SOL,
      timeout: IrysClient.DEFAULT_TIMEOUT,
      retries: IrysClient.DEFAULT_RETRIES,
      ...config,
    };
    this.logger = this.config.logger;
  }

  /**
   * Upload metadata to Arweave using Irys
   * @param metadata - The metadata object to upload
   * @returns Promise<IrysUploadResult>
   */
  public async uploadMetadata(metadata: any): Promise<IrysUploadResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: uploadMetadata`);

    try {
      const data = JSON.stringify(metadata);
      this.logger?.debug('Preparing metadata upload', {
        dataSize: data.length,
      });

      return await this.makeRequest(async () => {
        const irys = await this.createIrysUploader();
        await this.fundIrysIfNeeded(irys);

        this.logger?.debug('Uploading metadata to Irys');
        const receipt = await irys.upload(data);

        if (!receipt || !receipt.id) {
          throw new Error('No ID returned from Irys upload');
        }

        const uri = `https://arweave.net/${receipt.id}`;
        this.logger?.debug('Metadata upload completed', {
          txId: receipt.id,
          uri,
        });

        // Verify the upload is accessible
        const verified = await this.verifyUpload(uri);
        if (!verified) {
          throw new Error(`Irys metadata upload not found after verification attempts: ${uri}`);
        }

        return {
          success: true,
          uri,
          txId: receipt.id,
        };
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
   * Upload image to Arweave using Irys
   * @param imageBuffer - The image buffer to upload
   * @param mimeType - The MIME type of the image (e.g., "image/png", "image/jpeg")
   * @returns Promise<IrysUploadResult>
   */
  public async uploadImage(
    imageBuffer: Buffer, 
    mimeType: string
  ): Promise<IrysUploadResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: uploadImage`, {
      mimeType,
      dataSize: imageBuffer.length,
    });

    try {
      return await this.makeRequest(async () => {
        const irys = await this.createIrysUploader();
        await this.fundIrysIfNeeded(irys);

        // Create temporary file for upload
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `irys-upload-${Date.now()}`);
        
        try {
          fs.writeFileSync(tmpFile, imageBuffer);
          this.logger?.debug('Uploading image file to Irys', { tmpFile });

          const receipt = await irys.uploadFile(tmpFile);
          
          if (!receipt || !receipt.id) {
            throw new Error('No ID returned from Irys uploadFile');
          }

          const uri = `https://arweave.net/${receipt.id}`;
          this.logger?.debug('Image upload completed', {
            txId: receipt.id,
            uri,
          });

          return {
            success: true,
            uri,
            txId: receipt.id,
          };
        } finally {
          // Clean up temporary file
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        }
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
   * Get the cost estimate for uploading data to Arweave via Irys
   * @param dataSize - Size of data in bytes
   * @returns Promise<IrysCostResult>
   */
  public async getUploadCost(dataSize: number): Promise<IrysCostResult> {
    const requestId = ++this.requestId;
    this.logger?.debug(`Request ${requestId} started: getUploadCost`, { dataSize });

    try {
      return await this.makeRequest(async () => {
        let irys;
        try {
          irys = await this.createIrysUploader();
        } catch (e: any) {
          throw new Error(e?.message || 'Uploader creation failed');
        }
        if (!irys) throw new Error('Uploader creation failed');
        const price = await irys.getPrice(dataSize);
        
        this.logger?.debug('Upload cost calculated', {
          dataSize,
          cost: price,
        });

        return {
          cost: price,
          dataSize
        };
      }, 'getUploadCost');
    } catch (error) {
      this.logger?.error(`Request ${requestId} failed: getUploadCost`, error);
      throwError(error, 'Irys Cost Calculation Failed');
    }
  }

  /**
   * Create an Irys uploader instance
   * @returns Promise<any> - The Irys uploader
   */
  private async createIrysUploader(): Promise<any> {
    try {
      const privateKeyBytes = bs58.decode(this.config.privateKey);
      const keypair = Keypair.fromSecretKey(privateKeyBytes);

      this.logger?.debug('Creating Irys uploader', {
        fundingAccount: keypair.publicKey.toBase58(),
      });

      const irys = await Uploader(Solana).withWallet(privateKeyBytes);

      this.logger?.debug('Irys uploader created', {
        irysAddress: irys.address,
      });

      return irys;
    } catch (error) {
      this.logger?.error('Irys Uploader Creation Failed', error);
      throw error;
    }
  }

  /**
   * Fund the Irys account if needed
   * @param irys - The Irys uploader instance
   */
  private async fundIrysIfNeeded(irys: any): Promise<void> {
    try {
      const balance = await irys.getLoadedBalance(); // returns balance in lamports
      const solBalance = Number(balance) / LAMPORTS_PER_SOL;
      
      if (solBalance < this.config.minBalanceSol) {
        const requiredLamports = Math.ceil((this.config.minBalanceSol - solBalance) * LAMPORTS_PER_SOL);
        
        if (requiredLamports > 0) {
          this.logger?.debug('Funding Irys account', {
            currentBalance: solBalance,
            minBalance: this.config.minBalanceSol,
            requiredLamports,
          });

          await irys.fund(requiredLamports.toString());
          
          const newBalance = await irys.getLoadedBalance();
          const newSolBalance = Number(newBalance) / LAMPORTS_PER_SOL;
          
          this.logger?.debug('Irys account funded', {
            newBalance: newSolBalance,
          });
        }
      } else {
        this.logger?.debug('Sufficient balance, no funding needed', {
          currentBalance: solBalance,
          minBalance: this.config.minBalanceSol,
        });
      }
    } catch (error) {
      this.logger?.error('Irys Funding Failed', error);
      throw error;
    }
  }

  /**
   * Verify that an Arweave upload is accessible
   * @param uri - The Arweave URI to verify
   * @returns Promise<boolean>
   */
  private async verifyUpload(uri: string): Promise<boolean> {
    for (let i = 0; i < IrysClient.VERIFICATION_RETRIES; i++) {
      try {
        const response = await fetch(uri);
        if (response.ok) {
          this.logger?.debug('Arweave upload verified successfully', { uri });
          return true;
        }
      } catch (error) {
        this.logger?.debug(`Verification attempt ${i + 1} failed`, { uri, error });
      }
      await this.delay(IrysClient.VERIFICATION_DELAY);
    }
    return false;
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
  public getConfig(): Readonly<Omit<Required<IrysConfig>, 'logger' | 'privateKey'> & { 
    logger?: Logger; 
    privateKey: string;
  }> {
    return this.config;
  }
} 