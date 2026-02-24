import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { google } from 'googleapis';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OAUTH_STATE_COOKIE = 'lumina_oauth_state';
const DRIVE_TOKEN_COOKIE = 'lumina_drive_tokens';
const DRIVE_FOLDER_NAME = 'Lumina Audiobooks';
const ADMIN_SESSION_COOKIE = 'lumina_admin_session';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'nahidwebdesigner@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nahidnhd';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'change-admin-session-secret';

app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

interface OAuthStatePayload {
  nonce: string;
  redirectUri: string;
  appOrigin: string;
}

interface TtsRequestBody {
  text: string;
  voiceName: string;
}

interface AnalyzeRequestBody {
  chapterTitle: string;
  fullText: string;
}

interface UploadRequestBody {
  base64Audio: string;
  filename?: string;
  mimeType?: string;
}

interface AdminLoginBody {
  email: string;
  password: string;
}

function jsonError(res: express.Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function isSecureRequest(req: express.Request): boolean {
  if (req.secure) {
    return true;
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0].trim() === 'https';
  }
  return false;
}

function getCookieOptions(req: express.Request) {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax' as const,
    path: '/',
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signAdminPayload(payloadBase64: string): string {
  return crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payloadBase64).digest('base64url');
}

function createAdminSessionToken(email: string): string {
  const payload = {
    email,
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signAdminPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function verifyAdminSessionToken(token: string): { email: string; exp: number } | null {
  const [payloadBase64, signature] = token.split('.');
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expectedSignature = signAdminPayload(payloadBase64);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as {
      email?: string;
      exp?: number;
    };

    if (!payload.email || typeof payload.exp !== 'number') {
      return null;
    }
    if (payload.exp < Date.now()) {
      return null;
    }
    return { email: payload.email, exp: payload.exp };
  } catch {
    return null;
  }
}

function isAdminAuthenticated(req: express.Request): boolean {
  const token = req.cookies[ADMIN_SESSION_COOKIE];
  if (!token || typeof token !== 'string') {
    return false;
  }
  const payload = verifyAdminSessionToken(token);
  return Boolean(payload && payload.email === ADMIN_EMAIL);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isAdminAuthenticated(req)) {
    return jsonError(res, 401, 'Admin authentication required.');
  }
  next();
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY environment variable.');
  }
  return new GoogleGenAI({ apiKey });
}

function validateRedirectUri(redirectUri: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error('Invalid redirectUri format.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('redirectUri must use http or https.');
  }
  return parsed;
}

function createOAuthClient(redirectUri: string) {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variable.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function encodeState(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeState(value: string): OAuthStatePayload {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const parsed = JSON.parse(decoded) as OAuthStatePayload;
  if (!parsed.nonce || !parsed.redirectUri || !parsed.appOrigin) {
    throw new Error('Invalid state payload.');
  }
  return parsed;
}

function getDriveService(req: express.Request) {
  const tokensString = req.cookies[DRIVE_TOKEN_COOKIE];
  if (!tokensString) {
    throw new Error('Google Drive is not connected.');
  }

  const parsed = JSON.parse(tokensString);
  const oauth = createOAuthClient('postmessage');
  oauth.setCredentials(parsed);

  return google.drive({ version: 'v3', auth: oauth });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/admin/status', (req, res) => {
  res.json({ isAdmin: isAdminAuthenticated(req) });
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body as AdminLoginBody;

  if (!email || !password) {
    return jsonError(res, 400, 'email and password are required.');
  }

  if (!safeEqual(email.trim().toLowerCase(), ADMIN_EMAIL.toLowerCase()) || !safeEqual(password, ADMIN_PASSWORD)) {
    return jsonError(res, 401, 'Invalid admin credentials.');
  }

  const token = createAdminSessionToken(ADMIN_EMAIL);
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    ...getCookieOptions(req),
    maxAge: ADMIN_SESSION_TTL_MS,
  });
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(ADMIN_SESSION_COOKIE, getCookieOptions(req));
  res.json({ success: true });
});

app.post('/api/tts', requireAdmin, async (req, res) => {
  try {
    const { text, voiceName } = req.body as TtsRequestBody;

    if (!text || !text.trim()) {
      return jsonError(res, 400, 'text is required.');
    }
    if (!voiceName || !voiceName.trim()) {
      return jsonError(res, 400, 'voiceName is required.');
    }

    const ai = getGeminiClient();
    const isBengali = /[\u0980-\u09FF]/.test(text);
    const narratorInstruction = isBengali
      ? 'You are a professional Bengali audiobook narrator. Read naturally with proper pauses and clear articulation.'
      : 'You are a professional audiobook narrator. Read naturally with clear pronunciation and pacing.';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [
        {
          parts: [
            {
              text: `${narratorInstruction}\n\n${text}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName,
            },
          },
        },
      },
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data);
    const pcmBase64 = audioPart?.inlineData?.data;

    if (!pcmBase64) {
      return jsonError(res, 502, 'Gemini did not return audio data.');
    }

    res.json({
      pcmBase64,
      mimeType: 'audio/pcm',
      sampleRate: 24000,
      channels: 1,
    });
  } catch (error: any) {
    console.error('TTS generation failed:', error);
    jsonError(res, 500, error?.message || 'TTS generation failed.');
  }
});

app.post('/api/analyze', requireAdmin, async (req, res) => {
  try {
    const { chapterTitle, fullText } = req.body as AnalyzeRequestBody;

    if (!chapterTitle || !fullText) {
      return jsonError(res, 400, 'chapterTitle and fullText are required.');
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze chapter "${chapterTitle}".\n\nIMPORTANT: Respond in the same language as the input text.\nReturn concise output with:\n1) summary\n2) exactly 3 discussion questions\n\nCHAPTER TEXT:\n${fullText}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['summary', 'questions'],
          properties: {
            summary: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Chapter analysis failed:', error);
    jsonError(res, 500, error?.message || 'Chapter analysis failed.');
  }
});

app.get('/api/auth/url', requireAdmin, (req, res) => {
  try {
    const redirectUriParam = req.query.redirectUri;
    if (typeof redirectUriParam !== 'string') {
      return jsonError(res, 400, 'redirectUri query parameter is required.');
    }

    const redirectUri = validateRedirectUri(redirectUriParam);
    const nonce = crypto.randomBytes(16).toString('hex');
    const appOrigin = redirectUri.origin;

    const statePayload: OAuthStatePayload = {
      nonce,
      redirectUri: redirectUri.toString(),
      appOrigin,
    };
    const state = encodeState(statePayload);

    const oauth = createOAuthClient(redirectUri.toString());
    const authUrl = oauth.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      state,
      prompt: 'consent',
    });

    res.cookie(OAUTH_STATE_COOKIE, state, {
      ...getCookieOptions(req),
      maxAge: 10 * 60 * 1000,
    });

    res.json({ url: authUrl });
  } catch (error: any) {
    console.error('Auth URL generation failed:', error);
    jsonError(res, 500, error?.message || 'Could not create auth URL.');
  }
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  try {
    if (!isAdminAuthenticated(req)) {
      return res.status(401).send('Admin authentication required.');
    }

    const stateFromQuery = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';

    if (!stateFromQuery || !code) {
      return res.status(400).send('Missing OAuth code or state.');
    }

    const stateFromCookie = req.cookies[OAUTH_STATE_COOKIE];
    if (!stateFromCookie || stateFromCookie !== stateFromQuery) {
      return res.status(400).send('Invalid OAuth state.');
    }

    const payload = decodeState(stateFromQuery);
    const oauth = createOAuthClient(payload.redirectUri);
    const tokenResponse = await oauth.getToken(code);

    res.clearCookie(OAUTH_STATE_COOKIE, getCookieOptions(req));
    res.cookie(DRIVE_TOKEN_COOKIE, JSON.stringify(tokenResponse.tokens), {
      ...getCookieOptions(req),
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const safeTargetOrigin = payload.appOrigin.replace(/'/g, '');

    res.send(`
      <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <p>Google Drive connected. You can close this window.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '${safeTargetOrigin}');
              window.close();
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback failed:', error);
    res.status(500).send('Google authentication failed.');
  }
});

app.get('/api/auth/status', (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.json({ connected: false });
  }
  res.json({ connected: Boolean(req.cookies[DRIVE_TOKEN_COOKIE]) });
});

app.post('/api/auth/logout', requireAdmin, (req, res) => {
  res.clearCookie(OAUTH_STATE_COOKIE, getCookieOptions(req));
  res.clearCookie(DRIVE_TOKEN_COOKIE, getCookieOptions(req));
  res.json({ success: true });
});

app.post('/api/drive/upload', requireAdmin, async (req, res) => {
  try {
    const { base64Audio, filename, mimeType } = req.body as UploadRequestBody;

    if (!base64Audio) {
      return jsonError(res, 400, 'base64Audio is required.');
    }

    const drive = getDriveService(req);

    const existingFolders = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
      pageSize: 1,
    });

    let folderId = existingFolders.data.files?.[0]?.id;

    if (!folderId) {
      const createdFolder = await drive.files.create({
        requestBody: {
          name: DRIVE_FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder',
        },
        fields: 'id',
      });
      folderId = createdFolder.data.id || undefined;
    }

    if (!folderId) {
      return jsonError(res, 500, 'Could not resolve Drive destination folder.');
    }

    const contentBuffer = Buffer.from(base64Audio, 'base64');
    const createdFile = await drive.files.create({
      requestBody: {
        name: filename || `lumina-${Date.now()}.mp3`,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType || 'audio/mpeg',
        body: Readable.from(contentBuffer),
      },
      fields: 'id,name,mimeType',
    });

    const fileId = createdFile.data.id;
    if (!fileId) {
      return jsonError(res, 500, 'Drive upload succeeded but did not return a file ID.');
    }

    // Make uploaded audio publicly readable so visitors can stream without admin cookies.
    try {
      await drive.permissions.create({
        fileId,
        requestBody: {
          type: 'anyone',
          role: 'reader',
        },
      });
    } catch (permissionError) {
      console.warn('Could not set Drive file to public-read:', permissionError);
    }

    const publicUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
    res.json({ fileId, publicUrl });
  } catch (error: any) {
    console.error('Drive upload failed:', error);
    jsonError(res, 500, error?.message || 'Drive upload failed.');
  }
});

app.post('/api/drive/publish', requireAdmin, async (req, res) => {
  try {
    const { fileId } = req.body as { fileId?: string };
    if (!fileId || !fileId.trim()) {
      return jsonError(res, 400, 'fileId is required.');
    }

    const drive = getDriveService(req);
    const trimmedFileId = fileId.trim();

    try {
      await drive.permissions.create({
        fileId: trimmedFileId,
        requestBody: {
          type: 'anyone',
          role: 'reader',
        },
      });
    } catch (permissionError) {
      // If permission already exists, keep going.
      console.warn('Could not create Drive public permission for file:', trimmedFileId, permissionError);
    }

    const publicUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(trimmedFileId)}`;
    res.json({ fileId: trimmedFileId, publicUrl });
  } catch (error: any) {
    console.error('Drive publish failed:', error);
    jsonError(res, 500, error?.message || 'Drive publish failed.');
  }
});

app.get('/api/drive/stream/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    if (!fileId) {
      return jsonError(res, 400, 'fileId is required.');
    }

    const drive = getDriveService(req);
    const metadata = await drive.files.get({
      fileId,
      fields: 'mimeType,name',
    });

    const mediaResponse = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', metadata.data.mimeType || 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    mediaResponse.data
      .on('error', (streamError: Error) => {
        console.error('Drive stream failed:', streamError);
        if (!res.headersSent) {
          res.status(500).end();
        }
      })
      .pipe(res);
  } catch (error: any) {
    console.error('Drive streaming failed:', error);
    jsonError(res, 500, error?.message || 'Drive stream failed.');
  }
});

async function bootstrap() {
  const isDev =
    process.env.NODE_ENV === 'development' ||
    process.env.npm_lifecycle_event === 'dev';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath, { index: false }));

    app.get(/^\/(?!api\/|auth\/).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Lumina server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Server bootstrap failed:', error);
  process.exit(1);
});
