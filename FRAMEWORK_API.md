# Delegate Framework API Documentation

A TypeScript framework for building robust, production-ready blockchain workflows with comprehensive error handling, logging, and testing. Maintained by delegate.fun.

## Table of Contents

- [Installation](#installation)
- [Core Types](#core-types)
- [Error Handling Utilities](#error-handling-utilities)
- [Solana Clients](#solana-clients)
  - [HeliusClient](#heliusclient)
  - [JupiterClient](#jupiterclient)
  - [SplClient](#splclient)
- [Metadata Clients](#metadata-clients)
  - [ArweaveClient](#arweaveclient)
  - [IrysClient](#irysclient)
  - [PinataClient](#pinataclient)
- [Configuration Interfaces](#configuration-interfaces)
- [Logger Interface](#logger-interface)

## Installation

```bash
npm install delegate-framework
```

## Core Types

### Delegate<T>
A function type that processes a target with optional arguments.

```typescript
interface Delegate<T = any> {
  (target: T, ...args: any[]): any;
}
```

### DelegateContext<T>
Context information for delegate execution.

```typescript
interface DelegateContext<T = any> {
  target: T;
  args: any[];
  result?: any;
  error?: Error;
}
```

### DelegateOptions
Configuration options for delegate execution.

```typescript
interface DelegateOptions {
  timeout?: number;
  retries?: number;
  fallback?: Delegate;
}
```

### DelegateChain<T>
A chain of delegates that can be executed sequentially.

```typescript
interface DelegateChain<T = any> {
  add(delegate: Delegate<T>): DelegateChain<T>;
  remove(delegate: Delegate<T>): DelegateChain<T>;
  execute(target: T, ...args: any[]): Promise<any>;
  clear(): void;
}
```

### DelegateResult<T>
Standardized result type for delegate operations.

```typescript
type DelegateResult<T = any> = {
  success: true;
  data: T;
} | {
  success: false;
  error: Error;
};
```

## Error Handling Utilities

### throwError(error, context?)
Throws an error with proper type checking and handling.

```typescript
function throwError(error: unknown, context?: string): never
```

**Parameters:**
- `error`: The error to throw (Error, string, or object with message)
- `context`: Optional context information for debugging

**Example:**
```typescript
import { throwError } from 'delegate-framework';

try {
  // Some operation
} catch (error) {
  throwError(error, 'Operation failed');
}
```

### getErrorMessage(error)
Safely extracts error message from various error types.

```typescript
function getErrorMessage(error: unknown): string
```

### isErrorLike(value)
Checks if a value is an error-like object.

```typescript
function isErrorLike(value: unknown): value is { message: string }
```

### createStandardError(error, defaultMessage?)
Creates a standardized error from various input types.

```typescript
function createStandardError(error: unknown, defaultMessage?: string): Error
```

## Solana Clients

### HeliusClient

A robust client for interacting with Helius RPC endpoints with built-in error handling, retry logic, and logging.

#### Constructor
```typescript
new HeliusClient(config: HeliusConfig)
```

#### Configuration
```typescript
interface HeliusConfig {
  apiKey: string;           // Required: Helius API key
  rpcUrl?: string;          // Optional: Custom RPC URL
  enhancedApiUrl?: string;  // Optional: Enhanced API URL for specific endpoints (default: https://api.helius.xyz/v0)
  timeout?: number;         // Optional: Request timeout (default: 30000ms)
  retries?: number;         // Optional: Retry attempts (default: 3)
  logger?: Logger;          // Optional: Logger instance
}
```

#### Methods

##### getBalance(publicKey: PublicKey): Promise<number>
Get the balance of a public key.

##### getAccountInfo(publicKey: PublicKey, encoding?: 'base64' | 'base58'): Promise<any>
Get account information for a public key.

##### getLatestBlockhash(options?: GetLatestBlockhashOptions): Promise<any>
Get the latest blockhash.

##### getPriorityFee(options?: GetPriorityFeeOptions): Promise<any>
Get priority fee information.

##### simulateTransaction(transaction: Transaction): Promise<any>
Simulate a transaction.

##### sendTransaction(transaction: Transaction, options?: SendTransactionOptions): Promise<any>
Send a transaction.

##### getTokenAccount(publicKey: PublicKey, mint: PublicKey): Promise<any>
Get token account information.

##### getTokenAccounts(publicKey: PublicKey): Promise<any>
Get all token accounts for a public key.

##### getTokenAccountBalance(publicKey: PublicKey): Promise<any>
Get token account balance.

##### getTransactions(publicKey: PublicKey, options?: GetTransactionsOptions): Promise<any>
Get transactions for a public key (uses enhanced API endpoint).

**Options:**
- `limit?: number` - Maximum number of transactions to return
- `before?: string` - Get transactions before this signature
- `until?: string` - Get transactions until this signature

##### getAllTransactions(publicKey: PublicKey, options?: Omit<GetTransactionsOptions, 'before' | 'until'>): Promise<any[]>
Get all transactions for a public key with automatic pagination.

**Options:**
- `limit?: number` - Batch size for pagination (default: 100)

**Features:**
- Automatically handles pagination using the last signature from each batch
- Continues fetching until no more transactions are available
- Provides logging for batch progress
- Returns all transactions in a single array

##### getTransactionsWithLimit(publicKey: PublicKey, totalLimit: number, options?: Omit<GetTransactionsOptions, 'before' | 'until'>): Promise<any[]>
Get a specific number of transactions for a public key with automatic pagination.

**Parameters:**
- `totalLimit: number` - Total number of transactions to fetch

**Options:**
- `limit?: number` - Batch size for pagination (default: 100, will be capped by totalLimit)

**Features:**
- Fetches exactly the requested number of transactions (or all available if fewer exist)
- Automatically handles pagination across multiple batches
- Optimizes batch sizes to minimize API calls
- Provides logging for batch progress
- Stops when the total limit is reached or no more transactions are available

#### Example
```typescript
import { HeliusClient } from 'delegate-framework';
import { PublicKey } from '@solana/web3.js';

const client = new HeliusClient({
  apiKey: 'your-helius-api-key',
  timeout: 30000,
  retries: 3
});

const publicKey = new PublicKey('11111111111111111111111111111111');
const balance = await client.getBalance(publicKey);

// Get all transactions with pagination
const allTransactions = await client.getAllTransactions(publicKey, { limit: 50 });
console.log(`Total transactions: ${allTransactions.length}`);

// Get specific number of transactions with pagination
const limitedTransactions = await client.getTransactionsWithLimit(publicKey, 25, { limit: 10 });
console.log(`Fetched ${limitedTransactions.length} transactions`);

// Get recent transactions only (single batch)
const recentTransactions = await client.getTransactions(publicKey, { limit: 10 });
```

### JupiterClient

A client for interacting with Jupiter's swap API with comprehensive error handling and retry logic.

#### Constructor
```typescript
new JupiterClient(config: JupiterConfig)
```

#### Configuration
```typescript
interface JupiterConfig {
  quoteApiUrl?: string;     // Optional: Custom quote API URL
  timeout?: number;         // Optional: Request timeout (default: 30000ms)
  retries?: number;         // Optional: Retry attempts (default: 3)
  logger?: Logger;          // Optional: Logger instance
}
```

#### Methods

##### getQuote(params: QuoteParams): Promise<QuoteResponse>
Get a quote for a token swap.

##### getSwapTransaction(params: SwapParams): Promise<any>
Get a swap transaction.

##### getTokens(): Promise<any>
Get list of available tokens.

##### getTokenPrice(inputMint: string, outputMint: string): Promise<any>
Get token price information.

#### Example
```typescript
import { JupiterClient } from 'delegate-framework';
import { PublicKey } from '@solana/web3.js';

const client = new JupiterClient({
  timeout: 30000,
  retries: 3
});

const quote = await client.getQuote({
  inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  outputMint: 'So11111111111111111111111111111111111111112', // SOL
  amount: '1000000000', // 1 USDC (6 decimals)
  slippageBps: 100
});
```

### SplClient

A client for interacting with SPL Token program with error handling and retry logic.

#### Constructor
```typescript
new SplClient(config: SplConfig)
```

#### Configuration
```typescript
interface SplConfig {
  connection: Connection;    // Required: Solana connection
  programId: PublicKey;     // Required: SPL Token program ID
  timeout?: number;         // Optional: Request timeout (default: 30000ms)
  retries?: number;         // Optional: Retry attempts (default: 3)
  logger?: Logger;          // Optional: Logger instance
}
```

#### Methods

##### getMintInfo(mint: PublicKey): Promise<any>
Get mint information.

##### getAccountInfo(account: PublicKey): Promise<any>
Get token account information.

##### getBalance(account: PublicKey): Promise<any>
Get token account balance.

#### Example
```typescript
import { SplClient } from 'delegate-framework';
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const client = new SplClient({
  connection,
  programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
});

const mintInfo = await client.getMintInfo(new PublicKey('mint-address'));
```

## Metadata Clients

### ArweaveClient

A client for uploading metadata and images to Arweave using Bundlr Network.

#### Constructor
```typescript
new ArweaveClient(config: ArweaveConfig)
```

#### Configuration
```typescript
interface ArweaveConfig {
  privateKey: string;       // Required: Base58 encoded private key
  network?: 'mainnet-beta' | 'devnet' | 'testnet';
  bundlrUrl?: string;       // Optional: Custom Bundlr URL
  rpcUrl?: string;          // Optional: Custom RPC URL
  timeout?: number;         // Optional: Request timeout (default: 60000ms)
  retries?: number;         // Optional: Retry attempts (default: 3)
  logger?: Logger;          // Optional: Logger instance
}
```

#### Methods

##### uploadMetadata(metadata: any): Promise<ArweaveUploadResult>
Upload metadata to Arweave.

##### uploadImage(imageBuffer: Buffer, contentType: string): Promise<ArweaveUploadResult>
Upload image to Arweave.

##### getUploadCost(dataSize: number): Promise<ArweaveCostResult>
Get cost estimate for upload.

#### Example
```typescript
import { ArweaveClient } from 'delegate-framework';

const client = new ArweaveClient({
  privateKey: 'your-base58-private-key',
  network: 'mainnet-beta'
});

const metadata = {
  name: 'My NFT',
  description: 'A unique NFT',
  image: 'https://example.com/image.png'
};

const result = await client.uploadMetadata(metadata);
if (result.success) {
  console.log('Metadata uploaded:', result.uri);
}
```

### IrysClient

A client for uploading metadata and images to Arweave using Irys.

#### Constructor
```typescript
new IrysClient(config: IrysConfig)
```

#### Configuration
```typescript
interface IrysConfig {
  privateKey: string;       // Required: Base58 encoded private key
  network?: 'mainnet-beta' | 'devnet' | 'testnet';
  minBalanceSol?: number;   // Optional: Minimum balance in SOL (default: 0.02)
  timeout?: number;         // Optional: Request timeout (default: 60000ms)
  retries?: number;         // Optional: Retry attempts (default: 3)
  logger?: Logger;          // Optional: Logger instance
}
```

#### Methods

##### uploadMetadata(metadata: any): Promise<IrysUploadResult>
Upload metadata to Arweave via Irys.

##### uploadImage(imageBuffer: Buffer, mimeType: string): Promise<IrysUploadResult>
Upload image to Arweave via Irys.

##### getUploadCost(dataSize: number): Promise<IrysCostResult>
Get cost estimate for upload.

#### Example
```typescript
import { IrysClient } from 'delegate-framework';

const client = new IrysClient({
  privateKey: 'your-base58-private-key',
  network: 'mainnet-beta',
  minBalanceSol: 0.02
});

const imageBuffer = Buffer.from('image-data');
const result = await client.uploadImage(imageBuffer, 'image/png');
if (result.success) {
  console.log('Image uploaded:', result.uri);
}
```

### PinataClient

A client for uploading metadata and images to IPFS using Pinata.

#### Constructor
```typescript
new PinataClient(config: PinataConfig)
```

#### Configuration
```typescript
interface PinataConfig {
  jwt: string;              // Required: Pinata JWT token
  gateway?: string;         // Optional: Custom IPFS gateway (default: https://gateway.pinata.cloud)
  timeout?: number;         // Optional: Request timeout (default: 60000ms)
  retries?: number;         // Optional: Retry attempts (default: 3)
  logger?: Logger;          // Optional: Logger instance
}
```

#### Methods

##### uploadMetadata(metadata: any, fileName?: string): Promise<PinataUploadResult>
Upload metadata to IPFS.

##### uploadImage(imageBuffer: Buffer, mimeType: string, fileName?: string): Promise<PinataUploadResult>
Upload image to IPFS.

#### Example
```typescript
import { PinataClient } from 'delegate-framework';

const client = new PinataClient({
  jwt: 'your-pinata-jwt-token',
  gateway: 'https://gateway.pinata.cloud'
});

const metadata = {
  name: 'My NFT',
  description: 'A unique NFT',
  image: 'ipfs://QmExample'
};

const result = await client.uploadMetadata(metadata, 'metadata.json');
if (result.success) {
  console.log('Metadata uploaded:', result.uri);
  console.log('CID:', result.cid);
}
```

## Configuration Interfaces

### GetLatestBlockhashOptions
```typescript
interface GetLatestBlockhashOptions {
  commitment?: 'processed' | 'confirmed' | 'finalized';
  minContextSlot?: number;
}
```

### GetPriorityFeeOptions
```typescript
interface GetPriorityFeeOptions {
  percentile?: number;
  defaultCuPrice?: number;
}
```

### SwapParams
```typescript
interface SwapParams {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  feeAccount?: string;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: string;
}
```

### SendTransactionOptions
```typescript
interface SendTransactionOptions {
  skipPreflight?: boolean;
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
  encoding?: 'base58' | 'base64';
}
```

## Logger Interface

All clients support an optional logger for debugging and monitoring.

```typescript
interface Logger {
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
}
```

### Example Logger Implementation
```typescript
const logger = {
  debug: (message: string, data?: any) => console.debug(`[DEBUG] ${message}`, data),
  info: (message: string, data?: any) => console.info(`[INFO] ${message}`, data),
  warn: (message: string, data?: any) => console.warn(`[WARN] ${message}`, data),
  error: (message: string, data?: any) => console.error(`[ERROR] ${message}`, data)
};

const client = new HeliusClient({
  apiKey: 'your-api-key',
  logger
});
```

## Result Types

### Upload Results
All metadata clients return standardized upload result types:

```typescript
interface ArweaveUploadResult {
  success: boolean;
  uri?: string;
  error?: string;
  txId?: string;
}

interface IrysUploadResult {
  success: boolean;
  uri?: string;
  error?: string;
  txId?: string;
}

interface PinataUploadResult {
  success: boolean;
  uri?: string;
  error?: string;
  cid?: string;
}
```

### Cost Results
```typescript
interface ArweaveCostResult {
  cost: number; // Cost in lamports
  dataSize: number;
}

interface IrysCostResult {
  cost: number; // Cost in lamports
  dataSize: number;
}
```

## Error Handling

All clients include comprehensive error handling with:
- Automatic retries with exponential backoff
- Timeout protection
- Detailed error messages
- Logging support
- Graceful degradation

## Testing

The framework includes comprehensive test suites for all clients. Run tests with:

```bash
npm test
```

## Contributing

This framework is maintained by delegate.fun. For issues and contributions, please visit the GitHub repository. 