// Study configuration, AI releases and the randomization list (sql/035, 036,
// 038). Server-only.

import { createHash } from "node:crypto";
import { getPgPool } from "@/shared/data/db/pg-pool";
import { TrialError, makeId, select, selectOne, transaction, type Queryable } from "@/shared/data/server/trial/db";
import { recordEvents } from "@/shared/data/server/trial/events-store";
import { TRIAL_INSTRUMENTS } from "@/shared/trial/instruments";
import { DEFAULT_STUDY_SETTINGS } from "@/shared/trial/default-study-config";
import { SESSION_PROMPTS } from "@/shared/protocol/session-prompts.generated";
import { RETRIEVAL_ALGORITHM_VERSION } from "@/shared/memory/chunk-scorer";
import { MEMORY_INDEX_VERSION } from "@/shared/memory/chunk-builder";
import type { StudyConfigInput, TrialActor } from "@/shared/trial/trial-store-ops";
import type { AiRelease, AssessmentTimepoint, Site, Study, StudyArm, Therapist } from "@/types/trial";

/** The study of this database (one per country deployment): the active one,
 * else the most recent. */
export async function getStudy(db?: Queryable): Promise<Study | undefined> {
  return selectOne<Study>("SELECT * FROM studies ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1", [], db);
}

export async function requireStudy(db?: Queryable): Promise<Study> {
  const study = await getStudy(db);
  if (!study) throw new TrialError("No study is configured in this database.");
  return study;
}

export function studySettings(study: Study) {
  return { ...DEFAULT_STUDY_SETTINGS, ...(study.data ?? {}) };
}

export async function isLocked(db?: Queryable) {
  return Boolean(await selectOne<{ studyId: string }>("SELECT study_id FROM study_locks LIMIT 1", [], db));
}

export async function configureStudy(actor: TrialActor | undefined, config: StudyConfigInput) {
  return transaction(actor, async (db) => {
    const { study } = config;
    await db.query(
      `INSERT INTO studies (id, code, title, country, protocol_version, status, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, title = EXCLUDED.title, country = EXCLUDED.country,
         protocol_version = EXCLUDED.protocol_version, status = EXCLUDED.status, data = EXCLUDED.data, updated_at = now()`,
      [study.id, study.code, study.title, study.country, study.protocolVersion, study.status, JSON.stringify({ ...DEFAULT_STUDY_SETTINGS, ...(study.settings ?? {}) })],
    );
    for (const arm of config.arms) {
      await db.query(
        `INSERT INTO study_arms (id, study_id, code, name, ai_enabled, therapist_required, schedule_template) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (study_id, code) DO UPDATE SET name = EXCLUDED.name, ai_enabled = EXCLUDED.ai_enabled,
           therapist_required = EXCLUDED.therapist_required, schedule_template = EXCLUDED.schedule_template`,
        [`${study.id}-${arm.code}`, study.id, arm.code, arm.name, arm.aiEnabled, arm.therapistRequired, JSON.stringify(arm.scheduleTemplate)],
      );
    }
    for (const site of config.sites) {
      await db.query(
        `INSERT INTO sites (id, study_id, code, name, locale, timezone, status) VALUES ($1,$2,$3,$4,$5,$6,'active')
         ON CONFLICT (study_id, code) DO UPDATE SET name = EXCLUDED.name, locale = EXCLUDED.locale, timezone = EXCLUDED.timezone`,
        [`${study.id}-${site.code}`, study.id, site.code, site.name, site.locale, site.timezone],
      );
    }
    for (const timepoint of config.timepoints) {
      await db.query(
        `INSERT INTO assessment_timepoints (id, study_id, code, anchor, start_day, end_day, repeat_every_days, repeat_count, instruments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (study_id, code) DO UPDATE SET anchor = EXCLUDED.anchor, start_day = EXCLUDED.start_day, end_day = EXCLUDED.end_day,
           repeat_every_days = EXCLUDED.repeat_every_days, repeat_count = EXCLUDED.repeat_count, instruments = EXCLUDED.instruments`,
        [`${study.id}-${timepoint.code}`, study.id, timepoint.code, timepoint.anchor, timepoint.startDay, timepoint.endDay, timepoint.repeatEveryDays ?? null, timepoint.repeatCount ?? null, JSON.stringify(timepoint.instruments)],
      );
    }
    for (const instrument of TRIAL_INSTRUMENTS) {
      await db.query(
        `INSERT INTO instruments (id, code, version, name, mode, item_count, response_min, response_max, scoring, license_note, items)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code, version) DO NOTHING`,
        [`${instrument.code}@${instrument.version}`, instrument.code, instrument.version, instrument.name, instrument.mode, instrument.itemCount, instrument.responseMin, instrument.responseMax, JSON.stringify(instrument.scoring), instrument.licenseNote, JSON.stringify(instrument.items ?? {})],
      );
    }
    return getStudyContext(db);
  });
}

export async function getStudyContext(db?: Queryable) {
  const study = await getStudy(db);
  if (!study) return { study: null, arms: [], sites: [], therapists: [], releases: [], timepoints: [], locked: false };
  const [arms, sites, therapists, releases, timepoints, locked] = await Promise.all([
    select<StudyArm>("SELECT * FROM study_arms WHERE study_id = $1 ORDER BY code", [study.id], db),
    select<Site>("SELECT * FROM sites WHERE study_id = $1 ORDER BY code", [study.id], db),
    select<Therapist>("SELECT t.* FROM therapists t JOIN sites s ON s.id = t.site_id WHERE s.study_id = $1 ORDER BY t.display_name", [study.id], db),
    select<AiRelease>("SELECT * FROM ai_releases WHERE study_id = $1 ORDER BY created_at", [study.id], db),
    select<AssessmentTimepoint>("SELECT * FROM assessment_timepoints WHERE study_id = $1 ORDER BY start_day, code", [study.id], db),
    isLocked(db),
  ]);
  return { study, arms, sites, therapists, releases, timepoints, locked };
}

export async function upsertTherapist(actor: TrialActor | undefined, therapist: { id?: string; siteId: string; displayName: string; authUserId?: string | null; status: "active" | "inactive" }) {
  return transaction(actor, async (db) => {
    const id = therapist.id ?? makeId("THR");
    await db.query(
      `INSERT INTO therapists (id, site_id, auth_user_id, display_name, status) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET site_id = EXCLUDED.site_id, auth_user_id = EXCLUDED.auth_user_id, display_name = EXCLUDED.display_name, status = EXCLUDED.status`,
      [id, therapist.siteId, therapist.authUserId ?? null, therapist.displayName, therapist.status],
    );
    return (await selectOne<Therapist>("SELECT * FROM therapists WHERE id = $1", [id], db))!;
  });
}

/** What is deployed now: every session prompt's version and hash, and the
 * memory retrieval and index versions -- what a new release freezes. */
export function deployedAiVersions() {
  return {
    promptVersions: Object.fromEntries(Object.values(SESSION_PROMPTS).map((document) => [document.id, { version: document.version, sha256: document.sha256 }])),
    memoryAlgorithmVersion: RETRIEVAL_ALGORITHM_VERSION,
    memoryIndexVersion: MEMORY_INDEX_VERSION,
  };
}

export async function createAiRelease(actor: TrialActor | undefined, input: { label: string; modelId: string; promptVersions?: Record<string, { version: string; sha256: string }>; memoryAlgorithmVersion?: string; memoryIndexVersion?: string }) {
  if (!input.label.trim() || !input.modelId.trim()) throw new TrialError("A release needs a label and a model id");
  const release = { ...deployedAiVersions(), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) } as Required<typeof input>;
  return transaction(actor, async (db) => {
    const study = await requireStudy(db);
    const id = makeId("REL");
    await db.query(
      `INSERT INTO ai_releases (id, study_id, label, model_id, prompt_versions, memory_algorithm_version, memory_index_version, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
      [id, study.id, release.label, release.modelId, JSON.stringify(release.promptVersions), release.memoryAlgorithmVersion, release.memoryIndexVersion, actor?.userId ?? "server"],
    );
    return (await selectOne<AiRelease>("SELECT * FROM ai_releases WHERE id = $1", [id], db))!;
  });
}

/** Freezes a draft release. If participants were already allocated under an
 * earlier release, the change is a protocol deviation (Protocol V9 p.18) and
 * is recorded as one; re-consent is then due for the AI consent. */
export async function freezeAiRelease(actor: TrialActor | undefined, releaseId: string) {
  return transaction(actor, async (db) => {
    const release = await selectOne<AiRelease>("SELECT * FROM ai_releases WHERE id = $1 FOR UPDATE", [releaseId], db);
    if (!release) throw new TrialError("AI release not found");
    if (release.status !== "draft") throw new TrialError(`AI release is ${release.status}`);
    const earlier = await selectOne<{ n: number }>("SELECT count(*)::int AS n FROM allocations WHERE ai_release_id IS NOT NULL", [], db);
    await db.query("UPDATE ai_releases SET status = 'frozen' WHERE id = $1", [releaseId]);
    if ((earlier?.n ?? 0) > 0) {
      await db.query(
        `INSERT INTO protocol_deviations (id, study_id, category, severity, description, detected_at, detected_by, status, data)
         VALUES ($1,$2,'ai_release_change','major',$3,now(),$4,'open',$5)`,
        [makeId("DEV"), release.studyId, `New AI release "${release.label}" frozen after allocation began; affected participants need re-consent (Protocol V9 p.18).`, actor?.userId ?? "server", JSON.stringify({ releaseId })],
      );
    }
    return (await selectOne<AiRelease>("SELECT * FROM ai_releases WHERE id = $1", [releaseId], db))!;
  });
}

/** Retires a frozen release; the reason goes to runtime_events (the release
 * row itself is immutable apart from its status, sql/036). */
export async function retireAiRelease(actor: TrialActor | undefined, releaseId: string, reason: string) {
  if (!reason.trim()) throw new TrialError("Give the reason for retiring the release");
  return transaction(actor, async (db) => {
    const result = await db.query("UPDATE ai_releases SET status = 'retired' WHERE id = $1 AND status = 'frozen'", [releaseId]);
    if (!result.rowCount) throw new TrialError("Only a frozen release can be retired");
    await recordEvents([{ id: makeId("EVT"), category: "trial", severity: "info", code: "AI_RELEASE_RETIRED", detail: { releaseId, reason: reason.trim(), by: actor?.userId ?? "server" }, createdAt: new Date().toISOString() }], db);
    return (await selectOne<AiRelease>("SELECT * FROM ai_releases WHERE id = $1", [releaseId], db))!;
  });
}

const ARM_CODES = new Set(["CLINICIAN_ONLY", "AI_CLINICIAN", "AI_LED"]);

/** Parses the statistician's list: CSV with a header `stratum,sequence,arm`.
 * Every row is checked; nothing is stored unless the whole file is valid. */
export function parseRandomizationCsv(csv: string) {
  const lines = csv.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const header = lines.shift()?.split(",").map((cell) => cell.trim().toLowerCase());
  if (!header || header.join(",") !== "stratum,sequence,arm") throw new TrialError("The list must start with the header: stratum,sequence,arm");
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const [stratum, sequenceText, arm] = line.split(",").map((cell) => cell.trim());
    const sequence = Number(sequenceText);
    if (!/^[^|]+\|(MDD|ANXIETY)$/.test(stratum ?? "")) throw new TrialError(`Row ${index + 2}: stratum must be "<site code>|MDD" or "<site code>|ANXIETY"`);
    if (!Number.isInteger(sequence) || sequence < 1) throw new TrialError(`Row ${index + 2}: sequence must be a positive integer`);
    if (!ARM_CODES.has(arm)) throw new TrialError(`Row ${index + 2}: arm must be CLINICIAN_ONLY, AI_CLINICIAN or AI_LED`);
    const key = `${stratum}#${sequence}`;
    if (seen.has(key)) throw new TrialError(`Row ${index + 2}: duplicate ${stratum} sequence ${sequence}`);
    seen.add(key);
    return { stratum, sequence, arm };
  });
}

export async function uploadRandomizationList(actor: TrialActor | undefined, listVersion: string, csv: string) {
  const entries = parseRandomizationCsv(csv);
  if (!entries.length) throw new TrialError("The list has no rows.");
  const sha256 = createHash("sha256").update(csv).digest("hex");
  return transaction(actor, async (db) => {
    const study = await requireStudy(db);
    const sites = await select<Site>("SELECT * FROM sites WHERE study_id = $1", [study.id], db);
    const siteCodes = new Set(sites.map((site) => site.code));
    const unknown = entries.find((entry) => !siteCodes.has(entry.stratum.split("|")[0]));
    if (unknown) throw new TrialError(`Unknown site in stratum ${unknown.stratum}`);
    const existing = await selectOne<{ n: number }>("SELECT count(*)::int AS n FROM randomization_lists WHERE study_id = $1 AND list_version = $2", [study.id, listVersion], db);
    if ((existing?.n ?? 0) > 0) throw new TrialError(`List version ${listVersion} was already uploaded; use a new version.`);
    for (const entry of entries) {
      await db.query(
        `INSERT INTO randomization_lists (id, study_id, list_version, stratum, sequence, arm_code, upload_sha256, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [makeId("RND"), study.id, listVersion, entry.stratum, entry.sequence, entry.arm, sha256, actor?.userId ?? "server"],
      );
    }
    return { listVersion, sha256, rows: entries.length, strata: await randomizationStatus(db) };
  });
}

/** Per stratum: how many entries, how many used -- never which arm is next. */
export async function randomizationStatus(db?: Queryable) {
  return select<{ stratum: string; total: number; used: number; remaining: number }>(
    `SELECT stratum, count(*)::int AS total, count(used_at)::int AS used, (count(*) - count(used_at))::int AS remaining
     FROM randomization_lists GROUP BY stratum ORDER BY stratum`,
    [],
    db ?? (getPgPool() as unknown as Queryable),
  );
}
