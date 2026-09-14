"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button, inputClass } from "@/shared/components/ui/primitives";

// In-place editing of one worksheet value (.claude/TASK_SCOPE.json
// note2026_09_14_patient_worksheet_edit): the words themselves are the
// control. Clicking them turns them into a box that looks like the chat reply
// box. Enter saves (Shift+Enter starts a new line), Esc cancels, and Enter
// pressed while a Korean syllable is still being composed never saves.

const TEXT = {
  ko: { edit: "수정", save: "저장", cancel: "취소" },
  en: { edit: "edit", save: "Save", cancel: "Cancel" },
};

function fitHeight(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${Math.max(element.scrollHeight, 36)}px`;
}

export function InlineEditor({ value, label, onSave, busy, locale, numeric, children }: {
  value: string;
  /** What is being edited, for screen readers. */
  label: string;
  onSave: (next: string) => void;
  /** A reply is on its way or a save is running: nothing can be saved. */
  busy: boolean;
  locale?: string;
  /** A 0-100 value, edited in a number box. */
  numeric?: boolean;
  children: ReactNode;
}) {
  const text = TEXT[locale?.toLowerCase().startsWith("ko") ? "ko" : "en"];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const element = numeric ? inputRef.current : textareaRef.current;
    element?.focus();
    element?.select();
    if (textareaRef.current) fitHeight(textareaRef.current);
  }, [editing, numeric]);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={busy}
        title={text.edit}
        aria-label={`${label}: ${value} (${text.edit})`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="group inline cursor-text rounded-sm text-left decoration-clinical-blue/60 decoration-dotted underline-offset-4 hover:bg-clinical-blue-light/30 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-blue disabled:cursor-default disabled:hover:bg-transparent disabled:hover:no-underline"
      >
        {children}
        <Pencil aria-hidden className="ml-1 inline-block h-3 w-3 align-[-1px] text-text-muted opacity-40 group-hover:text-clinical-blue group-hover:opacity-100 group-disabled:opacity-0" />
      </button>
    );
  }

  const save = () => {
    if (busy) return;
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  };

  return (
    <form
      className="my-1 flex items-start gap-2 font-sans"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {numeric ? (
        <span className="w-24 shrink-0">
          <input ref={inputRef} type="number" inputMode="numeric" min={0} max={100} autoComplete="off" aria-label={label} className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} />
        </span>
      ) : (
        <textarea
          ref={textareaRef}
          rows={1}
          autoComplete="off"
          aria-label={label}
          className={`${inputClass} resize-none py-1.5 leading-6`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            fitHeight(event.target);
          }}
          onKeyDown={onKeyDown}
        />
      )}
      <Button type="submit" size="sm" disabled={busy}>{text.save}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{text.cancel}</Button>
    </form>
  );
}
