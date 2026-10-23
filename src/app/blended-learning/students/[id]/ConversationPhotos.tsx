"use client";

import { useEffect, useState } from "react";

// A Conversation's photos through short-lived presigned GETs from the photos
// route. The links expire after 5 minutes, so they are fetched per visit.
export function ConversationPhotos({ conversationId, count }: { conversationId: number; count: number }) {
  const [photos, setPhotos] = useState<{ id: number; url: string }[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/blended-learning/conversations/${conversationId}/photos`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ photos: { id: number; url: string }[] }>;
      })
      .then((body) => {
        if (!cancelled) setPhotos(body.photos);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (failed) return <p className="text-xs text-text-muted">Couldn&apos;t load {count === 1 ? "the photo" : "the photos"}.</p>;
  if (!photos) return <p className="text-xs text-text-muted">Loading photos…</p>;
  return (
    <ul aria-label="Photos" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <a href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
            {/* Presigned S3 URLs change on every visit; next/image would cache them. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={`Conversation photo ${index + 1}`}
              className="aspect-square w-full rounded-md border border-border object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
