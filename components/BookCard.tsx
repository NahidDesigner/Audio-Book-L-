import React from 'react';
import { Book } from '../types';
import { BookOpen, Trash2, PencilLine } from 'lucide-react';

interface BookCardProps {
  book: Book;
  onOpen: (bookId: string) => void;
  onEdit: (bookId: string) => void;
  onDelete: (bookId: string) => void;
}

const BookCard: React.FC<BookCardProps> = ({ book, onOpen, onEdit, onDelete }) => {
  const totalParts = book.chapters.reduce((acc, chapter) => acc + chapter.parts.length, 0);
  const narratedParts = book.chapters.reduce(
    (acc, chapter) =>
      acc + chapter.parts.filter((part) => part.audioBase64 || part.driveFileId).length,
    0
  );

  return (
    <article className="book-card">
      <button className="book-cover-wrap" onClick={() => onOpen(book.id)}>
        <img className="book-cover" src={book.coverUrl} alt={book.title} loading="lazy" />
      </button>

      <div className="book-content">
        <h3 className="book-title">{book.title}</h3>
        <p className="book-author">{book.author}</p>
        <p className="book-desc">{book.description || 'No description provided yet.'}</p>

        <div className="book-meta">
          <span>{book.chapters.length} chapters</span>
          <span>
            {narratedParts}/{totalParts} narrated
          </span>
        </div>

        <div className="book-actions">
          <button className="ghost-btn" onClick={() => onOpen(book.id)}>
            <BookOpen size={15} /> Open
          </button>
          <button className="ghost-btn" onClick={() => onEdit(book.id)}>
            <PencilLine size={15} /> Edit
          </button>
          <button className="danger-btn" onClick={() => onDelete(book.id)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </article>
  );
};

export default BookCard;
