import crypto from "crypto";

export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialBackoffMs = options.initialBackoffMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const backoffMs =
        initialBackoffMs * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(
        `Attempt ${attempt + 1} failed, retrying in ${backoffMs.toFixed(0)}ms...`
      );
      await sleep(backoffMs);
    }
  }

  throw new Error("Unreachable");
}
