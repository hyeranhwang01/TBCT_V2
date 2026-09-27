# 로컬 개발 환경 · Vercel 연동 · 푸시 범위 가드

> **Part A~C 는 Claude Code가 1회 수행**한다.
> **Part D~F 는 조민수님이 매일 쓰는 명령어**다.
> 이 파일 자체는 **git에 푸시되지 않는다** (Part C-2에서 exclude 처리).

---

# Part A. 환경 파악 (Claude Code 수행)

수정 전에 저장소 상태를 먼저 확인한다. 결과를 표로 보고할 것.

```bash
# 프레임워크 · 스크립트 · 패키지 매니저
cat package.json | sed -n '1,60p'
ls -1 | grep -E 'pnpm-lock.yaml|yarn.lock|package-lock.json|bun.lockb'
cat .nvmrc 2>/dev/null; node -v

# Next.js 여부 / 설정
ls -1 next.config.* vercel.json 2>/dev/null

# 대상 6개 파일의 실제 경로 확정
git ls-files | grep -E '(protocol/sessions/s0[123]\.ts|static-messages/s0[123]\.ts)'

# git 상태
git branch --show-current
git remote -v
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null   # 기본 브랜치(main/master)
git status --porcelain
```

**확인 결과 보고 항목**

| 항목 | 값 |
| --- | --- |
| 패키지 매니저 | pnpm / npm / yarn / bun |
| Node 버전 요구 | |
| dev / build / typecheck / lint / test 스크립트 | |
| 대상 6개 파일 실제 경로 | |
| origin 기본 브랜치 | main / master |
| working tree 청결 여부 | |

> 이하 명령의 `pnpm` 은 확인된 패키지 매니저로 치환한다.

---

# Part B. 로컬 실행 셋업 (Claude Code 수행, 1회)

## B-1. 의존성 설치

```bash
corepack enable            # pnpm/yarn 사용 시
pnpm install               # npm이면: npm ci
```

## B-2. Vercel CLI 연결 + 환경변수 내려받기

Vercel에 연동된 프로젝트이므로, 환경변수는 **대시보드에서 직접 복사하지 말고 CLI로 내려받는다.**

```bash
npm i -g vercel
vercel login               # 브라우저 인증
vercel link                # 이 디렉터리를 Vercel 프로젝트에 연결 → .vercel/ 생성
vercel env pull .env.local # Development 환경변수를 .env.local 로
```

- `.vercel/` 과 `.env.local` 은 **절대 커밋되지 않아야 한다** → Part C-2에서 exclude 처리
- `vercel env pull` 이 실패하면(권한 없음 등) 조민수님께 **어떤 환경변수 키가 필요한지 목록만** 보고하고 값을 요청할 것

## B-3. 첫 실행 확인

```bash
pnpm dev
```

`http://localhost:3000` 접속 → S01 세션 진입까지 되는지 확인하고 보고.
포트가 다르면 실제 포트를 보고할 것.

## B-4. 빌드 파이프라인 확인 (Vercel 빌드 사전 재현)

```bash
pnpm typecheck || npx tsc --noEmit
pnpm lint
pnpm build
```

**세 가지가 전부 통과하는 상태를 baseline으로 기록**한다. 수정 후 같은 명령이 통과해야 한다.

---

# Part C. 푸시 범위 가드 (Claude Code 수행, 1회) — **핵심**

목표: **아래 6개 파일 외에는 어떤 것도 푸시되지 않는다.**

```
protocol/sessions/s01.ts
protocol/sessions/s02.ts
protocol/sessions/s03.ts
runtime/static-messages/s01.ts
runtime/static-messages/s02.ts
runtime/static-messages/s03.ts
```

> `.gitignore` 는 **수정하지 마라**. 수정하면 그 자체가 7번째 푸시 파일이 된다.
> 대신 `.git/info/exclude`(로컬 전용 무시 목록)와 `.git/hooks/`(로컬 전용 훅)를 쓴다. 둘 다 **커밋 대상이 아니다.**

## C-1. 작업 브랜치 생성

```bash
git switch -c feat/tbct-s01-s03-fidelity-v3
git rev-parse HEAD > /tmp/tbct-baseline-sha.txt   # Phase 0 baseline
```

## C-2. 로컬 전용 제외 목록

```bash
cat >> .git/info/exclude <<'EOF'

# --- TBCT Phase 1 로컬 전용 (커밋 금지) ---
/docs/LOCAL_DEV_SETUP.md
/docs/TBCT_S01-S03_고도화_기획안_v3.md
/docs/CLAUDE_CODE_개발요청.md
/.env.local
/.env*.local
/.vercel/
/scratch/
/baseline/
/*.local.*
/tbct-*.log
EOF
```

이미 tracked 상태인 파일에는 exclude가 듣지 않는다. 그런 경우:

```bash
git rm --cached <파일>     # 워킹 트리는 유지, 추적만 해제
```

→ 단 이 작업 자체가 커밋에 포함되므로, 해당 상황이면 **먼저 물어볼 것.**

## C-3. pre-commit 훅 — 허용 목록 밖 스테이징 차단

```bash
cat > .git/hooks/pre-commit <<'HOOK'
#!/usr/bin/env bash
set -uo pipefail

ALLOW=(
  "*protocol/sessions/s01.ts"
  "*protocol/sessions/s02.ts"
  "*protocol/sessions/s03.ts"
  "*runtime/static-messages/s01.ts"
  "*runtime/static-messages/s02.ts"
  "*runtime/static-messages/s03.ts"
)

bad=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  ok=0
  for pat in "${ALLOW[@]}"; do
    case "$f" in $pat) ok=1; break;; esac
  done
  [ "$ok" -eq 0 ] && bad+=("$f")
done < <(git diff --cached --name-only --diff-filter=ACMRD)

if [ ${#bad[@]} -gt 0 ]; then
  echo ""
  echo "  [TBCT scope guard] 허용 목록 밖 파일이 스테이징되었습니다:"
  for f in "${bad[@]}"; do echo "    - $f"; done
  echo ""
  echo "  허용: protocol/sessions/s0{1,2,3}.ts, runtime/static-messages/s0{1,2,3}.ts"
  echo "  해제: git restore --staged <파일>"
  echo "  의도적 우회: ALLOW_OUTSIDE_SCOPE=1 git commit ..."
  echo ""
  [ "${ALLOW_OUTSIDE_SCOPE:-0}" = "1" ] || exit 1
  echo "  ⚠️  ALLOW_OUTSIDE_SCOPE=1 로 우회합니다."
fi
exit 0
HOOK
chmod +x .git/hooks/pre-commit
```

## C-4. pre-push 훅 — 브랜치 전체 diff 검사

pre-commit은 **이번 커밋만** 본다. 앞선 커밋에 섞여 들어간 파일은 pre-push에서 잡는다.

```bash
cat > .git/hooks/pre-push <<'HOOK'
#!/usr/bin/env bash
set -uo pipefail

BASE_REF="$(git symbolic-ref -q --short refs/remotes/origin/HEAD || echo origin/main)"
base="$(git merge-base "$BASE_REF" HEAD 2>/dev/null)" || { echo "[scope guard] base 산출 실패 — 수동 확인 필요"; exit 1; }

ALLOW=(
  "*protocol/sessions/s01.ts" "*protocol/sessions/s02.ts" "*protocol/sessions/s03.ts"
  "*runtime/static-messages/s01.ts" "*runtime/static-messages/s02.ts" "*runtime/static-messages/s03.ts"
)

bad=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  ok=0
  for pat in "${ALLOW[@]}"; do case "$f" in $pat) ok=1; break;; esac; done
  [ "$ok" -eq 0 ] && bad+=("$f")
done < <(git diff --name-only "$base"...HEAD)

if [ ${#bad[@]} -gt 0 ]; then
  echo ""
  echo "  [TBCT scope guard] 푸시 대상에 허용 목록 밖 파일이 있습니다:"
  for f in "${bad[@]}"; do echo "    - $f"; done
  echo "  푸시를 중단합니다. 커밋 이력을 정리하거나 담당자에게 확인하세요."
  echo ""
  [ "${ALLOW_OUTSIDE_SCOPE:-0}" = "1" ] || exit 1
fi
exit 0
HOOK
chmod +x .git/hooks/pre-push
```

## C-5. 설치 검증

```bash
# 일부러 허용 밖 파일을 스테이징해서 차단되는지 확인
touch scope-guard-test.txt && git add -f scope-guard-test.txt
git commit -m "guard test"     # ← 실패해야 정상
git restore --staged scope-guard-test.txt && rm scope-guard-test.txt
```

**차단되지 않으면 훅이 동작하지 않는 것이다. 보고할 것.**

---

# Part D. 푸시 전 필수 검증 (Claude Code 수행)

## D-1. 푸시 대상 확인

```bash
BASE="$(git merge-base "$(git symbolic-ref -q --short refs/remotes/origin/HEAD || echo origin/main)" HEAD)"
git diff --name-only "$BASE"...HEAD
```

출력이 **정확히 6줄**이어야 한다.

## D-2. "6개 파일만으로 Vercel 빌드가 되는가" 실증 ← **가장 중요**

로컬에는 있지만 푸시되지 않는 파일 때문에 Vercel 빌드가 깨지는 상황을 사전에 잡는다.
**커밋된 상태만** 복제해서 깨끗하게 빌드해 본다.

```bash
TMP="$(mktemp -d)"
git clone --single-branch --branch "$(git branch --show-current)" . "$TMP/verify"
cp .env.local "$TMP/verify/.env.local" 2>/dev/null || true
cd "$TMP/verify"
pnpm install --frozen-lockfile        # npm이면: npm ci
pnpm typecheck || npx tsc --noEmit
pnpm build
cd - && rm -rf "$TMP"
```

**여기서 실패하면 = 푸시하면 Vercel도 실패한다.**
실패 시 절대 임의로 파일을 추가 커밋하지 말고, **무엇이 없어서 깨지는지 + 최소 추가 파일 목록**을 정리해 조민수님께 물어볼 것 (개발요청서 STOP S-6).

## D-3. 푸시하지 않고 Vercel에서 확인하기

git push 없이 로컬 코드를 그대로 프리뷰 배포할 수 있다.

```bash
vercel                # 프리뷰 배포 (production 아님)
```

- 로컬 파일을 업로드하므로 **git 이력과 무관**하다
- 다만 이 방식은 "푸시 안 된 로컬 파일"까지 올라가므로, D-2의 깨끗한 클론 검증을 **대체하지 못한다**. 둘 다 하라.
- `vercel --prod` 는 **절대 실행하지 마라.**

---

# Part E. 조민수님 일상 명령어

## 개발 서버

```bash
pnpm dev
# → http://localhost:3000
```

Vercel의 라우팅·서버리스 함수 동작까지 재현하고 싶을 때:

```bash
vercel dev
```

> 일반적인 프론트 확인은 `pnpm dev` 로 충분하고 훨씬 빠르다.
> `vercel dev` 는 리다이렉트·rewrites·API 라우트 동작이 의심될 때만 쓴다.

## 환경변수 갱신 (대시보드에서 값이 바뀐 뒤)

```bash
vercel env pull .env.local
```

## Vercel 빌드와 동일한 검사

```bash
pnpm typecheck && pnpm lint && pnpm build
```

## 지금 무엇이 푸시되는지 확인

```bash
git diff --name-only "$(git merge-base origin/main HEAD)"...HEAD
```

→ **6줄이 아니면 푸시하지 마시고 알려주세요.**

## 캐시가 꼬였을 때

```bash
rm -rf .next node_modules/.cache && pnpm dev
```

---

# Part F. 트러블슈팅

| 증상 | 원인 / 조치 |
| --- | --- |
| `pnpm dev` 는 되는데 `pnpm build` 실패 | dev는 타입 오류를 무시하는 경우가 많다. **build 통과가 진짜 기준**이다 |
| 화면은 뜨는데 상담 문장이 이상함 | 에러가 아니라 **static-message 키 매칭 실패 → generic fallback**일 가능성. prompt ID 시프트를 의심하라 (개발요청서 §3.2) |
| 한국어 세션에 영어 문장이 섞임 | `s01.ts` 인라인 `patientText` 는 locale 대응이 없다 (v3 §7.1) |
| `vercel env pull` 권한 오류 | 프로젝트 멤버 권한 필요. 필요한 env 키 목록만 정리해 요청 |
| 훅이 동작하지 않음 | `chmod +x .git/hooks/pre-commit .git/hooks/pre-push` 확인. `core.hooksPath` 가 설정돼 있으면 그 경로에 설치해야 함 (`git config core.hooksPath`) |
| 푸시했더니 Vercel 자동 배포가 돌음 | 정상. 브랜치 푸시는 **프리뷰** 배포다. production 배포는 기본 브랜치 머지 시에만 발생 |
| 자동 배포를 잠시 막고 싶음 | Vercel 대시보드 → Settings → Git → Ignored Build Step. **`vercel.json` 을 수정하지 마라** (7번째 파일이 된다) |

---

# Part G. 절대 하지 말 것

- `.gitignore` 수정 (7번째 푸시 파일이 됨 → 필요하면 `.git/info/exclude`)
- `vercel.json` 수정 (동일)
- `vercel --prod` 실행
- `git add -A` / `git add .` — 항상 **경로를 명시**해서 add
- `git commit --no-verify` / `git push --no-verify` — 가드를 무력화한다
- 빌드가 깨진다는 이유로 6개 파일 밖 파일을 **임의로** 추가 커밋 → 반드시 먼저 질문
## Roles (2026-09-27)

Roles are read only from Supabase `app_metadata` (see `src/shared/auth/roles.ts`); `user_metadata.role` is only what a signup asked for, because users can edit it themselves. Patients get their role automatically (`/api/auth/claim-role`); a clinician signup waits until an admin approves it on the account page. An account without a granted role is refused by every API route.

Before deploying this change to an environment with existing accounts, move their roles (otherwise existing clinicians and admins are locked out and safety alerts find no clinician to email):

```
npx vite-node -c vitest.config.ts scripts/migrate-roles-to-app-metadata.ts                         # list; review the clinician/admin accounts
npx vite-node -c vitest.config.ts scripts/migrate-roles-to-app-metadata.ts --apply --grant-staff   # after review
```

Then apply `sql/031_roles_from_app_metadata.sql` (row-level security reads the same role).

## RCT backend deployment (2026-09-28)

One codebase, one Supabase project per country (KR, BR, FR), each with its own Vercel environment (`DATABASE_URL`, Supabase keys). For each country, in this order:

1. Migrations: `DATABASE_URL=... node scripts/migrate-neon.mjs` (applies only new files; exits 2 if an applied file was changed since).
2. Existing ended sessions: `DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/backfill-session-records.ts` (list), then `--apply`.
3. Study setup: `DATABASE_URL=... npx vite-node -c vitest.config.ts scripts/seed-trial.ts --country KR --apply` (draft study). Then on `/trial/monitoring` as admin: add therapists, create and freeze the AI release (model snapshot id), upload the statistician's randomization list.
4. Staff roles on the admin account page: coordinator, assessor (blinded), clinician.
5. Activate the study (`seed-trial.ts --country KR --activate --apply`). From then on AI sessions run only for allocated participants in AI arms with consent, on their frozen release.

Analysis extract (per country, then concatenate the same-named files): `scripts/export-deidentified.ts --out ./extract-KR`. Retention: `scripts/purge-retention.ts` lists studies whose lock is older than the retention period; `--apply --confirm <study code>` erases their AI data.
