"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders `text` progressively, character by character, the first time a given
 * `streamKey` is seen. Once a key has finished streaming (or when `active` is
 * false, e.g. reduced-motion or historical messages loaded on mount) the full
 * text is shown immediately and no further animation replays for that key.
 */
export function StreamingText({
  text,
  streamKey,
  active,
  onDone,
  speedMs = 16,
  className,
}: {
  text: string;
  streamKey: string;
  active: boolean;
  onDone?: () => void;
  speedMs?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(active ? "" : text);
  const streamedKeyRef = useRef<string | null>(active ? null : streamKey);

  useEffect(() => {
    if (!active) {
      setShown(text);
      streamedKeyRef.current = streamKey;
      // Callers that sequence multiple messages (only reveal the next one
      // once the current one's onDone fires -- see patient-session-page.tsx)
      // need this to fire even when there's no actual animation to play
      // (reduced motion, or a message that was never "new" to begin with),
      // or their reveal queue would stall forever waiting for a callback
      // that only the animated branch below used to call.
      onDone?.();
      return undefined;
    }
    if (streamedKeyRef.current === streamKey) return undefined;
    streamedKeyRef.current = streamKey;
    const chars = Array.from(text);
    let i = 0;
    setShown("");
    const id = window.setInterval(() => {
      i += 1;
      setShown(chars.slice(0, i).join(""));
      if (i >= chars.length) {
        window.clearInterval(id);
        onDone?.();
      }
    }, speedMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, streamKey, text, speedMs]);

  const isStreaming = active && shown.length < text.length;

  return (
    <span className={className}>
      {shown}
      {isStreaming && (
        <span aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-middle" />
      )}
    </span>
  );
}

/** Bouncing three-dot "typing…" indicator for the assistant turn in progress. */
export function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-text-muted"
          style={{
            animation: "tbct-typing-bounce 1.1s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes tbct-typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </span>
  );
}
