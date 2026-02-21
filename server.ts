import express from 'express';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { Readable } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const getOAuth2Client = (redirectUri: string) => {
  return new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    redirectUri
  );
};

app.get('/api/auth/url', (req, res) => {
  const redirectUri = req.query.redirectUri as string;
  if (!redirectUri) return res.status(400).json({ error: 'Missing redirectUri' });

  const oauth2Client = getOAuth2Client(redirectUri);
  const state = Buffer.from(JSON.stringify({ redirectUri })).toString('base64');

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
    prompt: 'consent'
  });

  res.json({ url });
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  try {
    const { code, state } = req.query;
    const { redirectUri } = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
    
    const oauth2Client = getOAuth2Client(redirectUri);
    const { tokens } = await oauth2Client.getToken(code as string);
    
    res.cookie('google_tokens', JSON.stringify(tokens), {
      secure: true,
      sameSite: 'none',
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/status', (req, res) => {
  const tokens = req.cookies.google_tokens;
  res.json({ connected: !!tokens });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('google_tokens', { secure: true, sameSite: 'none', httpOnly: true });
  res.json({ success: true });
});

const getDriveService = (req: express.Request, redirectUri: string = 'postmessage') => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) throw new Error('Not authenticated');
  const tokens = JSON.parse(tokensStr);
  const oauth2Client = getOAuth2Client(redirectUri);
  oauth2Client.setCredentials(tokens);
  return google.drive({ version: 'v3', auth: oauth2Client });
};

app.post('/api/drive/upload', async (req, res) => {
  try {
    const { base64Audio, filename, mimeType, redirectUri } = req.body;
    const drive = getDriveService(req, redirectUri);

    const folderName = 'Lumina Audiobooks';
    let folderId = '';
    const folderRes = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (folderRes.data.files && folderRes.data.files.length > 0) {
      folderId = folderRes.data.files[0].id!;
    } else {
      const newFolder = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
      });
      folderId = newFolder.data.id!;
    }

    const audioBuffer = Buffer.from(base64Audio, 'base64');
    
    const fileMetadata = {
      name: filename || 'audio.mp3',
      parents: [folderId]
    };
    
    const media = {
      mimeType: mimeType || 'audio/mpeg',
      body: Readable.from(audioBuffer)
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    });

    res.json({ fileId: file.data.id });
  } catch (error: any) {
    console.error('Drive upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/drive/stream/:fileId', async (req, res) => {
  try {
    const drive = getDriveService(req);
    const fileId = req.params.fileId;
    
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    
    res.setHeader('Content-Type', 'audio/wav');
    response.data
      .on('end', () => {})
      .on('error', (err: any) => {
        console.error('Error downloading file:', err);
        res.status(500).end();
      })
      .pipe(res);
  } catch (error: any) {
    console.error('Drive stream error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  const isDev =
    process.env.NODE_ENV === 'development' ||
    process.env.npm_lifecycle_event === 'dev';

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));

    // SPA fallback for non-API routes.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
