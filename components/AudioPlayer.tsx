import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, RotateCw, Square } from 'lucide-react';
import { base64ToBlob, formatTime } from '../utils/audioUtils';

interface AudioPlayerProps {
  audioBase64?: string;
  audioUrl?: string;
  driveFileId?: string;
  publicDriveFileId?: string;
  drivePublicUrl?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioBase64,
  audioUrl,
  driveFileId,
  publicDriveFileId,
  drivePublicUrl,
  autoPlay = false,
  onEnded,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const resolveSource = async () => {
      setIsLoadingSource(true);
      setSourceError('');
      setSourceUrl(null);
      setDuration(0);
      setCurrentTime(0);
      setIsPlaying(false);

      try {
        let lastSourceError: Error | null = null;

        if (audioBase64) {
          const blob = base64ToBlob(audioBase64, 'audio/mpeg');
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            setSourceUrl(objectUrl);
          }
          return;
        }

        if (driveFileId) {
          try {
            const response = await fetch(`/api/drive/stream/${driveFileId}`, {
              credentials: 'include',
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(`Private stream failed (${response.status})`);
            }
            const blob = await response.blob();
            objectUrl = URL.createObjectURL(blob);
            if (!cancelled) {
              setSourceUrl(objectUrl);
            }
            return;
          } catch (error: any) {
            lastSourceError = new Error(error?.message || 'Private stream failed.');
          }
        }

        if (publicDriveFileId) {
          try {
            const response = await fetch(`/api/drive/public-stream/${encodeURIComponent(publicDriveFileId)}`, {
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(`Public stream failed (${response.status})`);
            }
            const blob = await response.blob();
            objectUrl = URL.createObjectURL(blob);
            if (!cancelled) {
              setSourceUrl(objectUrl);
            }
            return;
          } catch (error: any) {
            lastSourceError = new Error(error?.message || 'Public stream failed.');
          }
        }

        if (audioUrl) {
          if (!cancelled) {
            setSourceUrl(audioUrl);
          }
          return;
        }

        if (drivePublicUrl) {
          if (!cancelled) {
            setSourceUrl(drivePublicUrl);
          }
          return;
        }

        if (lastSourceError) {
          throw lastSourceError;
        }
      } catch (error: any) {
        if (!cancelled && !controller.signal.aborted) {
          setSourceError(error?.message || 'Could not load audio source.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSource(false);
        }
      }
    };

    resolveSource();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audioBase64, audioUrl, driveFileId, publicDriveFileId, drivePublicUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleLoadedMetadata = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    };
    const handleTimeUpdate = () => {
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (onEnded) {
        onEnded();
      }
    };
    const handleError = () => {
      setIsPlaying(false);
      setSourceError('Audio is not publicly accessible yet. Ask admin to run Repair Public Audio.');
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [sourceUrl, onEnded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !sourceUrl) {
      return;
    }
    audio.playbackRate = playbackRate;
  }, [playbackRate, sourceUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !sourceUrl) {
      return;
    }
    audio.currentTime = 0;
    setCurrentTime(0);

    if (autoPlay) {
      audio.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [autoPlay, sourceUrl]);

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

  const jumpBy = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const next = Math.min(Math.max(audio.currentTime + delta, 0), Number.isFinite(duration) ? duration : 0);
    audio.currentTime = next;
    setCurrentTime(next);
  };

  return (
    <div className="audio-player">
      {isLoadingSource && (
        <p className="muted-row">
          <Loader2 className="spin" size={15} /> Loading audio...
        </p>
      )}

      {sourceError && <p className="error-text">{sourceError}</p>}

      {!isLoadingSource && !sourceError && sourceUrl && (
        <>
          <div className="audio-controls-row">
            <button className="icon-btn" onClick={isPlaying ? pause : play}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>

            <button className="icon-btn" onClick={() => jumpBy(-10)} title="Back 10 seconds">
              <RotateCcw size={16} />
            </button>

            <button className="icon-btn" onClick={() => jumpBy(10)} title="Forward 10 seconds">
              <RotateCw size={16} />
            </button>

            <button className="icon-btn" onClick={stop}>
              <Square size={18} />
            </button>

            <label className="rate-select">
              Speed
              <select
                value={playbackRate}
                onChange={(event) => setPlaybackRate(Number(event.target.value))}
              >
                <option value={0.75}>0.75x</option>
                <option value={1}>1x</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </label>
          </div>

          <div className="audio-track-wrap">
            <input
              className="audio-track"
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={0.1}
              value={currentTime}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={duration <= 0}
            />
            <div className="audio-time">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <audio
            ref={audioRef}
            src={sourceUrl}
            playsInline
            preload="metadata"
            className="hidden-audio"
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
};

export default AudioPlayer;
