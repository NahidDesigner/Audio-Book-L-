
import * as lamejs from 'lamejs';

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createWavBlob(pcmData: Uint8Array, sampleRate: number, numChannels: number): Blob {
  const dataLen = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLen, true);

  // Write PCM data
  const pcmView = new Uint8Array(buffer, 44);
  pcmView.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

export function pcmToMp3(pcmData: Uint8Array, sampleRate: number, numChannels: number): Uint8Array {
  // lamejs expects Int16Array for PCM samples
  const samples = new Int16Array(pcmData.buffer);
  const mp3encoder = new (lamejs as any).Mp3Encoder(numChannels, sampleRate, 128);
  const mp3Data: any[] = [];
  
  const sampleBlockSize = 1152; // standard for MP3
  
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const sampleChunk = samples.subarray(i, i + sampleBlockSize);
    let mp3buf;
    if (numChannels === 1) {
      mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    } else {
      const left = new Int16Array(sampleChunk.length / 2);
      const right = new Int16Array(sampleChunk.length / 2);
      for (let j = 0; j < sampleChunk.length; j += 2) {
        left[j / 2] = sampleChunk[j];
        right[j / 2] = sampleChunk[j + 1];
      }
      mp3buf = mp3encoder.encodeBuffer(left, right);
    }
    
    if (mp3buf.length > 0) {
      mp3Data.push(new Int8Array(mp3buf));
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Int8Array(mp3buf));
  }
  
  // Combine all Int8Array chunks into one Uint8Array
  const totalLength = mp3Data.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
    offset += chunk.length;
  }
  
  return result;
}

export function createMp3Blob(pcmData: Uint8Array, sampleRate: number, numChannels: number): Blob {
  const mp3Data = pcmToMp3(pcmData, sampleRate, numChannels);
  return new Blob([mp3Data], { type: 'audio/mp3' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
