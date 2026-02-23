import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Book } from '../types';

interface LibraryRow {
  device_id: string;
  books: Book[];
  updated_at?: string;
}

const TABLE_NAME = 'lumina_library';
const DEVICE_ID_KEY = 'lumina_device_id';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

let client: SupabaseClient | null = null;
if (supabaseUrl && supabaseKey) {
  client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const nextId = createDeviceId();
  localStorage.setItem(DEVICE_ID_KEY, nextId);
  return nextId;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(client);
}

export async function loadBooksFromSupabase(): Promise<Book[] | null> {
  if (!client) {
    return null;
  }

  const deviceId = getDeviceId();
  const { data, error } = await client
    .from(TABLE_NAME)
    .select('books')
    .eq('device_id', deviceId)
    .maybeSingle<Pick<LibraryRow, 'books'>>();

  if (error) {
    throw new Error(`Supabase load failed: ${error.message}`);
  }

  if (!data || !Array.isArray(data.books)) {
    return [];
  }

  return data.books;
}

export async function saveBooksToSupabase(books: Book[]): Promise<void> {
  if (!client) {
    return;
  }

  const deviceId = getDeviceId();
  const { error } = await client.from(TABLE_NAME).upsert(
    {
      device_id: deviceId,
      books,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'device_id',
      ignoreDuplicates: false,
    }
  );

  if (error) {
    throw new Error(`Supabase save failed: ${error.message}`);
  }
}
