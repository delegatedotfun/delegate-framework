/**
 * Utility functions for error handling
 */

/**
 * Throws an error with proper type checking and handling
 * @param error - The error to throw (can be Error, string, or object with message)
 * @param context - Optional context information for debugging
 */
export function throwError(error: unknown, context?: string): never {
  if (error instanceof Error) {
    // Preserve original error with stack trace
    throw error;
  } else if (typeof error === 'string') {
    // Create Error from string
    const message = context ? `${context}: ${error}` : error;
    throw new Error(message);
  } else if (error && typeof error === 'object' && 'message' in error) {
    // Extract message from object
    const message = context ? `${context}: ${(error as any).message}` : (error as any).message;
    throw new Error(message);
  } else {
    // Fallback for any other type
    const message = context ? `${context}: ${String(error)}` : String(error);
    throw new Error(message);
  }
}

/**
 * Safely extracts error message from various error types
 * @param error - The error to extract message from
 * @returns The error message as a string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === 'string') {
    return error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  } else {
    return String(error);
  }
}

/**
 * Checks if a value is an error-like object
 * @param value - The value to check
 * @returns True if the value is an error-like object
 */
export function isErrorLike(value: unknown): value is { message: string } {
  return value !== null && 
         typeof value === 'object' && 
         'message' in value && 
         typeof (value as any).message === 'string';
}

/**
 * Creates a standardized error from various input types
 * @param error - The error input
 * @param defaultMessage - Default message if error is empty/null/undefined
 * @returns A standardized Error object
 */
export function createStandardError(error: unknown, defaultMessage = 'An unknown error occurred'): Error {
  if (error instanceof Error) {
    return error;
  } else if (typeof error === 'string' && error.trim()) {
    return new Error(error);
  } else if (isErrorLike(error)) {
    return new Error(error.message);
  } else {
    return new Error(defaultMessage);
  }
} 