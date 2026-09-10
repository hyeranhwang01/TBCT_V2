"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResultHandler = (transcript: string, isFinal: boolean) => void;

function getSpeechRecognitionCtor(): (new () => any) | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
}

/**
 * Thin wrapper around the browser's SpeechRecognition (Web Speech API) for live
 * voice-to-text input. Falls back to `supported: false` when unavailable so callers
 * can hide the microphone control without breaking text-based interaction.
 */
export function useSpeechRecognition(locale: string) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onResultRef = useRef<RecognitionResultHandler | null>(null);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionCtor()));
    return () => {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const start = useCallback((onResult: RecognitionResultHandler) => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    onResultRef.current = onResult;
    const recognition = new Ctor();
    recognition.lang = locale || "en-US";
    // continuous=false made the browser's own endpointer end the WHOLE
    // recognition session on the first detected pause -- a participant
    // pausing mid-thought to collect themselves got cut off, not just the
    // current utterance. continuous=true keeps listening through pauses;
    // the session now only ends when the caller explicitly stops it (or on
    // a genuine error/very long silence), matching a normal "hold the mic
    // until you're done talking" expectation.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      // Rebuilds the FULL transcript from every result since this
      // recognition session started (not just event.resultIndex onward) --
      // in continuous mode, onresult fires once per pause/segment, and a
      // resultIndex-only sum would silently drop everything said before
      // the most recent segment instead of accumulating the whole answer.
      let text = "";
      let isFinal = false;
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      onResultRef.current?.(text, isFinal);
    };
    recognition.onerror = () => { setListening(false); };
    recognition.onend = () => { setListening(false); };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      return true;
    } catch {
      setListening(false);
      return false;
    }
  }, [locale]);

  return { supported, listening, start, stop };
}
