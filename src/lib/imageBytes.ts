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
 * 로컬 이미지 uri(사진 선택 결과 또는 공유로 받은 파일)를 바이트로 읽는다.
 * expo-file-system 의 File 은 Blob 을 구현해 arrayBuffer() 로 바로 읽을 수 있다
 * (base64 왕복 불필요). 결과는 Storage 업로드에 그대로 넘긴다.
 */
export async function readImageBytes(uri: string): Promise<ArrayBuffer> {
  return new File(toFileUri(uri)).arrayBuffer();
}
