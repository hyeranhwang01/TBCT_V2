import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { StreamingText } from "@/patient/components/streaming-text";

describe("StreamingText", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function revealFully(speedMs: number, length: number) {
    act(() => { vi.advanceTimersByTime(speedMs * (length + 2)); });
  }

  it("types the text out and reports completion", () => {
    const onDone = vi.fn();
    const { container } = render(<StreamingText text="안녕하세요" streamKey="M1" active speedMs={8} onDone={onDone} />);

    revealFully(8, 5);
    expect(container.textContent).toBe("안녕하세요");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // React StrictMode runs every effect twice in development, and Next.js turns
  // StrictMode on by default -- so this is the ordinary path in dev, not an
  // edge case. Marking the key as streamed *before* the interval started meant
  // the second invocation hit the "already streamed" guard, returned early,
  // and left the message permanently blank with the caret still blinking.
  // onDone never fired either, so the page's reveal queue stalled behind it.
  it("still reveals the text when the effect is invoked twice", () => {
    const onDone = vi.fn();
    const { container } = render(
      <StrictMode>
        <StreamingText text="안녕하세요" streamKey="M1" active speedMs={8} onDone={onDone} />
      </StrictMode>,
    );

    revealFully(8, 5);
    expect(container.textContent).toBe("안녕하세요");
    expect(onDone).toHaveBeenCalled();
  });

  it("re-runs cleanly when the text changes mid-stream", () => {
    const onDone = vi.fn();
    const { container, rerender } = render(<StreamingText text="첫번째 문장" streamKey="M1" active speedMs={8} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(16); });

    rerender(<StreamingText text="바뀐 문장" streamKey="M1" active speedMs={8} onDone={onDone} />);
    revealFully(8, 5);

    expect(container.textContent).toBe("바뀐 문장");
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the full text immediately when inactive, and still reports completion", () => {
    const onDone = vi.fn();
    const { container } = render(<StreamingText text="지난 대화입니다" streamKey="M1" active={false} onDone={onDone} />);

    expect(container.textContent).toBe("지난 대화입니다");
    expect(onDone).toHaveBeenCalled();
  });
});
