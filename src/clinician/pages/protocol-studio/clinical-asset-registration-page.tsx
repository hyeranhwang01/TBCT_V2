"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, RotateCcw, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  SectionHeader,
  inputClass,
  textareaClass,
} from "@/components/ui/primitives";
import { createClinicalAssetFromFile } from "@/lib/api/clinical-assets-api";
import { resetLocalDb } from "@/lib/db/tbct-local-db";
import type { AssetType, CreateClinicalAssetInput, LocalClinicalAsset } from "@/types/clinical-assets";

const routePath = "/projects/demo/clinical-assets/new";
const projectId = "TBCT-BR-001";

const assetTypes: AssetType[] = [
  "transcript",
  "therapist_manual",
  "patient_manual",
  "ai_only_manual",
  "claude_prompt",
  "session_audio",
  "session_video",
  "supporting_document",
];

export function ClinicalAssetRegistrationPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [registeredAsset, setRegisteredAsset] = useState<LocalClinicalAsset | null>(null);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [form, setForm] = useState({
    title: "TBCT Manual",
    assetType: "therapist_manual" as AssetType,
    sourceLocale: "pt-BR",
    translationLocale: "",
    country: "BR" as LocalClinicalAsset["country"],
    version: "1.0.0",
    sessionIds: "",
    authorName: "Demo User",
    organization: "TBCT Research Team",
    protocolId: "TBCT-BR-001",
    notes: "",
    tags: "pilot, session-03",
    permissionLevel: "project" as LocalClinicalAsset["permissionLevel"],
    allowForceDuplicate: false,
    duplicateReason: "",
  });

  const diagnostics = useMemo(
    () => [
      ["Route", routePath],
      ["Project", projectId],
      ["File", file?.name ?? "No file selected"],
      ["Permission", form.permissionLevel],
    ],
    [file?.name, form.permissionLevel],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a local file before registering the asset.");
      const result = await createClinicalAssetFromFile({
        file,
        title: form.title || file.name.replace(/\.[^.]+$/, ""),
        assetType: form.assetType,
        country: form.country,
        sourceLocale: form.sourceLocale,
        translationLocale: form.translationLocale || undefined,
        sessionIds: form.sessionIds.split(",").map((value) => value.trim()).filter(Boolean),
        protocolId: form.protocolId || undefined,
        authorName: form.authorName || undefined,
        organization: form.organization || undefined,
        version: form.version,
        notes: form.notes || undefined,
        tags: form.tags.split(",").map((value) => value.trim()).filter(Boolean),
        permissionLevel: form.permissionLevel,
        createdBy: "Demo User",
        allowForceDuplicate: form.allowForceDuplicate,
        duplicateReason: form.duplicateReason || undefined,
      } satisfies CreateClinicalAssetInput);

      if ("duplicate" in result && result.duplicate) {
        throw new Error(`A matching asset already exists: ${result.duplicate.title}. Enable force duplicate if this is intentional.`);
      }

      return result.asset;
    },
    onSuccess: (asset) => {
      setRegisteredAsset(asset);
      setSubmitError(null);
      toast.success("Asset registered locally.", { description: asset.originalFileName });
    },
    onError: (error) => {
      setSubmitError(error instanceof Error ? error : new Error("Asset registration failed."));
    },
  });

  const clearRuntime = async () => {
    await resetLocalDb();
    toast.success("Local demo data cleared.");
    router.refresh();
  };

  const reloadRuntime = () => {
    window.location.reload();
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Clinical Source Library"
        title="Register Clinical Asset"
        description="Upload a local file into the demo repository without depending on the asset list or other loaded data."
        meta={
          <>
            <Badge tone="primary">{projectId}</Badge>
            <Badge tone="neutral">Local-only registration</Badge>
          </>
        }
        actions={
          <Button variant="secondary" onClick={() => router.push("/projects/demo/assets")}>
            <ArrowLeft className="h-4 w-4" />
            Back to assets
          </Button>
        }
      />

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:p-6">
        <Card>
          <SectionHeader
            title="Upload and metadata"
            description="Choose a file, set the clinical metadata, and save it directly into the local browser database."
          />
          <div className="space-y-5 p-4 lg:p-5">
            <label className="block rounded-panel border border-dashed border-border bg-surface-subtle p-5 transition hover:border-clinical-blue">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-clinical-blue-light text-clinical-blue">
                  <FileUp className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary">Choose a local file</div>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">
                    PDF, DOCX, TXT, MD, JSON, MP3, WAV, MP4, and MOV are accepted for the demo flow.
                  </p>
                  <input
                    type="file"
                    className="mt-4 block w-full text-sm text-text-secondary file:mr-4 file:rounded-panel file:border-0 file:bg-clinical-blue file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[#2f5b9f]"
                    accept=".pdf,.docx,.txt,.md,.json,.mp3,.wav,.m4a,.mp4,.mov"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setSubmitError(null);
                    }}
                  />
                </div>
              </div>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Asset title"><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className={inputClass} /></Field>
              <Field label="Asset type"><select value={form.assetType} onChange={(event) => setForm((current) => ({ ...current, assetType: event.target.value as AssetType }))} className={inputClass}>{assetTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Locale"><input value={form.sourceLocale} onChange={(event) => setForm((current) => ({ ...current, sourceLocale: event.target.value }))} className={inputClass} /></Field>
              <Field label="Country"><select value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value as LocalClinicalAsset["country"] }))} className={inputClass}><option value="BR">BR</option><option value="FR">FR</option><option value="KR">KR</option><option value="OTHER">OTHER</option></select></Field>
              <Field label="Session IDs"><input value={form.sessionIds} onChange={(event) => setForm((current) => ({ ...current, sessionIds: event.target.value }))} className={inputClass} /></Field>
              <Field label="Version"><input value={form.version} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} className={inputClass} /></Field>
              <Field label="Author"><input value={form.authorName} onChange={(event) => setForm((current) => ({ ...current, authorName: event.target.value }))} className={inputClass} /></Field>
              <Field label="Organization"><input value={form.organization} onChange={(event) => setForm((current) => ({ ...current, organization: event.target.value }))} className={inputClass} /></Field>
              <Field label="Protocol ID"><input value={form.protocolId} onChange={(event) => setForm((current) => ({ ...current, protocolId: event.target.value }))} className={inputClass} /></Field>
              <Field label="Translation locale"><input value={form.translationLocale} onChange={(event) => setForm((current) => ({ ...current, translationLocale: event.target.value }))} className={inputClass} /></Field>
              <div className="sm:col-span-2">
                <Field label="Notes"><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={textareaClass} /></Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Tags"><input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} className={inputClass} /></Field>
              </div>
            </div>

            <div className="grid gap-3 rounded-panel border border-border bg-surface-subtle p-4 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={form.allowForceDuplicate} onChange={(event) => setForm((current) => ({ ...current, allowForceDuplicate: event.target.checked }))} className="mt-1" />
                <span>Allow force duplicate registration if the checksum already exists.</span>
              </label>
              <Field label="Duplicate reason"><input value={form.duplicateReason} onChange={(event) => setForm((current) => ({ ...current, duplicateReason: event.target.value }))} className={inputClass} /></Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                <CheckCircle2 className="h-4 w-4" />
                Register asset locally
              </Button>
              <Button variant="secondary" onClick={reloadRuntime}>
                <RotateCcw className="h-4 w-4" />
                Retry database initialization
              </Button>
              <Button variant="secondary" onClick={() => void clearRuntime()}>
                <ShieldAlert className="h-4 w-4" />
                Reset local demo data
              </Button>
            </div>

            {submitError && (
              <div className="rounded-panel border border-critical-light bg-critical-light/30 p-4 text-sm text-text-primary">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-critical" />
                  <div>
                    <div className="font-semibold text-critical">Registration failed</div>
                    <div className="mt-1 text-text-secondary">{submitError.message}</div>
                  </div>
                </div>
              </div>
            )}

            {registeredAsset && (
              <Card className="border-success-light bg-success-light/30 p-4">
                <div className="text-sm font-semibold text-text-primary">Asset registered successfully</div>
                <div className="mt-1 text-xs text-text-secondary">{registeredAsset.title} · {registeredAsset.originalFileName}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => router.push("/projects/demo/assets")}>Open asset library</Button>
                  <Button variant="secondary" onClick={() => router.push(routePath)}>Register another file</Button>
                </div>
              </Card>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionHeader title="Runtime diagnostics" description="Use this panel when the local repository or IndexedDB state needs recovery." />
            <div className="space-y-3 p-4 text-sm">
              {diagnostics.map(([label, value]) => (
                <div key={label} className="rounded-panel border border-border bg-surface-subtle p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
                  <div className="mt-1 break-all font-medium text-text-primary">{value}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="Expected flow" description="The page stays usable even when the asset list is empty or another query fails." />
            <div className="space-y-3 p-4 text-sm text-text-secondary">
              <div>1. Select a local file.</div>
              <div>2. Fill in the asset metadata.</div>
              <div>3. Register the file directly into local browser storage.</div>
              <div>4. Return to the asset library or upload another file.</div>
            </div>
          </Card>

          {process.env.NODE_ENV !== "production" && submitError && (
            <Card>
              <SectionHeader title="Development error panel" description="Only shown in development to help trace local runtime failures." />
              <div className="space-y-3 p-4 text-sm">
                <div className="rounded-panel border border-border bg-surface-subtle p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Message</div>
                  <div className="mt-1 text-text-primary">{submitError.message}</div>
                </div>
                <div className="rounded-panel border border-border bg-surface-subtle p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Route</div>
                  <div className="mt-1 text-text-primary">{routePath}</div>
                </div>
                <div className="rounded-panel border border-border bg-surface-subtle p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Stack</div>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs text-text-secondary">{submitError.stack || "No stack available."}</pre>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}