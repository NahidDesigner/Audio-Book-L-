import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { base64ToBlob, formatTime } from '../utils/audioUtils';

interface AudioPlayerProps {
  audioBase64?: string;
  driveFileId?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioBase64,
  driveFileId,
  autoPlay = false,
  onEnded,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    let blobUrl: string | null = null;
    if (driveFileId) {
      audio.src = `/api/drive/stream/${driveFileId}`;
    } else if (audioBase64) {
      const blob = base64ToBlob(audioBase64, 'audio/mpeg');
      blobUrl = URL.createObjectURL(blob);
      audio.src = blobUrl;
    }

    audio.onloadedmetadata = () => {
      setDuration(audio.duration || 0);
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (onEnded) {
        onEnded();
      }
    };

    if (autoPlay) {
      audio.play().catch(() => {
        setIsPlaying(false);
      });
    }

    return () => {
      audio.pause();
      audio.src = '';
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [audioBase64, driveFileId, autoPlay, onEnded]);

  const play = () => {
    audioRef.current?.play().catch(() => {
      setIsPlaying(false);
    });
  };

  const pause = () => {
    audioRef.current?.pause();
  };

  const stop = () => {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
  };

  const seek = (nextValue: number) => {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.currentTime = nextValue;
    setCurrentTime(nextValue);
  };

  return (
    <div className="audio-player">
      <button className="icon-btn" onClick={isPlaying ? pause : play}>
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <div className="audio-track-wrap">
        <input
          className="audio-track"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <div className="audio-time">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button className="icon-btn" onClick={stop}>
        <Square size={18} />
      </button>
    </div>
  );
};

export default AudioPlayer;
