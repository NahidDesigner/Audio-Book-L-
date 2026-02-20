
import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { decode, createMp3Blob } from '../utils/audioUtils';

interface AudioPlayerProps {
  audioBase64?: string;
  driveFileId?: string;
  onFinished?: () => void;
  autoPlay?: boolean;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ 
  audioBase64, 
  driveFileId,
  onFinished, 
  autoPlay,
  title = 'Unknown Title',
  artist = 'Unknown Artist',
  album = 'Unknown Album',
  coverUrl
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);
  
  // Use a ref for onFinished to prevent stale closures
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    let currentUrl: string | null = null;

    const initAudio = async () => {
      try {
        if (driveFileId) {
          currentUrl = `/api/drive/stream/${driveFileId}`;
        } else if (audioBase64) {
          const pcmData = decode(audioBase64);
          const mp3Blob = createMp3Blob(pcmData, 24000, 1);
          currentUrl = URL.createObjectURL(mp3Blob);
        } else {
          return;
        }
        
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        
        const audio = audioRef.current;
        audio.src = currentUrl;
        audio.load();
        
        audio.onloadedmetadata = () => {
          setDuration(audio.duration);
        };
        
        audio.onended = () => {
          setIsPlaying(false);
          setCurrentTime(0);
          cancelAnimationFrame(animationRef.current);
          if (onFinishedRef.current) onFinishedRef.current();
        };

        audio.onplay = () => setIsPlaying(true);
        audio.onpause = () => setIsPlaying(false);

        if (autoPlay) {
          audio.play().catch(e => console.error("Auto-play prevented:", e));
        }

        // Setup MediaSession API
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: album,
            artwork: coverUrl ? [
              { src: coverUrl, sizes: '512x512', type: 'image/jpeg' }
            ] : []
          });

          navigator.mediaSession.setActionHandler('play', () => {
            audio.play();
          });
          navigator.mediaSession.setActionHandler('pause', () => {
            audio.pause();
          });
          navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.fastSeek && 'fastSeek' in audio) {
              audio.fastSeek(details.seekTime || 0);
              return;
            }
            audio.currentTime = details.seekTime || 0;
          });
          navigator.mediaSession.setActionHandler('stop', () => {
            stop();
          });
        }
      } catch (e) {
        console.error("Failed to init audio:", e);
      }
    };

    initAudio();

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
      cancelAnimationFrame(animationRef.current);
    };
  }, [audioBase64, autoPlay, title, artist, album, coverUrl]);

  const updateProgress = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress);
    } else {
      cancelAnimationFrame(animationRef.current);
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [isPlaying]);

  const play = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(e => console.error("Play error:", e));
    }
  };

  const pause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-3 bg-slate-800/80 p-5 rounded-2xl border border-slate-700 w-full shadow-xl">
      <div className="flex items-center gap-4">
        <button 
          onClick={() => isPlaying ? pause() : play()}
          className="w-12 h-12 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 rounded-full transition-all text-white shadow-lg shadow-indigo-500/20 active:scale-95"
        >
          {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
        </button>
        
        <div className="flex-1 space-y-2">
          <div className="relative">
            <input 
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button onClick={stop} className="p-2 text-slate-500 hover:text-white transition-colors">
          <Square size={18} fill="currentColor" />
        </button>
      </div>
    </div>
  );
};

export default AudioPlayer;
