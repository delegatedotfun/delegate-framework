# Delegate Framework

A TypeScript framework for implementing delegation patterns with support for chaining, error handling, retries, and more.

## Features

- **Simple Delegates**: Create and execute individual delegates with error handling
- **Delegate Chains**: Chain multiple delegates together for complex workflows
- **Error Handling**: Built-in retry logic and fallback support
- **Timeout Support**: Prevent delegates from hanging indefinitely
- **Utility Functions**: Helper functions for common delegation patterns
- **TypeScript Support**: Full type safety and IntelliSense support

## Installation

```bash
npm install delegate-framework
```

## Quick Start

```typescript
import { createDelegate, createDelegateChain, loggingDelegate } from 'delegate-framework';

// Create a simple delegate
const addDelegate = createDelegate((target: number, value: number) => target + value);

// Execute the delegate
const result = await addDelegate.execute(5, 3); // Returns { success: true, data: 8 }

// Create a delegate chain
const chain = createDelegateChain<number>()
  .add((target, value) => target + value)
  .add((target, value) => target * 2)
  .add(loggingDelegate((target) => target.toString()));

// Execute the chain
const chainResult = await chain.execute(5, 3); // Returns "16"
```

## API Reference

### Core Classes

#### `SimpleDelegate<T>`

A wrapper around a single delegate function with error handling and retry support.

```typescript
import { createDelegate } from 'delegate-framework';

const delegate = createDelegate(
  (target: string, prefix: string) => `${prefix}${target}`,
  { timeout: 5000, retries: 3 }
);

const result = await delegate.execute("world", "Hello ");
```

#### `DelegateChain<T>`

A chain of delegates that execute sequentially, passing results from one to the next.

```typescript
import { createDelegateChain } from 'delegate-framework';

const chain = createDelegateChain<number>()
  .add((target, value) => target + value)
  .add((target) => target * 2)
  .add((target) => target.toString());

const result = await chain.execute(5, 3); // Returns "16"
```

### Utility Functions

#### `loggingDelegate<T>`

Wraps a delegate with logging functionality.

```typescript
import { loggingDelegate } from 'delegate-framework';

const loggedDelegate = loggingDelegate(
  (target: string) => target.toUpperCase(),
  console
);
```

#### `retryDelegate<T>`

Wraps a delegate with retry logic.

```typescript
import { retryDelegate } from 'delegate-framework';

const retryableDelegate = retryDelegate(
  async (target: string) => {
    // Some operation that might fail
    return target.toUpperCase();
  },
  3, // max retries
  1000 // delay between retries
);
```

#### `timeoutDelegate<T>`

Wraps a delegate with timeout functionality.

```typescript
import { timeoutDelegate } from 'delegate-framework';

const timeoutDelegate = timeoutDelegate(
  async (target: string) => {
    // Some slow operation
    await new Promise(resolve => setTimeout(resolve, 10000));
    return target.toUpperCase();
  },
  5000 // timeout after 5 seconds
);
```

#### `cachedDelegate<T>`

Wraps a delegate with caching functionality.

```typescript
import { cachedDelegate } from 'delegate-framework';

const cachedDelegate = cachedDelegate(
  (target: string) => expensiveOperation(target)
);
```

### Types

```typescript
interface Delegate<T = any> {
  (target: T, ...args: any[]): any;
}

interface DelegateOptions {
  timeout?: number;
  retries?: number;
  fallback?: Delegate;
}

interface DelegateChain<T = any> {
  add(delegate: Delegate<T>): DelegateChain<T>;
  remove(delegate: Delegate<T>): DelegateChain<T>;
  execute(target: T, ...args: any[]): Promise<any>;
  clear(): void;
}
```

## Examples

### Error Handling with Fallback

```typescript
import { createDelegate, fallbackDelegate } from 'delegate-framework';

const primaryDelegate = createDelegate(async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Request failed');
  return response.json();
});

const fallbackDelegate = createDelegate((url: string) => {
  return { data: 'fallback data' };
});

const delegate = createDelegate(
  fallbackDelegate(primaryDelegate.execute, fallbackDelegate.execute)
);

const result = await delegate.execute('https://api.example.com/data');
```

### Complex Workflow Chain

```typescript
import { createDelegateChain, loggingDelegate, retryDelegate } from 'delegate-framework';

const workflow = createDelegateChain<{ id: string; data: any }>()
  .add(loggingDelegate(async (item) => {
    // Validate input
    if (!item.id) throw new Error('Missing ID');
    return item;
  }))
  .add(retryDelegate(async (item) => {
    // Process data
    const processed = await processData(item.data);
    return { ...item, processed };
  }, 3))
  .add(loggingDelegate(async (item) => {
    // Save to database
    await saveToDatabase(item);
    return item;
  }));

const result = await workflow.execute({ id: '123', data: { name: 'test' } });
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Formatting

```bash
npm run format
```

## License

MIT 