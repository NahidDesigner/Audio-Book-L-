import { ChapterInsights, VoiceName } from '../types';

interface JsonError {
  error?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as JsonError;
      if (body.error) {
        message = body.error;
      }
    } catch {
      // ignore parse errors and use fallback message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export interface TtsAudioPayload {
  pcmBase64: string;
  sampleRate: number;
  channels: number;
}

export async function generateTtsAudio(
  text: string,
  voiceName: VoiceName
): Promise<TtsAudioPayload> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceName }),
  });

  return parseResponse<TtsAudioPayload>(response);
}

export async function analyzeChapter(chapterTitle: string, fullText: string): Promise<ChapterInsights> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapterTitle, fullText }),
  });

  return parseResponse<ChapterInsights>(response);
}

export async function fetchDriveStatus(): Promise<boolean> {
  const response = await fetch('/api/auth/status', { credentials: 'include' });
  const data = await parseResponse<{ connected: boolean }>(response);
  return data.connected;
}

export async function fetchAdminStatus(): Promise<boolean> {
  const response = await fetch('/api/admin/status', { credentials: 'include' });
  const data = await parseResponse<{ isAdmin: boolean }>(response);
  return data.isAdmin;
}

export async function loginAsAdmin(email: string, password: string): Promise<void> {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  await parseResponse<{ success: boolean }>(response);
}

export async function logoutAdmin(): Promise<void> {
  const response = await fetch('/api/admin/logout', {
    method: 'POST',
    credentials: 'include',
  });
  await parseResponse<{ success: boolean }>(response);
}

export async function fetchDriveAuthUrl(redirectUri: string): Promise<string> {
  const response = await fetch(`/api/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`, {
    credentials: 'include',
  });
  const data = await parseResponse<{ url: string }>(response);
  return data.url;
}

export async function disconnectDrive(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
  await parseResponse<{ success: boolean }>(response);
}

export async function uploadAudioToDrive(
  base64Audio: string,
  filename: string,
  mimeType = 'audio/mpeg'
): Promise<string> {
  const response = await fetch('/api/drive/upload', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Audio, filename, mimeType }),
  });

  const data = await parseResponse<{ fileId: string }>(response);
  return data.fileId;
}
