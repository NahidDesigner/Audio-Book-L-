import { Book } from '../types';
import {
  isSupabaseConfigured,
  loadBooksFromSupabase,
  saveBooksToSupabase,
} from './supabaseService';

const DB_NAME = 'lumina-library-db';
const DB_VERSION = 1;
const STORE_NAME = 'library';
const ROOT_KEY = 'books';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Failed to open IndexedDB.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function loadBooksFromIndexedDb(): Promise<Book[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(ROOT_KEY);

    request.onsuccess = () => {
      const value = request.result;
      if (Array.isArray(value)) {
        resolve(value as Book[]);
      } else {
        resolve([]);
      }
    };
    request.onerror = () => reject(new Error('Failed to load books from IndexedDB.'));
  });
}

async function saveBooksToIndexedDb(books: Book[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(books, ROOT_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Failed to save books to IndexedDB.'));
  });
}

export async function loadBooks(): Promise<Book[]> {
  if (isSupabaseConfigured()) {
    try {
      const remoteBooks = await loadBooksFromSupabase();
      if (remoteBooks) {
        await saveBooksToIndexedDb(remoteBooks);
        return remoteBooks;
      }
    } catch (error) {
      console.error(error);
    }
  }

  return loadBooksFromIndexedDb();
}

export async function saveBooks(books: Book[]): Promise<void> {
  await saveBooksToIndexedDb(books);

  if (isSupabaseConfigured()) {
    try {
      await saveBooksToSupabase(books);
    } catch (error) {
      console.error(error);
    }
  }
}
