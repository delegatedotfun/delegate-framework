# Delegate-Framework Blockhash Fix Requirements

## Problem Identified

The delegate-framework's `sendNativeTransfer` and `sendTokenTransfer` methods are throwing the error:
```
Error: Transaction recentBlockhash required
```

This occurs even though we're successfully obtaining a recent blockhash and passing it to the methods.

## Root Cause

The delegate-framework is accepting the `recentBlockhash` parameter in the options but **not setting it on the Transaction object** before signing. The Solana web3.js library requires the blockhash to be set on the transaction before it can be compiled and signed.

## Current Error Flow

1. ✅ Blockhash obtained successfully: `Recent blockhash obtained: CEJy48qL6E...`
2. ✅ Blockhash passed to delegate-framework in options
3. ❌ **Delegate-framework ignores the blockhash**
4. ❌ **Transaction created without blockhash**
5. ❌ **Solana web3.js throws "Transaction recentBlockhash required"**

## Required Fix for Delegate-Framework

### 1. Update `sendNativeTransfer` Method

```typescript
async sendNativeTransfer(
  fromKeypair: Keypair,
  toAddress: PublicKey, 
  amount: number,
  options: {
    skipPreflight?: boolean;
    preflightCommitment?: string;
    recentBlockhash?: string; // <-- This needs to be used!
  }
) {
  // Create transaction
  const transaction = new Transaction();
  
  // Add transfer instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey: toAddress,
      lamports: amount
    })
  );
  
  // CRITICAL: Set the blockhash on the transaction
  if (options.recentBlockhash) {
    transaction.recentBlockhash = options.recentBlockhash;
  }
  
  // Sign and send
  transaction.sign(fromKeypair);
  // ... rest of sending logic
}
```

### 2. Update `sendTokenTransfer` Method

```typescript
async sendTokenTransfer(
  toTokenAccount: PublicKey,
  ownerKeypair: Keypair,
  amount: number,
  mint: PublicKey,
  options: {
    skipPreflight?: boolean;
    preflightCommitment?: string;
    recentBlockhash?: string; // <-- This needs to be used!
  }
) {
  // Create transaction
  const transaction = new Transaction();
  
  // Add token transfer instruction
  transaction.add(
    // ... token transfer instruction
  );
  
  // CRITICAL: Set the blockhash on the transaction
  if (options.recentBlockhash) {
    transaction.recentBlockhash = options.recentBlockhash;
  }
  
  // Sign and send
  transaction.sign(ownerKeypair);
  // ... rest of sending logic
}
```

## Key Points

### What's Currently Working
- ✅ Blockhash retrieval from Helius RPC
- ✅ Blockhash passing to delegate-framework
- ✅ Error handling and logging

### What's Missing
- ❌ **Setting blockhash on Transaction object**
- ❌ **Using the blockhash in delegate-framework**

### Expected Behavior After Fix
```
Getting recent blockhash for transaction...
Recent blockhash obtained: CEJy48qL6E...
SOL transfer completed via delegate-framework: 5J7X...
```

## Implementation Notes

1. **Blockhash Purpose**: Every Solana transaction needs a recent blockhash to:
   - Prevent replay attacks
   - Ensure transaction freshness
   - Allow network to validate transaction timing

2. **Critical Line**: The key fix is adding:
   ```typescript
   if (options.recentBlockhash) {
     transaction.recentBlockhash = options.recentBlockhash;
   }
   ```

3. **Timing**: This must be done **after** creating the transaction but **before** signing it.

4. **Error Handling**: Consider adding validation to ensure blockhash is provided when required.

## Testing

After implementing the fix, test with:
1. Native SOL transfers
2. Token transfers
3. Verify transactions are successfully sent
4. Check that blockhash is properly set on transaction objects

This fix should resolve the "Transaction recentBlockhash required" error and allow successful reward rerouting! 🎯 