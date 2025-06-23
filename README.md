# Delegate Framework

A TypeScript framework for building robust, production-ready Solana applications with comprehensive error handling, logging, and testing.

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

// Get recent blockhash
const blockhash = await client.getRecentBlockhash('confirmed');

// Get transaction details
const transaction = await client.getTransaction('signature-here');

// Get current slot
const slot = await client.getSlot('confirmed');
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
- `getAccountInfo(publicKey: PublicKey, encoding?: 'base64' | 'base58'): Promise<any>`
- `getTransaction(signature: string, commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<any>`
- `getRecentBlockhash(commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<any>`
- `getSlot(commitment?: 'processed' | 'confirmed' | 'finalized'): Promise<number>`
- `getClusterNodes(): Promise<any[]>`
- `getVersion(): Promise<any>`
- `sendTransaction(transaction: Transaction, options?: SendTransactionOptions): Promise<string>`

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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

MIT 