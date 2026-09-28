"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Check, Mic, Square, X } from "lucide-react";
import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { PatientInput } from "@/types/runtime-session";
import { useSpeechRecognition } from "@/patient/lib/speech/use-speech-recognition";
import { choiceLabel } from "@/shared/runtime/patient-input-display";
import { PtButton } from "@/patient/components/ui/kit";
import { cn } from "@/shared/utils";

type PatientPromptInput = Pick<PromptItem, "type" | "validation" | "outputFields">;

export function PatientInputControls({
  payload,
  promptItem,
  disabled,
  onSubmit,
  locale,
  onBeforeMic,
}: {
  payload?: Record<string, unknown>;
  promptItem?: PatientPromptInput;
  disabled?: boolean;
  onSubmit: (input: PatientInput) => void;
  locale?: string;
  onBeforeMic?: () => void;
}) {
  const isKorean = locale?.toLowerCase().startsWith("ko") ?? false;
  const validation = promptItem?.validation ?? {};
  const promptValidationKind = typeof validation.kind === "string" ? validation.kind : "";
  const choices = Array.isArray(payload?.choices)
    ? payload.choices.map(String)
    : Array.isArray(validation.choices)
      ? validation.choices.map(String)
      : Array.isArray(validation.values)
        ? validation.values.map(String)
      : [];
  const kind = String((payload?.kind ?? payload?.inputKind ?? (promptValidationKind === "enum" ? "single_choice" : promptValidationKind)) || "text");
  const promptKind = String(promptItem?.type ?? "");
  // "consensus_weights" (S07's consensus-chair re-weighing: advantage % +
  // disadvantage %, summing to 100) is a genuine two-number answer, same
  // shape as paired_ratings. Rendering it with the single-value RatingInput
  // made the step impossible to complete (confirmed in production).
  // extractRuntimeState assigns numericValues[0]/[1] to outputFields[0]/[1]
  // in that order, matching the order PairedRatingInput submits them in.
  if (/^paired_ratings/.test(promptValidationKind) || promptValidationKind === "consensus_weights") {
    return <PairedRatingInput disabled={disabled} locale={locale} min={Number(validation.min ?? 0)} max={Number(validation.max ?? 100)} fields={promptItem?.outputFields ?? []} onSubmit={(first, second) => onSubmit({ kind: "rating", value: `${first}, ${second}` })} />;
  }
  if (kind === "single_choice") {
    return (
      <div className="grid gap-2">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={disabled}
            onClick={() => onSubmit({ kind: "single_choice", value: choice })}
            className="transition-ui group flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-left text-[15px] font-semibold leading-snug text-text-primary hover:border-brand/50 hover:bg-brand-tint active:scale-[0.99] disabled:opacity-50"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border-strong group-hover:border-brand" aria-hidden="true" />
            {choiceLabel(choice, locale)}
          </button>
        ))}
      </div>
    );
  }
  if (kind === "multi_choice") {
    return <MultiChoiceInput choices={choices} locale={locale} disabled={disabled} onSubmit={(value) => onSubmit({ kind: "multi_choice", value })} />;
  }
  if (kind === "rating" || promptKind === "rating" || promptValidationKind === "rating") {
    return <RatingInput disabled={disabled} min={Number(payload?.min ?? validation.min ?? 0)} max={Number(payload?.max ?? validation.max ?? 100)} locale={locale} onSubmit={(value) => onSubmit({ kind: "rating", value })} />;
  }
  if (kind === "activity_completion") {
    return <ChoiceRow disabled={disabled} locale={locale} options={["not_started", "partial", "completed"]} onSelect={(value) => onSubmit({ kind: "activity_completion", value })} />;
  }
  if (kind === "homework_status") {
    return <ChoiceRow disabled={disabled} locale={locale} options={["not_assigned", "pending", "completed"]} onSelect={(value) => onSubmit({ kind: "homework_status", value })} />;
  }
  if (kind === "boolean") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ kind: "boolean", value: true })}
          className="transition-ui flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand text-base font-bold text-white shadow-[0_6px_16px_rgb(var(--color-brand)/0.22)] hover:bg-brand-strong active:scale-[0.98] disabled:opacity-50"
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          {isKorean ? "네" : "Yes"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ kind: "boolean", value: false })}
          className="transition-ui flex h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-base font-bold text-text-primary hover:bg-surface-hover active:scale-[0.98] disabled:opacity-50"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          {isKorean ? "아니요" : "No"}
        </button>
      </div>
    );
  }
  return (
    <TextInput
      disabled={disabled}
      placeholder={String(payload?.placeholder ?? (isKorean ? "답변을 입력해 주세요" : "Type your answer"))}
      locale={locale}
      onBeforeMic={onBeforeMic}
      onSubmit={(value) => onSubmit({ kind: "text", value })}
    />
  );
}

function readableFieldLabel(field: string, index: number, locale?: string) {
  const isKorean = locale?.startsWith("ko");
  // "disadvantage" contains "advantage", so it must be tested first.
  if (/disadvantage/i.test(field)) return isKorean ? "단점 비중 (%)" : "Disadvantages weight (%)";
  if (/advantage/i.test(field)) return isKorean ? "장점 비중 (%)" : "Advantages weight (%)";
  if (/belief/i.test(field)) return isKorean ? "혐의에 대한 믿음 (%)" : "Belief in the charge (%)";
  if (/emotion|intensity/i.test(field)) return isKorean ? "감정 강도 (%)" : "Emotion intensity (%)";
  return isKorean ? `평가 ${index + 1} (%)` : `Rating ${index + 1} (%)`;
}

const numberBox = "transition-ui h-11 w-20 rounded-xl border border-border bg-surface px-2 text-center text-[15px] font-bold text-text-primary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft";
const rangeClass = "h-2 w-full cursor-pointer appearance-auto accent-[rgb(var(--color-brand))]";

function PairedRatingInput({ disabled, min, max, fields, locale, onSubmit }: { disabled?: boolean; min: number; max: number; fields: string[]; locale?: string; onSubmit: (first: number, second: number) => void }) {
  const initial = Math.round((min + max) / 2);
  const [first, setFirst] = useState(initial);
  const [second, setSecond] = useState(initial);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  return (
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(first, second); }}>
      {([[first, setFirst], [second, setSecond]] as const).map(([value, setter], index) => (
        <label key={index} className="grid gap-2">
          <span className="text-sm font-semibold text-text-primary">{readableFieldLabel(fields[index] ?? "", index, locale)}</span>
          <span className="flex items-center gap-3">
            <input type="range" min={min} max={max} value={value} disabled={disabled} onChange={(event) => setter(clamp(Number(event.target.value)))} className={rangeClass} aria-hidden="true" tabIndex={-1} />
            <input type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => setter(clamp(Number(event.target.value)))} className={numberBox} />
          </span>
        </label>
      ))}
      <PtButton type="submit" size="lg" block disabled={disabled}>{locale?.startsWith("ko") ? "두 값 모두 제출" : "Submit both ratings"}</PtButton>
    </form>
  );
}

function TextInput({
  disabled,
  placeholder,
  locale,
  onBeforeMic,
  onSubmit,
}: {
  disabled?: boolean;
  placeholder: string;
  locale?: string;
  onBeforeMic?: () => void;
  onSubmit: (value: string) => void;
}) {
  const isKorean = locale?.toLowerCase().startsWith("ko") ?? false;
  const [value, setValue] = useState("");
  const speech = useSpeechRecognition(locale ?? "en-US");
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const voiceTurnActiveRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submitValue = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  // Recognition runs continuous, so a mid-thought pause no longer ends the
  // turn: submission happens once, when listening actually stops (the mic was
  // pressed again, or the browser ended recognition), with whatever was
  // transcribed by then. Only for a turn that was started by voice.
  useEffect(() => {
    if (voiceTurnActiveRef.current && !speech.listening) {
      voiceTurnActiveRef.current = false;
      submitValue(latestValueRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.listening]);

  // Grow with the answer, up to about six lines.
  useLayoutEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "0px";
    box.style.height = `${Math.min(box.scrollHeight, 168)}px`;
    box.style.overflowY = box.scrollHeight > 168 ? "auto" : "hidden";
  }, [value]);

  const handleMicClick = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    // Voice input takes priority: interrupt any playback before listening.
    onBeforeMic?.();
    voiceTurnActiveRef.current = true;
    const started = speech.start((text) => setValue(text));
    if (!started) voiceTurnActiveRef.current = false;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line. Never while an IME (Korean)
    // is still composing, or the last syllable would be sent half-finished.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitValue(value);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitValue(value);
      }}
    >
      {speech.listening && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-critical-light px-3 py-2 text-[13px] font-medium text-critical" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-critical" aria-hidden="true" />
          {isKorean ? "듣고 있어요… 다 말씀하셨으면 마이크를 다시 눌러 주세요." : "Listening… tap the mic again when you're done."}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-[26px] border border-border bg-surface p-1.5 shadow-[var(--pt-shadow-sm)] focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand-soft">
        {speech.supported && (
          <button
            type="button"
            disabled={disabled}
            aria-label={speech.listening ? (isKorean ? "듣기 중지" : "Stop listening") : (isKorean ? "말로 응답하기" : "Speak your response")}
            onClick={handleMicClick}
            className={cn(
              "transition-ui flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40",
              speech.listening ? "bg-critical text-white" : "text-text-secondary hover:bg-surface-hover",
            )}
          >
            {speech.listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
        <textarea
          ref={textareaRef}
          name="message"
          // Without this the browser offers every previously typed answer as
          // an autofill dropdown -- re-exposing things the participant already
          // moved past. This field is never meant to be remembered.
          autoComplete="off"
          rows={1}
          className={cn("min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-text-primary placeholder:text-text-muted focus:outline-none", !speech.supported && "pl-3")}
          placeholder={placeholder}
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={placeholder}
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label={isKorean ? "보내기" : "Send"}
          className="transition-ui flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-strong active:scale-95 disabled:bg-surface-hover disabled:text-text-muted"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );
}

function RatingInput({ disabled, min, max, locale, onSubmit }: { disabled?: boolean; min: number; max: number; locale?: string; onSubmit: (value: number) => void }) {
  const isKorean = locale?.toLowerCase().startsWith("ko") ?? false;
  const initialValue = String(Math.max(min, Math.min(max, Math.round((min + max) / 2))));
  const [value, setValue] = useState(initialValue);
  const numeric = Number.parseFloat(value);
  const isPercent = min === 0 && max === 100;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const numericValue = Number.parseFloat(value);
        if (Number.isNaN(numericValue)) return;
        onSubmit(Math.max(min, Math.min(max, numericValue)));
      }}
    >
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <input type="range" min={min} max={max} value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled} className={rangeClass} aria-label={isKorean ? "점수" : "Rating"} />
          <div className="mt-1 flex justify-between text-[11px] font-medium text-text-muted" aria-hidden="true">
            <span>{min}{isPercent ? "%" : ""}</span>
            <span>{max}{isPercent ? "%" : ""}</span>
          </div>
        </div>
        <div className="flex items-baseline gap-0.5">
          <input type="number" min={min} max={max} value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled} className={numberBox} aria-label={isKorean ? "점수 직접 입력" : "Type a rating"} />
          {isPercent && <span className="text-sm font-bold text-text-secondary">%</span>}
        </div>
      </div>
      <PtButton type="submit" size="lg" block disabled={disabled || Number.isNaN(numeric)}>{isKorean ? "평가 제출" : "Submit rating"}</PtButton>
    </form>
  );
}

function ChoiceRow({ disabled, options, locale, onSelect }: { disabled?: boolean; options: string[]; locale?: string; onSelect: (value: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(option)}
          className="transition-ui rounded-2xl border border-border bg-surface px-4 py-3.5 text-[15px] font-semibold text-text-primary hover:border-brand/50 hover:bg-brand-tint active:scale-[0.99] disabled:opacity-50"
        >
          {choiceLabel(option, locale)}
        </button>
      ))}
    </div>
  );
}

function MultiChoiceInput({ choices, disabled, locale, onSubmit }: { choices: string[]; disabled?: boolean; locale?: string; onSubmit: (value: string[]) => void }) {
  const isKorean = locale?.toLowerCase().startsWith("ko") ?? false;
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (choice: string) => {
    setSelected((current) => (current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice]));
  };
  return (
    <div className="grid gap-3">
      <div className="text-xs font-semibold text-text-muted">{isKorean ? "해당하는 것을 모두 골라 주세요" : "Choose all that apply"}</div>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => {
          const isSelected = selected.includes(choice);
          return (
            <button
              key={choice}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => toggle(choice)}
              className={cn(
                "transition-ui inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-[15px] font-semibold active:scale-[0.98] disabled:opacity-50",
                isSelected ? "border-brand bg-brand text-white" : "border-border bg-surface text-text-primary hover:bg-surface-hover",
              )}
            >
              {isSelected && <Check className="h-4 w-4" aria-hidden="true" />}
              {choiceLabel(choice, locale)}
            </button>
          );
        })}
      </div>
      <PtButton size="lg" block disabled={disabled || !selected.length} onClick={() => onSubmit(selected)}>
        {isKorean ? "선택 제출" : "Submit selection"}
      </PtButton>
    </div>
  );
}
