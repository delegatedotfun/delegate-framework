/**
 * Core types for the delegate framework
 */

export interface Delegate<T = any> {
  (target: T, ...args: any[]): any;
}

export interface DelegateContext<T = any> {
  target: T;
  args: any[];
  result?: any;
  error?: Error;
}

export interface DelegateOptions {
  timeout?: number;
  retries?: number;
  fallback?: Delegate;
}

export interface DelegateChain<T = any> {
  add(delegate: Delegate<T>): DelegateChain<T>;
  remove(delegate: Delegate<T>): DelegateChain<T>;
  execute(target: T, ...args: any[]): Promise<any>;
  clear(): void;
}

export type DelegateResult<T = any> = {
  success: true;
  data: T;
} | {
  success: false;
  error: Error;
}; 