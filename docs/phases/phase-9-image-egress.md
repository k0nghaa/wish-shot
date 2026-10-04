# Phase 9 — 이미지 egress 최적화 (Free 플랜을 출시·성장까지 유지)

> **이 문서 사용법**: Claude Code에 이 파일 전체를 컨텍스트로 넘기고 "**A/B/C/D를 진행해달라**"고 요청한다. 네 갈래(A·B·C·D)는 **한 브랜치·한 세션**에서 순서대로 구현하는 것을 전제로 자족적으로 적었다(서로 같은 파일 `storage.ts`·`register.tsx`를 공유하므로 병렬로 쪼개지 않는다). iOS 실기기에서의 업로드/썸네일 표시/앨범 동작은 **에이전트가 검증할 수 없으므로 사람이 dev client로 확인**한다.
>
> **브랜치·워크트리**: 이 작업은 `feat/phase-9-image-egress`(= `dev`에서 분기, Phase 8 릴리스 커밋 없음)에서 한다. 이미 별도 워크트리 `../wish-shot-phase9`가 만들어져 있다. 세션 시작 시 `git status --short --branch`로 브랜치를 먼저 확인한다. **release/v1.0.0에 직접 작업 금지**(새 기능은 release 금지 — dev 경유). 완료 후 PR로 `dev`에 머지한다.
>
> **워크트리 첫 셋업(구현 세션이 반드시 먼저)**: git worktree는 `.git`만 공유하고 gitignore 파일은 안 옮겨진다.
> ```
> Copy-Item ..\wish-shot\.env .env      # .env는 gitignore → 복사 필수(없으면 앱이 Supabase 없이 부팅 실패)
> npm install                            # node_modules는 워크트리마다 별도. .npmrc(legacy-peer-deps)는 커밋돼 있어 그대로 통과
> ```
>
> **재빌드 없음(중요)**: 이 Phase는 **새 네이티브 모듈을 추가하지 않는다**. `expo-image-manipulator`(리사이즈)·`@react-native-async-storage/async-storage`(영속 캐시)는 **이미 설치·빌드돼 있다**(`package.json:7,17`). 따라서 **전 작업이 순수 JS/설정 → EAS 재빌드 불필요**, 현재 dev client(또는 TestFlight 다음 빌드)로 검증한다. 만약 새 네이티브가 필요하다고 판단되면 **즉시 멈추고 사람에게 보고**한다.
>
> **단, 선택 항목 F(OTA 설정)를 채택하면 `expo-updates`(네이티브 1개)가 추가된다 — 유일한 예외다.** 하지만 이 Phase는 어차피 Phase 8+9를 담은 release production 빌드를 한 번 돈다(출시 계획). F는 **그 빌드에 올라타므로 추가 빌드가 발생하지 않는다.** F를 채택하지 않으면 이 Phase는 100% 순수 JS/설정이다. F 채택 시, 출시 후의 JS-only 수정은 재빌드 없이 `eas update`로 나간다.
>
> **근거 원칙**: iOS/Expo/Supabase 판단은 공식 문서로 검증한 사실에 기반한다(맨 아래 "근거·출처"). 불확실하면 추측하지 말고 문서를 확인하거나 사람에게 묻는다(CLAUDE.md 규칙 6).
>
> 관련 문서: `CLAUDE.md`(현행 구조·규칙), `docs/phases/phase-7-*.md`(직전 기능 상태), `docs/design/phase-5-visual-spec.md`(원본 방침 문구 — 이 Phase에서 개정).

---

## 목표 (Goal)

Supabase **Free 플랜(월 Egress 5GB)** 을, **정식 출시 후 사용자가 늘어도** 초과 없이 유지한다. 코드 레벨에서 전송량을 줄이는 것이 목표이며 **플랜 업그레이드로 해결하지 않는다.**

### 왜 지금 egress가 터지는가 (진단 요약 — 구현 전 반드시 이해)

Storage 25MB·DB 25MB로 저장량은 작은데 9월 청구주기 Egress가 6.49GB(130%)까지 올랐고, **Cached Egress는 0.15GB로 사실상 0**이었다. 즉 "**같은 원본 이미지를 캐시 없이 반복 다운로드**"가 근본 원인이다. 코드 근거:

1. **signed URL 토큰 회전 + 인메모리 전용 캐시** — `src/lib/queries/storage.ts:24`의 `signedUrlCache`는 `Map`(인메모리)이라 **앱 콜드스타트·Metro 리로드마다 전멸**한다. `createSignedUrl`(`:70`,`:97`)은 호출마다 **토큰이 다른 새 URL**을 만들고, `expo-image`(`src/components/Thumbnail.tsx:22-27`, `cachePolicy="memory-disk"`, `recyclingKey={url}`)는 **URL을 캐시 키**로 쓴다 → URL이 바뀌면 디스크 캐시 미스 → 전 이미지 재다운로드. **이게 Cached Egress ≈ 0의 이유이자 9/14~9/15 스파이크(Phase 5 이미지 화면 리디자인 중 반복 리로드)의 주범.**
2. **업로드 전 리사이즈·압축이 없음** — `register.tsx:291`/`edit.tsx:124`가 `quality:1`, `imageBytes.ts:104`가 원본 바이트 그대로 → iOS 레티나 스크린샷 원본(PNG 1.5~3MB)이 저장·전송 단위. 매 다운로드 크기를 키운다.
3. **목록/그리드가 풀사이즈 원본을 렌더** — `all.tsx:48`(3열, 타일 ≈130px)·`index.tsx:126-130`+`CategoryCard`(폴더당 4장, ≈90px)가 90~130px 자리에 1MB 원본을 내려받는다. Supabase **Image Transformation은 Pro 전용**(`supabase/config.toml:130-131` 주석 확인)이라 Free에선 못 쓴다 → **별도 썸네일 객체**로 해결한다.
4. (부차) `select('*')`는 base64를 안 끌어온다(이미지는 Storage, DB엔 `image_key` 문자열만) → **DB egress 문제 아님**. 페이지네이션 없음(`items.ts:30`)은 지금은 소규모라 미미(→ 아래 E, 성장 대비 선택).

### 성장해도 Free를 유지하는 근거 (Egress 예산)

이 Phase 후 사용자 1명의 전형적 브라우징 비용:
- **그리드 열람**: 썸네일(≤400px JPEG q0.6) ≈ **30~50KB/장**. 캐시(A)로 같은 기기·TTL 내 재열람은 **0**.
- **상세 열람**: 원본(≤1600px JPEG q0.8) ≈ **300~500KB/장**, 역시 재열람 0.
- 신규 아이템 20개를 담고 전부 상세까지 본 사용자 ≈ 그리드 1MB + 상세 8MB ≈ **~9MB(최초 1회)**, 이후 재방문 ≈ 0.

→ 5GB/월이면 **월 수백 MAU가 활발히 써도 여유**. (현행 구조로는 사용자 1명이 앱을 몇십 번 재실행하며 그리드를 보기만 해도 GB 단위가 나갔다.) **핵심 레버는 A(캐시)와 D(썸네일)**, B는 상세 비용, C는 부차.

---

## 승인된 범위 (사람이 확정한 값 — 임의 변경 금지)

| 갈래 | 내용 | 확정값 |
|---|---|---|
| **A** | signed URL 영속 캐시 + TTL 단축 | AsyncStorage 영속(hydrate/put/invalidate), **TTL = 86400초(1일)**, 앱 시작 시 `hydrateSignedUrlCache()` 1회 |
| **B** | 업로드 전 리사이즈·압축 | 신규 `src/lib/imageResize.ts` — 원본 **긴 변 ≤1600 · JPEG q0.8** |
| **C** | 업로드 `cacheControl` | `604800`(7일) |
| **D** | 그리드 썸네일 분리 | **긴 변 ≤400 · JPEG q0.6** 별도 객체 `{uid}/{id}_thumb.jpg`. 그리드=썸네일 / 상세 뷰어=원본. 삭제·덮어쓰기 시 썸네일 동반. thumb 부재 시 원본 폴백 |
| E(선택) | 그리드 초기 로드 상한 | 성장 대비 권장(아래). 미적용해도 A+D로 목표 달성 |
| F(선택) | OTA 설정(`expo-updates`) | 출시 후 JS-only 수정을 재빌드 없이 배포. 네이티브 1개 추가지만 **이번 release 빌드에 포함**(추가 빌드 없음). 채택 여부는 사람 결정 |

> **TTL 1일 근거**: 영속 캐시로 일 단위 재방문 egress는 거의 0으로 유지하면서, 정식 사용자에게 signed URL 수명(유출 시 노출 창)을 짧게 둔다. `SIGNED_URL_TTL_SEC=7일`(개발 편의값)에서 **1일로 낮춘다**.

---

## 정확성 불변식 (Invariants) — 출시 품질을 위해 반드시 성립

이 Phase는 "오류 없이 출시"가 목표다. 아래를 **모두** 만족해야 한다(각 갈래 DoD에 반영).

1. **고아 객체 없음.** 아이템 1개 = 원본 1 + 썸네일 1. 삭제 시 **둘 다** 제거(`deleteItemImage`/`deleteItemImages`가 원본+썸네일 키를 함께 remove). 덮어쓰기(중복 저장·이미지 교체)는 **원본과 썸네일을 모두 재업로드**하고 **둘 다 캐시 무효화**(안 그러면 옛 사진이 캐시로 남는다).
2. **OCR·AI는 원본에서.** 압축/썸네일 생성은 **저장 시점**에만 한다. OCR(`analyze(imageUri)`)·"제품 영역 지정" 크롭은 **사용자가 고른 원본 uri**에서 그대로 돈다(품질 저하 금지). 파이프라인 순서: 분석은 원본, 업로드만 압축본.
3. **iCloud 미다운로드 처리 유지.** 압축 전에 `ensureFileReady`(`imageBytes.ts`)를 통과시켜, 원본이 아직 안 내려온 경우 기존 `ImageNotReadyError` 안내·재시도로 떨어지게 한다(새 에러 경로 만들지 않음).
4. **thumb 부재에도 화면이 비지 않음.** 썸네일 객체가 없으면(레거시/백필 전) 그리드는 **원본으로 폴백**해 표시한다(blank 금지). signed URL 발급은 객체 존재를 확인하지 않으므로, 폴백은 **표시 실패(onError) 시 원본 소스로 교체**하는 컴포넌트 레벨로 구현한다.
5. **데이터는 `src/lib/queries` 경유.** 화면에서 `supabase.from`/`supabase.storage` 직접 호출 금지. 썸네일 키·업로드·서명URL은 `storage.ts`에 둔다.
6. **카피·토큰 규칙 승계.** 한국어 단답형("~습니다"/명사구, 대화체 금지), 디자인 토큰만(원시 hex 금지), 커밋 컨벤션(`feat:`/`fix:`+한국어).
7. **하위호환.** DB 스키마·타입 변경 없음(`items.image_key`는 원본 키 그대로, 썸네일 키는 **파생**). Edge Function·RLS·정규화·Storage 정책 불변.

---

## A — signed URL 영속 캐시 + TTL 1일

**대상**: `src/lib/queries/storage.ts`, `src/app/_layout.tsx`.

**작업**:
1. `AsyncStorage` import 추가. `SIGNED_URL_TTL_SEC`를 **86400**으로. 영속 접두사 `const PERSIST_PREFIX = 'wishshot.signedurl.';`
2. `putCachedSignedUrl`에서 인메모리 `Map`에 넣을 때 **AsyncStorage에도 저장**(실패는 무시). `invalidateSignedUrl`에서 **AsyncStorage에서도 제거**.
3. `hydrateSignedUrlCache()`를 export: 앱 시작 시 영속 항목을 `Map`으로 복원, **만료된 키는 건너뛰고 정리**한다.
4. `_layout.tsx`의 `AuthGate` 부트스트랩(예: `getSession()` 직후)에서 `void hydrateSignedUrlCache();` **1회** 호출.

```ts
// storage.ts (요지)
import AsyncStorage from '@react-native-async-storage/async-storage';
export const SIGNED_URL_TTL_SEC = 60 * 60 * 24; // 1일
const PERSIST_PREFIX = 'wishshot.signedurl.';

function putCachedSignedUrl(key: string, url: string, expiresInSec: number): void {
  const entry = { url, expiresAt: Date.now() + expiresInSec * 1000 };
  signedUrlCache.set(key, entry);
  void AsyncStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(entry)); // 실패 무시
}
export function invalidateSignedUrl(imageKey: string): void {
  signedUrlCache.delete(imageKey);
  void AsyncStorage.removeItem(PERSIST_PREFIX + imageKey);
}
export async function hydrateSignedUrlCache(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PERSIST_PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    const expired: string[] = [];
    for (const [k, v] of pairs) {
      if (!v) continue;
      const e = JSON.parse(v) as { url: string; expiresAt: number };
      if (e.expiresAt > Date.now()) signedUrlCache.set(k.slice(PERSIST_PREFIX.length), e);
      else expired.push(k);
    }
    if (expired.length) void AsyncStorage.multiRemove(expired);
  } catch { /* 복원 실패 무시 — 다음 미스 시 재발급 */ }
}
```

**왜 효과가 큰가**: URL이 콜드스타트·리로드를 넘어 유지되면 `expo-image` 디스크 캐시가 살아남아 **재방문 다운로드 = 0**. Cached Egress가 비로소 오른다. (이 항목이 스파이크성 트래픽의 대부분을 제거한다.)

**DoD**: 앱을 완전히 종료 후 재실행해도 그리드/상세가 **네트워크 재다운로드 없이** 즉시 뜬다(Supabase 대시보드 Egress가 재실행에 거의 안 움직임 — 사람 확인). `tsc`·`lint` 통과.

---

## B — 업로드 전 리사이즈·압축 + 신규 `src/lib/imageResize.ts`

**대상**: 신규 `src/lib/imageResize.ts`, `src/app/register.tsx`(`performNewSave`·`handleOverwrite`), `src/app/item/[id]/edit.tsx`(`handleSave`의 이미지 교체).

**작업 1 — `imageResize.ts`** (리사이즈 관용구는 `RegionSelectSheet.tsx:193-196`와 동일):

```ts
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { toFileUri } from './imageBytes';

async function downscaleToJpeg(uri: string, maxEdge: number, compress: number): Promise<string> {
  const file = toFileUri(uri);
  const probe = await manipulateAsync(file, [], { format: SaveFormat.JPEG }); // 크기 확인(원격 https도 허용 — 백필용)
  const longest = Math.max(probe.width, probe.height);
  const actions = longest > maxEdge
    ? [probe.width >= probe.height ? { resize: { width: maxEdge } } : { resize: { height: maxEdge } }]
    : [];                                                                    // 업스케일 금지
  const out = await manipulateAsync(file, actions, { compress, format: SaveFormat.JPEG });
  return out.uri;
}
export async function compressForUpload(uri: string): Promise<{ uri: string; contentType: string }> {
  return { uri: await downscaleToJpeg(uri, 1600, 0.8), contentType: 'image/jpeg' };
}
export async function makeThumbnail(uri: string): Promise<string> {  // D에서 함께 사용
  return downscaleToJpeg(uri, 400, 0.6);
}
```

**작업 2 — 업로드 경로**(register `performNewSave`·`handleOverwrite`, edit 교체 블록). 불변식 2·3 준수:

```ts
// 원본 uri = 사용자가 고른 imageUri (OCR은 이미 이걸로 돌았음)
await ensureFileReady(imageUri!);                     // iCloud 처리 유지(불변식 3)
const compressed = await compressForUpload(imageUri!); // ≤1600 jpeg
const thumbUri = await makeThumbnail(compressed.uri);  // 이미 축소된 원본에서 400px (디코드 절약)
const [bytes, thumbBytes] = await Promise.all([
  readImageBytes(compressed.uri),
  readImageBytes(thumbUri),
]);
const imageKey = await uploadItemImage(userId, id, bytes, compressed.contentType); // D: 원본
await uploadItemImageThumb(userId, id, thumbBytes);                                 // D: 썸네일
```
- `ensureFileReady`·`readImageBytes`는 `@/lib/imageBytes`에서 이미 export됨. register/edit에서 `compressForUpload`,`makeThumbnail`(그리고 D의 `uploadItemImageThumb`) import 추가.
- **덮어쓰기·교체도 동일**(원본+썸네일 둘 다 재업로드). `uploadItemImage`/`uploadItemImageThumb`가 각 키를 `invalidateSignedUrl` 하므로 옛 캐시가 남지 않는다(불변식 1).

**주의**: OCR/분석(`analyze(imageUri)`)·`ImageZoomModal`(롱프레스 원본 보기)은 **원본 uri 그대로** 둔다 — 절대 압축본으로 바꾸지 않는다.

**정책 변경(문서 동기화 필요)**: `docs/design/phase-5-visual-spec.md:59`·데이터 흐름 문서의 "**이미지 원본은 온전**" 문구를 "**업로드 시 긴 변 1600px JPEG로 최적화 저장(egress·저장 절감)**"으로 개정한다(같은 커밋에서 `CLAUDE.md`·`README.md`도).

**DoD**: 담기·덮어쓰기·이미지 교체 후 Storage 객체 크기가 원본 대비 크게 준다(수 MB → 수백 KB, 사람 확인). 상세 뷰어 가독성 문제 없음. `tsc`·`lint` 통과.

---

## C — 업로드 `cacheControl`

**대상**: `src/lib/queries/storage.ts`의 `uploadItemImage`(그리고 D의 `uploadItemImageThumb`).

```ts
const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
  contentType, upsert: true, cacheControl: '604800', // 7일
});
```
**DoD**: 업로드 정상, 옵션 반영. (부차 — A와 함께일 때 의미. private+signed라 이득은 제한적이지만 표준 관행.)

---

## D — 그리드 썸네일 분리 (핵심 성장 레버)

**대상**: `storage.ts`(썸네일 키/업로드/서명URL/삭제), 그리드 4곳(`(tabs)/all.tsx`,`(tabs)/index.tsx`,`category/[id].tsx`,`tag/[name].tsx`), 표시 컴포넌트 폴백(`Thumbnail.tsx`/`PhotoTile.tsx`), `settings.tsx`(백필). **상세 뷰어 `item/[id]/index.tsx`는 원본 유지**(변경 금지).

**작업 1 — `storage.ts`**:
```ts
/** 원본 키 {uid}/{id}.jpg → 썸네일 키 {uid}/{id}_thumb.jpg (파생 — DB에 저장하지 않음). */
export function thumbKeyFromImageKey(imageKey: string): string {
  return imageKey.replace(/\.jpg$/i, '_thumb.jpg');
}
/** 썸네일 업로드(항상 JPEG). 키만 원본과 다르고 나머지는 uploadItemImage와 동일. */
export async function uploadItemImageThumb(userId: string, itemId: string, bytes: ArrayBuffer): Promise<string> {
  const key = thumbKeyFromImageKey(itemImageKey(userId, itemId));
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, {
    contentType: 'image/jpeg', upsert: true, cacheControl: '604800',
  });
  if (error) throw new Error(`썸네일을 업로드하지 못했습니다: ${error.message}`);
  invalidateSignedUrl(key);
  return key;
}
/** 그리드용: 원본 image_key 배열 → { image_key → 썸네일 signed URL } 로 반환(화면은 image_key로 인덱싱 유지). */
export async function getItemThumbSignedUrls(imageKeys: string[], expiresInSec = SIGNED_URL_TTL_SEC): Promise<Record<string,string>> {
  const pairs = imageKeys.map((k) => [k, thumbKeyFromImageKey(k)] as const);
  const thumbUrls = await getItemImageSignedUrls(pairs.map(([, t]) => t), expiresInSec);
  const map: Record<string,string> = {};
  for (const [orig, thumb] of pairs) if (thumbUrls[thumb]) map[orig] = thumbUrls[thumb];
  return map;
}
```
- **삭제 동반**: `deleteItemImage(imageKey)` → `remove([imageKey, thumbKeyFromImageKey(imageKey)])` 후 두 키 모두 `invalidateSignedUrl`. `deleteItemImages(keys)` → `keys.flatMap(k => [k, thumbKeyFromImageKey(k)])`.
- `index.ts` 배럴은 `export * from './storage'`라 새 export 자동 노출(추가 작업 없음).

**작업 2 — 그리드 4곳**: `getItemImageSignedUrls(list.map(it => it.image_key))` → **`getItemThumbSignedUrls(list.map(it => it.image_key))`**. 화면은 여전히 `urls[item.image_key]`로 인덱싱(반환이 원본 키 기준). `index.tsx`의 홈 모자이크(`allKeys`)도 동일 교체.
- **상세 뷰어(`item/[id]/index.tsx`)·편집 미리보기(`edit.tsx`)·중복 다이얼로그(`register.openDuplicate`)는 원본(`getItemImageSignedUrl(s)`) 유지** — 큰 이미지가 필요하거나 단일 이미지라 이득이 없고 폴백 리스크만 는다.

**작업 3 — thumb 부재 폴백(불변식 4)**: 그리드는 썸네일을 우선 쓰되, 표시 실패 시 원본으로 교체한다. `Thumbnail`에 `fallbackUrl?: string`을 추가해 `expo-image`의 `onError`에서 소스를 원본으로 스왑(1회). 그리드는 `getItemThumbSignedUrls`(우선)와 `getItemImageSignedUrls`(폴백)를 둘 다 발급해 `PhotoTile`/`CategoryCard`에 넘긴다.
- signed URL 발급은 egress가 아니므로(바이트 전송이 아님) 두 번 발급해도 무해하고, **원본 바이트는 썸네일이 실제로 없을 때(레거시)만** 내려온다.
- 이 폴백 덕에 **대규모 일괄 백필 없이도** 레거시 아이템이 화면에서 비지 않는다 → 출시 안전.

**작업 4 — `__DEV__` 백필 버튼**(개발자 자기 데이터용, `settings.tsx` devSection):
```ts
async function handleBackfillThumbs() {
  try {
    const userId = await getCurrentUserId();
    const items = await listItems();
    let done = 0, failed = 0;
    for (const it of items) {
      try {
        const url = await getItemImageSignedUrl(it.image_key);   // 원본 signed URL
        const thumbUri = await makeThumbnail(url);               // manipulateAsync가 원격 URL을 받아 400px 생성
        const bytes = await readImageBytes(thumbUri);
        await uploadItemImageThumb(userId, it.id, bytes);
        done++;
      } catch { failed++; }
    }
    Alert.alert('썸네일 백필', `완료 ${done} · 실패 ${failed}`);
  } catch (e) { Alert.alert('오류', e instanceof Error ? e.message : '백필 실패'); }
}
```
- 각 사용자는 RLS로 **자기 아이템만** 백필한다(전역 백필 불가·불필요 — 폴백이 안전망). 실사용자 기존 데이터는 폴백으로 커버되고, 재저장/신규는 자동으로 썸네일이 생긴다.

**DoD**: 새로 담은 아이템이 그리드에서 **썸네일(수십 KB)** 로 로드(사람이 Egress·네트워크로 확인), 상세는 원본. 아이템 삭제 후 Storage에 `_thumb` 객체가 남지 않음. 레거시(썸네일 없는) 아이템도 그리드에서 원본 폴백으로 정상 표시. `tsc`·`lint` 통과.

---

## E — (선택, 성장 대비) 그리드 초기 로드 상한

A+D만으로 목표는 달성된다. 사용자당 아이템이 수백 개로 커질 때를 대비해 **권장**:
- `all.tsx`의 `FlatList`에 `initialNumToRender`/`windowSize`/`maxToRenderPerBatch`를 보수적으로 두거나, `listItems`에 선택적 `limit`/`range`를 추가해 초기 N개만 서명·로드하고 스크롤 시 추가 로드. **서명URL은 화면에 실제 보이는 만큼만** 발급하도록.
- 지금은 데이터가 작아 미적용해도 된다. 적용 시 "무한/추가 로드"의 로딩·빈 상태 카피는 앱 톤 유지.

---

## F — (선택) OTA 설정: 출시 후 JS 수정은 재빌드 없이

**결정 필요(사람)**: 채택하면 이번 release 빌드에 `expo-updates`를 포함한다. 출시 후 A~E 같은 **JS-only 수정·버그픽스**를 App Store 재빌드·재심사 없이 `eas update`로 배포할 수 있다. 빌드 분(minutes)을 소모하지 않는다.

**전제(중요)**: OTA를 켜는 `expo-updates`는 네이티브 모듈이라 **한 번은 빌드에 구워져야** 한다(그 빌드 자체는 OTA로 못 넣음). 이 Phase는 어차피 release production 빌드를 1회 돌므로, **F를 그 빌드에 함께 넣으면 추가 빌드가 없다.** F 이후의 JS 변경부터 OTA가 적용된다. **채널·runtimeVersion은 꼬리표·게이트일 뿐 `expo-updates`가 없으면 무효**임에 유의(설치가 먼저).

**대상**: `package.json`(expo install), `app.json`(runtimeVersion), `eas.json`(production channel). CLAUDE.md 명령어 섹션의 "production 프로필은 channel 없음 = OTA 미사용" 서술도 F 채택 시 개정한다.

**작업**:
1. `npx expo install expo-updates` — SDK 호환 버전만(버전 임의 인상 금지, CLAUDE.md 규칙 10).
2. `eas.json`의 `build.production`에 `"channel": "production"` 추가.
3. `app.json`에 `runtimeVersion` 설정 — 호환 빌드에만 업데이트가 가도록(예: `{ "policy": "fingerprint" }`). Expo 문서로 현재 권장 정책 확인 후 적용(추측 금지).
4. 검증: `npx expo config --type introspect`·`npx expo-doctor` 통과. **실제 OTA 동작은 release 빌드에서만 검증 가능**(사람).

**주의**:
- **runtimeVersion 호환**: 이후 네이티브를 바꾸면 runtimeVersion을 올리고 다시 빌드해야 하며, 옛 빌드엔 그 OTA가 안 간다(불일치 크래시 방지 안전장치).
- **깨진 OTA 롤백 대비**: 잘못된 번들을 올리면 사용자 앱이 깨질 수 있다. `expo-updates`는 마지막 정상/내장(embedded) 번들로 폴백하고, 고친 업데이트를 다시 publish해 롤백한다. **먼저 preview/internal 채널로 확인 후 production에 올린다.**
- **Apple 정책(심사 안전)**: OTA(원격 JS 실행)는 Apple이 공식 허용하는 방식이라 **`expo-updates` 설치만으로 심사에서 떨어지지 않는다**. 단 심사에서 본 앱의 성격·기능을 통째로 바꾸는 용도로 남용하지 않는다(버그 수정·소소한 개선 = 문제없음).

**DoD**: `expo config introspect`에 updates 설정 반영, `expo-doctor` 통과, `tsc`·`lint` 통과. release 빌드 후 사람이 `eas update`로 JS 수정이 재빌드 없이 반영되는지 1회 확인.

---

## 검증 (Verification)

에이전트:
- `npx tsc --noEmit` · `npx expo lint` 통과.
- 코드 리뷰: 불변식 1~7 자체 점검(특히 삭제/덮어쓰기의 원본+썸네일 동반, OCR이 원본 uri인지, 폴백 경로).

사람(dev client 실기기 — 에이전트가 못 하는 것):
- [ ] 담기/덮어쓰기/이미지 교체 후 Storage 객체 크기 대폭 감소 + `_thumb` 객체 생성 확인.
- [ ] 앱 완전 종료 후 재실행 시 그리드/상세가 재다운로드 없이 즉시(대시보드 Egress 거의 정지).
- [ ] 그리드=썸네일 화질/상세=원본 화질 OK, 레거시 아이템도 비지 않음.
- [ ] 삭제 후 원본·썸네일 둘 다 사라짐(고아 없음).
- [ ] `__DEV__` 백필 실행 → 기존 아이템 그리드가 썸네일로 전환.
- [ ] 며칠 사용 후 대시보드에서 **Cached Egress 비중이 오르고 총 Egress 증가율이 완만**한지 확인.

---

## 문서 동기화 (완료 시 같은 커밋)

- `CLAUDE.md` — "Storage · Egress 규칙" 신설: **업로드 전 리사이즈 필수 / 목록은 썸네일 객체만 / signed URL 영속 캐시 재사용 / 상세만 원본**. + "이미지 원본 온전 저장" 관련 서술을 "1600px 최적화 저장"으로 개정.
- `README.md` — 이미지 저장/전송 설명 정합.
- `docs/design/phase-5-visual-spec.md:59` — `quality:1`·원본 온전 문구 개정.
- 이 문서의 "결과 기록" 갱신.

---

## 결과 기록 (구현 세션이 채움)

- [x] A — 영속 캐시 + TTL 1일: `storage.ts` — `SIGNED_URL_TTL_SEC=86400`, `PERSIST_PREFIX='wishshot.signedurl.'`, `putCachedSignedUrl`/`invalidateSignedUrl`이 AsyncStorage 반영(실패 무시), `hydrateSignedUrlCache()` export(만료 키 정리). `_layout.tsx` AuthGate 부트스트랩에서 `void hydrateSignedUrlCache()` 1회.
- [x] B — 리사이즈·압축(`imageResize.ts`) + register/edit 적용: 신규 `src/lib/imageResize.ts`(`downscaleToJpeg`/`compressForUpload` ≤1600·q0.8 / `makeThumbnail` ≤400·q0.6, 업스케일 금지, 원격 URL 허용). `register.tsx`(`performNewSave`·`handleOverwrite`)·`edit.tsx`(`handleSave` 교체 블록) 업로드 경로를 `ensureFileReady`→`compressForUpload`→`makeThumbnail`→원본+썸네일 업로드로 교체. OCR `analyze(imageUri)`·`ImageZoomModal`은 원본 uri 유지. register의 죽은 `contentType` 상태·`guessContentType` 제거(업로드는 항상 JPEG).
- [x] C — cacheControl: `uploadItemImage`·`uploadItemImageThumb` upload에 `cacheControl: '604800'`.
- [x] D — 썸네일 분리(키/업로드/서명URL/삭제 동반/폴백/백필) + 그리드 4곳: `storage.ts`에 `thumbKeyFromImageKey`·`uploadItemImageThumb`·`getItemThumbSignedUrls` 추가, `deleteItemImage`/`deleteItemImages`가 원본+썸네일 함께 remove·무효화. 그리드 4곳(`all`·`index` 모자이크·`category/[id]`·`tag/[name]`)이 썸네일(우선)+원본(폴백)을 함께 발급. `Thumbnail`에 `fallbackUrl`+`onError` 스왑, `PhotoTile`·`CategoryCard`로 관통. `settings.tsx` `__DEV__` "썸네일 백필" 버튼. 상세 뷰어·편집 미리보기·중복 다이얼로그는 원본 유지(변경 없음). 삭제 호출부(`useItemSelection`·상세)는 무변경(storage 내부에서 썸네일 동반).
- [ ] E — (선택) 초기 로드 상한: **미적용 — 성장 대비 후속으로 남김**(A+D로 목표 달성, 현재 데이터 규모에서 불필요·리스크만 증가).
- [x] F — (선택) OTA 설정(`expo-updates`): **채택·적용 완료.** `npx expo install expo-updates`(`~57.0.23`, SDK 57 호환). `app.json`에 `runtimeVersion: { policy: "fingerprint" }`(가장 안전 — 네이티브 변경 시 자동 불일치 방지) + `updates.url: https://u.expo.dev/13c8e5d2-653f-4e14-975b-f006e0a13471`. `eas.json` production에 `channel: "production"`. `CLAUDE.md` 명령어 섹션 "OTA 미사용" 서술을 "OTA 사용 + `eas update`" 로 개정. 이번 release production 빌드에 포함(추가 빌드 없음), 출시 후 JS-only 수정은 `eas update`로. **실제 OTA 반영은 release 빌드 후 사람이 검증.**
- [x] 문서 동기화: `CLAUDE.md`(Storage·Egress 규칙 신설 + 데이터 흐름 문구 개정), `README.md`(이미지 저장·전송 섹션 + Edge Function 문구), `docs/design/phase-5-visual-spec.md`(M6 "원본 온전"→1600px 최적화).
- [x] 검증(tsc/lint + 사람 실기기): `npx tsc --noEmit` exit 0 · `npx expo lint` exit 0. 실기기 검증은 아래 "검증(사람)" 체크리스트로 위임(에이전트 불가).
- 특이사항·결정:
  - register `contentType` 상태 제거: 업로드가 항상 JPEG(`compressForUpload`)라 원본 mime 추적이 무의미 → unused 방지 겸 제거. `params.imageMime` 타입은 보존(무해).
  - `getItemThumbSignedUrls`/`getItemImageSignedUrls`를 그리드에서 **둘 다** 발급: signed URL 발급은 바이트 전송이 아니라 egress가 아니므로 무해하고, 원본 바이트는 썸네일 로드 실패(레거시) 시 `onError` 폴백에서만 내려온다.
  - 백필은 RLS로 본인 아이템만(전역 백필 불가·불필요). 실사용자 레거시는 그리드 원본 폴백으로 커버.
  - A~E는 새 네이티브 모듈 없음 → 그 자체론 EAS 재빌드 불필요(현재 dev client/다음 빌드로 검증). **F는 유일한 예외로 `expo-updates`(네이티브 1개)를 추가** — 다만 이번 release production 빌드에 올라타므로 추가 빌드는 없다. F의 OTA 설정(runtimeVersion·updates·channel)은 `expo config introspect`에 반영·`expo-doctor` 통과(실패 1건은 기존 패치 미스매치 뿐, expo-updates 무관 — 규칙 10).

---

## 근거·출처 (구현 전 확인 권장)

- Expo Image Manipulator (`manipulateAsync`, `SaveFormat`, resize/compress): https://docs.expo.dev/versions/latest/sdk/imagemanipulator/
- Expo Image 캐시 정책(`cachePolicy`, URL 기반 캐싱): https://docs.expo.dev/versions/latest/sdk/image/#cachepolicy
- Supabase Storage `createSignedUrl(s)` (토큰 포함 URL — 호출마다 상이): https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
- Supabase Storage `upload`(`cacheControl` 옵션): https://supabase.com/docs/reference/javascript/storage-from-upload
- Supabase Storage Image Transformation = **Pro 이상 전용**(Free 사용 불가 → 썸네일 객체로 대체하는 이유): https://supabase.com/docs/guides/storage/serving/image-transformations
- AsyncStorage: https://react-native-async-storage.github.io/async-storage/

> 위 URL의 API 시그니처·플랜 제약이 현재와 다르면 **추측하지 말고** 문서 최신본을 따르거나 사람에게 보고한다(CLAUDE.md 규칙 6·10).
