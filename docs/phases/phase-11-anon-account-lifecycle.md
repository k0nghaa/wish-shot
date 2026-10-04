# Phase 11 — 익명 계정 수명주기: 빈 계정·고아 파일 정리

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**Step 1/2/3을 진행해달라**"고 요청한다. Step은 순서대로 진행하되 **Step 1(빈 계정 삭제)과 Step 2(고아 파일 스윕)는 서로 독립**이라 어느 것부터 해도 된다(권장: 비밀값이 없는 Step 1 먼저). 실제 Supabase 프로젝트(auth.users·Storage)에 대한 dry-run·스케줄 활성화는 **에이전트가 검증할 수 없으므로 사람이 대시보드에서 확인**한다.
>
> **브랜치**: 최신 `dev` 기준 `feat/phase-11-anon-lifecycle`에서 작업한다. 세션 시작 시 `git status --short --branch`로 확인하고, **release/v1.0.0 직접 작업 금지**(출시 릴리스 브랜치). 참고: 계측(Phase 10) 데이터는 DB가 아니라 PostHog(외부)에 있어 이 Phase의 삭제 작업과 상호작용이 없다 — 삭제된 익명 계정의 과거 이벤트가 PostHog에 가명 uid로 남는 것은 정상.
>
> **재빌드 없음 · 앱 변경 없음(중요)**: 이 Phase는 **전부 서버 측**이다 — Supabase 마이그레이션(pg_cron)·Edge Function·DB 함수뿐이고, **앱 코드(`src/**`)·네이티브·`app.json`은 건드리지 않는다.** 따라서 EAS 재빌드도, OTA(`eas update`)도 필요 없다. 만약 앱 변경이 필요하다고 판단되면 **즉시 멈추고 사람에게 보고**한다(그건 이 Phase 범위 밖 = 미래 "계정 연결" Phase 소관).
>
> **근거 원칙**: Supabase(pg_cron·Storage API·auth 관리)·GoTrue 판단은 **추측하지 말고** 공식 문서로 검증한 사실에 기반한다(맨 아래 "근거·출처"). 불확실하면 문서를 확인하거나 사람에게 묻는다(CLAUDE.md 규칙 6).
>
> 관련 문서: `CLAUDE.md`(현행 구조·규칙·익명 로그인), `supabase/migrations/0001_init.sql`(스키마 계약 — FK cascade·Storage 키 규칙), `docs/phases/phase-9-image-egress.md`(**썸네일 키 `{uid}/{id}_thumb.jpg` 파생 규칙 — Step 2에서 반드시 고려**).

---

## 목표 (Goal)

익명 로그인(로그인 벽 없이 즉시 사용)의 이면으로 **설치→삭제→재설치 때마다 "접근 불가능한 잔여물"이 서버에 쌓인다.** 이 Phase는 그 잔여물 중 **잃을 게 없는 것만 안전하게 자동 정리**한다. 범위는 둘:

1. **빈 익명 계정 자동 삭제** — 아이템이 하나도 없는 오래된 익명 계정을 주기적으로 삭제(→ `auth.users` 비대화 방지).
2. **고아 파일 스윕** — 살아있는 아이템이 참조하지 않는 Storage 객체를 주기적으로 삭제(→ Storage 용량·egress 누수 방지, Free 플랜 유지에 기여).

둘 다 **데이터가 있는 계정·살아있는 파일은 절대 건드리지 않는다.** "재설치해도 데이터 유지"(돌아온 사용자 복원)는 이 Phase의 목표가 **아니다** — 그건 아래 "하지 않는 것"의 계정 연결(linkIdentity)이 유일한 해법이고, 미래 네이티브 Phase 소관이다.

### 왜 고아가 생기나 (구현 전 반드시 이해)

익명 세션 토큰은 앱의 AsyncStorage에 저장된다. **iOS는 앱을 삭제하면 앱 샌드박스(AsyncStorage 포함)를 통째로 지운다.** 그래서 재설치하면:

```
재설치 → 세션 없음 → signInAnonymouslyIfNeeded() → 완전히 새로운 auth.uid() 발급(옛 uid 복구 불가)
```

RLS는 `user_id = auth.uid()`로 행을 거르므로, 새 uid로는 옛 uid의 데이터가 **아예 안 보인다.** 서버엔 그대로 남지만 아무도 접근 못 하는 상태다. 세 종류로 쌓인다:

| 종류 | 정체 | 재설치만으로 정리되나? |
|---|---|---|
| **고아 유저** | `auth.users`에 남은, 로그인 불가능한 옛 익명 계정 | ❌ 계속 쌓임 |
| **고아 행(row)** | 그 유저의 `categories`/`items`/`analysis_logs` | ❌ (유저를 지워야만 cascade) |
| **고아 파일** | Storage `item-images/{옛uid}/*.jpg`·`*_thumb.jpg` | ❌ (cascade 대상 아님) |

> **핵심 오해 포인트**: `0001_init.sql`의 `user_id ... on delete cascade`는 **"auth 유저를 삭제할 때"** 행이 따라 지워진다는 뜻일 뿐이다. **재설치 자체는 옛 유저를 지우지 않으므로 cascade는 영영 안 터진다.** 그래서 누가(= 이 Phase의 cron이) 옛 유저를 지워주기 전까지는 전부 그대로 남는다. 그리고 **Storage는 cascade 대상이 아니라서 유저를 지워도 파일 바이트는 안 지워진다** → 파일은 Step 2가 따로 쓸어야 한다.

---

## 이 Phase에서 하지 않는 것 (→ 미래 네이티브 Phase)

- **계정 연결(Apple/이메일 linkIdentity)·인앱 넛지** — 익명 계정에 영구 신원을 붙여 **재설치해도 데이터가 유지**되게 하는 유일하게 견고한 방법. 네이티브(Sign in with Apple)·앱 UI가 필요하므로 별도 Phase.
- **"미연결 계정 전환 유도 후 삭제" 정책** — 연결 기능이 생긴 뒤에야 의미가 있다. 그때도 트리거는 단순 타이머가 아니라 **(미연결) AND (넛지를 본 적 있음 = 기능 출시 후 1회 이상 앱 실행) AND (장기 비활성 6개월+)** 세 조건을 모두 만족할 때만이어야 한다 — 익명 계정엔 연락 수단이 없어 "앱을 연 사람"에게만 공지가 닿기 때문(공지에 의존한 캘린더 삭제는 정작 휴면 유저에게 안 닿아 불공정).
  - 그 정책을 켤 때 필요한 신호(지금은 **불필요**): 앱 열 때 `last_seen_at` 갱신 + "넛지 노출/dismiss" 플래그. **이 Phase에서는 심지 않는다**(빈 계정 삭제는 `created_at` + "아이템 없음"만으로 판정하므로).
- **왜 지금 "데이터 있는 계정"을 안 지우나**: Phase 9에서 원본 1600px·썸네일 400px로 **유저당 용량이 이미 작다.** 비용 압박으로 데이터 있는 계정을 지울 이유가 거의 없다 → 데이터 있는 계정은 **보존**하고, 빈 계정·고아 파일만 정리하는 것으로 충분하다.

---

## 승인된 범위 (사람이 확정한 값 — 임의 변경 금지)

| Step | 내용 | 확정값 |
|---|---|---|
| **1** | 빈 익명 계정 삭제 (pg_cron) | `is_anonymous = true` **AND** `created_at < now() - 30일` **AND** `items` 0건. 주기 **주 1회**. |
| **2** | 고아 파일 스윕 (Edge Function + DB 함수) | `item-images` 객체 중 **살아있는 키 집합 = {`items.image_key`} ∪ {그 썸네일 키}** 밖의 객체를 삭제. 파일 삭제는 **Storage API로만**. 주기 **주 1회**. |
| 3 | 문서 동기화 | CLAUDE.md·README·이 문서 결과 기록 |

> **"빈"의 정의**: 기본은 **"아이템 0건"**(아이템 = 실제 저장한 제품·사진 = 보존 가치). 카테고리만 있고 아이템이 없는 계정은 라벨뿐이고 어차피 cascade로 지워지므로 함께 삭제한다. 더 보수적으로 가려면 "아이템 0 **AND** 카테고리 0"으로 조일 수 있다(미결 사항 참고) — 둘 다 안전하다.
> **30일 근거**: 빈 계정의 대기 기간은 **데이터를 보호하는 게 아니다**(보호할 데이터가 없다). 창의 유일한 목적은 "정말 버려진 게 맞는지 확신할 여유"일 뿐이다. 30일 지난 빈 계정으로 다시 접속해도 `signInAnonymouslyIfNeeded`가 새 익명 세션을 투명하게 만들어 **사용자는 아무것도 잃지 않는다**(데이터가 없으므로). 그래서 90일은 과하고 30일이면 충분하다(더 짧아도 방어 가능하나 30일을 깔끔한 기본값으로 둔다). 긴 창(6개월+)은 미래 "데이터 있는 미연결 계정" 정책용으로 아껴둔다.

---

## 정확성 불변식 (Invariants) — 반드시 성립 (각 Step DoD에 반영)

이 Phase는 **파괴적(삭제) 작업**이다. 하나라도 어기면 사용자 데이터를 잃을 수 있다.

1. **데이터 있는 계정을 절대 삭제하지 않는다.** 삭제 조건에 `and not exists (select 1 from public.items i where i.user_id = u.id)`가 **반드시** 들어간다. 조건 누락 = 전 사용자 데이터 삭제 사고.
2. **(⚠️ 가장 치명적) 살아있는 아이템의 파일을 절대 삭제하지 않는다 — 썸네일 키를 포함해서.** Phase 9의 썸네일 키 `{uid}/{id}_thumb.jpg`는 **DB에 저장되지 않는 파생 키**다. 그래서 "`items.image_key`에 없는 객체 = 고아"로 단순 판정하면 **모든 썸네일이 고아로 오인돼 전부 삭제**된다. 살아있는 키 집합은 반드시 **원본 키 ∪ 썸네일 키**여야 한다(Step 2의 DB 함수가 `union`으로 구성).
3. **파일 삭제는 Storage API(`.remove()`)로만 한다. `storage.objects` 행을 SQL로 직접 `DELETE`하지 않는다.** 행만 지우면 메타데이터는 사라지지만 **S3의 실제 파일 바이트가 남아** 오히려 더 추적 불가능한 고아가 된다. (열거/판정은 SQL로 해도 되지만, 삭제는 API로.)
4. **`service_role` 키는 Edge Function 환경에만 존재한다.** 앱·커밋·채팅에 절대 넣지 않는다(CLAUDE.md 규칙 2). Edge Function은 `SUPABASE_SERVICE_ROLE_KEY`를 런타임 env에서 자동으로 받는다(수동 등록 불필요).
5. **먼저 dry-run한다.** 실삭제 전에 "몇 개가 지워질지"를 카운트/로그만 하는 모드로 돌려 사람이 눈으로 확인한 뒤 활성화한다. 특히 Step 2는 **첫 실행 때 과거에 쌓인 고아를 한꺼번에 지우므로** dry-run 결과(건수·샘플 키)를 반드시 검토한다.
6. **멱등·안전 재실행.** cron이 중복 실행되거나 수동 재실행돼도 깨지지 않는다(이미 지운 건 넘어감).
7. **DB 스키마·앱 불변.** 테이블/컬럼/RLS/정규화/Storage 정책을 바꾸지 않는다. 추가되는 것은 **cron 잡 1개 + DB 함수 1개 + Edge Function 1개**뿐. 앱 코드 변경 0.

---

## Step 1 — 빈 익명 계정 삭제 (pg_cron)

**대상**: 신규 `supabase/migrations/0002_cleanup_anon_users.sql`.

**배경**: pg_cron은 Postgres 안에서 SQL을 주기 실행하는 확장이다. Supabase에서 활성화하면 `cron.schedule(...)`로 잡을 등록한다. 이 Step은 **비밀값·외부 호출이 전혀 없다**(순수 SQL) — 그래서 먼저 한다.

**작업**:
1. 마이그레이션 파일에 pg_cron 활성화:
   ```sql
   create extension if not exists pg_cron;
   ```
2. **먼저 dry-run(불변식 5)**: 스케줄 등록 전에, SQL Editor에서 **삭제 대신 조회**로 대상 건수를 확인한다.
   ```sql
   -- 몇 명이, 정말로 비어 있는지 눈으로 확인 (삭제 아님)
   select count(*) as to_delete
   from auth.users u
   where u.is_anonymous = true
     and u.created_at < now() - interval '30 days'
     and not exists (select 1 from public.items i where i.user_id = u.id);
   ```
3. 주 1회 삭제 잡 등록(일요일 03:00 UTC 예시 — 트래픽 적은 시간대):
   ```sql
   select cron.schedule(
     'delete-empty-anon-users',
     '0 3 * * 0',
     $$
       delete from auth.users u
       where u.is_anonymous = true
         and u.created_at < now() - interval '30 days'
         and not exists (select 1 from public.items i where i.user_id = u.id)
     $$
   );
   ```
   - 재등록(스케줄·조건 변경) 시: `select cron.unschedule('delete-empty-anon-users');` 후 다시 `cron.schedule`.
4. **cascade 확인(불변식 2 아님, 여기선 "제대로 지워지는지")**: `auth.users` 행을 지우면 FK로 `public.categories/items/analysis_logs`가 cascade 삭제된다(`0001_init.sql:30,45,79` 확인). GoTrue 내부 테이블(`auth.identities`·`auth.sessions`·`auth.refresh_tokens` 등)도 각자의 `on delete cascade`로 따라 지워지는지 **dry-run으로 1건 삭제 후 확인**한다. (이 파일 집합은 Storage는 포함하지 않는다 → 파일은 Step 2.)

**설계 메모(구현 세션이 판단)**:
- **삭제 방식**: 기본은 위처럼 **pg_cron에서 raw `DELETE FROM auth.users`**(간단·비밀값 없음, FK cascade로 정리). 만약 GoTrue 내부 정리(세션 무효화 등)가 raw delete로 불완전하다고 판단되면, 대안으로 **`auth.admin.deleteUser()`를 호출하는 Edge Function**을 pg_net/대시보드 Cron으로 돌리는 방식이 있다. **먼저 raw delete의 cascade 범위를 공식 문서/실측으로 확인하고**, 불완전하면 사람에게 보고 후 admin API로 전환한다(추측 금지).
- **권한**: `auth` 스키마 삭제는 권한이 필요하다. 대시보드 **SQL Editor(= `postgres` 롤)**에서 스케줄을 등록하면 잡이 그 권한 맥락으로 실행된다. 권한 오류가 나면 잡 실행 롤을 확인한다(추측 말고 문서 확인).

**적용**: `0001`과 동일하게 **대시보드 SQL Editor에 붙여넣어 적용**한다(또는 `supabase db push`). 마이그레이션 파일은 재현/계약용으로 커밋한다.

**DoD**
- [ ] dry-run 카운트가 **합리적**이다(전체 익명 유저 대비 "오래되고 빈" 일부만). 아이템이 있는 계정은 한 건도 포함되지 않음(사람 확인).
- [ ] 수동 1회 실행(또는 1건 타깃 삭제) 시 해당 유저의 `categories/items/analysis_logs`가 cascade로 사라지고, 다른 유저 데이터는 불변.
- [ ] `cron.job`에 잡이 등록되고 다음 실행 시각이 잡힘. 마이그레이션 파일 커밋.

---

## Step 2 — 고아 파일 스윕 (DB 함수 + Edge Function)

**대상**: 신규 `supabase/migrations/0003_orphan_images_fn.sql`(고아 키 열거 함수), 신규 `supabase/functions/cleanup-orphan-images/index.ts`(Deno, service_role).

**왜 Edge Function인가**: 불변식 3 — 파일 바이트는 **Storage API로만** 안전하게 지워진다. 열거/판정은 SQL이 쉽고(아래 함수), 실제 삭제는 service_role 클라이언트의 `.remove()`로 한다. 이 둘을 Edge Function이 잇는다.

**작업 1 — DB 함수(고아 키 열거, 썸네일 포함)**: `0003_orphan_images_fn.sql`
```sql
-- item-images 버킷에서 "살아있는 아이템이 참조하지 않는" 객체 키를 돌려준다.
-- 살아있는 키 = items.image_key(원본) ∪ 그 썸네일 키(_thumb.jpg, DB 미저장 파생).
-- ⚠️ 썸네일 키를 union 하지 않으면 모든 썸네일이 고아로 오인돼 삭제된다(불변식 2).
create or replace function public.list_orphan_item_images()
returns setof text
language sql
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'item-images'
    and o.name not in (
      select image_key from public.items
      union all
      -- Phase 9: thumbKeyFromImageKey = imageKey.replace(/\.jpg$/i, '_thumb.jpg')
      select regexp_replace(image_key, '\.jpg$', '_thumb.jpg', 'i') from public.items
    )
$$;

-- service_role(Edge Function)만 호출. anon/authenticated엔 노출 금지.
revoke all on function public.list_orphan_item_images() from public, anon, authenticated;
grant execute on function public.list_orphan_item_images() to service_role;
```
- `security definer` + `search_path` 고정: 함수가 소유자(postgres) 권한으로 `storage.objects`를 읽게 한다(일반 롤은 storage 스키마 접근 불가).
- **첫 실행 전 dry-run**: SQL Editor에서 `select count(*), (select array_agg(x) from (select * from public.list_orphan_item_images() limit 20) x) as sample;` 로 **건수와 샘플 키**를 확인한다. 샘플에 `_thumb.jpg`가 **살아있는 아이템 것**으로 섞여 있지 않은지 반드시 눈으로 본다(불변식 2 검증).

**작업 2 — Edge Function(삭제 실행)**: `supabase/functions/cleanup-orphan-images/index.ts`
```ts
import { createClient } from 'npm:@supabase/supabase-js@2';

// Edge Function 런타임이 자동 주입하는 env (수동 등록 불필요)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,   // RLS 우회 — Edge Function 환경에만 존재(불변식 4)
);

Deno.serve(async (req) => {
  // 공개 호출 방지: 스케줄러만 아는 비밀 헤더를 요구한다(아래 스케줄링 메모).
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('unauthorized', { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';   // 불변식 5

  // 1) 고아 키 열거(썸네일 포함 판정은 DB 함수가 책임)
  const { data: orphans, error } = await supabase.rpc('list_orphan_item_images');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const keys: string[] = (orphans ?? []).map((r: any) => (typeof r === 'string' ? r : r.name));

  if (dryRun) {
    return Response.json({ dryRun: true, orphanCount: keys.length, sample: keys.slice(0, 20) });
  }

  // 2) Storage API로만 삭제(불변식 3). 배치로 끊어서(remove 입력 상한·안전).
  let removed = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const { error: rmErr } = await supabase.storage.from('item-images').remove(batch);
    if (rmErr) return Response.json({ removed, error: rmErr.message }, { status: 500 });
    removed += batch.length;
  }
  return Response.json({ removed });
});
```
- 배포: `npx supabase functions deploy cleanup-orphan-images`. 시크릿: `npx supabase secrets set CRON_SECRET=<임의 난수>` (service_role은 자동 주입이라 등록 불필요).
- **JWT 검증**: 이 함수는 사용자 JWT가 아니라 `x-cron-secret`으로 보호하므로, 배포 시 JWT 검증을 끄고(`--no-verify-jwt` 또는 함수 설정) 비밀 헤더로만 막는다. 설정 방법은 Supabase 문서 확인(추측 금지).

**작업 3 — 스케줄링(주 1회)**: 다음 중 하나. **먼저 dryRun=true로 수동 호출해 건수를 확인(불변식 5)한 뒤** 실행 스케줄을 건다.
- **(권장·간단) Supabase 대시보드 Cron**으로 이 Edge Function을 주 1회 호출하도록 등록(헤더에 `x-cron-secret` 포함). 외부 비밀 배선이 가장 적다.
- **(대안·SQL 커밋) pg_cron + pg_net**으로 함수 URL을 `net.http_post`로 호출. 이때 `CRON_SECRET`·함수 URL은 **Supabase Vault**에 넣고 잡에서 읽는다(평문 커밋 금지). 배선이 복잡하니 대시보드 Cron으로 충분하면 그걸 쓴다.

**DoD**
- [ ] `list_orphan_item_images()` dry-run: 건수·샘플이 합리적이고, **살아있는 아이템의 원본/썸네일이 샘플에 없음**(불변식 2, 사람 확인).
- [ ] Edge Function `?dryRun=true` 응답의 `orphanCount`가 위 SQL과 일치.
- [ ] 비밀 헤더 없이 호출 시 401.
- [ ] 실삭제 1회 후, 임의의 살아있는 아이템이 **그리드(썸네일)·상세(원본) 모두 정상 표시**(살아있는 파일 미삭제). 지워진 키는 접근 시 사라짐.
- [ ] 재실행 시 `removed: 0`(멱등, 불변식 6).

---

## Step 3 — 문서 동기화 (완료 시 같은 커밋)

- **`CLAUDE.md`** — "데이터 레이어 · Supabase 접근" 또는 인증 섹션에 **"익명 계정 수명주기"** 한 단락 신설: (1) 빈 익명 계정(아이템 0·30일+)은 주 1회 pg_cron으로 삭제 → cascade로 행 정리, (2) 고아 Storage 객체(살아있는 `image_key`∪썸네일 키 밖)는 주 1회 Edge Function이 Storage API로 스윕, (3) **"재설치 시 데이터 미보존"**은 의도된 동작이며 복원은 미래 계정 연결(Apple/이메일) Phase 소관.
- **`README.md`** — 데이터/프라이버시·운영 설명이 있으면 위 사실 반영(없으면 생략).
- **(선택) `docs/legal/privacy.html`** — 현행 방침의 **§6 "보관 및 삭제"**(2026-10-03 개정본)에 "비활성 빈 익명 계정·미참조 이미지를 주기적으로 삭제한다"는 취지를 추가(법무 문구는 사람 검토). 수정 시 **노션 방침 페이지도 함께 갱신**한다 — 2026-10-03에 privacy.html 전체와 동기화된 상태라 어긋나게 두지 말 것.
- **이 문서의 "결과 기록"** 갱신.
- 커밋: `feat: 빈 익명 계정 정리 cron` / `feat: 고아 이미지 스윕 함수+Edge Function` / `docs: 익명 계정 수명주기 문서화`, `dev`로 PR(`.github/pull_request_template.md` 구조 준수).

---

## 검증 (Verification)

**에이전트**:
- 마이그레이션 SQL·DB 함수 문법 점검, Edge Function `deno check`(가능 시)·로직 리뷰.
- 불변식 1~7 자체 점검 — 특히 **(2) 썸네일 키 union 누락 여부**, (1) `not exists items` 조건 존재, (3) 삭제가 Storage API 경유인지, (4) service_role이 커밋/앱에 노출 안 됐는지.
- `npx tsc --noEmit`·`npx expo lint`는 앱 코드 무변경이라 영향 없음(그래도 1회 돌려 회귀 0 확인).

**사람(실 프로젝트 — 에이전트가 못 하는 것)**:
- [ ] Step 1 dry-run 카운트 검토 → 수동 1건 삭제로 cascade(+GoTrue 내부) 확인 → 주간 잡 활성화.
- [ ] Step 2 `list_orphan_item_images()` dry-run 샘플에 **살아있는 썸네일/원본이 없음** 확인 → Edge Function dryRun 확인 → 실삭제 1회 → 살아있는 아이템 표시 정상 → 주간 잡 활성화.
- [ ] 1~2주 후 `auth.users` 익명 계정 수·Storage 객체 수·Egress가 **급증 없이 안정/감소**하는지 확인.

---

## 미결 사항 (구현 중 결정)

- **"빈"의 정의**: "아이템 0"만(기본) vs "아이템 0 AND 카테고리 0"(더 보수적). 둘 다 안전 — 기본 권장, 더 조이고 싶으면 후자.
- **30일 / 주 1회**: 트래픽·누적량 보고 조정 가능(값만 바꾸면 됨). 빈 계정이라 더 짧게도 가능.
- **삭제 방식(Step 1)**: raw `DELETE`(기본) vs `auth.admin.deleteUser` Edge Function(GoTrue 내부 정리가 raw로 불완전할 때). dry-run 실측 후 결정.
- **스케줄링(Step 2)**: 대시보드 Cron(권장) vs pg_cron+pg_net+Vault.
- **(범위 밖 확인만)** 등록 중 "이미지 업로드 성공 후 `items` INSERT 실패"도 고아 원인이다 — 지금은 Step 2 스윕이 사후 정리하므로 충분. 업로드-INSERT를 트랜잭션처럼 묶는 앱 변경은 **이 Phase 밖**(필요성 생기면 별도 과제).

---

## 근거·출처 (구현 전 확인 권장)

- Supabase 익명 로그인(익명 유저 특성·`is_anonymous`·정리 권고): https://supabase.com/docs/guides/auth/auth-anonymous
- Supabase 유저 삭제/관리(`auth.admin.deleteUser`): https://supabase.com/docs/reference/javascript/auth-admin-deleteuser
- pg_cron(스케줄 잡): https://supabase.com/docs/guides/database/extensions/pg_cron
- Supabase Cron(Edge Function/SQL 주기 실행): https://supabase.com/docs/guides/cron
- Storage `remove`(API로 삭제 — 행+바이트): https://supabase.com/docs/reference/javascript/storage-from-remove
- Edge Functions 환경변수(`SUPABASE_SERVICE_ROLE_KEY` 자동 주입)·시크릿·`--no-verify-jwt`: https://supabase.com/docs/guides/functions/secrets
- pg_net(SQL에서 HTTP 호출) · Vault(시크릿 보관): https://supabase.com/docs/guides/database/extensions/pg_net

> 위 API·플랜 제약·권한 모델이 현재와 다르면 **추측하지 말고** 문서 최신본을 따르거나 사람에게 보고한다(CLAUDE.md 규칙 6).

---

## 결과 기록 (구현 세션이 채움)

- **완료일**: 2026-10-04 (코드·문서 작성 + 실제 Supabase 적용·주간 잡 활성화까지 완료. 남은 확인: 첫 자동 실행 이력·1~2주 추이)
- **Step 1(빈 계정 삭제)**: `supabase/migrations/0002_cleanup_anon_users.sql` / dry-run 카운트(2026-10-04 실측): 익명 16 · 30일+ 0 · **to_delete 0**(익명 로그인 도입이 최근이라 전부 30일 미만 — 합리적) / 조건: 빈 = **아이템 0건**(기본 정의 채택)·30일·주 1회(**토 18:00 UTC = 한국 일 03:00** — 지시서 예시 '일 03:00 UTC'는 KST 정오라 심야로 조정, `cron.alter_job`) / 삭제 방식: **raw `DELETE FROM auth.users`** 확정 / GoTrue cascade 확인(2026-10-04, 빈 익명 1건 타깃 삭제 실측): `sessions` 1→0 · `refresh_tokens` 1→0 · `auth.users` 행 삭제 · 타 유저(`all_items`) 불변 — `identities`는 익명 계정엔 행이 원래 없어 해당 없음 → **raw DELETE 완전, admin API 전환 불필요**
- **Step 2(고아 파일 스윕)**: `supabase/migrations/0003_orphan_images_fn.sql`(`list_orphan_item_images`, security definer, service_role 전용) + `supabase/functions/cleanup-orphan-images/index.ts`(x-cron-secret 보호·dryRun·배치 100 remove) / 첫 dry-run(2026-10-04): **orphan_count 0**(깨끗한 상태 — 스윕은 안전망으로 상시 가동) / 기능 검증: 비밀 헤더 없이 **401** · dryRun 응답 0 = SQL 건수 일치 · 실삭제 `removed: 0` · 재실행 멱등 · 앱 그리드/상세 표시 정상 / 스케줄링: **대시보드 Cron 등록 완료** — 잡 `cleanup-orphan-images-weekly`, `30 18 * * 6`(한국 일 03:30, Step 1 잡 30분 뒤), POST, timeout 5000ms(대시보드 상한), `x-cron-secret` 헤더 포함
- **Step 3(문서)**: CLAUDE.md(문서 목록·디렉터리 구조·명령어·데이터 레이어에 "익명 계정 수명주기" 단락)·README("익명 계정·고아 파일 정리" 섹션 + DB 섹션·문서 링크) 반영 / `privacy.html` §6은 **미수정** — 법무 문구 사람 검토 + 노션 방침 페이지 동시 갱신이 필요해 사람에게 넘김(선택 항목)
- **검증(사람)**: 활성화 2026-10-04(두 잡 `active=true` 확인) / 남은 것: 첫 자동 실행 이력(한국 일요일 새벽 후 `cron.job_run_details`·함수 Logs) · 1~2주 후 auth.users·Storage·Egress 추이
- **특이사항·결정**: ① JWT 검증 해제는 `supabase/config.toml`의 `[functions.cleanup-orphan-images] verify_jwt = false`로 선언(공식 문서 확인 — deploy 시 적용, 플래그 기억 불필요). ② pg_cron은 동일 이름 `cron.schedule` upsert를 문서상 보장하지 않아, 등록 전 `cron.job` 존재 확인 후 조건부 `unschedule`로 멱등 처리. ③ pg_cron 잡은 "등록한 롤의 권한"으로 실행됨(공식 README 확인) → SQL Editor(postgres)에서 등록해야 auth.users 삭제 권한 확보. ④ rpc 열거는 Data API max rows(기본 1000행)에 잘릴 수 있음 — 고아가 그보다 많아도 주간 재실행이 멱등이라 수렴(코드 주석에 명시). ⑤ 두 잡 스케줄을 한국 심야(토 18:00/18:30 UTC = 일 03:00/03:30 KST)로 조정 — 지시서 예시 03:00 UTC는 KST 정오(활동 시간대)라 "저트래픽" 의도와 어긋났고, 업로드~INSERT 사이 짧은 틈에 스윕이 겹칠 이론상 가능성도 제거. 순서가 어긋나도 멱등이라 안전하며 30분 간격은 같은 날 청소용 최적화일 뿐.
- **다음으로 넘길 것**: 계정 연결(Apple/이메일 linkIdentity)·넛지·"미연결 전환유도 후 삭제" 정책(별도 네이티브 Phase).
