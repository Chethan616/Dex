/**
 * Pictures, video and sound, from a blob: URL of the file's bytes (the hub's
 * CSP allows blob: for img/media). An SVG is drawn as an <img>, so any script
 * inside it never runs.
 */
import React, { useEffect, useState } from 'react';
import { mimeFor, type ViewerProps } from './kinds';

/** A blob: URL for the bytes, revoked when they change or the view goes. */
export function useBlobUrl(bytes: Uint8Array, name: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeFor(name) }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, name]);
  return url;
}

export function ImageView({ bytes, name, zoom, onReady, onError }: ViewerProps): React.ReactElement {
  const url = useBlobUrl(bytes, name);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="dv-media dv-media--image">
      {url && (
        <img
          src={url}
          alt={name}
          draggable={false}
          style={natural ? { width: natural.w * zoom, height: natural.h * zoom } : undefined}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
            onReady?.();
          }}
          onError={() => onError?.('Couldn’t show this picture.')}
        />
      )}
    </div>
  );
}

export function VideoView({ bytes, name, onReady, onError }: ViewerProps): React.ReactElement {
  const url = useBlobUrl(bytes, name);
  return (
    <div className="dv-media">
      {url && <video src={url} controls playsInline onLoadedMetadata={onReady} onError={() => onError?.('Couldn’t play this video here.')} />}
    </div>
  );
}

export function AudioView({ bytes, name, onReady, onError }: ViewerProps): React.ReactElement {
  const url = useBlobUrl(bytes, name);
  return (
    <div className="dv-media dv-media--audio">
      {url && <audio src={url} controls onLoadedMetadata={onReady} onError={() => onError?.('Couldn’t play this sound here.')} />}
    </div>
  );
}
