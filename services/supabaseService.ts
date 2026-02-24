import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Book } from '../types';

interface LibraryRow {
  device_id: string;
  books: Book[];
  updated_at?: string;
}

const TABLE_NAME = 'lumina_library';
const LEGACY_DEVICE_ID_KEY = 'lumina_device_id';
const DEFAULT_SHARED_LIBRARY_KEY = 'public-library';
const SUPABASE_LOAD_TIMEOUT_MS = 20000;
const SUPABASE_SAVE_TIMEOUT_MS = 15000;
const SUPABASE_LOAD_RETRIES = 3;
const SUPABASE_SAVE_RETRIES = 2;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const sharedLibraryKey =
  (import.meta.env.VITE_LIBRARY_KEY as string | undefined)?.trim() || DEFAULT_SHARED_LIBRARY_KEY;

function withTimeout<T>(promiseLike: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promiseLike)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function isRetryableSupabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed out|Failed to fetch|NetworkError|network request failed/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withRetry<T>(
  task: () => Promise<T>,
  retries: number,
  label: string
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryableSupabaseError(error)) {
        break;
      }
      // Small linear backoff for transient connectivity issues.
      await sleep(500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

let client: SupabaseClient | null = null;
if (supabaseUrl && supabaseKey) {
  client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getLegacyDeviceId(): string | null {
  try {
    return localStorage.getItem(LEGACY_DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

async function fetchBooksByKey(key: string): Promise<Book[] | null> {
  if (!client) {
    return null;
  }

  const response = (await withRetry(
    () =>
      withTimeout(
        client
          .from(TABLE_NAME)
          .select('books')
          .eq('device_id', key)
          .maybeSingle<Pick<LibraryRow, 'books'>>(),
        SUPABASE_LOAD_TIMEOUT_MS,
        `Supabase load (${key})`
      ),
    SUPABASE_LOAD_RETRIES,
    `Supabase load (${key})`
  )) as { data: Pick<LibraryRow, 'books'> | null; error: { message: string } | null };
  const { data, error } = response;

  if (error) {
    throw new Error(`Supabase load failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }
  if (!Array.isArray(data.books)) {
    return [];
  }

  return data.books;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(client);
}

export async function loadBooksFromSupabase(): Promise<Book[] | null> {
  if (!client) {
    return null;
  }

  const sharedBooks = await fetchBooksByKey(sharedLibraryKey);
  if (sharedBooks && sharedBooks.length > 0) {
    return sharedBooks;
  }

  const legacyDeviceId = getLegacyDeviceId();
  if (legacyDeviceId && legacyDeviceId !== sharedLibraryKey) {
    const legacyBooks = await fetchBooksByKey(legacyDeviceId);
    if (legacyBooks && legacyBooks.length > 0) {
      await saveBooksToSupabase(legacyBooks);
      return legacyBooks;
    }
  }

  if (sharedBooks) {
    return sharedBooks;
  }

  return [];
}

export async function saveBooksToSupabase(books: Book[]): Promise<void> {
  if (!client) {
    return;
  }

  const response = (await withRetry(
    () =>
      withTimeout(
        client.from(TABLE_NAME).upsert(
          {
            device_id: sharedLibraryKey,
            books,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'device_id',
            ignoreDuplicates: false,
          }
        ),
        SUPABASE_SAVE_TIMEOUT_MS,
        'Supabase save'
      ),
    SUPABASE_SAVE_RETRIES,
    'Supabase save'
  )) as { error: { message: string } | null };
  const { error } = response;

  if (error) {
    throw new Error(`Supabase save failed: ${error.message}`);
  }
}
