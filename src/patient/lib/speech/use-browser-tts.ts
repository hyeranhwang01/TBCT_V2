"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function normalizeSpeechLocale(locale: string) {
  const value = locale.toLowerCase();
  if (value.startsWith("pt")) return "pt-BR";
  if (value.startsWith("ko")) return "ko-KR";
  return locale || "en-US";
}

/** Female voices to prefer, per base language, best first.
 *
 * The Web Speech API exposes no gender field, so the only way to ask for one is
 * by name. Matching is a case-insensitive substring so platform decorations
 * ("Microsoft Heami Desktop - Korean") still hit. Anything not listed here is
 * still reachable through the plain language match below, so an unfamiliar
 * platform degrades to the previous behaviour rather than going silent.
 *
 * Without this the choice was simply whichever ko-KR voice the browser happened
 * to list first, which on macOS can be Eddy, Reed or Rocko -- male novelty
 * voices sitting alongside Yuna in the same list.
 */
const PREFERRED_FEMALE_VOICES: Record<string, string[]> = {
  ko: ["Yuna", "유나", "Google 한국의", "Heami", "Sora", "Shelley", "Sandy", "Flo"],
  en: ["Samantha", "Google US English", "Zira", "Ava", "Allison", "Joanna"],
  pt: ["Luciana", "Google português do Brasil", "Maria", "Camila"],
};

export function selectSpeechVoice(voices: SpeechSynthesisVoice[], locale: string) {
  const target = normalizeSpeechLocale(locale).toLowerCase();
  const base = target.split("-")[0];
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));
  for (const preferred of PREFERRED_FEMALE_VOICES[base] ?? []) {
    const match = sameLanguage.find((voice) => voice.name.toLowerCase().includes(preferred.toLowerCase()));
    if (match) return match;
  }
  return voices.find((voice) => voice.lang.toLowerCase() === target)
    ?? sameLanguage[0]
    ?? null;
}

// How long to wait for the async voice list before speaking anyway with
// whatever (possibly still empty) list is available -- a safety net for
// browsers that never fire "voiceschanged".
const VOICE_LOAD_FALLBACK_MS = 1200;

type SpeechQueueItem = { messageId: string; text: string };

function speechSynthesisAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function useBrowserTts(locale: string) {
  const [supported, setSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  // A single turn can release several Program messages at once, and the
  // conversation reveals them one after another. Speech has to follow that
  // same order, so speak() only ever appends here -- it never cancels what is
  // already playing. Cancelling on arrival is what used to cut the previous
  // message off mid-sentence and drop every message but the last.
  const queueRef = useRef<SpeechQueueItem[]>([]);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Bumped by stop(). A cancelled utterance still fires onend/onerror
  // afterwards; without this generation check that stale handler would pull
  // the next item out of a queue the user just cleared and start talking
  // again -- straight over the microphone stop() was making room for.
  const generationRef = useRef(0);
  const voiceWaitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets "voiceschanged" and an utterance's own onend reach the current pump
  // without re-subscribing on every locale change -- re-subscribing runs the
  // effect cleanup, which cancels whatever is being spoken.
  const pumpRef = useRef<(voicesAlreadyLoaded?: boolean) => void>(() => {});

  const clearVoiceWait = useCallback(() => {
    if (voiceWaitTimeoutRef.current !== null) {
      clearTimeout(voiceWaitTimeoutRef.current);
      voiceWaitTimeoutRef.current = null;
    }
  }, []);

  const pump = useCallback((voicesAlreadyLoaded = false) => {
    if (!speechSynthesisAvailable()) return;
    const synth = window.speechSynthesis;
    if (currentUtteranceRef.current) return;

    const next = queueRef.current[0];
    if (!next) {
      setSpeakingMessageId(null);
      return;
    }

    // Chrome (and several other browsers) populate speechSynthesis.getVoices()
    // asynchronously: it returns [] on the very first call after page load,
    // and only fires "voiceschanged" once the real list is ready. The patient
    // session page speaks the assistant's opening line the instant it renders,
    // which is exactly the call most likely to land inside that empty window --
    // selectSpeechVoice finds nothing, utterance.voice stays null, and the
    // browser substitutes its own default voice (commonly an English one) for
    // that one utterance regardless of utterance.lang="ko-KR". Leave the item
    // at the head of the queue rather than consuming it with no voice set.
    // speakingMessageId deliberately stays null here: nothing has been handed
    // to the synthesizer yet, and a "now speaking" indicator built on it would
    // light up for a message the patient cannot hear.
    if (!voicesAlreadyLoaded && synth.getVoices().length === 0) {
      if (voiceWaitTimeoutRef.current === null) {
        const generation = generationRef.current;
        voiceWaitTimeoutRef.current = setTimeout(() => {
          voiceWaitTimeoutRef.current = null;
          if (generation === generationRef.current) pumpRef.current(true);
        }, VOICE_LOAD_FALLBACK_MS);
      }
      return;
    }

    clearVoiceWait();
    queueRef.current.shift();
    const generation = generationRef.current;
    const utterance = new SpeechSynthesisUtterance(next.text);
    utterance.lang = normalizeSpeechLocale(locale);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.voice = selectSpeechVoice(synth.getVoices(), locale);
    const finish = () => {
      if (generation !== generationRef.current) return;
      if (currentUtteranceRef.current !== utterance) return;
      currentUtteranceRef.current = null;
      pumpRef.current();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    currentUtteranceRef.current = utterance;
    setSpeakingMessageId(next.messageId);
    synth.speak(utterance);
  }, [clearVoiceWait, locale]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    if (!speechSynthesisAvailable()) {
      setSupported(false);
      return undefined;
    }
    setSupported(true);
    const synth = window.speechSynthesis;
    const onVoicesChanged = () => {
      if (synth.getVoices().length > 0) pumpRef.current();
    };
    synth.addEventListener("voiceschanged", onVoicesChanged);
    // Some browsers (notably Chrome) only start loading voices once
    // getVoices() has been called at least once -- this call's return
    // value is intentionally unused, it just kicks off that load.
    synth.getVoices();
    return () => {
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      generationRef.current += 1;
      queueRef.current = [];
      currentUtteranceRef.current = null;
      clearVoiceWait();
      synth.cancel();
    };
  }, [clearVoiceWait]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    currentUtteranceRef.current = null;
    clearVoiceWait();
    setSpeakingMessageId(null);
    if (speechSynthesisAvailable()) window.speechSynthesis.cancel();
  }, [clearVoiceWait]);

  const speak = useCallback((messageId: string, text: string) => {
    if (!speechSynthesisAvailable() || !text.trim()) return false;
    queueRef.current.push({ messageId, text });
    pump();
    return true;
  }, [pump]);

  return { supported, speakingMessageId, speak, stop };
}
