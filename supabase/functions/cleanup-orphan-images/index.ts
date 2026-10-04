// cleanup-orphan-images — 살아있는 아이템이 참조하지 않는 item-images 객체를
// 삭제하는 Edge Function (Deno, service_role). 주 1회 스케줄 호출 전제.
//
// 계약:
//   판정: DB 함수 public.list_orphan_item_images() (0003 마이그레이션)가 책임진다.
//         살아있는 키 = items.image_key(원본) ∪ 썸네일 키(_thumb.jpg, DB 미저장 파생).
//   삭제: Storage API(.remove())로만 한다 — storage.objects 행 직접 DELETE 금지(불변식 3).
//   호출: 스케줄러만. 사용자 JWT 가 아니라 비밀 헤더 x-cron-secret 으로 보호하므로
//         JWT 검증을 끈다(supabase/config.toml [functions.cleanup-orphan-images]
//         verify_jwt = false). 헤더 불일치·부재는 401.
//   dry-run(불변식 5): ?dryRun=true 면 삭제 없이 { dryRun, orphanCount, sample }만 반환.
//         첫 실행 전 반드시 이걸로 건수·샘플을 사람이 확인한 뒤 실스케줄을 건다.
//   멱등(불변식 6): .remove() 가 객체 행+바이트를 함께 지우므로 재실행 시 고아 목록이
//         비어 removed: 0 으로 끝난다. 중복 실행에 안전.
//
// 운영 메모:
//   - rpc 응답은 Data API 의 max rows(기본 1000행)에 잘린다. 고아가 그보다 많으면
//     한 번에 다 못 지우지만, 주간 재실행이 멱등이라 남은 분량은 다음 실행이 지운다.
//   - service_role 키는 Edge Function 런타임 env 로만 존재(불변식 4). 앱·커밋 금지.
//   - 시크릿 등록(사람): npx supabase secrets set CRON_SECRET=<임의 난수>
//   - 배포(사람):      npx supabase functions deploy cleanup-orphan-images

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
// RLS 우회 — Edge Function 런타임이 자동 주입(수동 등록 불필요), 여기에만 존재(불변식 4)
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

// .remove() 한 번에 넘기는 키 수. 요청 크기·부분 실패 영향 범위를 줄인다.
const REMOVE_BATCH_SIZE = 100;
// dry-run 응답에 포함할 샘플 키 수(사람이 눈으로 썸네일 오탐을 검증 — 불변식 2).
const DRY_RUN_SAMPLE = 20;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CRON_SECRET) {
    // CRON_SECRET 미등록 포함 — 설정이 덜 된 채로는 아무것도 지우지 않는다.
    return json({ error: 'server_misconfigured' }, 500);
  }

  // 공개 호출 방지: 스케줄러만 아는 비밀 헤더를 요구한다.
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === 'true';

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1) 고아 키 열거 — 썸네일 포함 판정은 DB 함수가 책임진다(불변식 2).
  const { data: orphans, error } = await supabase.rpc('list_orphan_item_images');
  if (error) return json({ error: error.message }, 500);

  // setof text 는 보통 string[] 로 오지만, 행 객체 형태도 방어적으로 흡수한다.
  const keys = (Array.isArray(orphans) ? orphans : [])
    .map((row: unknown) =>
      typeof row === 'string' ? row : (row as { name?: unknown } | null)?.name,
    )
    .filter((k: unknown): k is string => typeof k === 'string' && k.length > 0);

  // 관측용: 키 목록(사용자 uid 포함)은 dry-run 응답에만 담고, 로그엔 건수만 남긴다.
  console.log(`cleanup-orphan-images: dryRun=${dryRun} orphanCount=${keys.length}`);

  if (dryRun) {
    return json({ dryRun: true, orphanCount: keys.length, sample: keys.slice(0, DRY_RUN_SAMPLE) });
  }

  // 2) Storage API 로만 삭제(불변식 3). 배치로 끊어 실행한다.
  let removed = 0;
  for (let i = 0; i < keys.length; i += REMOVE_BATCH_SIZE) {
    const batch = keys.slice(i, i + REMOVE_BATCH_SIZE);
    const { error: rmErr } = await supabase.storage.from('item-images').remove(batch);
    if (rmErr) {
      // 부분 실패: 여기까지 지운 건수와 함께 실패를 알린다(다음 실행이 이어서 지움 — 멱등).
      return json({ removed, error: rmErr.message }, 500);
    }
    removed += batch.length;
  }
  return json({ removed });
});
