
import { Book } from '../types';

const DB_NAME = 'LuminaDB';
const STORE_NAME = 'books';
const DB_VERSION = 1;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject('Failed to open IndexedDB');
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveBooks = async (books: Book[]): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Clear and re-save is simpler for this app's scale
    const clearRequest = store.clear();
    clearRequest.onsuccess = () => {
      books.forEach((book) => {
        store.add(book);
      });
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject('Failed to save books to IndexedDB');
  });
};

export const loadBooks = async (): Promise<Book[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject('Failed to load books from IndexedDB');
  });
};
