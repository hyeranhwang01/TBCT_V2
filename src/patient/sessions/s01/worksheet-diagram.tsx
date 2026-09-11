"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { QuestCompleteBadge, useJustFilled } from "@/patient/components/worksheet-renderers/shared";
import type { S01Labels } from "@/patient/sessions/s01/worksheet-labels";
import type { WorksheetFieldView } from "@/types/worksheet";

// The TBCT Conceptualization Diagram Phase 1 Level 1, as drawn on the paper
// worksheet used in the real first session: Situation -> Automatic Thought
// -> Emotion(s) -> Behavior(s)/Physiological Response, with a dotted arrow
// from the situation to the thought, returning arrows from behavior back to
// the feeling and the thought, and a dotted returning arrow from behavior
// back to the situation. The boxes stack vertically so the diagram fits the
// narrow panel beside the chat; the arrows are an SVG overlay measured from
// the real box positions. The returning-arrow answers are listed under the
// diagram with the same numbers as the arrows.

export type FieldGetter = (key: string) => WorksheetFieldView | undefined;

export function fieldText(field?: WorksheetFieldView): string | undefined {
  const value = field?.value?.value;
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : undefined;
  return field?.value?.displayValue ?? String(value);
}

export function fieldNumber(field?: WorksheetFieldView): number | undefined {
  const raw = field?.value?.value;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isNaN(parsed) ? undefined : Math.max(0, Math.min(100, parsed));
}

export function Placeholder({ text }: { text: string }) {
  return <span className="text-text-muted">{text}</span>;
}

export function PercentBar({ value, label }: { value?: number; label?: string }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-subtle">
        <div className="h-full rounded-full bg-clinical-blue" style={{ width: `${value}%` }} />
      </div>
      <span className="shrink-0 text-xs font-semibold text-text-primary">{label ? `${label} ` : ""}{value}%</span>
    </div>
  );
}

/** Brings `element` into view inside the nearest scrolling panel only. Never
 * scrolls the page itself: on a narrow screen the worksheet sits under the
 * chat, and scrolling the window would pull the participant away from the
 * reply box. */
export function scrollWithinPanel(element: HTMLElement, reducedMotion: boolean) {
  let panel = element.parentElement;
  while (panel && panel !== document.body) {
    const { overflowY } = window.getComputedStyle(panel);
    if (/(auto|scroll)/.test(overflowY) && panel.scrollHeight > panel.clientHeight) break;
    panel = panel.parentElement;
  }
  if (!panel || panel === document.body) return;
  const box = element.getBoundingClientRect();
  const frame = panel.getBoundingClientRect();
  const margin = 12;
  let delta = 0;
  if (box.top < frame.top + margin) delta = box.top - frame.top - margin;
  else if (box.bottom > frame.bottom - margin) delta = Math.min(box.bottom - frame.bottom + margin, box.top - frame.top - margin);
  if (delta !== 0) panel.scrollBy?.({ top: delta, behavior: reducedMotion ? "auto" : "smooth" });
}

/** One worksheet box: dashed while empty, blue ring while the conversation
 * is on it, a brief "filled" flourish when it fills. Read-only. */
export function S01Box({ title, active, filled, reducedMotion, autoScroll, boxRef, children, className }: {
  title: string;
  active: boolean;
  filled: boolean;
  reducedMotion: boolean;
  autoScroll: boolean;
  boxRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
}) {
  const justFilled = useJustFilled(filled, reducedMotion);
  const localRef = useRef<HTMLDivElement>(null);
  const ref = boxRef ?? localRef;
  useEffect(() => {
    if (active && autoScroll && ref.current) scrollWithinPanel(ref.current, reducedMotion);
  }, [active, autoScroll, reducedMotion, ref]);
  const tone = active ? "border-clinical-blue ring-2 ring-clinical-blue" : justFilled ? "border-success ring-2 ring-success" : filled ? "border-border" : "border-dashed border-border";
  return (
    <div ref={ref} className={`relative rounded-panel border bg-surface p-3 transition ${tone} ${className ?? ""}`} aria-current={active ? "step" : undefined}>
      {justFilled && <QuestCompleteBadge />}
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">{title}</div>
      <div className="mt-1 space-y-1 text-sm text-text-primary">{children}</div>
    </div>
  );
}

type Rect = { top: number; left: number; width: number; height: number };
type Geometry = { width: number; height: number; situation: Rect; thought: Rect; emotion: Rect; behavior: Rect };

function arrowPaths(g: Geometry) {
  const centerX = (r: Rect) => r.left + r.width / 2;
  const down = (a: Rect, b: Rect) => `M ${centerX(a)} ${a.top + a.height + 2} L ${centerX(b)} ${b.top - 3}`;
  const rightReturn = (from: Rect, fromY: number, to: Rect, bulge: number) => {
    const x1 = from.left + from.width;
    const x2 = to.left + to.width;
    const y2 = to.top + to.height / 2;
    const control = Math.max(x1, x2) + bulge;
    return { d: `M ${x1 + 2} ${fromY} C ${control} ${fromY}, ${control} ${y2}, ${x2 + 3} ${y2}`, labelX: (x1 + x2 + 6 * control) / 8, labelY: (fromY + y2) / 2 };
  };
  const b = g.behavior;
  const behaviorY = b.top + b.height / 2;
  const situationY = g.situation.top + g.situation.height / 2;
  const leftControl = Math.min(b.left, g.situation.left) - 22;
  return {
    situationToThought: down(g.situation, g.thought),
    thoughtToEmotion: down(g.thought, g.emotion),
    emotionToBehavior: down(g.emotion, g.behavior),
    toEmotion: rightReturn(b, b.top + b.height * 0.35, g.emotion, 26),
    toThought: rightReturn(b, b.top + b.height * 0.7, g.thought, 52),
    toSituation: {
      d: `M ${b.left - 2} ${behaviorY} C ${leftControl} ${behaviorY}, ${leftControl} ${situationY}, ${g.situation.left - 3} ${situationY}`,
      labelX: (b.left + g.situation.left + 6 * leftControl) / 8,
      labelY: (behaviorY + situationY) / 2,
    },
  };
}

function ArrowLabel({ x, y, n }: { x: number; y: number; n: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="9" className="fill-surface" stroke="currentColor" strokeWidth="1.2" />
      <text textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700" fill="currentColor">{n}</text>
    </g>
  );
}

function LegendItem({ n, title, value, active, empty }: { n: string; title: string; value?: string; active: boolean; empty: string }) {
  return (
    <li className={`flex gap-2 rounded-panel px-2 py-1 ${active ? "bg-clinical-blue-light/40 ring-1 ring-clinical-blue" : ""}`}>
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-clinical-blue text-[10px] font-bold text-clinical-blue">{n}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-text-muted">{title}</span>
        <span className="block text-sm text-text-primary">{value ?? <Placeholder text={empty} />}</span>
      </span>
    </li>
  );
}

export function CcdLevel1Diagram({ get, isActive, labels, reducedMotion, autoScroll }: {
  get: FieldGetter;
  isActive: (keys: string[]) => boolean;
  labels: S01Labels;
  reducedMotion: boolean;
  autoScroll: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const situationRef = useRef<HTMLDivElement>(null);
  const thoughtRef = useRef<HTMLDivElement>(null);
  const emotionRef = useRef<HTMLDivElement>(null);
  const behaviorRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const markerId = `s01-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const measure = () => {
      const boxes = [situationRef.current, thoughtRef.current, emotionRef.current, behaviorRef.current];
      if (boxes.some((box) => !box)) return;
      const base = container.getBoundingClientRect();
      const rect = (element: HTMLDivElement): Rect => {
        const r = element.getBoundingClientRect();
        return { top: r.top - base.top, left: r.left - base.left, width: r.width, height: r.height };
      };
      const [situation, thought, emotion, behavior] = boxes.map((box) => rect(box!));
      const next: Geometry = { width: base.width, height: base.height, situation, thought, emotion, behavior };
      setGeometry((previous) => (previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const situationLine = fieldText(get("situationLine"));
  const situationRaw = fieldText(get("situationThoughtDistinction"));
  const thoughtText = fieldText(get("thoughtLine")) ?? fieldText(get("openingInitialThought"));
  const belief = fieldNumber(get("s01ThoughtBeliefPercent"));
  const emotions = [
    ["personalEmotion", "personalEmotionIntensity"],
    ["personalSecondEmotion", "personalSecondEmotionIntensity"],
    ["personalThirdEmotion", "personalThirdEmotionIntensity"],
  ].map(([name, intensity]) => ({ name: fieldText(get(name)), intensity: fieldNumber(get(intensity)) })).filter((emotion) => emotion.name);
  const behaviors = ["personalBehavior", "personalSecondBehavior"].map((key) => fieldText(get(key))).filter((value): value is string => Boolean(value));
  const body = fieldText(get("personalBodySensations"));
  const paths = geometry ? arrowPaths(geometry) : null;

  return (
    <div>
      <div ref={containerRef} className="relative pl-8 pr-16" data-testid="s01-ccd-diagram">
        <div className="space-y-7">
          <S01Box boxRef={situationRef} title={labels.situation} active={isActive(["situationThoughtDistinction", "situationLine"])} filled={Boolean(situationLine ?? situationRaw)} reducedMotion={reducedMotion} autoScroll={autoScroll}>
            <div className="font-serif">{situationLine ?? situationRaw ?? <Placeholder text={labels.empty} />}</div>
            {situationLine && situationRaw && <div className="text-xs text-text-muted">{labels.firstWords}: {situationRaw}</div>}
          </S01Box>
          <S01Box boxRef={thoughtRef} title={labels.thought} active={isActive(["openingInitialThought", "thoughtLine", "s01ThoughtBeliefPercent"])} filled={Boolean(thoughtText)} reducedMotion={reducedMotion} autoScroll={autoScroll}>
            <div className="font-serif">{thoughtText ?? <Placeholder text={labels.empty} />}</div>
            <PercentBar value={belief} label={labels.belief} />
          </S01Box>
          <S01Box boxRef={emotionRef} title={labels.emotions} active={isActive(["personalEmotion", "personalEmotionIntensity", "personalSecondEmotion", "personalSecondEmotionIntensity", "personalThirdEmotion", "personalThirdEmotionIntensity"])} filled={emotions.length > 0} reducedMotion={reducedMotion} autoScroll={autoScroll}>
            {emotions.length ? emotions.map((emotion, index) => (
              <div key={index} className="space-y-0.5">
                <div className="font-serif">{emotion.name}</div>
                <PercentBar value={emotion.intensity} />
              </div>
            )) : <Placeholder text={labels.empty} />}
          </S01Box>
          <S01Box boxRef={behaviorRef} title={labels.behaviorBody} active={isActive(["personalBehavior", "personalSecondBehavior", "personalBodySensations"])} filled={behaviors.length > 0 || Boolean(body)} reducedMotion={reducedMotion} autoScroll={autoScroll}>
            {behaviors.length ? behaviors.map((behavior, index) => <div key={index} className="font-serif">{behavior}</div>) : <Placeholder text={labels.empty} />}
            {body && <div className="text-xs text-text-secondary">{labels.body}: {body}</div>}
          </S01Box>
        </div>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-text-muted" aria-hidden>
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {paths && (
            <>
              <path d={paths.situationToThought} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" fill="none" markerEnd={`url(#${markerId})`} />
              <path d={paths.thoughtToEmotion} stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />
              <path d={paths.emotionToBehavior} stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />
              <g className="text-clinical-blue">
                <path d={paths.toEmotion.d} stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />
                <path d={paths.toThought.d} stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd={`url(#${markerId})`} />
                <path d={paths.toSituation.d} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" fill="none" markerEnd={`url(#${markerId})`} />
                <ArrowLabel x={paths.toEmotion.labelX} y={paths.toEmotion.labelY} n="1" />
                <ArrowLabel x={paths.toThought.labelX} y={paths.toThought.labelY} n="2" />
              </g>
            </>
          )}
        </svg>
      </div>
      <p className="mt-2 text-xs text-text-muted">{labels.dottedNote}</p>
      <div className="mt-2 rounded-panel border border-border bg-surface-subtle/60 p-2">
        <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">{labels.cycleTitle}</div>
        <ol className="space-y-1">
          <LegendItem n="·" title={labels.friend} value={fieldText(get("friendThought"))} active={isActive(["friendThought"])} empty={labels.empty} />
          <LegendItem n="1" title={labels.cycleFeeling} value={fieldText(get("cycleAfterBehaviorEmotion"))} active={isActive(["cycleAfterBehaviorEmotion"])} empty={labels.empty} />
          <LegendItem n="2" title={labels.cycleThought} value={fieldText(get("cycleReinforcedThought"))} active={isActive(["cycleReinforcedThought"])} empty={labels.empty} />
          <LegendItem n="·" title={labels.cyclePrevention} value={fieldText(get("cycleSafetyStrategy"))} active={isActive(["cycleSafetyStrategy"])} empty={labels.empty} />
          <LegendItem n="·" title={labels.cycleLink} value={fieldText(get("cycleProblemLink"))} active={isActive(["cycleProblemLink"])} empty={labels.empty} />
          <LegendItem n="·" title={labels.cycleEffect} value={fieldText(get("cycleShortLongTermEffect"))} active={isActive(["cycleShortLongTermEffect"])} empty={labels.empty} />
          <LegendItem n="·" title={labels.outcome} value={fieldText(get("ownCaseActualOutcome"))} active={isActive(["ownCaseActualOutcome"])} empty={labels.empty} />
        </ol>
      </div>
    </div>
  );
}
