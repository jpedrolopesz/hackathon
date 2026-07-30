'use client';

import { useEffect, useRef } from 'react';

function RemoteVideo({
  stream,
  label,
}: {
  stream: MediaStream;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <figure>
      <video ref={ref} autoPlay playsInline className="aspect-video w-full rounded-md bg-black" />
      <figcaption className="mt-1 text-xs opacity-60">{label}</figcaption>
    </figure>
  );
}

export function RemoteVideoTiles({
  streams,
}: {
  streams: Readonly<Record<string, MediaStream>>;
}) {
  const entries = Object.entries(streams);
  if (entries.length === 0) {
    return <p className="rounded-md border p-4 text-sm opacity-60">Aguardando outro participante publicar vídeo…</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(([participantId, stream]) => (
        <RemoteVideo key={participantId} stream={stream} label="Participante remoto" />
      ))}
    </div>
  );
}
