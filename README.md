# Delegate Framework

A TypeScript framework for building robust, production-ready blockchain workflows with comprehensive error handling, logging, and testing. Maintained by [delegate.fun](https://delegate.fun).

## Features

- **Solana RPC Clients**: Production-ready Helius and SPL clients with retry logic, timeouts, and error handling
- **Error Handling**: Modular error handling utilities for consistent error management across your application
- **TypeScript Support**: Full type safety with comprehensive interfaces and type definitions
- **Logging**: Built-in logging support with customizable loggers
- **Testing**: Comprehensive test suite with mocking and edge case coverage
- **Configuration**: Flexible configuration management with sensible defaults

```bash
npm install delegate-framework
# or
pnpm add delegate-framework
# or
yarn add delegate-framework
```

## Quick Start

### Helius RPC Client

```typescript
import { HeliusClient } from 'delegate-framework';
import { PublicKey } from '@solana/web3.js';

// Create a Helius client
const client = new HeliusClient({
  apiKey: 'your-helius-api-key',
  timeout: 30000,
  retries: 3,
});

// Get account balance
const publicKey = new PublicKey('11111111111111111111111111111111');
const balance = await client.getBalance(publicKey);
console.log('Balance:', balance);

// Get account information
const accountInfo = await client.getAccountInfo(publicKey, 'base64');

// Get account information with Metaplex metadata parsing
const metadata = await client.getAccountInfo(publicKey, { 
  parseMetaplexMetadata: true,
  includeOffChainMetadata: true 
});
console.log('NFT Name:', metadata.name);
console.log('Creators:', metadata.creators);

// Get recent blockhash
const blockhash = await client.getRecentBlockhash('confirmed');

// Get transaction details
const transaction = await client.getTransaction('signature-here');

// Get current slot
const slot = await client.getSlot('confirmed');

// Send native SOL transfer
const signature = await client.sendNativeTransfer(
  keypair, // Use keypair directly as from parameter
  new PublicKey('to-wallet-address'),
  1000000 // 0.001 SOL in lamports
);
console.log('Transfer signature:', signature);

// Send SPL token transfer
const tokenSignature = await client.sendTokenTransfer(
  new PublicKey('to-token-account'),
  keypair, // Use keypair directly as owner parameter
  1000000, // amount
  new PublicKey('token-mint-address')
);
console.log('Token transfer signature:', tokenSignature);

// Get comprehensive asset data for an NFT or token
const assetId = '11111111111111111111111111111111'; // Mint address
const assetData = await client.getAsset(assetId);
console.log('Asset data:', assetData);
```

### SPL Client for Priority Fees

```typescript
import { SplClient } from 'delegate-framework';
import { Connection, PublicKey } from '@solana/web3.js';

// Create an SPL client
const connection = new Connection('https://api.mainnet-beta.solana.com');
const client = new SplClient({
  connection,
  programId: new PublicKey('your-program-id'),
  timeout: 30000,
  retries: 3,
  percentile: 0.95, // 95th percentile
  defaultCuPrice: 0.1,
});

// Get priority fee based on recent network activity
const priorityFee = await client.getPriorityFee();
console.log('Priority fee:', priorityFee);
```

### Error Handling Utilities

```typescript
import { throwError, getErrorMessage, isErrorLike } from 'delegate-framework';

// Throw errors with proper type checking
if (data.error) {
  throwError(data.error, 'API Error');
}

// Extract error messages safely
const message = getErrorMessage(someError);

// Check if value is error-like
if (isErrorLike(response.error)) {
  console.log(response.error.message);
}
```

### Custom Logging

```typescript
import { Logger } from 'delegate-framework';

class CustomLogger implements Logger {
  debug(message: string, data?: any) {
    console.log(`[DEBUG] ${message}`, data);
  }
  
  info(message: string, data?: any) {
    console.log(`[INFO] ${message}`, data);
  }
  
  warn(message: string, data?: any) {
    console.warn(`[WARN] ${message}`, data);
  }
  
  error(message: string, data?: any) {
    console.error(`[ERROR] ${message}`, data);
  }
}

// Use custom logger
const client = new HeliusClient({
  apiKey: 'your-api-key',
  logger: new CustomLogger(),
});
```

## API Reference

### HeliusClient

#### Constructor
```typescript
new HeliusClient(config: HeliusConfig)
```

#### Configuration
```typescript
interface HeliusConfig {
  apiKey: string;
  rpcUrl?: string;        // Default: "https://mainnet.helius-rpc.com"
  timeout?: number;       // Default: 30000ms
  retries?: number;       // Default: 3
  logger?: Logger;        // Optional custom logger
}
```

#### Methods
- `getBalance(publicKey: PublicKey): Promise<number>`
- `getAccountInfo(publicKey: PublicKey, encodingOrOptions?: 'base64' | 'base58' | GetAccountInfoOptions): Promise<any>` - Get account info with optional Metaplex metadata parsing
- `getTransaction(signature: string, commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<any>`
- `getAsset(assetId: string): Promise<any>` - Get comprehensive asset data for any Solana NFT or digital asset
- `getRecentBlockhash(commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<any>`
- `getSlot(commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<number>`
- `getClusterNodes(): Promise<any[]>`
- `getVersion(): Promise<any>`
- `sendTransaction(transaction: Transaction, options?: SendTransactionOptions): Promise<string>`
- `sendNativeTransfer(from: Keypair, to: PublicKey, amount: number, options?: SendTransactionOptions): Promise<string>` - Send native SOL transfer
- `sendTokenTransfer(to: PublicKey, owner: Keypair, amount: number, mint: PublicKey, options?: SendTransactionOptions): Promise<string>` - Send SPL token transfer

### SplClient

#### Constructor
```typescript
new SplClient(config: SplConfig)
```

#### Configuration
```typescript
interface SplConfig {
  connection: Connection;
  programId: PublicKey;
  timeout?: number;       // Default: 30000ms
  retries?: number;       // Default: 3
  logger?: Logger;        // Optional custom logger
  percentile?: number;    // Default: 0.9999999 (99.99999th percentile)
  defaultCuPrice?: number; // Default: 0.1
}
```

#### Methods
- `getPriorityFee(): Promise<number>`

### Error Handling Utilities

#### `throwError(error: unknown, context?: string): never`
Throws an error with proper type checking and handling.

#### `getErrorMessage(error: unknown): string`
Safely extracts error message from various error types.

#### `isErrorLike(value: unknown): value is { message: string }`
Type guard for error-like objects.

#### `createStandardError(error: unknown, defaultMessage?: string): Error`
Creates a standardized Error object from various input types.

## Configuration

### Default Values

| Setting | HeliusClient | SplClient | Description |
|---------|--------------|-----------|-------------|
| Timeout | 30,000ms | 30,000ms | Request timeout |
| Retries | 3 | 3 | Number of retry attempts |
| RPC URL | Helius Mainnet | - | RPC endpoint |
| Percentile | - | 99.99999% | Fee calculation percentile |
| Default CU Price | - | 0.1 | Default compute unit price |

### Environment Variables

```bash
HELIUS_API_KEY=your-api-key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com
```

## Error Handling

The framework provides robust error handling with:

- **Automatic retries** with exponential backoff
- **Timeout handling** to prevent hanging requests
- **Network error detection** and recovery
- **API error handling** with proper error messages
- **Type-safe error utilities** for consistent error management

### Error Types

- **Network Errors**: Connection failures, timeouts
- **API Errors**: JSON-RPC errors from Solana nodes
- **Validation Errors**: Invalid parameters or responses
- **Configuration Errors**: Missing or invalid configuration

## Testing

The framework includes comprehensive tests covering:

- All client methods and configurations
- Error handling and retry logic
- Timeout scenarios
- Edge cases and invalid inputs
- Logging functionality

Run tests:
```bash
pnpm test
```

## Development

### Building
```bash
pnpm build
```

### Linting
```bash
pnpm lint
```

### Formatting
```bash
pnpm format
```

### Type Checking
```bash
pnpm type-check
```

## Examples

### Complete Transaction Flow

```typescript
import { HeliusClient, SplClient } from 'delegate-framework';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';

async function sendTransactionWithPriorityFee() {
  // Setup clients
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  const heliusClient = new HeliusClient({ apiKey: 'your-api-key' });
  const splClient = new SplClient({ 
    connection, 
    programId: new PublicKey('your-program-id') 
  });

  // Get priority fee
  const priorityFee = await splClient.getPriorityFee();
  
  // Create and send transaction
  const transaction = new Transaction();
  // ... add instructions to transaction
  
  const signature = await heliusClient.sendTransaction(transaction, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  
  console.log('Transaction sent:', signature);
}
```

### Token Transfer Examples

```typescript
import { HeliusClient } from 'delegate-framework';
import { PublicKey, Keypair } from '@solana/web3.js';

async function performTransfers() {
  const client = new HeliusClient({ apiKey: 'your-api-key' });
  
  // Create or load your keypair
  const keypair = Keypair.fromSecretKey(/* your secret key bytes */);
  // Or load from environment: Keypair.fromSecretKey(Buffer.from(process.env.PRIVATE_KEY, 'base64'));
  
  // Send native SOL transfer
  const solSignature = await client.sendNativeTransfer(
    keypair, // Use keypair directly as from parameter
    new PublicKey('22222222222222222222222222222222'), // to
    1000000, // 0.001 SOL in lamports
    {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    }
  );
  console.log('SOL transfer:', solSignature);
  
  // Send SPL token transfer (e.g., USDC)
  const tokenSignature = await client.sendTokenTransfer(
    new PublicKey('44444444444444444444444444444444'), // to token account
    keypair, // Use keypair directly as owner parameter
    1000000, // amount (1 USDC = 1,000,000 with 6 decimals)
    new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC mint
    {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    }
  );
  console.log('Token transfer:', tokenSignature);
}

// Helper function to convert human-readable amounts to raw amounts
function convertToRawAmount(amount: number, decimals: number): number {
  return Math.floor(amount * Math.pow(10, decimals));
}

// Example: Transfer 1.5 USDC
async function transferUSDC() {
  const client = new HeliusClient({ apiKey: 'your-api-key' });
  
  // Load your keypair (replace with your actual keypair loading logic)
  const keypair = Keypair.fromSecretKey(/* your secret key */);
  
  const rawAmount = convertToRawAmount(1.5, 6); // USDC has 6 decimals
  const signature = await client.sendTokenTransfer(
    new PublicKey('to-token-account'),
    keypair, // Use keypair directly as owner parameter
    rawAmount,
    new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') // USDC mint
  );
  
  console.log('USDC transfer completed:', signature);
}
```

### Asset Data Retrieval

```typescript
import { HeliusClient } from 'delegate-framework';

async function getAssetInformation() {
  const client = new HeliusClient({ apiKey: 'your-api-key' });
  
  // Get comprehensive data for an NFT or token
  const assetId = '11111111111111111111111111111111'; // Mint address
  const assetData = await client.getAsset(assetId);
  
  // Asset data includes on-chain metadata, off-chain metadata, and more
  console.log('Asset name:', assetData[0]?.onChainMetadata?.metadata?.name);
  console.log('Token standard:', assetData[0]?.onChainMetadata?.tokenStandard);
  console.log('Off-chain metadata:', assetData[0]?.offChainMetadata);
}
```

### Metaplex Metadata Parsing

```typescript
import { HeliusClient } from 'delegate-framework';
import { PublicKey } from '@solana/web3.js';

async function getMetaplexMetadata() {
  const client = new HeliusClient({ apiKey: 'your-api-key' });
  
  // Get metadata directly from a metadata account
  const metadataAccount = new PublicKey('metadata-account-address');
  const metadata = await client.getAccountInfo(metadataAccount, { 
    parseMetaplexMetadata: true,
    includeOffChainMetadata: true 
  });
  
  console.log('NFT Name:', metadata.name);
  console.log('Symbol:', metadata.symbol);
  console.log('Creators:', metadata.creators);
  console.log('Collection:', metadata.collection);
  console.log('Royalty:', metadata.sellerFeeBasisPoints / 100, '%');
  
  // Get metadata from a mint address (automatically derives metadata account)
  const mintAddress = new PublicKey('mint-address');
  const mintMetadata = await client.getAccountInfo(mintAddress, { 
    parseMetaplexMetadata: true 
  });
  
  console.log('Mint Metadata:', mintMetadata);
}
```

### Error Handling Example

```typescript
import { HeliusClient, throwError, getErrorMessage } from 'delegate-framework';

async function safeGetBalance(publicKey: PublicKey) {
  try {
    const client = new HeliusClient({ apiKey: 'your-api-key' });
    return await client.getBalance(publicKey);
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('Failed to get balance:', message);
    
    // Re-throw with context
    throwError(error, 'Balance Check Failed');
  }
}
```

### Practical Transfer Workflow

```typescript
import { HeliusClient } from 'delegate-framework';
import { PublicKey, Keypair } from '@solana/web3.js';

async function completeTransferWorkflow() {
  const client = new HeliusClient({ 
    apiKey: 'your-api-key',
    timeout: 30000,
    retries: 3 
  });
  
  // Load your keypair (replace with your actual keypair loading logic)
  const keypair = Keypair.fromSecretKey(/* your secret key bytes */);
  
  // 1. Check balances before transfer
  const fromWallet = keypair.publicKey; // Get public key from keypair
  const toWallet = new PublicKey('recipient-address');
  
  const fromBalance = await client.getBalance(fromWallet);
  const toBalance = await client.getBalance(toWallet);
  
  console.log('From balance:', fromBalance / 1e9, 'SOL');
  console.log('To balance:', toBalance / 1e9, 'SOL');
  
  // 2. Send native SOL transfer
  const transferAmount = 0.001 * 1e9; // 0.001 SOL in lamports
  
  try {
    const signature = await client.sendNativeTransfer(
      keypair, // Use keypair directly as from parameter
      toWallet,
      transferAmount,
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      }
    );
    
    console.log('Transfer sent:', signature);
    
    // 3. Wait for confirmation
    const confirmation = await client.waitForConfirmation(signature, 'confirmed');
    console.log('Transfer confirmed:', confirmation);
    
    // 4. Check balances after transfer
    const newFromBalance = await client.getBalance(fromWallet);
    const newToBalance = await client.getBalance(toWallet);
    
    console.log('New from balance:', newFromBalance / 1e9, 'SOL');
    console.log('New to balance:', newToBalance / 1e9, 'SOL');
    
  } catch (error) {
    console.error('Transfer failed:', error);
  }
}

// Advanced: Token transfer with balance checks
async function tokenTransferWithValidation() {
  const client = new HeliusClient({ apiKey: 'your-api-key' });
  
  // Load your keypair
  const keypair = Keypair.fromSecretKey(/* your secret key bytes */);
  
  const toTokenAccount = new PublicKey('recipient-token-account');
  const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  
  // Get the source token account for balance checking
  const sourceTokenAccount = await client.getTokenAccount(keypair.publicKey, mint);
  const fromTokenAccount = new PublicKey(sourceTokenAccount.value[0].pubkey);
  
  // Check token balances
  const fromBalance = await client.getTokenAccountBalance(fromTokenAccount);
  const toBalance = await client.getTokenAccountBalance(toTokenAccount);
  
  console.log('From token balance:', fromBalance.value.uiAmount, 'USDC');
  console.log('To token balance:', toBalance.value.uiAmount, 'USDC');
  
  // Transfer 10 USDC
  const transferAmount = 10 * 1e6; // USDC has 6 decimals
  
  if (fromBalance.value.uiAmount < 10) {
    throw new Error('Insufficient token balance');
  }
  
  const signature = await client.sendTokenTransfer(
    toTokenAccount,
    keypair, // Use keypair directly as owner parameter
    transferAmount,
    mint
  );
  
  console.log('Token transfer completed:', signature);
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT 