"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function normalizeSpeechLocale(locale: string) {
  const value = locale.toLowerCase();
  if (value.startsWith("pt")) return "pt-BR";
  if (value.startsWith("ko")) return "ko-KR";
  return locale || "en-US";
}

export function selectSpeechVoice(voices: SpeechSynthesisVoice[], locale: string) {
  const target = normalizeSpeechLocale(locale).toLowerCase();
  return voices.find((voice) => voice.lang.toLowerCase() === target)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(target.split("-")[0]))
    ?? null;
}

// How long to wait for the async voice list before speaking anyway with
// whatever (possibly still empty) list is available -- a safety net for
// browsers that never fire "voiceschanged".
const VOICE_LOAD_FALLBACK_MS = 1200;

export function useBrowserTts(locale: string) {
  const [supported, setSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Chrome (and several other browsers) populate speechSynthesis.getVoices()
  // asynchronously: it returns [] on the very first call after page load,
  // and only fires "voiceschanged" once the real list is ready. The patient
  // session page auto-speaks the assistant's opening line the instant it
  // renders (see patient-session-page.tsx), which is exactly the call most
  // likely to land inside that empty window -- selectSpeechVoice finds
  // nothing, utterance.voice stays null, and the browser substitutes its
  // own default voice (commonly an English one) for that one utterance
  // regardless of utterance.lang="ko-KR". Every later message, spoken after
  // the list has loaded, correctly finds the Korean voice. That reads as
  // the very first utterance (and again after any remount/navigation that
  // races the same cold start) ignoring the session's language while later
  // turns get it right -- not a text-generation bug, a voice-selection one.
  // Deferring a speak() that lands before voices are ready, instead of
  // firing it immediately with no voice selected, is what fixes it.
  const pendingSpeechRef = useRef<{ messageId: string; text: string } | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    pendingSpeechRef.current = null;
    if (pendingTimeoutRef.current !== null) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  }, []);

  const speakNow = useCallback((messageId: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window) || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = normalizeSpeechLocale(locale);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.voice = selectSpeechVoice(window.speechSynthesis.getVoices(), locale);
    utterance.onend = () => { utteranceRef.current = null; setSpeakingMessageId(null); };
    utterance.onerror = () => { utteranceRef.current = null; setSpeakingMessageId(null); };
    utteranceRef.current = utterance;
    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setSupported(false);
      return undefined;
    }
    setSupported(true);
    const synth = window.speechSynthesis;
    const onVoicesChanged = () => {
      const pending = pendingSpeechRef.current;
      if (pending && synth.getVoices().length > 0) {
        clearPending();
        speakNow(pending.messageId, pending.text);
      }
    };
    synth.addEventListener("voiceschanged", onVoicesChanged);
    // Some browsers (notably Chrome) only start loading voices once
    // getVoices() has been called at least once -- this call's return
    // value is intentionally unused, it just kicks off that load.
    synth.getVoices();
    return () => {
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      synth.cancel();
    };
  }, [clearPending, speakNow]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    clearPending();
    utteranceRef.current = null;
    setSpeakingMessageId(null);
  }, [clearPending]);

  const speak = useCallback((messageId: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window) || !text.trim()) return false;
    clearPending();
    if (window.speechSynthesis.getVoices().length === 0) {
      // Voice list isn't ready yet -- wait for "voiceschanged" (with a
      // timed fallback in case it never fires) instead of speaking now with
      // no voice selected, which is what let the locale get silently lost.
      pendingSpeechRef.current = { messageId, text };
      setSpeakingMessageId(messageId);
      pendingTimeoutRef.current = setTimeout(() => {
        const pending = pendingSpeechRef.current;
        pendingSpeechRef.current = null;
        pendingTimeoutRef.current = null;
        if (pending) speakNow(pending.messageId, pending.text);
      }, VOICE_LOAD_FALLBACK_MS);
      return true;
    }
    speakNow(messageId, text);
    return true;
  }, [clearPending, speakNow]);

  return { supported, speakingMessageId, speak, stop };
}
