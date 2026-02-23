export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = base64ToUint8Array(base64);
  return new Blob([bytes], { type: mimeType });
}

export function base64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function pcmBase64ToMp3Base64(
  pcmBase64: string,
  sampleRate = 24000,
  channels = 1
): Promise<string> {
  return encodePcmToMp3(pcmBase64, sampleRate, channels);
}

type Mp3EncoderInstance = {
  encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
  flush: () => Int8Array;
};

type LameJsGlobal = {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance;
};

let lameLoadPromise: Promise<LameJsGlobal> | null = null;

function loadLameJs(): Promise<LameJsGlobal> {
  const existing = (window as any).lamejs as LameJsGlobal | undefined;
  if (existing?.Mp3Encoder) {
    return Promise.resolve(existing);
  }

  if (lameLoadPromise) {
    return lameLoadPromise;
  }

  lameLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/lame.all.js';
    script.async = true;
    script.onload = () => {
      const loaded = (window as any).lamejs as LameJsGlobal | undefined;
      if (!loaded?.Mp3Encoder) {
        reject(new Error('lamejs loaded but Mp3Encoder was not found.'));
        return;
      }
      resolve(loaded);
    };
    script.onerror = () => reject(new Error('Failed to load /lame.all.js'));
    document.head.appendChild(script);
  });

  return lameLoadPromise;
}

async function encodePcmToMp3(
  pcmBase64: string,
  sampleRate = 24000,
  channels = 1
): Promise<string> {
  const lamejs = await loadLameJs();
  const pcmBytes = base64ToUint8Array(pcmBase64);
  const pcmSamples = new Int16Array(
    pcmBytes.buffer,
    pcmBytes.byteOffset,
    Math.floor(pcmBytes.byteLength / 2)
  );

  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 128);
  const sampleBlockSize = 1152;
  const chunks: Uint8Array[] = [];

  if (channels === 1) {
    for (let i = 0; i < pcmSamples.length; i += sampleBlockSize) {
      const monoChunk = pcmSamples.subarray(i, i + sampleBlockSize);
      const encoded = encoder.encodeBuffer(monoChunk);
      if (encoded.length > 0) {
        chunks.push(new Uint8Array(encoded));
      }
    }
  } else {
    for (let i = 0; i < pcmSamples.length; i += sampleBlockSize * channels) {
      const interleaved = pcmSamples.subarray(i, i + sampleBlockSize * channels);
      const frameLength = Math.floor(interleaved.length / channels);
      const left = new Int16Array(frameLength);
      const right = new Int16Array(frameLength);
      for (let j = 0; j < frameLength; j += 1) {
        left[j] = interleaved[j * 2] || 0;
        right[j] = interleaved[j * 2 + 1] || 0;
      }
      const encoded = encoder.encodeBuffer(left, right);
      if (encoded.length > 0) {
        chunks.push(new Uint8Array(encoded));
      }
    }
  }

  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) {
    chunks.push(new Uint8Array(finalChunk));
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return uint8ArrayToBase64(merged);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || Number.isNaN(seconds)) {
    return '0:00';
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export function safeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9\-_. ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
