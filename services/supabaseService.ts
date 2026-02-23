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

  const response = (await withTimeout(
    client
      .from(TABLE_NAME)
      .select('books')
      .eq('device_id', key)
      .maybeSingle<Pick<LibraryRow, 'books'>>(),
    7000,
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

  const response = (await withTimeout(
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
    7000,
    'Supabase save'
  )) as { error: { message: string } | null };
  const { error } = response;

  if (error) {
    throw new Error(`Supabase save failed: ${error.message}`);
  }
}
