import type { ComponentType } from "react";
import { S01Worksheet } from "@/patient/sessions/s01/worksheet";
import { S02Worksheet } from "@/patient/sessions/s02/worksheet";
import { S03Worksheet } from "@/patient/sessions/s03/worksheet";
import { S04Worksheet } from "@/patient/sessions/s04/worksheet";
import { S05Worksheet } from "@/patient/sessions/s05/worksheet";
import { S06Worksheet } from "@/patient/sessions/s06/worksheet";
import { S07Worksheet } from "@/patient/sessions/s07/worksheet";
import { S08Worksheet } from "@/patient/sessions/s08/worksheet";
import type { WorksheetView } from "@/types/worksheet";

export interface ComposedWorksheetProps {
  view: WorksheetView;
  activeCanonicalFieldKey?: string;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  // Only S06Worksheet currently reads this (its cross-run progress-over-time
  // table needs to look up the participant's other runs of this same
  // session -- see getListScoreHistory). Every other session component
  // simply doesn't destructure it.
  runtimeSessionId: string;
}

// Session-specific "recreate the figure in real HTML/CSS" worksheets --
// each one has a genuinely different layout matching that session's own
// manual figure (see src/components/runtime/worksheet-renderers/s0N-worksheet.tsx).
// All eight sessions use this approach; the coordinate-mapped photo-overlay
// renderer (figure-registry + FigureWorkspace) that S03 used previously has
// been retired in favor of s03-worksheet.tsx, for consistency with every
// other session.
const REGISTRY: Partial<Record<string, ComponentType<ComposedWorksheetProps>>> = {
  "tbct-s01": S01Worksheet,
  "tbct-s02": S02Worksheet,
  "tbct-s03": S03Worksheet,
  "tbct-s04": S04Worksheet,
  "tbct-s05": S05Worksheet,
  "tbct-s06": S06Worksheet,
  "tbct-s07": S07Worksheet,
  "tbct-s08": S08Worksheet,
};

export function getComposedWorksheet(sessionDefinitionId: string): ComponentType<ComposedWorksheetProps> | undefined {
  return REGISTRY[sessionDefinitionId];
}
