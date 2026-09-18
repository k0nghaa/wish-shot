import { File } from 'expo-file-system';

/**
 * 로컬 파일 경로를 file:// URI 로 정규화한다. 사진 선택 결과는 이미 file:// 이지만,
 * 공유로 받은 파일은 스킴 없는 절대경로(/var/...)로 올 수 있어 방어적으로 보정한다.
 */
export function toFileUri(pathOrUri: string): string {
  if (/^[a-z]+:\/\//i.test(pathOrUri)) return pathOrUri; // 이미 스킴 있음(file://, content:// 등)
  if (pathOrUri.startsWith('/')) return `file://${pathOrUri}`;
  return pathOrUri;
}

/**
 * 로컬 파일이 아직 읽을 수 없는 상태(예: iCloud "저장 공간 최적화"로 원본 미다운로드)일 때
 * 던지는 에러. 사용자에겐 잠시 후 재시도를 안내한다(수동 입력은 계속 가능).
 */
export class ImageNotReadyError extends Error {
  constructor() {
    super('사진을 아직 내려받지 못했습니다. 잠시 후 다시 시도하세요.');
    this.name = 'ImageNotReadyError';
  }
}

// 파일 준비 폴링: iCloud 원본 다운로드 지연을 흡수한다(준비되면 즉시 반환).
const READY_RETRY_INTERVAL_MS = 500;
const READY_MAX_ATTEMPTS = 6;

/**
 * __DEV__ 전용 시뮬레이션: iCloud 미다운로드를 흉내 낸다(실기기 재현 없이 재시도·안내 UX 검증용).
 * ensureFileReady 의 처음 N번 시도를 실제 파일 상태와 무관하게 "준비 안 됨"으로 만든다.
 *   0 = 끄기(기본, 실제 동작).
 *   1~5 = N번 재시도 후 실제 파일이 준비돼 있으면 성공으로 회복(재시도-후-채움 UX).
 *   6 이상(= READY_MAX_ATTEMPTS) = 끝까지 실패(하드 실패 UX: "사진을 아직 내려받지 못했습니다" + 다시 시도).
 * 프로덕션 빌드에선 __DEV__ 가드로 항상 무시된다. 검증이 끝나면 0으로 되돌린다.
 */
const SIMULATE_NOT_READY_ATTEMPTS = 0;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// uri 스킴을 안전하게 추출(계측용).
function uriScheme(uri: string): string {
  return uri.match(/^([a-z]+):\/\//i)?.[1] ?? (uri.startsWith('/') ? '(absolute)' : '(none)');
}

/**
 * __DEV__ 계측: 파일 상태를 안전하게 요약한다(절대 던지지 않음).
 * 실패 지점 특정용 — 스킴/존재/크기를 남긴다.
 */
function describeFile(uri: string): { scheme: string; exists: boolean; size: number } {
  try {
    const f = new File(toFileUri(uri));
    return { scheme: uriScheme(uri), exists: f.exists, size: f.size };
  } catch {
    return { scheme: uriScheme(uri), exists: false, size: -1 };
  }
}

/**
 * __DEV__ 계측 로그. picker/공유 진입점에서 uri·파일 상태(+추가 정보)를 남긴다.
 * 프로덕션에선 아무것도 하지 않는다.
 */
export function logImageDiag(tag: string, uri: string, extra?: Record<string, unknown>): void {
  if (!__DEV__) return;
  console.log(`[WishShot/img] ${tag}`, { uri: toFileUri(uri), ...describeFile(uri), ...extra });
}

/**
 * 로컬 파일이 읽을 수 있는 상태가 될 때까지 존재/크기를 폴링한다.
 * iCloud "저장 공간 최적화"로 원본이 아직 안 내려온 경우를 짧은 재시도로 흡수한다.
 * 준비되면 즉시 반환, 끝까지 안 되면 ImageNotReadyError 를 던진다.
 *
 * OCR·업로드가 이 게이트를 공유해 같은 준비 조건을 본다.
 */
export async function ensureFileReady(uri: string): Promise<void> {
  const fileUri = toFileUri(uri);
  for (let attempt = 1; attempt <= READY_MAX_ATTEMPTS; attempt++) {
    const f = new File(fileUri);
    // __DEV__ 시뮬레이션: 처음 N번 시도를 강제로 미준비 처리(실제 파일 상태 무시).
    const simFail = __DEV__ && attempt <= SIMULATE_NOT_READY_ATTEMPTS;
    const ready = !simFail && f.exists && f.size > 0;
    if (__DEV__) {
      console.log(`[WishShot/img] ensureFileReady #${attempt}/${READY_MAX_ATTEMPTS}`, {
        uri: fileUri,
        exists: f.exists,
        size: f.size,
        simFail,
        ready,
      });
    }
    if (ready) return;
    if (attempt < READY_MAX_ATTEMPTS) await wait(READY_RETRY_INTERVAL_MS);
  }
  if (__DEV__) console.warn('[WishShot/img] ensureFileReady 실패(준비 안 됨)', describeFile(uri));
  throw new ImageNotReadyError();
}

/**
 * 로컬 이미지 uri(사진 선택 결과 또는 공유로 받은 파일)를 바이트로 읽는다.
 * expo-file-system 의 File 은 Blob 을 구현해 arrayBuffer() 로 바로 읽을 수 있다
 * (base64 왕복 불필요). 결과는 Storage 업로드에 그대로 넘긴다.
 *
 * 읽기 전 ensureFileReady 로 파일 준비를 보장한다(iCloud 미다운로드 흡수).
 */
export async function readImageBytes(uri: string): Promise<ArrayBuffer> {
  await ensureFileReady(uri);
  try {
    return await new File(toFileUri(uri)).arrayBuffer();
  } catch (e) {
    // 존재/크기는 통과했으나 읽기 실패 → 준비 안 됨으로 취급(재시도 안내). 원인은 __DEV__ 로그로.
    if (__DEV__) console.warn('[WishShot/img] arrayBuffer 실패', describeFile(uri), e);
    throw new ImageNotReadyError();
  }
}
