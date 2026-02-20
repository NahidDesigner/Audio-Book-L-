
import React from 'react';
import { Book as BookType } from '../types';
import { BookOpen, Headphones, Calendar, Trash2 } from 'lucide-react';

interface BookCardProps {
  book: BookType;
  onClick: (book: BookType) => void;
  onDelete?: (id: string) => void;
  isAdmin?: boolean;
}

const BookCard: React.FC<BookCardProps> = ({ book, onClick, onDelete, isAdmin }) => {
  // Calculate total parts across all chapters
  const totalParts = book.chapters?.reduce((acc, ch) => acc + (ch.parts?.length || 0), 0) || 0;
  const narratedParts = book.chapters?.reduce((acc, ch) => 
    acc + (ch.parts?.filter(p => p.audioBase64 || p.driveFileId).length || 0), 0) || 0;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) onDelete(book.id);
  };

  return (
    <div 
      onClick={() => onClick(book)}
      className="group relative bg-slate-800/40 rounded-2xl border border-slate-700/50 hover:border-indigo-500/50 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col h-full shadow-lg hover:shadow-indigo-500/5"
    >
      <div className="aspect-[3/4] overflow-hidden relative">
        <img 
          src={book.coverUrl || `https://picsum.photos/seed/${book.id}/600/800`} 
          alt={book.title}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
        
        <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
          <div className="bg-slate-900/80 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border border-white/10">
            <Headphones size={12} className="text-indigo-400" />
            <span>{narratedParts}/{totalParts} Ready</span>
          </div>
          
          {isAdmin && (
            <button 
              onClick={handleDelete}
              className="w-8 h-8 bg-red-500/80 backdrop-blur-md text-white rounded-full flex items-center justify-center border border-red-400/50 hover:bg-red-500 transition-all shadow-lg active:scale-90"
              title="Delete Collection"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      
      <div className="p-5 flex flex-col flex-1">
        <div className="flex-1">
          <h3 className="serif-font text-xl mb-1 group-hover:text-indigo-400 transition-colors line-clamp-1">{book.title}</h3>
          <p className="text-sm text-slate-400 mb-3 font-medium">{book.author}</p>
          <p className="text-xs text-slate-500 line-clamp-2 italic leading-relaxed">
            {book.description || "No description provided for this collection."}
          </p>
        </div>
        
        <div className="mt-4 pt-4 border-t border-slate-700/50 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1 font-bold">
            <Calendar size={10} />
            {new Date(book.createdAt).toLocaleDateString()}
          </span>
          <span className="text-xs font-bold text-indigo-400 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            Open <BookOpen size={14} />
          </span>
        </div>
      </div>
    </div>
  );
};

export default BookCard;
