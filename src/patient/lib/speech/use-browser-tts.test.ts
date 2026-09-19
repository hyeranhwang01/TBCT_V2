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

  // macOS lists Eddy/Reed/Rocko (male novelty voices) in ko-KR alongside Yuna,
  // and which one comes first is the browser's choice -- taking the first match
  // meant the patient could get a male voice on one machine and Yuna on another.
  it("prefers a known female voice over whichever one the browser listed first", () => {
    const voices = [voice("ko-KR", "Eddy"), voice("ko-KR", "Rocko"), voice("ko-KR", "Yuna")];
    expect(selectSpeechVoice(voices, "ko-KR")?.name).toBe("Yuna");
  });

  it("matches a preferred voice inside a decorated platform name", () => {
    const voices = [voice("ko-KR", "Microsoft Heami Desktop - Korean")];
    expect(selectSpeechVoice(voices, "ko-KR")?.name).toBe("Microsoft Heami Desktop - Korean");
    expect(selectSpeechVoice([voice("en-US", "Microsoft Zira Desktop")], "en-US")?.name).toBe("Microsoft Zira Desktop");
  });

  it("prefers Samantha for an English session", () => {
    const voices = [voice("en-US", "Alex"), voice("en-US", "Samantha")];
    expect(selectSpeechVoice(voices, "en-US")?.name).toBe("Samantha");
  });

  it("still returns a voice when none of the preferred names exist", () => {
    const voices = [voice("ko-KR", "Unknown Vendor Voice")];
    expect(selectSpeechVoice(voices, "ko-KR")?.name).toBe("Unknown Vendor Voice");
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

  // speakingMessageId means "the synthesizer is saying this right now", not
  // "this is queued" -- a playback indicator built on it must not light up for
  // a message still waiting on the voice list.
  it("reports nothing as speaking while the voice list is still loading", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));

    act(() => {
      result.current.speak("MSG-1", "여기 와 주셔서 감사합니다.");
    });
    expect(result.current.speakingMessageId).toBeNull();

    voicesList = [voice("ko-KR", "Korean")];
    act(() => {
      voiceschangedListeners.forEach((listener) => listener());
    });
    expect(result.current.speakingMessageId).toBe("MSG-1");
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

// A turn can release several Program messages at once. These pin down the fix
// for two bugs that came out of speaking them with a bare cancel-then-speak:
// only the last message of a batch was ever heard, and whatever was already
// playing got cut off mid-sentence.
describe("useBrowserTts queueing", () => {
  let voicesList: SpeechSynthesisVoice[];
  let spoken: FakeSpeechSynthesisUtterance[];
  let cancelCalls: number;

  beforeEach(() => {
    voicesList = [voice("ko-KR", "Korean")];
    spoken = [];
    cancelCalls = 0;
    vi.stubGlobal("SpeechSynthesisUtterance", FakeSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voicesList,
      speak: (utterance: FakeSpeechSynthesisUtterance) => spoken.push(utterance),
      cancel: () => { cancelCalls += 1; },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function speakBatch(result: { current: ReturnType<typeof useBrowserTts> }) {
    act(() => {
      result.current.speak("MSG-A", "첫 번째 안내입니다.");
      result.current.speak("MSG-B", "두 번째 안내입니다.");
      result.current.speak("MSG-C", "세 번째 안내입니다.");
    });
  }

  it("speaks a batch in order, one utterance at a time", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    speakBatch(result);

    expect(spoken.map((utterance) => utterance.text)).toEqual(["첫 번째 안내입니다."]);

    act(() => { spoken[0].onend?.(); });
    expect(spoken.map((utterance) => utterance.text)).toEqual(["첫 번째 안내입니다.", "두 번째 안내입니다."]);

    act(() => { spoken[1].onend?.(); });
    expect(spoken.map((utterance) => utterance.text)).toEqual(["첫 번째 안내입니다.", "두 번째 안내입니다.", "세 번째 안내입니다."]);
  });

  it("never cancels the message being spoken just because another was queued", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    speakBatch(result);
    expect(cancelCalls).toBe(0);
  });

  it("carries on through an utterance that errors instead of stalling the queue", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    speakBatch(result);

    act(() => { spoken[0].onerror?.(); });
    expect(spoken).toHaveLength(2);
  });

  it("reports which message is being spoken, and nothing once the queue drains", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    act(() => { result.current.speak("MSG-A", "첫 번째 안내입니다."); });
    expect(result.current.speakingMessageId).toBe("MSG-A");

    act(() => { spoken[0].onend?.(); });
    expect(result.current.speakingMessageId).toBeNull();
  });

  it("drops the rest of the queue on stop() and cancels the browser once", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    speakBatch(result);

    act(() => { result.current.stop(); });

    expect(cancelCalls).toBe(1);
    expect(result.current.speakingMessageId).toBeNull();
    expect(spoken).toHaveLength(1);
  });

  // speechSynthesis.cancel() still fires the cancelled utterance's onend.
  // Acting on it would restart a queue the mic (onBeforeMic={stop}) just
  // cleared, and talk straight over the patient's recording.
  it("ignores a stale onend that arrives after stop()", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    speakBatch(result);
    const cancelled = spoken[0];

    act(() => { result.current.stop(); });
    act(() => { cancelled.onend?.(); });

    expect(spoken).toHaveLength(1);
    expect(result.current.speakingMessageId).toBeNull();
  });

  it("still speaks a message queued after a stop()", () => {
    const { result } = renderHook(() => useBrowserTts("ko-KR"));
    speakBatch(result);
    act(() => { result.current.stop(); });

    act(() => { result.current.speak("MSG-D", "네 번째 안내입니다."); });
    expect(spoken.map((utterance) => utterance.text)).toEqual(["첫 번째 안내입니다.", "네 번째 안내입니다."]);
  });
});
