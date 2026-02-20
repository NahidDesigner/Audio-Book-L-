
export interface Part {
  id: string;
  title: string;
  content: string;
  audioBase64?: string;
  driveFileId?: string;
  voiceName: string;
  isGenerating: boolean;
  progress?: number;
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

export enum Voice {
  KORE = 'Kore',
  PUCK = 'Puck',
  CHARON = 'Charon',
  FENRIR = 'Fenrir',
  ZEPHYR = 'Zephyr'
}
