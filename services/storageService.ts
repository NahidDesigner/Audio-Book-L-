import { Book } from '../types';
import {
  checkSupabaseConnection,
  type SupabaseConnectionInfo,
  isSupabaseConfigured,
  loadBooksFromSupabase,
  saveBooksToSupabase,
} from './supabaseService';

const LEGACY_DB_NAME = 'lumina-library-db';

function clearLegacyIndexedDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }

    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onerror = () => reject(new Error('Failed to clear IndexedDB cache.'));
    request.onsuccess = () => resolve();
    request.onblocked = () => reject(new Error('IndexedDB clear is blocked by an open tab.'));
  });
}

export async function loadBooks(): Promise<Book[]> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase is not configured. Shared library is unavailable.');
    return [];
  }

  const remoteBooks = await loadBooksFromSupabase();
  return remoteBooks ?? [];
}

export async function saveBooks(books: Book[]): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase is not configured. Skipping library save.');
    return;
  }

  await saveBooksToSupabase(books);
}

export async function clearLocalCache(): Promise<void> {
  await clearLegacyIndexedDb();
}

export async function checkStorageConnection(): Promise<SupabaseConnectionInfo> {
  if (!isSupabaseConfigured()) {
    return {
      connected: false,
      message: 'Supabase is not configured at build time.',
    };
  }

  return checkSupabaseConnection();
}
