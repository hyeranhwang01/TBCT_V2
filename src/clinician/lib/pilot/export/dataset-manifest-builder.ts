import type { ResearchDataSnapshot, ResearchExportFile } from "@/types/pilot-operations";

export function buildDatasetManifest(input: {
  studyId: string;
  snapshot: ResearchDataSnapshot;
  files: ResearchExportFile[];
  countries: string[];
  arms: string[];
  included: string[];
  excluded: string[];
}) {
  return {
    studyId: input.studyId,
    snapshotId: input.snapshot.id,
    snapshotChecksum: input.snapshot.datasetChecksum,
    generatedAt: new Date().toISOString(),
    schemaVersion: "demo-v1",
    countries: input.countries,
    arms: input.arms,
    includedCount: input.included.length,
    excludedCount: input.excluded.length,
    included: input.included,
    excluded: input.excluded,
    files: input.files.map((file) => ({
      filename: file.filename,
      mediaType: file.mediaType,
      rowCount: file.rowCount,
      byteLength: file.byteLength,
      checksum: file.checksum,
      description: file.description,
    })),
    limitations: [
      "Demo data only",
      "Local-first prototype",
      "Pilot target N=30",
      "Feasibility-focused",
      "Not confirmatory efficacy evidence",
      "Not a production clinical-trial export",
    ],
  };
}
