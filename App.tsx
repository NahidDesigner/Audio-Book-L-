import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookPlus,
  Brain,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
  PencilLine,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import AudioPlayer from './components/AudioPlayer';
import BookCard from './components/BookCard';
import {
  analyzeChapter,
  disconnectDrive,
  fetchDriveAuthUrl,
  fetchDriveStatus,
  generateTtsAudio,
  uploadAudioToDrive,
} from './services/apiService';
import { loadBooks, saveBooks } from './services/storageService';
import { Book, Chapter, Part, VOICES, VoiceName } from './types';
import { makeId, safeFileName } from './utils/audioUtils';

const seedBook: Book = {
  id: makeId('book'),
  title: 'The Bronze Observatory',
  author: 'Nadia Quinn',
  description:
    'A clockwork city where memories are stored in starlight and every chapter has a different voice.',
  coverUrl:
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=900&q=80',
  chapters: [],
  createdAt: Date.now(),
};

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

const App: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);

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

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  const selectedChapter = useMemo(
    () => selectedBook?.chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [selectedBook, selectedChapterId]
  );

  useEffect(() => {
    const initialize = async () => {
      try {
        const storedBooks = await loadBooks();
        setBooks(storedBooks.length > 0 ? storedBooks : [seedBook]);
      } catch (error) {
        console.error('Failed to load books:', error);
        setBooks([seedBook]);
      } finally {
        setLoaded(true);
      }
    };

    initialize();
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    saveBooks(books).catch((error) => {
      console.error('Failed to persist books:', error);
    });
  }, [books, loaded]);

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

  const updateSelectedPart = (partId: string, patch: Partial<Part>) => {
    if (!selectedBookId || !selectedChapterId) {
      return;
    }

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
  };

  const openAddBook = () => {
    setBookDraft({ title: '', author: '', description: '', coverUrl: '' });
    setBookModal({ mode: 'add' });
  };

  const openEditBook = (bookId: string) => {
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
    setChapterDraft({ title: '' });
    setChapterModal({ mode: 'add' });
  };

  const openEditChapter = (chapterId: string) => {
    const target = selectedBook?.chapters.find((chapter) => chapter.id === chapterId);
    if (!target) {
      return;
    }
    setChapterDraft({ title: target.title });
    setChapterModal({ mode: 'edit', id: chapterId });
  };

  const submitChapter = (event: React.FormEvent) => {
    event.preventDefault();
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
    setPartDraft({ title: '', content: '', voiceName: VOICES[4] });
    setPartModal({ mode: 'add' });
  };

  const openEditPart = (partId: string) => {
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
                    driveFileId: contentChanged ? undefined : part.driveFileId,
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
    if (!deleteTarget) {
      return;
    }

    if (deleteTarget.type === 'book') {
      setBooks((prevBooks) => prevBooks.filter((book) => book.id !== deleteTarget.id));
      if (selectedBookId === deleteTarget.id) {
        setSelectedBookId(null);
        setSelectedChapterId(null);
        setActivePartId(null);
      }
    }

    if (deleteTarget.type === 'chapter' && selectedBookId) {
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

  const connectDrive = async () => {
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
    try {
      await disconnectDrive();
      setIsDriveConnected(false);
    } catch (error: any) {
      alert(error?.message || 'Failed to disconnect Google Drive.');
    }
  };

  const generatePartAudio = async (partId: string) => {
    if (!selectedBook || !selectedChapter) {
      return;
    }

    const targetPart = selectedChapter.parts.find((part) => part.id === partId);
    if (!targetPart) {
      return;
    }

    updateSelectedPart(partId, {
      isGenerating: true,
      progress: 2,
      error: undefined,
    });

    let progress = 2;
    const timer = window.setInterval(() => {
      progress = Math.min(progress + 7, 92);
      updateSelectedPart(partId, { progress });
    }, 450);

    try {
      const audioBase64 = await generateTtsAudio(targetPart.content, targetPart.voiceName);

      if (isDriveConnected) {
        updateSelectedPart(partId, { progress: 96 });
        const filename = safeFileName(
          `${selectedBook.title}-${selectedChapter.title}-${targetPart.title}.mp3`
        );
        const fileId = await uploadAudioToDrive(audioBase64, filename || `lumina-${partId}.mp3`);

        updateSelectedPart(partId, {
          isGenerating: false,
          progress: 100,
          audioBase64: undefined,
          driveFileId: fileId,
          error: undefined,
        });
      } else {
        updateSelectedPart(partId, {
          isGenerating: false,
          progress: 100,
          audioBase64,
          driveFileId: undefined,
          error: undefined,
        });
      }
    } catch (error: any) {
      updateSelectedPart(partId, {
        isGenerating: false,
        progress: 0,
        error: error?.message || 'Narration generation failed.',
      });
    } finally {
      window.clearInterval(timer);
    }
  };

  const analyzeSelectedChapter = async () => {
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

    const firstPlayable = selectedChapter.parts.find((part) => part.audioBase64 || part.driveFileId);
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
      if (candidate.audioBase64 || candidate.driveFileId) {
        setActivePartId(candidate.id);
        return;
      }
    }

    setActivePartId(null);
  }, [autoplayEnabled, selectedChapter, activePartId]);

  if (!loaded) {
    return (
      <div className="app-loading">
        <Loader2 className="spin" size={42} />
        <p>Loading Lumina workspace...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">L</span>
          <div>
            <h1>Lumina Studio</h1>
            <p>Audiobook production for web and mobile listening</p>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="soft-btn" onClick={() => setAutoplayEnabled((prev) => !prev)}>
            {autoplayEnabled ? <CheckCircle2 size={15} /> : <CloudOff size={15} />}
            Autoplay {autoplayEnabled ? 'On' : 'Off'}
          </button>

          <button
            className={isDriveConnected ? 'soft-btn connected' : 'soft-btn'}
            onClick={isDriveConnected ? handleDisconnectDrive : connectDrive}
          >
            {isDriveConnected ? <Cloud size={15} /> : <CloudOff size={15} />}
            Drive {isDriveConnected ? 'Connected' : 'Connect'}
          </button>
        </div>
      </header>

      <main className="main-layout">
        {!selectedBook && (
          <section>
            <div className="section-header">
              <div>
                <h2>Your Library</h2>
                <p>Create books, split chapters into parts, and narrate them with Gemini voices.</p>
              </div>
              <button className="primary-btn" onClick={openAddBook}>
                <BookPlus size={17} /> New Book
              </button>
            </div>

            {books.length === 0 ? (
              <div className="empty-state">No books yet. Create your first one.</div>
            ) : (
              <div className="book-grid">
                {books.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onOpen={(bookId) => setSelectedBookId(bookId)}
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
              </div>
            </div>

            <div className="chapter-list">
              {selectedBook.chapters.length === 0 && (
                <div className="empty-state">No chapters yet. Add one to start building narration.</div>
              )}

              {selectedBook.chapters.map((chapter) => (
                <article key={chapter.id} className="chapter-card">
                  <button
                    className="chapter-open"
                    onClick={() => {
                      setSelectedChapterId(chapter.id);
                      setActivePartId(null);
                    }}
                  >
                    <h3>{chapter.title}</h3>
                    <p>{chapter.parts.length} parts</p>
                  </button>

                  <div className="chapter-card-actions">
                    <button className="soft-btn" onClick={() => openEditChapter(chapter.id)}>
                      <PencilLine size={15} />
                    </button>
                    <button
                      className="danger-btn"
                      onClick={() => setDeleteTarget({ type: 'chapter', id: chapter.id })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
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
                  {selectedChapter.parts.filter((part) => part.audioBase64 || part.driveFileId).length}{' '}
                  narrated
                </p>
              </div>
              <div className="section-actions-wrap">
                <button className="soft-btn" onClick={handlePlayChapter}>
                  <Play size={15} /> Play chapter
                </button>
                <button
                  className="soft-btn"
                  onClick={analyzeSelectedChapter}
                  disabled={selectedChapter.isAnalyzing || selectedChapter.parts.length === 0}
                >
                  {selectedChapter.isAnalyzing ? <Loader2 className="spin" size={15} /> : <Brain size={15} />}
                  Insights
                </button>
                <button className="primary-btn" onClick={openAddPart}>
                  <Plus size={15} /> Add Part
                </button>
              </div>
            </div>

            <div className="content-grid">
              <div className="parts-stack">
                {selectedChapter.parts.length === 0 && (
                  <div className="empty-state">No parts yet. Add a part and generate narration.</div>
                )}

                {selectedChapter.parts.map((part, index) => {
                  const isActive = part.id === activePartId;
                  const hasAudio = Boolean(part.audioBase64 || part.driveFileId);

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
                      </div>

                      <p className="part-preview">{part.content.slice(0, 220)}{part.content.length > 220 ? '...' : ''}</p>

                      {!hasAudio && !part.isGenerating && (
                        <button className="primary-btn" onClick={() => generatePartAudio(part.id)}>
                          <Wand2 size={15} /> Generate narration
                        </button>
                      )}

                      {part.isGenerating && (
                        <div className="progress-wrap">
                          <div className="progress-line">
                            <span style={{ width: `${part.progress}%` }} />
                          </div>
                          <p>Generating audio... {Math.round(part.progress)}%</p>
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
                          driveFileId={part.driveFileId}
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
                    <p className="muted-row">Run Insights to generate summary and discussion questions.</p>
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

      {deleteTarget && (
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

      {bookModal.mode !== 'closed' && (
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

      {chapterModal.mode !== 'closed' && (
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

      {partModal.mode !== 'closed' && (
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
    </div>
  );
};

export default App;
