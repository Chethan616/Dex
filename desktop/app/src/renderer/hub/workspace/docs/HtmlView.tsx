/**
 * An .html file as a page, in a sandboxed frame with nothing allowed: no
 * scripts, no forms, no same-origin, no navigation of the hub. It's a
 * preview of what the file looks like; to run it, open it in a web tab or
 * its own app.
 */
import React, { useEffect, useMemo } from 'react';
import type { ViewerProps } from './kinds';

export default function HtmlView({ bytes, name, onReady }: ViewerProps): React.ReactElement {
  const html = useMemo(() => new TextDecoder('utf-8').decode(bytes), [bytes]);
  useEffect(() => { onReady?.(); }, [html, onReady]);
  return (
    <div className="dv-html">
      <iframe title={name} sandbox="" srcDoc={html} referrerPolicy="no-referrer" />
    </div>
  );
}
