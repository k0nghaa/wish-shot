/**
 * 개인정보 안내(NFR-3) — 단일 소스.
 * 첫 이미지 업로드 시 1회 뜨는 고지(register)와 설정 화면의 열람이 같은 문구를 쓴다.
 */
export const PRIVACY_NOTICE = {
  title: '이미지 분석 안내',
  body: '이미지는 기기에서 분석되고 비공개 저장소에만 저장돼요. AI 정제에는 인식한 텍스트만 전송돼요.',
} as const;
