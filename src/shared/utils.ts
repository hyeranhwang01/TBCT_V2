import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ReviewStatus, Severity } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const reviewStatusMap: Record<ReviewStatus, { label: string; tone: string; icon: string }> = {
  draft: { label: "Draft", tone: "neutral", icon: "Draft" },
  review: { label: "Needs Review", tone: "warning", icon: "Review" },
  approved: { label: "Approved", tone: "primary", icon: "Approved" },
  error: { label: "Risk or Error", tone: "critical", icon: "Critical" },
  published: { label: "Published", tone: "success", icon: "Published" },
};

export const versionStatusMap: Record<string, { label: string; tone: string }> = {
  Draft: { label: "Draft", tone: "neutral" },
  "Clinical Review": { label: "Clinical Review", tone: "warning" },
  Published: { label: "Published", tone: "success" },
  Archived: { label: "Archived", tone: "neutral" },
};

export const severityMap: Record<Severity, { label: string; tone: string }> = {
  critical: { label: "Critical", tone: "critical" },
  warning: { label: "Warning", tone: "warning" },
  info: { label: "Information", tone: "primary" },
  passed: { label: "Passed", tone: "success" },
};
