/**
 * A 3D model (.glb, or a .gltf with its buffers embedded) in Google's
 * <model-viewer>: drag to orbit, scroll to zoom, a slow turn until you touch
 * it. A .gltf that points at separate .bin/texture files can't be drawn from
 * a single file's bytes; "Open in app" handles those.
 */
import React, { useEffect, useRef } from 'react';
import '@google/model-viewer';
import { useBlobUrl } from './MediaView';
import type { ViewerProps } from './kinds';

export default function ModelView({ bytes, name, onReady, onError }: ViewerProps): React.ReactElement {
  const url = useBlobUrl(bytes, name);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const load = () => onReady?.();
    const fail = () => onError?.('Couldn’t draw this model. A .gltf that uses separate files needs its own app.');
    el.addEventListener('load', load);
    el.addEventListener('error', fail);
    return () => { el.removeEventListener('load', load); el.removeEventListener('error', fail); };
  }, [url, onReady, onError]);

  if (!url) return <div className="dv-model" />;
  // A custom element: React passes these through as attributes.
  return (
    <div className="dv-model">
      {React.createElement('model-viewer', {
        ref,
        src: url,
        alt: name,
        'camera-controls': '',
        'auto-rotate': '',
        'auto-rotate-delay': '1200',
        'interaction-prompt': 'none',
        'shadow-intensity': '0.8',
        exposure: '1',
        style: { width: '100%', height: '100%', background: 'transparent' },
      })}
    </div>
  );
}
