
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, ChevronLeft, Library, Trash2, 
  Loader2, AlertCircle, 
  Shield, BrainCircuit, PlayCircle, Lock, Edit3,
  Volume2, Play, Headphones, Wand2, Sparkles
} from 'lucide-react';
import { Book, Chapter, Part, Voice } from './types';
import BookCard from './components/BookCard';
import AudioPlayer from './components/AudioPlayer';
import { generateAudioFromText, analyzeChapter } from './services/geminiService';
import { loadBooks, saveBooks } from './services/storageService';
import { decode, pcmToMp3, encode } from './utils/audioUtils';

const App: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [isAutoplayEnabled, setIsAutoplayEnabled] = useState(true);
  
  // Persistence for Admin Mode
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('lumina_admin_test') === 'true');
  
  // CRUD UI States
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [isAddingChapter, setIsAddingChapter] = useState(false);
  const [isAddingPart, setIsAddingPart] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [targetId, setTargetId] = useState<string | null>(null);
  
  // Confirmation states
  const [deleteTarget, setDeleteTarget] = useState<{type: 'book' | 'chapter' | 'part', id: string} | null>(null);
  
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true);

  // Form states
  const [newBook, setNewBook] = useState({ title: '', author: '', description: '', coverUrl: '' });
  const [newChapter, setNewChapter] = useState({ title: '' });
  const [newPart, setNewPart] = useState({ title: '', content: '', voiceName: Voice.ZEPHYR });

  const selectedBook = books.find(b => b.id === selectedBookId) || null;
  const selectedChapter = selectedBook?.chapters.find(c => c.id === selectedChapterId) || null;

  useEffect(() => {
    const init = async () => {
      try {
        const storedBooks = await loadBooks();
        if (storedBooks && storedBooks.length > 0) {
          setBooks(storedBooks);
        } else {
          const seed: Book[] = [{
            id: 'seed-1',
            title: 'The Alchemist\'s Secret',
            author: 'Julian Thorne',
            description: 'An ancient mystery waiting to be told through the power of voice.',
            coverUrl: 'https://images.unsplash.com/photo-1543005128-d39eef502b0e?auto=format&fit=crop&q=80&w=600&h=800',
            chapters: [],
            createdAt: Date.now()
          }];
          setBooks(seed);
          await saveBooks(seed);
        }
      } catch (e) {
        console.error("Storage init error:", e);
      } finally {
        setIsLoadingLibrary(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!isLoadingLibrary) {
      saveBooks(books).catch(console.error);
    }
  }, [books, isLoadingLibrary]);

  useEffect(() => {
    localStorage.setItem('lumina_admin_test', isAdmin.toString());
  }, [isAdmin]);

  const toggleAdmin = () => setIsAdmin(!isAdmin);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const { type, id } = deleteTarget;

    if (type === 'book') {
      const nextBooks = books.filter(b => b.id !== id);
      setBooks(nextBooks);
      if (selectedBookId === id) setSelectedBookId(null);
    } else if (type === 'chapter') {
      setBooks(prev => prev.map(b => b.id === selectedBookId 
        ? { ...b, chapters: b.chapters.filter(c => c.id !== id) } 
        : b
      ));
      if (selectedChapterId === id) setSelectedChapterId(null);
    } else if (type === 'part') {
      setBooks(prev => prev.map(b => b.id === selectedBookId ? {
        ...b,
        chapters: b.chapters.map(c => c.id === selectedChapterId 
          ? { ...c, parts: c.parts.filter(p => p.id !== id) } 
          : c)
      } : b));
      if (activePartId === id) setActivePartId(null);
    }
    setDeleteTarget(null);
  };

  const handleBookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modalMode === 'add') {
      const book: Book = {
        id: Math.random().toString(36).substr(2, 9),
        ...newBook,
        chapters: [],
        createdAt: Date.now(),
        coverUrl: newBook.coverUrl || `https://picsum.photos/seed/${Math.random()}/600/800`
      };
      setBooks(prev => [book, ...prev]);
    } else {
      setBooks(prev => prev.map(b => b.id === targetId ? { ...b, ...newBook } : b));
    }
    setIsAddingBook(false);
    setNewBook({ title: '', author: '', description: '', coverUrl: '' });
  };

  const handleChapterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookId) return;
    if (modalMode === 'add') {
      const chapter: Chapter = {
        id: Math.random().toString(36).substr(2, 9),
        title: newChapter.title,
        parts: []
      };
      setBooks(prev => prev.map(b => b.id === selectedBookId ? { ...b, chapters: [...b.chapters, chapter] } : b));
    } else {
      setBooks(prev => prev.map(b => b.id === selectedBookId ? {
        ...b,
        chapters: b.chapters.map(c => c.id === targetId ? { ...c, title: newChapter.title } : c)
      } : b));
    }
    setIsAddingChapter(false);
    setNewChapter({ title: '' });
  };

  const handlePartSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookId || !selectedChapterId) return;
    if (modalMode === 'add') {
      const part: Part = {
        id: Math.random().toString(36).substr(2, 9),
        ...newPart,
        isGenerating: false,
        progress: 0
      };
      setBooks(prev => prev.map(b => b.id === selectedBookId ? {
        ...b,
        chapters: b.chapters.map(c => c.id === selectedChapterId ? { ...c, parts: [...c.parts, part] } : c)
      } : b));
    } else {
      setBooks(prev => prev.map(b => b.id === selectedBookId ? {
        ...b,
        chapters: b.chapters.map(c => c.id === selectedChapterId ? {
          ...c,
          parts: c.parts.map(p => {
            if (p.id === targetId) {
              const contentChanged = p.content !== newPart.content;
              return { 
                ...p, 
                ...newPart, 
                audioBase64: contentChanged ? undefined : p.audioBase64,
                driveFileId: contentChanged ? undefined : p.driveFileId
              };
            }
            return p;
          })
        } : c)
      } : b));
    }
    setIsAddingPart(false);
    setNewPart({ title: '', content: '', voiceName: Voice.ZEPHYR });
  };

  const triggerEditBook = (book: Book) => {
    setModalMode('edit');
    setTargetId(book.id);
    setNewBook({ title: book.title, author: book.author, description: book.description, coverUrl: book.coverUrl });
    setIsAddingBook(true);
  };

  const triggerEditChapter = (e: React.MouseEvent, chapter: Chapter) => {
    e.stopPropagation();
    setModalMode('edit');
    setTargetId(chapter.id);
    setNewChapter({ title: chapter.title });
    setIsAddingChapter(true);
  };

  const triggerEditPart = (part: Part) => {
    setModalMode('edit');
    setTargetId(part.id);
    setNewPart({ title: part.title, content: part.content, voiceName: part.voiceName as Voice });
    setIsAddingPart(true);
  };

  const updatePartState = (partId: string, updates: Partial<Part>) => {
    setBooks(prev => prev.map(b => b.id === selectedBookId ? {
      ...b,
      chapters: b.chapters.map(c => c.id === selectedChapterId ? {
        ...c,
        parts: c.parts.map(p => p.id === partId ? { ...p, ...updates } : p)
      } : c)
    } : b));
  };

  const [isDriveConnected, setIsDriveConnected] = useState(false);

  useEffect(() => {
    const checkDriveStatus = async () => {
      try {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        setIsDriveConnected(data.connected);
      } catch (e) {
        console.error("Failed to check drive status", e);
      }
    };
    checkDriveStatus();

    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsDriveConnected(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const connectDrive = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const response = await fetch(`/api/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`);
      if (!response.ok) throw new Error('Failed to get auth URL');
      const { url } = await response.json();
      
      const authWindow = window.open(url, 'oauth_popup', 'width=600,height=700');
      if (!authWindow) {
        alert('Please allow popups for this site to connect your Google Drive.');
      }
    } catch (error) {
      console.error('OAuth error:', error);
      alert('Failed to connect to Google Drive');
    }
  };

  const disconnectDrive = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setIsDriveConnected(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const generatePartAudio = async (partId: string) => {
    const part = selectedChapter?.parts.find(p => p.id === partId);
    if (!part) return;
    
    updatePartState(partId, { isGenerating: true, progress: 0, error: undefined });
    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(progress + (100 - progress) / 10, 99);
      updatePartState(partId, { progress });
    }, 500);

    try {
      const audio = await generateAudioFromText(part.content, part.voiceName);
      
      if (isDriveConnected) {
        updatePartState(partId, { progress: 99 }); // Indicate uploading
        
        // Convert PCM to MP3
        const pcmData = decode(audio);
        const mp3Data = pcmToMp3(pcmData, 24000, 1);
        const mp3Base64 = encode(mp3Data);

        const redirectUri = `${window.location.origin}/auth/callback`;
        const uploadRes = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64Audio: mp3Base64,
            filename: `${selectedBook?.title} - ${selectedChapter?.title} - ${part.title || part.id}.mp3`,
            mimeType: 'audio/mpeg',
            redirectUri
          })
        });
        
        if (!uploadRes.ok) {
          const errorData = await uploadRes.json();
          throw new Error(errorData.error || 'Failed to upload to Drive');
        }
        
        const { fileId } = await uploadRes.json();
        clearInterval(interval);
        updatePartState(partId, { isGenerating: false, progress: 100, driveFileId: fileId, audioBase64: undefined });
      } else {
        clearInterval(interval);
        updatePartState(partId, { isGenerating: false, progress: 100, audioBase64: audio });
      }
    } catch (error: any) {
      clearInterval(interval);
      updatePartState(partId, { isGenerating: false, error: error.message });
    }
  };

  const runAIAnalysis = async () => {
    if (!selectedChapter || !selectedBookId) return;
    setBooks(prev => prev.map(b => b.id === selectedBookId ? {
      ...b,
      chapters: b.chapters.map(c => c.id === selectedChapterId ? { ...c, isAnalyzing: true } : c)
    } : b));

    try {
      const fullText = selectedChapter.parts.map(p => p.content).join("\n\n");
      const result = await analyzeChapter(selectedChapter.title, fullText);
      setBooks(prev => prev.map(b => b.id === selectedBookId ? {
        ...b,
        chapters: b.chapters.map(c => c.id === selectedChapterId ? { 
          ...c, isAnalyzing: false, summary: result.summary, questions: result.questions 
        } : c)
      } : b));
    } catch (error) {
      console.error("Analysis failed", error);
      alert("Analysis failed.");
      setBooks(prev => prev.map(b => b.id === selectedBookId ? {
        ...b,
        chapters: b.chapters.map(c => c.id === selectedChapterId ? { ...c, isAnalyzing: false } : c)
      } : b));
    }
  };

  // PLAYLIST LOGIC: Moving to the next part automatically
  const onPartFinished = useCallback(() => {
    if (!selectedChapter || !isAutoplayEnabled) return;
    
    setActivePartId((currentId) => {
      if (!currentId) return null;
      const currentIndex = selectedChapter.parts.findIndex(p => p.id === currentId);
      if (currentIndex !== -1 && currentIndex < selectedChapter.parts.length - 1) {
        const nextPart = selectedChapter.parts[currentIndex + 1];
        if (nextPart.audioBase64 || nextPart.driveFileId) {
          return nextPart.id;
        }
      }
      return null;
    });
  }, [selectedChapter, isAutoplayEnabled]);

  const playEntireChapter = () => {
    if (!selectedChapter || selectedChapter.parts.length === 0) return;
    
    // Find the first part with audio
    const firstPlayable = selectedChapter.parts.find(p => !!p.audioBase64 || !!p.driveFileId);
    
    if (firstPlayable) {
      // Small delay to ensure state updates sequentially and triggers the player mount
      setActivePartId(null);
      setTimeout(() => setActivePartId(firstPlayable.id), 100);
    } else if (isAdmin) {
        alert("No audio generated yet. Please generate narration for at least one part first.");
    } else {
        alert("Narration is still being prepared for this chapter.");
    }
  };

  if (isLoadingLibrary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
        <div className="text-center">
          <Loader2 className="animate-spin text-indigo-500 mx-auto mb-4" size={48} />
          <p className="text-slate-400 font-medium animate-pulse tracking-widest uppercase">Initializing Lumina Engine</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-[#0f172a] text-slate-100 selection:bg-indigo-500/30 font-sans">
      {/* Header */}
      <header className={`sticky top-0 z-50 backdrop-blur-xl border-b px-6 py-4 transition-all duration-300 ${isAdmin ? 'bg-indigo-950/60 border-indigo-500/40 shadow-lg' : 'bg-slate-900/80 border-slate-800'}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => {setSelectedBookId(null); setSelectedChapterId(null); setActivePartId(null);}}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-all ${isAdmin ? 'bg-indigo-500 rotate-3' : 'bg-indigo-600'}`}>
              <Headphones size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold">Lumina</h1>
              <p className={`text-[9px] uppercase tracking-widest font-bold ${isAdmin ? 'text-indigo-300' : 'text-indigo-500'}`}>
                {isAdmin ? 'ADMIN MODE ACTIVE' : 'READER MODE'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
              <div className={`w-2 h-2 rounded-full ${isDriveConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Drive: {isDriveConnected ? 'Connected' : 'Disconnected'}
              </span>
              <button 
                onClick={isDriveConnected ? disconnectDrive : connectDrive}
                className={`ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${isDriveConnected ? 'text-red-400 hover:bg-red-400/10' : 'text-indigo-400 hover:bg-indigo-400/10'}`}
              >
                {isDriveConnected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
            <button 
              onClick={toggleAdmin} 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-xs font-bold border ${isAdmin ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
            >
              {isAdmin ? <Shield size={14} /> : <Lock size={14} />}
              {isAdmin ? 'Leave Admin' : 'Admin Test'}
            </button>
            {isAdmin && !selectedBookId && (
              <button onClick={() => {setModalMode('add'); setIsAddingBook(true);}} className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded-lg transition-all font-bold text-xs shadow-md">
                <Plus size={14} /> Add Book
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {!selectedBookId ? (
          /* Bookshelf View */
          <div className="animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl serif-font">My Library</h2>
              {isAdmin && books.length > 0 && (
                <p className="text-xs text-indigo-400 font-bold bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">ADMIN CONTROLS UNLOCKED</p>
              )}
            </div>
            {books.length === 0 ? (
              <div className="py-32 flex flex-col items-center text-slate-600 border-2 border-dashed border-slate-800 rounded-3xl">
                <Library size={64} strokeWidth={1} className="mb-4 opacity-30" />
                <p className="text-xl">Your library is currently empty.</p>
                {isAdmin && <button onClick={() => {setModalMode('add'); setIsAddingBook(true);}} className="mt-4 text-indigo-400 font-bold hover:underline">Create First Collection</button>}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                {books.map(book => (
                  <BookCard 
                    key={book.id} 
                    book={book} 
                    isAdmin={isAdmin}
                    onDelete={(id) => setDeleteTarget({type: 'book', id})}
                    onClick={(b) => setSelectedBookId(b.id)} 
                  />
                ))}
              </div>
            )}
          </div>
        ) : !selectedChapterId ? (
          /* Chapters View */
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <button onClick={() => setSelectedBookId(null)} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 group transition-colors text-sm">
              <ChevronLeft size={16} /> Back to Library
            </button>
            <div className="flex flex-col md:flex-row gap-12">
              <div className="md:w-1/3">
                <div className="sticky top-28">
                  <div className="relative group/cover">
                    <img src={selectedBook.coverUrl} className="w-full aspect-[3/4] object-cover rounded-2xl shadow-2xl border border-slate-700/50 mb-6" />
                    {isAdmin && (
                      <button onClick={() => triggerEditBook(selectedBook)} className="absolute top-4 right-4 bg-indigo-600 p-2 rounded-lg shadow-lg hover:bg-indigo-500 transition-colors">
                        <Edit3 size={18} />
                      </button>
                    )}
                  </div>
                  <h2 className="text-4xl serif-font mb-2">{selectedBook.title}</h2>
                  <p className="text-slate-400 mb-6 text-lg">{selectedBook.author}</p>
                  <p className="text-sm text-slate-500 mb-8 leading-relaxed italic">{selectedBook.description}</p>
                  
                  {isAdmin && (
                    <div className="space-y-4 pt-6 border-t border-slate-800">
                      <p className="text-[10px] font-bold text-indigo-400 tracking-widest uppercase">Chapter Actions</p>
                      <button onClick={() => {setModalMode('add'); setIsAddingChapter(true);}} className="w-full flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 p-4 rounded-xl transition-all font-bold">
                        <Plus size={20} /> Add New Chapter
                      </button>
                      <button onClick={() => setDeleteTarget({type: 'book', id: selectedBookId})} className="w-full flex items-center justify-center gap-2 text-red-400 hover:bg-red-500/10 p-3 rounded-xl transition-colors font-medium border border-transparent hover:border-red-500/20">
                        <Trash2 size={16} /> Delete This Book
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="md:w-2/3">
                <h3 className="text-2xl font-bold mb-6 flex items-center gap-3 text-indigo-400">Chapters</h3>
                <div className="grid gap-3">
                  {selectedBook.chapters.length === 0 ? (
                    <div className="text-center py-20 border-2 border-dashed border-slate-800 rounded-2xl text-slate-600">
                      <p className="mb-4">No chapters created yet.</p>
                      {isAdmin && <button onClick={() => {setModalMode('add'); setIsAddingChapter(true);}} className="text-indigo-400 font-bold">Add First Chapter</button>}
                    </div>
                  ) : (
                    selectedBook.chapters.map(ch => (
                      <div 
                        key={ch.id} 
                        onClick={() => setSelectedChapterId(ch.id)}
                        className="group bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 hover:border-indigo-500/50 cursor-pointer transition-all flex items-center justify-between"
                      >
                        <div>
                          <h4 className="text-lg font-bold group-hover:text-indigo-400 transition-colors">{ch.title}</h4>
                          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">{ch.parts.length} PARTS</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {isAdmin && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => triggerEditChapter(e, ch)} className="p-2 bg-slate-700 hover:bg-indigo-500/40 rounded-lg text-slate-300 transition-colors">
                                <Edit3 size={16} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setDeleteTarget({type: 'chapter', id: ch.id}); }} className="p-2 bg-slate-700 hover:bg-red-500/40 rounded-lg text-slate-300 transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                          <ChevronLeft size={20} className="rotate-180 text-slate-600 group-hover:text-indigo-400 transition-all" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Playlist View */
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <button onClick={() => {setSelectedChapterId(null); setActivePartId(null);}} className="flex items-center gap-2 text-slate-400 hover:text-white mb-8 text-sm">
              <ChevronLeft size={16} /> Back to Chapters
            </button>
            
            <div className="flex flex-col lg:flex-row gap-10">
              <div className="lg:w-3/5">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 pb-4 border-b border-slate-800 gap-4">
                  <div>
                    <h2 className="text-3xl font-bold">{selectedChapter.title}</h2>
                    <div className="flex items-center gap-4 mt-1">
                      <p className="text-xs text-slate-500">Continuous play is enabled by default.</p>
                      <button 
                        onClick={() => setIsAutoplayEnabled(!isAutoplayEnabled)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase transition-colors border ${isAutoplayEnabled ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}
                      >
                        Autoplay: {isAutoplayEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={playEntireChapter}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                    >
                      <Play size={14} fill="currentColor" /> Play All
                    </button>
                    <button 
                      onClick={runAIAnalysis} 
                      disabled={selectedChapter.isAnalyzing || selectedChapter.parts.length === 0}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-4 py-2.5 rounded-xl transition-all font-bold text-xs disabled:opacity-30"
                    >
                      {selectedChapter.isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
                      Insights
                    </button>
                    {isAdmin && (
                      <button onClick={() => {setModalMode('add'); setIsAddingPart(true);}} className="flex items-center justify-center w-10 h-10 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-all">
                        <Plus size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-4 relative">
                  {/* Decorative Playlist line */}
                  <div className="absolute left-[29px] top-8 bottom-8 w-0.5 bg-slate-800/50 -z-10" />

                  {selectedChapter.parts.length === 0 ? (
                    <div className="text-center py-20 border border-slate-800 rounded-2xl text-slate-600">
                      No narrative parts here yet.
                    </div>
                  ) : (
                    selectedChapter.parts.map((p, idx) => {
                      const isActive = activePartId === p.id;
                      const hasAudio = !!p.audioBase64 || !!p.driveFileId;
                      
                      return (
                        <div 
                          key={p.id} 
                          className={`group relative p-5 rounded-2xl border transition-all duration-300 ${isActive ? 'bg-indigo-500/10 border-indigo-500/40 shadow-xl shadow-indigo-500/5 ring-1 ring-indigo-500/20' : 'bg-slate-800/30 border-slate-800/50 hover:border-slate-700'}`}
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-4">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-sm font-bold border ${isActive ? 'bg-indigo-500 border-indigo-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>
                                {isActive ? <Volume2 size={14} className="animate-pulse" /> : (idx + 1)}
                              </div>
                              <div>
                                <h4 className={`font-bold text-lg transition-colors ${isActive ? 'text-indigo-300' : 'text-slate-100'}`}>{p.title}</h4>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] text-slate-500 tracking-widest font-bold uppercase">{p.voiceName}</span>
                                  {isActive && <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-widest animate-pulse">• Now Playing</span>}
                                  {!hasAudio && !p.isGenerating && <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">• No Audio</span>}
                                </div>
                              </div>
                            </div>
                            {isAdmin && (
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => triggerEditPart(p)} className="p-2 text-slate-600 hover:text-indigo-400 transition-colors"><Edit3 size={16} /></button>
                                  <button onClick={() => setDeleteTarget({type: 'part', id: p.id})} className="p-2 text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={16} /></button>
                              </div>
                            )}
                          </div>

                          {hasAudio ? (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                              {isActive ? (
                                <AudioPlayer 
                                  audioBase64={p.audioBase64} 
                                  driveFileId={p.driveFileId}
                                  autoPlay={true} 
                                  onFinished={onPartFinished}
                                  title={p.title || `Part ${idx + 1}`}
                                  artist={selectedBook?.author}
                                  album={selectedBook?.title}
                                  coverUrl={selectedBook?.coverUrl}
                                />
                              ) : (
                                <button 
                                  onClick={() => setActivePartId(p.id)}
                                  className="flex items-center gap-2 bg-slate-800/50 hover:bg-indigo-600 text-slate-300 hover:text-white px-5 py-3 rounded-xl text-sm font-bold border border-slate-700 hover:border-indigo-500 transition-all active:scale-95"
                                >
                                  <PlayCircle size={18} /> Play Segment
                                </button>
                              )}
                            </div>
                          ) : (
                            isAdmin ? (
                              p.isGenerating ? (
                                <div className="space-y-3 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                                  <div className="flex justify-between text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                                    <span>Synthesizing Narration...</span>
                                    <span>{Math.round(p.progress || 0)}%</span>
                                  </div>
                                  <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-indigo-500 transition-all duration-300 shadow-[0_0_8px_rgba(99,102,241,0.6)]" style={{ width: `${p.progress}%` }} />
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => generatePartAudio(p.id)} className="flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-5 py-3 rounded-xl font-bold text-sm transition-all">
                                  <Wand2 size={16} /> Generate Narration
                                </button>
                              )
                            ) : (
                              <div className="flex items-center gap-3 text-slate-500 italic text-sm py-4 px-2">
                                <Loader2 size={14} className="animate-spin" /> 
                                <span>The narrator is preparing this segment.</span>
                              </div>
                            )
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Insights Sidebar */}
              <div className="lg:w-2/5">
                <div className="sticky top-28 space-y-6">
                  {/* Playlist Queue info if active */}
                  {activePartId && selectedChapter.parts.length > 1 && (
                    <div className="bg-indigo-500/5 border border-indigo-500/20 p-5 rounded-2xl">
                       <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                         <Volume2 size={14} /> Playlist Status
                       </h3>
                       <div className="flex items-center justify-between text-sm">
                         <span className="text-slate-400">Next Part:</span>
                         <span className="font-bold text-slate-200">
                           {(() => {
                             const idx = selectedChapter.parts.findIndex(p => p.id === activePartId);
                             return idx !== -1 && idx < selectedChapter.parts.length - 1 ? selectedChapter.parts[idx+1].title : 'End of Chapter';
                           })()}
                         </span>
                       </div>
                    </div>
                  )}

                  {(selectedChapter.summary || selectedChapter.isAnalyzing) && (
                    <div className="bg-slate-800/40 border border-slate-700/50 p-6 rounded-2xl animate-in fade-in slide-in-from-right-4">
                      <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-indigo-400">
                        <Sparkles size={18} /> Chapter Synthesis
                      </h3>
                      {selectedChapter.isAnalyzing ? (
                        <div className="flex flex-col items-center py-10 text-slate-500">
                          <Loader2 className="animate-spin mb-3 text-indigo-500" />
                          <p className="text-sm font-medium animate-pulse uppercase tracking-widest">GEMINI IS READING</p>
                        </div>
                      ) : (
                        <>
                          <div className="mb-6">
                            <label className="text-[10px] uppercase tracking-tighter text-indigo-500 font-bold mb-2 block">Executive Summary</label>
                            <p className="text-slate-400 text-sm leading-relaxed italic">"{selectedChapter.summary}"</p>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-tighter text-indigo-500 font-bold mb-2 block">Analysis & Questions</label>
                            <ul className="space-y-3">
                              {selectedChapter.questions?.map((q, i) => (
                                <li key={i} className="text-xs bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 text-slate-300 leading-tight">
                                  {q}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Confirmation & Form Modals */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
            <h2 className="text-xl font-bold text-red-400 mb-2 flex items-center gap-2">
              <AlertCircle size={20} /> Confirm Deletion
            </h2>
            <p className="text-slate-400 text-sm mb-6 leading-relaxed">
              This will permanently remove the selected {deleteTarget.type}. All associated data will be lost.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 bg-slate-800 py-3 rounded-lg font-bold text-sm">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 bg-red-600 hover:bg-red-500 py-3 rounded-lg font-bold text-sm transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {isAddingBook && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm bg-black/60">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95">
            <h2 className="text-2xl font-bold mb-6">{modalMode === 'add' ? 'Create Book' : 'Update Book'}</h2>
            <form onSubmit={handleBookSubmit} className="space-y-4">
              <input required value={newBook.title} onChange={e => setNewBook({...newBook, title: e.target.value})} placeholder="Title" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
              <input required value={newBook.author} onChange={e => setNewBook({...newBook, author: e.target.value})} placeholder="Author" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
              <textarea value={newBook.description} onChange={e => setNewBook({...newBook, description: e.target.value})} placeholder="Description" rows={3} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none resize-none" />
              <input value={newBook.coverUrl} onChange={e => setNewBook({...newBook, coverUrl: e.target.value})} placeholder="Cover Image URL" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsAddingBook(false)} className="flex-1 bg-slate-800 py-3 rounded-lg font-bold text-sm">Cancel</button>
                <button type="submit" className="flex-1 bg-indigo-600 font-bold py-3 rounded-lg text-sm">{modalMode === 'add' ? 'Create' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddingChapter && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm bg-black/60">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95">
            <h2 className="text-xl font-bold mb-6">{modalMode === 'add' ? 'New Chapter' : 'Update Chapter'}</h2>
            <form onSubmit={handleChapterSubmit} className="space-y-4">
              <input required autoFocus value={newChapter.title} onChange={e => setNewChapter({title: e.target.value})} placeholder="e.g. Chapter 1" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none" />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsAddingChapter(false)} className="flex-1 bg-slate-800 py-3 rounded-lg font-bold text-sm">Cancel</button>
                <button type="submit" className="flex-1 bg-indigo-600 font-bold py-3 rounded-lg text-sm">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddingPart && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm bg-black/60">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl p-6 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-2">{modalMode === 'add' ? 'Add Narrative Part' : 'Edit Part'}</h2>
            <form onSubmit={handlePartSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-indigo-400 font-bold uppercase ml-1">Part Title</label>
                  <input required value={newPart.title} onChange={e => setNewPart({...newPart, title: e.target.value})} placeholder="Part Title" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-indigo-400 font-bold uppercase ml-1">Voice</label>
                  <select value={newPart.voiceName} onChange={e => setNewPart({...newPart, voiceName: e.target.value as Voice})} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm outline-none">
                    {Object.values(Voice).map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-indigo-400 font-bold uppercase ml-1">Text Content</label>
                <textarea required value={newPart.content} onChange={e => setNewPart({...newPart, content: e.target.value})} placeholder="Paste book text here..." rows={12} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm outline-none resize-none leading-relaxed" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsAddingPart(false)} className="flex-1 bg-slate-800 py-4 rounded-xl font-bold text-sm">Discard</button>
                <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-500 py-4 rounded-xl font-bold text-sm shadow-lg transition-colors">Commit to Chapter</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
