import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { selectSpeechVoice, useBrowserTts } from "@/patient/lib/speech/use-browser-tts";

function voice(lang: string, name: string) {
  return { lang, name, default: false, localService: true, voiceURI: name } as SpeechSynthesisVoice;
}

describe("browser TTS voice selection", () => {
  it("prefers Brazilian Portuguese and Korean locale matches", () => {
    const voices = [voice("pt-PT", "Portugal"), voice("pt-BR", "Brazil"), voice("ko-KR", "Korean")];
    expect(selectSpeechVoice(voices, "pt-BR")?.name).toBe("Brazil");
    expect(selectSpeechVoice(voices, "ko")?.name).toBe("Korean");
  });

  it("falls back to the same base language without selecting an unrelated voice", () => {
    expect(selectSpeechVoice([voice("pt-PT", "Portugal"), voice("en-US", "English")], "pt-BR")?.name).toBe("Portugal");
    expect(selectSpeechVoice([voice("en-US", "English")], "ko-KR")).toBeNull();
  });
});

// Chrome (and others) return getVoices()===[] synchronously right after page
// load and only populate the real list once "voiceschanged" fires -- these
// pin down the fix for the resulting bug: the session's opening line (spoken
// the instant it renders) landing inside that empty window and silently
// speaking with no voice selected instead of the session's own locale.
class FakeSpeechSynthesisUtterance {
  lang = "";
  rate = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

describe("useBrowserTts voice-loading race", () => {
  let voiceschangedListeners: Array<() => void>;
  let voicesList: SpeechSynthesisVoice[];
  let spoken: FakeSpeechSynthesisUtterance[];

  beforeEach(() => {
    voiceschangedListeners = [];
    voicesList = [];
    spoken = [];
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voicesList,
      speak: (utterance: FakeSpeechSynthesisUtterance) => spoken.push(utterance),
      cancel: () => {},
      addEventListener: (_type: string, listener: () => void) => voiceschangedListeners.push(listener),
      removeEventListener: (_type: string, listener: () => void) => {
        voiceschangedListeners = voiceschangedListeners.filter((candidate) => candidate !== listener);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defers the opening line instead of speaking it with no voice selected", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));

    act(() => {
      result.current.speak("MSG-1", "여기 와 주셔서 감사합니다.");
    });
    expect(spoken).toHaveLength(0); // not spoken yet -- voices still loading

    voicesList = [voice("en-US", "English"), voice("ko-KR", "Korean")];
    act(() => {
      voiceschangedListeners.forEach((listener) => listener());
    });

    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice?.name).toBe("Korean");
  });

  it("speaks immediately once the voice list is already loaded", () => {
    voicesList = [voice("ko-KR", "Korean")];
    const { result } = renderHook(() => useBrowserTts("ko-KR"));

    act(() => {
      result.current.speak("MSG-1", "여기 와 주셔서 감사합니다.");
    });

    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice?.name).toBe("Korean");
  });
});
