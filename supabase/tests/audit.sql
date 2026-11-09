-- =============================================================================
-- RLS·GRANT·함수 권한·Storage 정책 점검 SQL — 읽기만(select 한 문장)
-- 실행: Supabase 대시보드 SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행한다.
--       결과는 표 하나(check_id·target·item·value)로 나온다 → 표 전체를 복사해 전달.
--       (SQL Editor 는 여러 문장을 넣으면 마지막 결과만 보여 주므로 한 문장으로 묶었다.)
-- 출력: 구조 정보(권한·정책·설정)와 집계(개수·크기)만 나온다. 사용자 내용·식별자는 나오지 않는다.
-- 판정: 이 파일에는 적지 않는다. 결과를 점검표(A~D·F, E2 참고)와 대조한다.
-- 범위: public·ops 스키마, storage 버킷·정책. Data API 노출 스키마 목록(C1)은 대시보드에서 따로 본다.
-- =============================================================================

with
-- 점검에 쓰는 롤
api_roles(role_name, ord) as (
  values ('anon', 1), ('authenticated', 2), ('service_role', 3)
),
table_privs(priv, ord) as (
  values ('SELECT', 1), ('INSERT', 2), ('UPDATE', 3), ('DELETE', 4),
         ('TRUNCATE', 5), ('REFERENCES', 6), ('TRIGGER', 7)
),
-- public·ops 의 테이블·뷰
rels as (
  select c.oid, n.nspname as schema_name, c.relname,
         format('%I.%I', n.nspname, c.relname) as qname,
         c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.reloptions
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'ops')
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
-- public·ops 의 함수(확장이 만든 함수는 ext 에 확장 이름)
funcs as (
  select p.oid, n.nspname as schema_name,
         format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig,
         p.prosecdef, p.proconfig, p.proacl, pg_get_userbyid(p.proowner) as owner,
         p.prorettype = 'trigger'::regtype as is_trigger,
         (select e.extname
            from pg_depend d
            join pg_extension e on e.oid = d.refobjid
           where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
           limit 1) as ext
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'ops')
),
-- 표의 행
report(sort1, sort2, check_id, target, item, value) as (

  -- ── A1. public 테이블·뷰의 RLS (ops 는 C1) ──────────────────────────────────
  select 10, r.qname, 'A1', r.qname, 'rls',
         format('kind=%s enabled=%s forced=%s',
                case r.relkind when 'r' then 'table' when 'p' then 'partitioned' when 'v' then 'view'
                               when 'm' then 'matview' when 'f' then 'foreign' end,
                r.relrowsecurity, r.relforcerowsecurity)
         || case when r.relkind in ('v', 'm')
                 then ' options=' || coalesce(array_to_string(r.reloptions, ','), '(없음)')
                 else '' end
  from rels r
  where r.schema_name = 'public'

  -- ── A2. public 테이블 정책: 테이블별 명령 요약 + 정책 하나씩 ─────────────────
  union all
  select 20, r.qname || ' 0', 'A2', r.qname, 'policy_cmds',
         coalesce((select string_agg(distinct pp.cmd, ',' order by pp.cmd)
                     from pg_policies pp
                    where pp.schemaname = r.schema_name and pp.tablename = r.relname), '(정책 없음)')
  from rels r
  where r.schema_name = 'public' and r.relkind in ('r', 'p')

  union all
  select 20, format('%I.%I 1 %s', pp.schemaname, pp.tablename, pp.policyname), 'A2',
         format('%I.%I', pp.schemaname, pp.tablename), 'policy:' || pp.policyname,
         format('%s %s to %s | using: %s | with check: %s',
                pp.permissive, pp.cmd, array_to_string(pp.roles, ','),
                coalesce(pp.qual, '-'), coalesce(pp.with_check, '-'))
  from pg_policies pp
  where pp.schemaname = 'public'

  -- ── A3·A4. public 테이블의 롤별 실효 권한(PUBLIC·상속 포함) ─────────────────
  union all
  select 30 + ar.ord, r.qname, case ar.role_name when 'anon' then 'A3' else 'A4' end,
         r.qname, 'privs:' || ar.role_name,
         coalesce((select string_agg(tp.priv, ',' order by tp.ord)
                     from table_privs tp
                    where has_table_privilege(ar.role_name, r.oid, tp.priv)), '(없음)')
  from rels r
  cross join api_roles ar
  where r.schema_name = 'public'

  -- A4. 열 단위 권한(있으면 표시)
  union all
  select 34, format('%s %s', r.qname, a.attname), 'A4', r.qname, 'column_acl:' || a.attname,
         a.attacl::text
  from rels r
  join pg_attribute a on a.attrelid = r.oid
  where r.schema_name = 'public' and a.attnum > 0 and not a.attisdropped and a.attacl is not null

  -- ── A5. 기본 권한(새로 만드는 객체에 자동으로 붙는 권한) — public·ops·전체 범위 ─
  union all
  select 50, format('%s %s %s %s', pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '*'),
                    d.defaclobjtype, coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC')),
         'A5',
         format('%s 가 만드는 %s @ %s', pg_get_userbyid(d.defaclrole),
                case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence' when 'f' then 'function'
                                     when 'T' then 'type' when 'n' then 'schema' else d.defaclobjtype::text end,
                coalesce(n.nspname, '(모든 스키마)')),
         'default:' || coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC'),
         string_agg(x.privilege_type, ',' order by x.privilege_type)
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) x
  where d.defaclnamespace = 0 or n.nspname in ('public', 'ops')
  group by d.defaclrole, n.nspname, d.defaclobjtype, x.grantee

  -- ── B1. public·ops 함수의 EXECUTE(PUBLIC·상속 포함) ─────────────────────────
  union all
  select 60, f.sig, 'B1', f.sig, 'execute',
         format('PUBLIC=%s anon=%s authenticated=%s service_role=%s | owner=%s | acl=%s%s',
                has_function_privilege('public',        f.oid, 'EXECUTE'),
                has_function_privilege('anon',          f.oid, 'EXECUTE'),
                has_function_privilege('authenticated', f.oid, 'EXECUTE'),
                has_function_privilege('service_role',  f.oid, 'EXECUTE'),
                f.owner, coalesce(f.proacl::text, '(기본값)'),
                case when f.ext is not null then ' | ext=' || f.ext else '' end)
  from funcs f

  -- ── B2. 함수의 security definer·트리거 여부와 search_path 설정 ───────────────
  union all
  select 70, f.sig, 'B2', f.sig, 'search_path',
         format('definer=%s trigger=%s config=%s%s',
                f.prosecdef, f.is_trigger,
                coalesce(array_to_string(f.proconfig, ' '), '(없음)'),
                case when f.ext is not null then ' | ext=' || f.ext else '' end)
  from funcs f

  -- B2. public·ops 테이블에 걸린 트리거
  union all
  select 71, format('%s %s', r.qname, t.tgname), 'B2', r.qname, 'trigger:' || t.tgname,
         pg_get_triggerdef(t.oid)
  from rels r
  join pg_trigger t on t.tgrelid = r.oid
  where not t.tgisinternal

  -- ── C1. 스키마 USAGE — public·ops 와, API 롤이 USAGE 를 가진 스키마 ─────────
  union all
  select 80, n.nspname, 'C1', 'schema:' || n.nspname, 'usage',
         format('anon=%s authenticated=%s service_role=%s',
                has_schema_privilege('anon',          n.oid, 'USAGE'),
                has_schema_privilege('authenticated', n.oid, 'USAGE'),
                has_schema_privilege('service_role',  n.oid, 'USAGE'))
  from pg_namespace n
  where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
    and (n.nspname in ('public', 'ops')
         or has_schema_privilege('anon', n.oid, 'USAGE')
         or has_schema_privilege('authenticated', n.oid, 'USAGE'))

  -- C1. ops 테이블의 RLS·롤별 권한
  union all
  select 81, r.qname, 'C1', r.qname, 'rls',
         format('enabled=%s forced=%s', r.relrowsecurity, r.relforcerowsecurity)
  from rels r
  where r.schema_name = 'ops'

  union all
  select 81, format('%s %s', r.qname, ar.ord), 'C1', r.qname, 'privs:' || ar.role_name,
         coalesce((select string_agg(tp.priv, ',' order by tp.ord)
                     from table_privs tp
                    where has_table_privilege(ar.role_name, r.oid, tp.priv)), '(없음)')
  from rels r
  cross join api_roles ar
  where r.schema_name = 'ops'

  union all
  select 82, 'ops policies', 'C1', 'ops', 'policy_count',
         (select count(*)::text from pg_policies where schemaname = 'ops')

  -- C1. DB 안의 Data API 스키마 설정(없으면 대시보드 설정만 쓰는 것)
  union all
  select 83, 'authenticator', 'C1', 'role:authenticator', 'pgrst.db_schemas',
         coalesce((select string_agg(cfg, ' ; ')
                     from pg_db_role_setting s
                     join pg_roles ro on ro.oid = s.setrole
                     cross join lateral unnest(s.setconfig) cfg
                    where ro.rolname = 'authenticator'
                      and (cfg like 'pgrst.db\_schemas=%' or cfg like 'pgrst.db\_extra\_search\_path=%')),
                  '(DB 설정 없음 — 대시보드 Data API 설정 확인)')

  -- C1. Realtime 발행 대상에 들어간 public·ops 테이블
  union all
  select 84, 'realtime', 'C1', 'publication', 'tables',
         coalesce((select string_agg(format('%s:%I.%I', pt.pubname, pt.schemaname, pt.tablename), ', ')
                     from pg_publication_tables pt
                    where pt.schemaname in ('public', 'ops')), '(없음)')

  -- ── D1. 버킷 공개 여부(전체 버킷) ───────────────────────────────────────────
  union all
  select 90, b.id, 'D1', 'bucket:' || b.id, 'public', b.public::text
  from storage.buckets b

  -- ── D2. storage 스키마 테이블의 RLS·API 롤 권한·정책 ─────────────────────────
  union all
  select 91, c.relname, 'D2', format('storage.%I', c.relname), 'rls',
         format('enabled=%s forced=%s', c.relrowsecurity, c.relforcerowsecurity)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname in ('objects', 'buckets')

  union all
  select 92, format('%s %s', c.relname, ar.ord), 'D2', format('storage.%I', c.relname),
         'privs:' || ar.role_name,
         coalesce((select string_agg(tp.priv, ',' order by tp.ord)
                     from table_privs tp
                    where has_table_privilege(ar.role_name, c.oid, tp.priv)), '(없음)')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join api_roles ar
  where n.nspname = 'storage' and c.relname in ('objects', 'buckets')

  union all
  select 93, format('%s %s', pp.tablename, pp.policyname), 'D2',
         format('storage.%I', pp.tablename), 'policy:' || pp.policyname,
         format('%s %s to %s | using: %s | with check: %s',
                pp.permissive, pp.cmd, array_to_string(pp.roles, ','),
                coalesce(pp.qual, '-'), coalesce(pp.with_check, '-'))
  from pg_policies pp
  where pp.schemaname = 'storage'

  -- ── D3. 버킷의 크기·형식 제한(전체 버킷) ─────────────────────────────────────
  union all
  select 94, b.id, 'D3', 'bucket:' || b.id, 'limits',
         format('file_size_limit=%s allowed_mime_types=%s',
                coalesce(b.file_size_limit::text, '(없음)'),
                coalesce(array_to_string(b.allowed_mime_types, ','), '(없음)'))
  from storage.buckets b

  -- D3. item-images 에 올라간 객체: 형식별 개수·크기(바이트) 집계
  union all
  select 95, coalesce(o.metadata ->> 'mimetype', '(없음)')
             || case when o.name like '%\_thumb.jpg' then ' thumb' else ' orig' end,
         'D3', 'bucket:item-images',
         'objects:' || coalesce(o.metadata ->> 'mimetype', '(없음)')
             || case when o.name like '%\_thumb.jpg' then ' (thumb)' else ' (원본)' end,
         format('count=%s max_bytes=%s p99_bytes=%s',
                count(*),
                max((o.metadata ->> 'size')::bigint),
                percentile_disc(0.99) within group (order by (o.metadata ->> 'size')::bigint))
  from storage.objects o
  where o.bucket_id = 'item-images'
  group by 2, 5

  -- ── E2(참고). 익명 계정 생성 추이·계정당 Storage 사용량 집계 ─────────────────
  union all
  select 100, 'auth users', 'E2', 'auth.users', 'accounts',
         format('total=%s anonymous=%s anon_created_30d=%s max_anon_per_kst_day_30d=%s',
                (select count(*) from auth.users),
                (select count(*) from auth.users where is_anonymous),
                (select count(*) from auth.users where is_anonymous and created_at >= now() - interval '30 days'),
                coalesce((select max(cnt) from (
                            select count(*) as cnt
                              from auth.users
                             where is_anonymous and created_at >= now() - interval '30 days'
                             group by (created_at at time zone 'Asia/Seoul')::date) per_day), 0))

  union all
  select 101, 'storage per owner', 'E2', 'bucket:item-images', 'per_owner',
         format('owners=%s max_objects=%s max_bytes=%s avg_bytes=%s',
                count(*), coalesce(max(objs), 0), coalesce(max(bytes), 0), coalesce(round(avg(bytes)), 0))
  from (
    select (storage.foldername(o.name))[1] as owner_folder,
           count(*) as objs,
           sum((o.metadata ->> 'size')::bigint) as bytes
    from storage.objects o
    where o.bucket_id = 'item-images'
    group by 1
  ) per_owner

  -- ── F1. analysis_logs 의 열과 저장 현황 집계(내용 없음) ──────────────────────
  union all
  select 110, 'columns', 'F1', 'public.analysis_logs', 'columns',
         string_agg(format('%s:%s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' order by a.attnum)
  from pg_attribute a
  where a.attrelid = 'public.analysis_logs'::regclass and a.attnum > 0 and not a.attisdropped

  union all
  select 111, 'rows ' || grp, 'F1', 'public.analysis_logs', 'rows:' || grp,
         format('total=%s with_raw_text=%s item_linked=%s item_null=%s oldest_kst_month=%s',
                count(*),
                count(*) filter (where coalesce(l.raw_text, '') <> ''),
                count(*) filter (where l.item_id is not null),
                count(*) filter (where l.item_id is null),
                coalesce(to_char(min(l.created_at) at time zone 'Asia/Seoul', 'YYYY-MM'), '-'))
  from (
    select l.*,
           case when exists (select 1 from ops.internal_users iu where iu.user_id = l.user_id)
                then 'internal' else 'others' end as grp
    from public.analysis_logs l
  ) l
  group by grp

  -- ── F2. public·ops 의 외래 키와 삭제 시 동작 ────────────────────────────────
  union all
  select 120, format('%I.%I %s', n.nspname, c.relname, con.conname), 'F2',
         format('%I.%I', n.nspname, c.relname), 'fk:' || con.conname,
         pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f' and n.nspname in ('public', 'ops')
)
select check_id, target, item, value
from report
order by sort1, sort2, item;
