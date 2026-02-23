export const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

export type VoiceName = (typeof VOICES)[number];

export interface Part {
  id: string;
  title: string;
  content: string;
  voiceName: VoiceName;
  audioBase64?: string;
  driveFileId?: string;
  isGenerating: boolean;
  progress: number;
  error?: string;
}

export interface Chapter {
  id: string;
  title: string;
  parts: Part[];
  summary?: string;
  questions?: string[];
  isAnalyzing?: boolean;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  chapters: Chapter[];
  createdAt: number;
}

export interface ChapterInsights {
  summary: string;
  questions: string[];
}
