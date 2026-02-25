import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookPlus,
  Brain,
  CheckCircle2,
  Cloud,
  CloudOff,
  Grid2x2,
  House,
  List,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  PencilLine,
  Play,
  Plus,
  RefreshCcw,
  Shield,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import AudioPlayer from './components/AudioPlayer';
import BookCard from './components/BookCard';
import {
  analyzeChapter,
  fetchAdminStatus,
  disconnectDrive,
  fetchDriveAuthUrl,
  fetchDriveStatus,
  generateTtsAudio,
  loginAsAdmin,
  logoutAdmin,
  publishDriveFile,
  uploadAudioToDrive,
} from './services/apiService';
import {
  checkStorageConnection,
  clearLocalCache,
  loadBooks,
  saveBooks,
} from './services/storageService';
import { Book, Chapter, Part, VOICES, VoiceName } from './types';
import { makeId, pcmBase64ToMp3Base64, safeFileName } from './utils/audioUtils';

type DeleteTarget =
  | { type: 'book'; id: string }
  | { type: 'chapter'; id: string }
  | { type: 'part'; id: string }
  | null;

type BookModalState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

type ChapterModalState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

type PartModalState =
  | { mode: 'closed' }
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

const GENERATION_TIMEOUT_MS = 2 * 60 * 1000;
type SupabaseStatus = 'unknown' | 'checking' | 'connected' | 'error';
type LibraryViewMode = 'grid' | 'list';
const LIBRARY_VIEW_STORAGE_KEY = 'lumina_library_view_mode';

const App: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [initialLoadError, setInitialLoadError] = useState('');

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>(() => {
    if (typeof window === 'undefined') {
      return 'grid';
    }

    try {
      const stored = localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
      if (stored === 'grid' || stored === 'list') {
        return stored;
      }
    } catch {
      // ignore storage read errors and use fallback
    }

    return window.matchMedia('(max-width: 640px)').matches ? 'list' : 'grid';
  });

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('nahidwebdesigner@gmail.com');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuthError, setAdminAuthError] = useState('');
  const [isAdminAuthBusy, setIsAdminAuthBusy] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isRepairingPublicAudio, setIsRepairingPublicAudio] = useState(false);
  const [isMobileTopbarOpen, setIsMobileTopbarOpen] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<SupabaseStatus>('unknown');
  const [supabaseStatusMessage, setSupabaseStatusMessage] = useState('');

  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const [bookModal, setBookModal] = useState<BookModalState>({ mode: 'closed' });
  const [chapterModal, setChapterModal] = useState<ChapterModalState>({ mode: 'closed' });
  const [partModal, setPartModal] = useState<PartModalState>({ mode: 'closed' });

  const [bookDraft, setBookDraft] = useState({
    title: '',
    author: '',
    description: '',
    coverUrl: '',
  });
  const [chapterDraft, setChapterDraft] = useState({ title: '' });
  const [partDraft, setPartDraft] = useState({
    title: '',
    content: '',
    voiceName: VOICES[4] as VoiceName,
  });
  const generationControllersRef = useRef<Record<string, AbortController>>({});
  const generationRunIdsRef = useRef<Record<string, string>>({});

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  const selectedChapter = useMemo(
    () => selectedBook?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [selectedBook, selectedChapterId]
  );

  const canPlayPart = useCallback(
    (part: Part) => Boolean(part.audioBase64 || part.audioUrl || part.drivePublicUrl || part.driveFileId),
    []
  );

  const loadSharedLibrary = useCallback(async () => {
    try {
      const storedBooks = await loadBooks();
      setBooks(storedBooks);
      setInitialLoadFailed(false);
      setInitialLoadError('');
    } catch (error) {
      console.error('Failed to load books:', error);
      setBooks([]);
      setInitialLoadFailed(true);
      setInitialLoadError(error instanceof Error ? error.message : 'Unknown load error');
    } finally {
      setLoaded(true);
    }
  }, []);

  const handleCheckSupabaseConnection = useCallback(
    async (resyncLibrary = true) => {
      setSupabaseStatus('checking');
      setSupabaseStatusMessage('');

      try {
        const info = await checkStorageConnection();
        if (info.connected) {
          const latencySuffix = typeof info.latencyMs === 'number' ? ` (${info.latencyMs}ms)` : '';
          setSupabaseStatus('connected');
          setSupabaseStatusMessage(`Connected${latencySuffix}`);

          if (resyncLibrary) {
            await loadSharedLibrary();
          }
          return;
        }

        setSupabaseStatus('error');
        setSupabaseStatusMessage(info.message || 'Connection check failed.');
      } catch (error) {
        setSupabaseStatus('error');
        setSupabaseStatusMessage(error instanceof Error ? error.message : 'Connection check failed.');
      }
    },
    [loadSharedLibrary]
  );

  useEffect(() => {
    loadSharedLibrary();
  }, [loadSharedLibrary]);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const status = await fetchAdminStatus();
        setIsAdmin(status);
      } catch (error) {
        console.error('Failed to fetch admin status:', error);
        setIsAdmin(false);
      }
    };

    checkAdminStatus();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setSupabaseStatus('unknown');
      setSupabaseStatusMessage('');
      return;
    }

    handleCheckSupabaseConnection(false);
  }, [isAdmin, handleCheckSupabaseConnection]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    if (initialLoadFailed && books.length === 0) {
      return;
    }

    saveBooks(books).catch((error) => {
      console.error('Failed to persist books:', error);
    });
  }, [books, loaded, initialLoadFailed]);

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, libraryViewMode);
    } catch {
      // ignore storage write errors
    }
  }, [libraryViewMode]);

  useEffect(() => {
    const checkDrive = async () => {
      try {
        const connected = await fetchDriveStatus();
        setIsDriveConnected(connected);
      } catch (error) {
        console.error('Failed to check Drive connection:', error);
      }
    };

    checkDrive();

    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsDriveConnected(true);
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  useEffect(() => {
    if (!isMobileTopbarOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileTopbarOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileTopbarOpen]);

  useEffect(() => {
    return () => {
      Object.values(generationControllersRef.current).forEach((controller) => controller.abort());
      generationControllersRef.current = {};
      generationRunIdsRef.current = {};
    };
  }, []);

  const updatePartByLocation = useCallback(
    (bookId: string, chapterId: string, partId: string, patch: Partial<Part>) => {
      setBooks((prevBooks) =>
        prevBooks.map((book) => {
          if (book.id !== bookId) {
            return book;
          }
          return {
            ...book,
            chapters: book.chapters.map((chapter) => {
              if (chapter.id !== chapterId) {
                return chapter;
              }
              return {
                ...chapter,
                parts: chapter.parts.map((part) =>
                  part.id === partId
                    ? {
                        ...part,
                        ...patch,
                      }
                    : part
                ),
              };
            }),
          };
        })
      );
    },
    []
  );

  const clearGenerationRefs = (partId: string) => {
    delete generationControllersRef.current[partId];
    delete generationRunIdsRef.current[partId];
  };

  const buildDrivePublicUrl = (fileId: string): string =>
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

  const parseDriveFileIdFromUrl = (urlValue?: string): string | null => {
    if (!urlValue) {
      return null;
    }

    try {
      const parsed = new URL(urlValue);
      const idFromQuery = parsed.searchParams.get('id');
      if (idFromQuery) {
        return idFromQuery;
      }
      const pathMatch = parsed.pathname.match(/\/d\/([^/]+)/);
      if (pathMatch?.[1]) {
        return pathMatch[1];
      }
    } catch {
      const looseMatch = urlValue.match(/[?&]id=([^&]+)/);
      if (looseMatch?.[1]) {
        return decodeURIComponent(looseMatch[1]);
      }
    }

    return null;
  };

  const cancelPartGeneration = (
    partId: string,
    location?: { bookId: string; chapterId: string },
    message = 'Generation canceled. You can re-generate this part.'
  ) => {
    const activeController = generationControllersRef.current[partId];
    if (activeController) {
      activeController.abort();
    }
    clearGenerationRefs(partId);

    if (location) {
      updatePartByLocation(location.bookId, location.chapterId, partId, {
        isGenerating: false,
        progress: 0,
        error: message,
      });
      return;
    }

    setBooks((prevBooks) =>
      prevBooks.map((book) => ({
        ...book,
        chapters: book.chapters.map((chapter) => ({
          ...chapter,
          parts: chapter.parts.map((part) =>
            part.id === partId
              ? {
                  ...part,
                  isGenerating: false,
                  progress: 0,
                  error: message,
                }
              : part
          ),
        })),
      }))
    );
  };

  const cancelGenerationsForPartIds = (partIds: string[]) => {
    partIds.forEach((partId) => {
      const activeController = generationControllersRef.current[partId];
      if (activeController) {
        activeController.abort();
      }
      clearGenerationRefs(partId);
    });
  };

  const openAddBook = () => {
    if (!isAdmin) {
      return;
    }
    setBookDraft({ title: '', author: '', description: '', coverUrl: '' });
    setBookModal({ mode: 'add' });
  };

  const openEditBook = (bookId: string) => {
    if (!isAdmin) {
      return;
    }
    const target = books.find((book) => book.id === bookId);
    if (!target) {
      return;
    }
    setBookDraft({
      title: target.title,
      author: target.author,
      description: target.description,
      coverUrl: target.coverUrl,
    });
    setBookModal({ mode: 'edit', id: bookId });
  };

  const submitBook = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    if (bookModal.mode === 'add') {
      const newBook: Book = {
        id: makeId('book'),
        title: bookDraft.title.trim(),
        author: bookDraft.author.trim(),
        description: bookDraft.description.trim(),
        coverUrl:
          bookDraft.coverUrl.trim() ||
          `https://picsum.photos/seed/${Math.random().toString(36).slice(2)}/900/1200`,
        chapters: [],
        createdAt: Date.now(),
      };
      setBooks((prevBooks) => [newBook, ...prevBooks]);
    }

    if (bookModal.mode === 'edit') {
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === bookModal.id
            ? {
                ...book,
                title: bookDraft.title.trim(),
                author: bookDraft.author.trim(),
                description: bookDraft.description.trim(),
                coverUrl: bookDraft.coverUrl.trim() || book.coverUrl,
              }
            : book
        )
      );
    }

    setBookModal({ mode: 'closed' });
  };

  const openAddChapter = () => {
    if (!isAdmin) {
      return;
    }
    setChapterDraft({ title: '' });
    setChapterModal({ mode: 'add' });
  };

  const openEditChapter = (chapterId: string) => {
    if (!isAdmin) {
      return;
    }
    const target = selectedBook?.chapters.find((chapter) => chapter.id === chapterId);
    if (!target) {
      return;
    }
    setChapterDraft({ title: target.title });
    setChapterModal({ mode: 'edit', id: chapterId });
  };

  const submitChapter = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }
    if (!selectedBookId) {
      return;
    }

    if (chapterModal.mode === 'add') {
      const newChapter: Chapter = {
        id: makeId('chapter'),
        title: chapterDraft.title.trim(),
        parts: [],
      };

      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: [...book.chapters, newChapter],
              }
            : book
        )
      );
    }

    if (chapterModal.mode === 'edit') {
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: book.chapters.map((chapter) =>
                  chapter.id === chapterModal.id
                    ? {
                        ...chapter,
                        title: chapterDraft.title.trim(),
                      }
                    : chapter
                ),
              }
            : book
        )
      );
    }

    setChapterModal({ mode: 'closed' });
  };

  const openAddPart = () => {
    if (!isAdmin) {
      return;
    }
    setPartDraft({ title: '', content: '', voiceName: VOICES[4] });
    setPartModal({ mode: 'add' });
  };

  const openEditPart = (partId: string) => {
    if (!isAdmin) {
      return;
    }
    const target = selectedChapter?.parts.find((part) => part.id === partId);
    if (!target) {
      return;
    }

    setPartDraft({
      title: target.title,
      content: target.content,
      voiceName: target.voiceName,
    });
    setPartModal({ mode: 'edit', id: partId });
  };

  const submitPart = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }
    if (!selectedBookId || !selectedChapterId) {
      return;
    }

    if (partModal.mode === 'add') {
      const newPart: Part = {
        id: makeId('part'),
        title: partDraft.title.trim(),
        content: partDraft.content.trim(),
        voiceName: partDraft.voiceName,
        isGenerating: false,
        progress: 0,
      };

      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: book.chapters.map((chapter) =>
                  chapter.id === selectedChapterId
                    ? {
                        ...chapter,
                        parts: [...chapter.parts, newPart],
                      }
                    : chapter
                ),
              }
            : book
        )
      );
    }

    if (partModal.mode === 'edit') {
      setBooks((prevBooks) =>
        prevBooks.map((book) => {
          if (book.id !== selectedBookId) {
            return book;
          }

          return {
            ...book,
            chapters: book.chapters.map((chapter) => {
              if (chapter.id !== selectedChapterId) {
                return chapter;
              }

              return {
                ...chapter,
                parts: chapter.parts.map((part) => {
                  if (part.id !== partModal.id) {
                    return part;
                  }

                  const contentChanged =
                    part.content !== partDraft.content.trim() ||
                    part.voiceName !== partDraft.voiceName;

                  return {
                    ...part,
                    title: partDraft.title.trim(),
                    content: partDraft.content.trim(),
                    voiceName: partDraft.voiceName,
                    audioBase64: contentChanged ? undefined : part.audioBase64,
                    audioUrl: contentChanged ? undefined : part.audioUrl,
                    driveFileId: contentChanged ? undefined : part.driveFileId,
                    drivePublicUrl: contentChanged ? undefined : part.drivePublicUrl,
                    error: undefined,
                  };
                }),
              };
            }),
          };
        })
      );
    }

    setPartModal({ mode: 'closed' });
  };

  const confirmDelete = () => {
    if (!isAdmin) {
      return;
    }

    if (!deleteTarget) {
      return;
    }

    if (deleteTarget.type === 'book') {
      const targetBook = books.find((book) => book.id === deleteTarget.id);
      if (targetBook) {
        cancelGenerationsForPartIds(
          targetBook.chapters.flatMap((chapter) => chapter.parts.map((part) => part.id))
        );
      }
      setBooks((prevBooks) => prevBooks.filter((book) => book.id !== deleteTarget.id));
      if (selectedBookId === deleteTarget.id) {
        setSelectedBookId(null);
        setSelectedChapterId(null);
        setActivePartId(null);
      }
    }

    if (deleteTarget.type === 'chapter' && selectedBookId) {
      const targetChapter = selectedBook?.chapters.find((chapter) => chapter.id === deleteTarget.id);
      if (targetChapter) {
        cancelGenerationsForPartIds(targetChapter.parts.map((part) => part.id));
      }
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: book.chapters.filter((chapter) => chapter.id !== deleteTarget.id),
              }
            : book
        )
      );
      if (selectedChapterId === deleteTarget.id) {
        setSelectedChapterId(null);
        setActivePartId(null);
      }
    }

    if (deleteTarget.type === 'part' && selectedBookId && selectedChapterId) {
      cancelPartGeneration(deleteTarget.id, {
        bookId: selectedBookId,
        chapterId: selectedChapterId,
      });
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: book.chapters.map((chapter) =>
                  chapter.id === selectedChapterId
                    ? {
                        ...chapter,
                        parts: chapter.parts.filter((part) => part.id !== deleteTarget.id),
                      }
                    : chapter
                ),
              }
            : book
        )
      );
      if (activePartId === deleteTarget.id) {
        setActivePartId(null);
      }
    }

    setDeleteTarget(null);
  };

  const handleAdminLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdminAuthError('');
    setIsAdminAuthBusy(true);

    try {
      await loginAsAdmin(adminEmail.trim(), adminPassword);
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminPassword('');
      const connected = await fetchDriveStatus();
      setIsDriveConnected(connected);
    } catch (error: any) {
      setAdminAuthError(error?.message || 'Admin login failed.');
    } finally {
      setIsAdminAuthBusy(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await logoutAdmin();
      setIsAdmin(false);
      setShowAdminLogin(false);
      setAdminPassword('');
      setAdminAuthError('');
      setDeleteTarget(null);
      setBookModal({ mode: 'closed' });
      setChapterModal({ mode: 'closed' });
      setPartModal({ mode: 'closed' });
      setIsDriveConnected(false);
    } catch (error: any) {
      alert(error?.message || 'Failed to logout admin user.');
    }
  };

  const goHome = () => {
    setSelectedBookId(null);
    setSelectedChapterId(null);
    setActivePartId(null);
  };

  const handleClearCache = async () => {
    const confirmed = window.confirm(
      'Clear browser cache and local app cache, then reload?\nUnsynced local changes in this browser may be removed.'
    );
    if (!confirmed) {
      return;
    }

    setIsClearingCache(true);
    try {
      await clearLocalCache();

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      sessionStorage.clear();
      window.location.reload();
    } catch (error: any) {
      setIsClearingCache(false);
      alert(error?.message || 'Failed to clear cache. Try closing other tabs and retry.');
    }
  };

  const connectDrive = async () => {
    if (!isAdmin) {
      return;
    }

    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const authUrl = await fetchDriveAuthUrl(redirectUri);
      const popup = window.open(authUrl, 'lumina-drive-auth', 'width=560,height=700');
      if (!popup) {
        alert('Popup was blocked. Allow popups and try again.');
      }
    } catch (error: any) {
      alert(error?.message || 'Failed to connect Google Drive.');
    }
  };

  const handleDisconnectDrive = async () => {
    if (!isAdmin) {
      return;
    }

    try {
      await disconnectDrive();
      setIsDriveConnected(false);
    } catch (error: any) {
      alert(error?.message || 'Failed to disconnect Google Drive.');
    }
  };

  const handleRepairPublicAudioLinks = async () => {
    if (!isAdmin) {
      return;
    }
    if (!isDriveConnected) {
      alert('Connect Google Drive first, then run repair.');
      return;
    }

    const targetByPartId = new Map<string, string>();
    books.forEach((book) => {
      book.chapters.forEach((chapter) => {
        chapter.parts.forEach((part) => {
          const resolvedFileId =
            part.driveFileId || parseDriveFileIdFromUrl(part.audioUrl) || parseDriveFileIdFromUrl(part.drivePublicUrl);
          if (resolvedFileId) {
            targetByPartId.set(part.id, resolvedFileId);
          }
        });
      });
    });

    const targets = Array.from(targetByPartId.entries()).map(([partId, fileId]) => ({ partId, fileId }));

    if (targets.length === 0) {
      alert('No Drive file IDs found in the current library.');
      return;
    }

    setIsRepairingPublicAudio(true);
    const repairedLinks = new Map<string, string>();
    let failed = 0;
    let firstFailureMessage = '';

    try {
      for (const target of targets) {
        try {
          const result = await publishDriveFile(target.fileId);
          repairedLinks.set(target.partId, result.publicUrl || buildDrivePublicUrl(target.fileId));
        } catch (error: any) {
          failed += 1;
          if (!firstFailureMessage) {
            firstFailureMessage = error?.message || 'Unknown publish error.';
          }
        }
      }

      if (repairedLinks.size > 0) {
        setBooks((prevBooks) =>
          prevBooks.map((book) => ({
            ...book,
            chapters: book.chapters.map((chapter) => ({
              ...chapter,
              parts: chapter.parts.map((part) => {
                const nextPublicUrl = repairedLinks.get(part.id);
                if (!nextPublicUrl) {
                  return part;
                }
                return {
                  ...part,
                  driveFileId: part.driveFileId || parseDriveFileIdFromUrl(nextPublicUrl) || undefined,
                  audioUrl: nextPublicUrl,
                  drivePublicUrl: nextPublicUrl,
                };
              }),
            })),
          }))
        );
      }

      const ok = repairedLinks.size;
      alert(
        failed > 0
          ? `Repaired ${ok}/${targets.length} files. ${failed} failed. ${firstFailureMessage}`
          : `Repaired ${ok} public audio files.`
      );
    } finally {
      setIsRepairingPublicAudio(false);
    }
  };

  const generatePartAudio = async (partId: string) => {
    if (!isAdmin) {
      return;
    }

    if (!selectedBook || !selectedChapter) {
      return;
    }

    const targetPart = selectedChapter.parts.find((part) => part.id === partId);
    if (!targetPart) {
      return;
    }

    if (!isDriveConnected) {
      alert('Connect Google Drive first. Narration is now published to Drive and stored by URL.');
      return;
    }

    const bookId = selectedBook.id;
    const chapterId = selectedChapter.id;
    const runId = makeId('gen');
    const abortController = new AbortController();
    let timedOut = false;

    if (generationControllersRef.current[partId]) {
      generationControllersRef.current[partId].abort();
    }
    generationControllersRef.current[partId] = abortController;
    generationRunIdsRef.current[partId] = runId;

    updatePartByLocation(bookId, chapterId, partId, {
      isGenerating: true,
      progress: 2,
      error: undefined,
    });

    let progress = 2;
    const timer = window.setInterval(() => {
      if (generationRunIdsRef.current[partId] !== runId) {
        window.clearInterval(timer);
        return;
      }
      progress = Math.min(progress + 7, 92);
      updatePartByLocation(bookId, chapterId, partId, { progress });
    }, 450);
    const hardTimeout = window.setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, GENERATION_TIMEOUT_MS);

    try {
      const ttsPayload = await generateTtsAudio(
        targetPart.content,
        targetPart.voiceName,
        abortController.signal
      );
      if (generationRunIdsRef.current[partId] !== runId) {
        return;
      }

      const audioBase64 = await pcmBase64ToMp3Base64(
        ttsPayload.pcmBase64,
        ttsPayload.sampleRate,
        ttsPayload.channels
      );
      if (generationRunIdsRef.current[partId] !== runId) {
        return;
      }

      updatePartByLocation(bookId, chapterId, partId, { progress: 96 });
      const baseName =
        safeFileName(`${selectedBook.title}-${selectedChapter.title}-${targetPart.title}`) ||
        `lumina-${partId}`;
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const filename = `${baseName}-${uniqueSuffix}.mp3`;
      const uploadResult = await uploadAudioToDrive(audioBase64, filename);
      if (generationRunIdsRef.current[partId] !== runId) {
        return;
      }

      updatePartByLocation(bookId, chapterId, partId, {
        isGenerating: false,
        progress: 100,
        audioBase64: undefined,
        driveFileId: uploadResult.fileId,
        audioUrl: uploadResult.publicUrl || buildDrivePublicUrl(uploadResult.fileId),
        drivePublicUrl: uploadResult.publicUrl,
        error: undefined,
      });
    } catch (error: any) {
      if (generationRunIdsRef.current[partId] !== runId) {
        return;
      }

      const message = abortController.signal.aborted
        ? timedOut
          ? 'Generation timed out. Click re-generate.'
          : 'Generation canceled. Click re-generate.'
        : error?.message || 'Narration generation failed.';

      updatePartByLocation(bookId, chapterId, partId, {
        isGenerating: false,
        progress: 0,
        error: message,
      });
    } finally {
      window.clearInterval(timer);
      window.clearTimeout(hardTimeout);
      if (generationRunIdsRef.current[partId] === runId) {
        clearGenerationRefs(partId);
      }
    }
  };

  const analyzeSelectedChapter = async () => {
    if (!isAdmin) {
      return;
    }

    if (!selectedBookId || !selectedChapterId || !selectedChapter) {
      return;
    }

    if (selectedChapter.parts.length === 0) {
      return;
    }

    setBooks((prevBooks) =>
      prevBooks.map((book) =>
        book.id === selectedBookId
          ? {
              ...book,
              chapters: book.chapters.map((chapter) =>
                chapter.id === selectedChapterId
                  ? {
                      ...chapter,
                      isAnalyzing: true,
                    }
                  : chapter
              ),
            }
          : book
      )
    );

    try {
      const chapterText = selectedChapter.parts.map((part) => part.content).join('\n\n');
      const result = await analyzeChapter(selectedChapter.title, chapterText);

      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: book.chapters.map((chapter) =>
                  chapter.id === selectedChapterId
                    ? {
                        ...chapter,
                        isAnalyzing: false,
                        summary: result.summary,
                        questions: result.questions,
                      }
                    : chapter
                ),
              }
            : book
        )
      );
    } catch (error: any) {
      setBooks((prevBooks) =>
        prevBooks.map((book) =>
          book.id === selectedBookId
            ? {
                ...book,
                chapters: book.chapters.map((chapter) =>
                  chapter.id === selectedChapterId
                    ? {
                        ...chapter,
                        isAnalyzing: false,
                      }
                    : chapter
                ),
              }
            : book
        )
      );

      alert(error?.message || 'Chapter analysis failed.');
    }
  };

  const handlePlayChapter = () => {
    if (!selectedChapter || selectedChapter.parts.length === 0) {
      return;
    }

    const firstPlayable = selectedChapter.parts.find((part) => canPlayPart(part));
    if (!firstPlayable) {
      alert('Generate at least one narrated part first.');
      return;
    }

    setActivePartId(firstPlayable.id);
  };

  const handlePartFinished = useCallback(() => {
    if (!autoplayEnabled || !selectedChapter || !activePartId) {
      return;
    }

    const currentIndex = selectedChapter.parts.findIndex((part) => part.id === activePartId);
    if (currentIndex === -1) {
      return;
    }

    for (let i = currentIndex + 1; i < selectedChapter.parts.length; i += 1) {
      const candidate = selectedChapter.parts[i];
      if (canPlayPart(candidate)) {
        setActivePartId(candidate.id);
        return;
      }
    }

    setActivePartId(null);
  }, [autoplayEnabled, canPlayPart, selectedChapter, activePartId]);

  return (
    <div className="app-shell">
      <button
        type="button"
        className="mobile-topbar-toggle"
        onClick={() => setIsMobileTopbarOpen((prev) => !prev)}
        aria-expanded={isMobileTopbarOpen}
        aria-controls="lumina-topbar"
      >
        {isMobileTopbarOpen ? <X size={16} /> : <Menu size={16} />}
        {isMobileTopbarOpen ? 'Close' : 'Menu'}
      </button>

      {isMobileTopbarOpen && (
        <button
          type="button"
          className="mobile-topbar-backdrop"
          onClick={() => setIsMobileTopbarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <header id="lumina-topbar" className={isMobileTopbarOpen ? 'topbar open' : 'topbar'}>
        <div className="brand">
          <span className="brand-mark">L</span>
          <div>
            <h1>Lumina Studio</h1>
            <p>Audiobook production for web and mobile listening</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className="soft-btn"
            onClick={goHome}
            disabled={!selectedBookId && !selectedChapterId}
          >
            <House size={15} /> Home
          </button>

          <button className="soft-btn" onClick={() => setAutoplayEnabled((prev) => !prev)}>
            {autoplayEnabled ? <CheckCircle2 size={15} /> : <CloudOff size={15} />}
            Autoplay {autoplayEnabled ? 'On' : 'Off'}
          </button>

          <button className="soft-btn" onClick={handleClearCache} disabled={isClearingCache}>
            {isClearingCache ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
            Clear Cache
          </button>

          {isAdmin && (
            <button
              className={
                supabaseStatus === 'connected'
                  ? 'soft-btn connected'
                  : supabaseStatus === 'error'
                    ? 'danger-btn'
                    : 'soft-btn'
              }
              onClick={() => handleCheckSupabaseConnection(true)}
              disabled={supabaseStatus === 'checking'}
              title={
                supabaseStatusMessage ||
                'Check Supabase connection and sync the shared library from remote storage.'
              }
            >
              {supabaseStatus === 'checking' ? (
                <Loader2 className="spin" size={15} />
              ) : supabaseStatus === 'connected' ? (
                <CheckCircle2 size={15} />
              ) : (
                <CloudOff size={15} />
              )}
              {supabaseStatus === 'checking'
                ? 'Supabase Checking'
                : supabaseStatus === 'connected'
                  ? 'Supabase Connected'
                  : supabaseStatus === 'error'
                    ? 'Supabase Offline'
                    : 'Supabase Check'}
            </button>
          )}

          {isAdmin && (
            <button
              className={isDriveConnected ? 'soft-btn connected' : 'soft-btn'}
              onClick={isDriveConnected ? handleDisconnectDrive : connectDrive}
            >
              {isDriveConnected ? <Cloud size={15} /> : <CloudOff size={15} />}
              Drive {isDriveConnected ? 'Connected' : 'Connect'}
            </button>
          )}

          {isAdmin && (
            <button
              className="soft-btn"
              onClick={handleRepairPublicAudioLinks}
              disabled={!isDriveConnected || isRepairingPublicAudio}
              title="Publish old Drive files for public playback and save missing public URLs."
            >
              {isRepairingPublicAudio ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
              Repair Public Audio
            </button>
          )}

          {isAdmin ? (
            <button className="soft-btn connected" onClick={handleAdminLogout}>
              <LogOut size={15} /> Admin Logout
            </button>
          ) : (
            <button
              className="soft-btn"
              onClick={() => {
                setAdminAuthError('');
                setShowAdminLogin(true);
              }}
            >
              <LogIn size={15} /> Admin Login
            </button>
          )}
        </div>
      </header>

      <main className="main-layout">
        {!loaded && (
          <p className="muted-row">
            <Loader2 className="spin" size={14} /> Syncing library...
          </p>
        )}

        {isAdmin && supabaseStatus !== 'unknown' && (
          <p className={supabaseStatus === 'error' ? 'error-text' : 'status-text-ok'}>
            <Shield size={14} />
            Supabase: {supabaseStatusMessage || (supabaseStatus === 'connected' ? 'Connected' : 'Checking...')}
          </p>
        )}

        {initialLoadFailed && (
          <p className="error-text">
            Could not load shared library from Supabase.
            {initialLoadError ? ` ${initialLoadError}` : ' Check Supabase availability and redeploy settings.'}
          </p>
        )}

        {!selectedBook && (
          <section>
            <div className="section-header">
              <div>
                <h2>Library</h2>
              </div>
              <div className="section-actions-wrap">
                <div className="view-toggle" role="group" aria-label="Library view mode">
                  <button
                    type="button"
                    className={libraryViewMode === 'grid' ? 'view-toggle-btn active' : 'view-toggle-btn'}
                    onClick={() => setLibraryViewMode('grid')}
                    aria-pressed={libraryViewMode === 'grid'}
                    title="Grid view"
                  >
                    <Grid2x2 size={14} /> Grid
                  </button>
                  <button
                    type="button"
                    className={libraryViewMode === 'list' ? 'view-toggle-btn active' : 'view-toggle-btn'}
                    onClick={() => setLibraryViewMode('list')}
                    aria-pressed={libraryViewMode === 'list'}
                    title="List view"
                  >
                    <List size={14} /> List
                  </button>
                </div>

                {isAdmin && (
                  <button className="primary-btn" onClick={openAddBook}>
                    <BookPlus size={17} /> New Book
                  </button>
                )}
              </div>
            </div>

            {books.length === 0 ? (
              <div className="empty-state">No books yet. Create your first one.</div>
            ) : (
              <div className={libraryViewMode === 'list' ? 'book-grid list-mode' : 'book-grid'}>
                {books.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    viewMode={libraryViewMode}
                    onOpen={(bookId) => setSelectedBookId(bookId)}
                    canManage={isAdmin}
                    onEdit={openEditBook}
                    onDelete={(bookId) => setDeleteTarget({ type: 'book', id: bookId })}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {selectedBook && !selectedChapter && (
          <section>
            <button
              className="back-btn"
              onClick={() => {
                setSelectedBookId(null);
                setSelectedChapterId(null);
                setActivePartId(null);
              }}
            >
              <ArrowLeft size={15} /> Back to library
            </button>

            <div className="chapter-header">
              <img className="chapter-cover" src={selectedBook.coverUrl} alt={selectedBook.title} />
              <div>
                <h2>{selectedBook.title}</h2>
                <p>{selectedBook.author}</p>
                <p>{selectedBook.description}</p>
                {isAdmin && (
                  <div className="chapter-controls">
                    <button className="primary-btn" onClick={openAddChapter}>
                      <Plus size={16} /> Add Chapter
                    </button>
                    <button className="soft-btn" onClick={() => openEditBook(selectedBook.id)}>
                      <PencilLine size={15} /> Edit Book
                    </button>
                    <button
                      className="danger-btn"
                      onClick={() => setDeleteTarget({ type: 'book', id: selectedBook.id })}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="chapter-list">
              {selectedBook.chapters.length > 0 && (
                <div className="chapter-list-notice">
                  <Play size={14} />
                  Chapters marked <strong>Ready to listen</strong> already have playable audio.
                </div>
              )}

              {selectedBook.chapters.length === 0 && (
                <div className="empty-state">No chapters yet. Add one to start building narration.</div>
              )}

              {selectedBook.chapters.map((chapter) => {
                const narratedParts = chapter.parts.filter((part) => canPlayPart(part)).length;
                const totalParts = chapter.parts.length;
                const hasNarration = narratedParts > 0;
                const narrationProgress = totalParts > 0 ? Math.round((narratedParts / totalParts) * 100) : 0;

                const openChapter = () => {
                  setSelectedChapterId(chapter.id);
                  setActivePartId(null);
                };

                return (
                  <article key={chapter.id} className={hasNarration ? 'chapter-card ready' : 'chapter-card'}>
                    <button className="chapter-open" onClick={openChapter}>
                      <div className="chapter-open-head">
                        <h3>{chapter.title}</h3>
                        <span className={hasNarration ? 'chapter-audio-badge ready' : 'chapter-audio-badge pending'}>
                          {hasNarration ? 'Ready to listen' : 'Audio pending'}
                        </span>
                      </div>

                      <p>
                        {totalParts} parts • {narratedParts} playable
                        {chapter.summary ? ' • Insights available' : ''}
                      </p>

                      {totalParts > 0 && (
                        <div className="chapter-audio-meter" aria-hidden="true">
                          <span style={{ width: `${narrationProgress}%` }} />
                        </div>
                      )}
                    </button>

                    <div className="chapter-card-actions">
                      <button className={hasNarration ? 'soft-btn' : 'ghost-btn'} onClick={openChapter}>
                        <Play size={14} /> {hasNarration ? 'Listen' : 'Open'}
                      </button>

                      {isAdmin && (
                        <>
                          <button className="soft-btn" onClick={() => openEditChapter(chapter.id)}>
                            <PencilLine size={15} />
                          </button>
                          <button
                            className="danger-btn"
                            onClick={() => setDeleteTarget({ type: 'chapter', id: chapter.id })}
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {selectedBook && selectedChapter && (
          <section>
            <button
              className="back-btn"
              onClick={() => {
                setSelectedChapterId(null);
                setActivePartId(null);
              }}
            >
              <ArrowLeft size={15} /> Back to chapters
            </button>

            <div className="section-header">
              <div>
                <h2>{selectedChapter.title}</h2>
                  <p>
                    {selectedChapter.parts.length} parts •{' '}
                  {selectedChapter.parts.filter((part) => canPlayPart(part)).length}{' '}
                    narrated
                  </p>
                </div>
              <div className="section-actions-wrap">
                <button className="soft-btn" onClick={handlePlayChapter}>
                  <Play size={15} /> Play chapter
                </button>
                {isAdmin && (
                  <button
                    className="soft-btn"
                    onClick={analyzeSelectedChapter}
                    disabled={selectedChapter.isAnalyzing || selectedChapter.parts.length === 0}
                  >
                    {selectedChapter.isAnalyzing ? <Loader2 className="spin" size={15} /> : <Brain size={15} />}
                    Insights
                  </button>
                )}
                {isAdmin && (
                  <button className="primary-btn" onClick={openAddPart}>
                    <Plus size={15} /> Add Part
                  </button>
                )}
              </div>
            </div>

            <div className="content-grid">
              <div className="parts-stack">
                {selectedChapter.parts.length === 0 && (
                  <div className="empty-state">No parts yet. Add a part and generate narration.</div>
                )}

                {selectedChapter.parts.map((part, index) => {
                  const isActive = part.id === activePartId;
                  const hasAudio = canPlayPart(part);

                  return (
                    <article key={part.id} className={isActive ? 'part-card active' : 'part-card'}>
                      <div className="part-head">
                        <div>
                          <h3>
                            {index + 1}. {part.title}
                          </h3>
                          <p>
                            Voice: <strong>{part.voiceName}</strong>
                          </p>
                        </div>

                        {isAdmin && (
                          <div className="part-actions">
                            <button className="soft-btn" onClick={() => openEditPart(part.id)}>
                              <PencilLine size={14} />
                            </button>
                            <button
                              className="danger-btn"
                              onClick={() => setDeleteTarget({ type: 'part', id: part.id })}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>

                      {isAdmin && (
                        <p className="muted-row">Narration text is hidden. Use Edit to view or update it.</p>
                      )}

                      {!part.isGenerating && isAdmin && (
                        <button
                          className={hasAudio ? 'soft-btn' : 'primary-btn'}
                          onClick={() => generatePartAudio(part.id)}
                        >
                          {hasAudio ? <RefreshCcw size={15} /> : <Wand2 size={15} />}
                          {hasAudio ? 'Re-generate narration' : 'Generate narration'}
                        </button>
                      )}

                      {!hasAudio && !part.isGenerating && !isAdmin && (
                        <p className="muted-row">Narration for this part is not published yet.</p>
                      )}

                      {part.isGenerating && (
                        <div className="progress-wrap">
                          <div className="progress-line">
                            <span style={{ width: `${part.progress}%` }} />
                          </div>
                          <p>Generating audio... {Math.round(part.progress)}%</p>
                          {isAdmin && (
                            <button
                              className="danger-btn"
                              onClick={() => cancelPartGeneration(part.id)}
                            >
                              Cancel generation
                            </button>
                          )}
                        </div>
                      )}

                      {part.error && <p className="error-text">{part.error}</p>}

                      {hasAudio && !isActive && (
                        <button className="soft-btn" onClick={() => setActivePartId(part.id)}>
                          <Play size={15} /> Play this part
                        </button>
                      )}

                      {hasAudio && isActive && (
                        <AudioPlayer
                          audioBase64={part.audioBase64}
                          audioUrl={part.audioUrl}
                          publicDriveFileId={part.driveFileId}
                          drivePublicUrl={
                            part.drivePublicUrl ||
                            part.audioUrl ||
                            (part.driveFileId ? buildDrivePublicUrl(part.driveFileId) : undefined)
                          }
                          driveFileId={isAdmin && isDriveConnected ? part.driveFileId : undefined}
                          autoPlay
                          onEnded={handlePartFinished}
                        />
                      )}
                    </article>
                  );
                })}
              </div>

              <aside className="insight-panel">
                <div className="insight-card">
                  <h3>
                    <Sparkles size={16} /> Chapter Insights
                  </h3>

                  {selectedChapter.isAnalyzing && (
                    <p className="muted-row">
                      <Loader2 className="spin" size={15} /> Gemini is analyzing your chapter...
                    </p>
                  )}

                  {!selectedChapter.isAnalyzing && !selectedChapter.summary && (
                    <p className="muted-row">
                      {isAdmin
                        ? 'Run Insights to generate summary and discussion questions.'
                        : 'Insights will appear here once published by admin.'}
                    </p>
                  )}

                  {selectedChapter.summary && (
                    <>
                      <h4>Summary</h4>
                      <p>{selectedChapter.summary}</p>
                    </>
                  )}

                  {selectedChapter.questions && selectedChapter.questions.length > 0 && (
                    <>
                      <h4>Questions</h4>
                      <ul>
                        {selectedChapter.questions.map((question, idx) => (
                          <li key={`${question}-${idx}`}>{question}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </aside>
            </div>
          </section>
        )}
      </main>

      {isAdmin && deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal-card compact">
            <h3>Confirm deletion</h3>
            <p>This action removes the selected {deleteTarget.type} permanently.</p>
            <div className="modal-actions">
              <button className="soft-btn" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="danger-btn" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && bookModal.mode !== 'closed' && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>{bookModal.mode === 'add' ? 'Create Book' : 'Edit Book'}</h3>
            <form className="modal-form" onSubmit={submitBook}>
              <input
                required
                placeholder="Book title"
                value={bookDraft.title}
                onChange={(event) => setBookDraft((prev) => ({ ...prev, title: event.target.value }))}
              />
              <input
                required
                placeholder="Author"
                value={bookDraft.author}
                onChange={(event) => setBookDraft((prev) => ({ ...prev, author: event.target.value }))}
              />
              <textarea
                placeholder="Description"
                rows={4}
                value={bookDraft.description}
                onChange={(event) =>
                  setBookDraft((prev) => ({ ...prev, description: event.target.value }))
                }
              />
              <input
                placeholder="Cover URL"
                value={bookDraft.coverUrl}
                onChange={(event) => setBookDraft((prev) => ({ ...prev, coverUrl: event.target.value }))}
              />
              <div className="modal-actions">
                <button type="button" className="soft-btn" onClick={() => setBookModal({ mode: 'closed' })}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAdmin && chapterModal.mode !== 'closed' && (
        <div className="modal-backdrop">
          <div className="modal-card compact">
            <h3>{chapterModal.mode === 'add' ? 'Add Chapter' : 'Edit Chapter'}</h3>
            <form className="modal-form" onSubmit={submitChapter}>
              <input
                required
                autoFocus
                placeholder="Chapter title"
                value={chapterDraft.title}
                onChange={(event) => setChapterDraft({ title: event.target.value })}
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="soft-btn"
                  onClick={() => setChapterModal({ mode: 'closed' })}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAdmin && partModal.mode !== 'closed' && (
        <div className="modal-backdrop">
          <div className="modal-card large">
            <h3>{partModal.mode === 'add' ? 'Add Part' : 'Edit Part'}</h3>
            <form className="modal-form" onSubmit={submitPart}>
              <div className="row-grid">
                <input
                  required
                  placeholder="Part title"
                  value={partDraft.title}
                  onChange={(event) => setPartDraft((prev) => ({ ...prev, title: event.target.value }))}
                />
                <select
                  value={partDraft.voiceName}
                  onChange={(event) =>
                    setPartDraft((prev) => ({ ...prev, voiceName: event.target.value as VoiceName }))
                  }
                >
                  {VOICES.map((voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                required
                rows={12}
                placeholder="Paste chapter text for this part"
                value={partDraft.content}
                onChange={(event) => setPartDraft((prev) => ({ ...prev, content: event.target.value }))}
              />

              <div className="modal-actions">
                <button type="button" className="soft-btn" onClick={() => setPartModal({ mode: 'closed' })}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Save Part
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {!isAdmin && showAdminLogin && (
        <div className="modal-backdrop">
          <div className="modal-card compact">
            <h3><Shield size={16} /> Admin Login</h3>
            <form className="modal-form" onSubmit={handleAdminLoginSubmit}>
              <input
                required
                type="email"
                placeholder="Admin email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
              />
              <input
                required
                type="password"
                placeholder="Password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
              />
              {adminAuthError && <p className="error-text">{adminAuthError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="soft-btn"
                  onClick={() => {
                    setShowAdminLogin(false);
                    setAdminPassword('');
                    setAdminAuthError('');
                  }}
                  disabled={isAdminAuthBusy}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={isAdminAuthBusy}>
                  {isAdminAuthBusy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
                  Login
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
