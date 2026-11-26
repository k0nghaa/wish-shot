# 문서 안내

WishShot(위시샷) 저장소의 문서를 어떤 순서로 읽으면 되는지, 작업 기록이 무엇을 다루는지, 문서와 코드에 나오는 용어가 무슨 뜻인지 모았습니다.

## 읽는 순서

1. [README](../README.md) — 무엇을 하는 앱인지, 화면, 구조·빌드 흐름 그림.
2. [개발 가이드](development.md) — 로컬 실행, 앱 빌드·출시, DB 마이그레이션, Edge Function 배포·요청 한도, 환경 변수. 절차·명령·수치의 정본입니다.
3. [작업 기록](phases/) — 기능마다 왜 이렇게 만들었는지. 각 문서 끝에 결과 기록이 있습니다(아래 목록).
4. [색 토큰](design/color_tokens.md) → [화면 명세](design/phase-5-visual-spec.md) — 색 정본과 코드 토큰 대응, 화면별 명세. 지금 화면은 명세 맨 아래 'Phase 24' 절입니다.
5. [트래킹 플랜](testing/tracking-plan.md) — 계측 이벤트 정본, 지표 SQL, 릴리스별 측정 한계.
6. [정답셋 리포트](../supabase/functions/parse-screenshot-text/samples/goldset/REPORT.md) → [라벨 규칙](../supabase/functions/parse-screenshot-text/samples/goldset/LABELING.md) — AI 가격 자동채움 정확도 측정 결과와 기준.
7. [개인정보처리방침](legal/privacy.html)·[지원 페이지](legal/support.html) — 공개 페이지 원본. 방침은 게시 절차를 거쳐서만 고칩니다.
8. [CLAUDE.md](../CLAUDE.md) — 저장소 작업 규칙과 디렉터리 구조. [PR 템플릿](../.github/pull_request_template.md) — PR 본문 형식.

## 작업 기록 목록

`docs/phases/`의 문서는 작업 지시와 결과를 함께 담은 기록입니다. 그때의 판단과 경과를 그대로 두고, 지금과 달라진 곳에는 `2026-11 기준` 각주를 달았습니다.

| 번호 | 문서 | 다룬 것 | 머지(PR) |
|---|---|---|---|
| 1 | [phase-1](phases/phase-1-toolchain.md) | 웹 코드 정리, Expo·Supabase 개발 환경, 이메일 로그인·공유 시트·EAS 빌드 | 2026-09-08~09 (#8, #9) |
| 2 | [phase-2](phases/phase-2-data-and-screens.md) | DB 계약(테이블·RLS·Storage), 공유로 저장, 핵심 화면 | 2026-09-11 (#10) |
| 3 | [phase-3](phases/phase-3-ocr-and-autofill.md) | 온디바이스 OCR + AI 정제 자동채움 | 2026-09-14 (#12) |
| 4 | [phase-4](phases/phase-4-edit-and-manage.md) | 편집·카테고리 이동·태그, 카테고리 추천, 설정 | 2026-09-14 (#13) |
| 5 | [phase-5](phases/phase-5-redesign-and-deploy.md) | 디자인 리스킨, 하단 탭바, 상세 뷰어·정보 시트, 익명 로그인 | 2026-09-15 (#14) |
| 6 | [phase-6](phases/phase-6-hackathon-submission.md) | iCloud 사진 대응, 제품 영역 지정(이미지 분석), 검색 | 2026-09-18 (#15, #16) |
| 7 | [phase-7](phases/phase-7-link-capture-and-onboarding.md) | URL 공유로 링크 저장, 앨범 원본 삭제, 첫 실행 온보딩, 다중 선택 | 2026-09-20~21 (#17~#21) |
| 8 | [phase-8](phases/phase-8-app-store-release.md) | App Store 출시 절차(1.0.0) | 출시 2026-10-04 |
| 9 | [phase-9](phases/phase-9-image-egress.md) | 이미지 전송량 줄이기(압축·썸네일·캐시), OTA 설정 | 2026-09-22 (#22) |
| 10 | [phase-10](phases/phase-10-testflight-analytics.md) | PostHog 계측 | 2026-10-03 (#23) |
| 11 | [phase-11](phases/phase-11-anon-account-lifecycle.md) | 빈 익명 계정·고아 이미지 자동 정리 | 2026-10-04 (#24) |
| 13 | [phase-13](phases/phase-13-goldset-eval.md) | 정답셋으로 가격 자동채움 정확도 기준선 측정 | 2026-11-06 (#37) |
| 14 | [phase-14](phases/phase-14-sentry-and-store-metadata.md) | Sentry 오류·크래시 수집, 개발용 앱 분리, 스토어 메타데이터(1.0.2) | 2026-11-05 (#32) |
| 15 | [phase-15](phases/phase-15-ai-rate-limit.md) | AI 정제 요청 한도·입력 상한·실패 기록 | 2026-11-08 (#40) |
| 16 | [phase-16](phases/phase-16-rls-storage-audit.md) | RLS·Storage 권한 점검, 업로드 제한, 분석 원문 정리 | 2026-11-09 (#43) |
| 17 | [phase-17](phases/phase-17-price-accuracy.md) | 가격 정확도(중고거래 가격 규칙) | 2026-11-08 (#39) |
| 21 | [phase-21](phases/phase-21-purchase-finder.md) | 구매처 링크 찾기 | 2026-11-09 (#42) |
| 22 | [phase-22](phases/phase-22-account-login.md) | Apple·카카오 로그인, 익명 위시 합치기, 닉네임, 계정 삭제(1.2.0) | 진행 중 |
| 24 | [phase-24](phases/phase-24-ux-improvements.md) | 탭 순서, 공유 시트 처리, 등록 폼 정리, 알림 | 2026-11-09 (#44) |

빠진 번호(12·18·19·20·23)는 이 저장소에 기록이 없습니다.

**출시**: 1.0.0(2026-10-04) · 1.0.1(2026-10-20, 계측 내장) · 1.0.2(2026-11-06, Sentry·개발용 앱 분리) · 1.1.0(2026-11-11, 구매처 링크 찾기·알림·탭 순서). 태그 `vX.Y.Z`.

## 용어

### 요구사항 번호 (FR·NFR·E)

코드 주석과 문서의 번호는 **노션 「WishShot v2 PRD (iOS 앱)」** 기준입니다. v1 PRD(웹)는 번호의 뜻이 다릅니다(특히 E 번호). 지금 앱과 다른 곳은 '지금' 열에 적었습니다.

| 번호 | PRD 정의 | 지금 |
|---|---|---|
| FR-7a | 정제 결과의 신뢰도가 낮으면 확인 안내를 띄운다 | 기준 0.5. 문구는 "AI가 채운 값을 확인하세요." |
| FR-8 | 사용자의 기존 카테고리 중 맞는 것을 추천한다 | 정제 함수가 함께 추천해 등록 폼에서 미리 고른다 |
| FR-8a | OCR 엔진을 인터페이스 뒤에 둬 교체할 수 있게 한다 | `src/lib/ocr`의 `OcrEngine` |
| FR-14 | 저장 후 모든 필드를 편집한다 | 같음 |
| FR-15 | 위시를 다른 카테고리로 옮긴다(미분류 포함) | 다중 선택 일괄 이동도 있음 |
| FR-15a | 태그를 칩으로 넣고, 태그를 누르면 그 태그의 위시만 모아 본다 | 같음 |
| NFR-1 | 분석 단계별 상태를 보여 준다 | "글자를 읽는 중…" → "AI가 정보를 정리하는 중…" |
| NFR-2 | AI가 실패해도 수동 입력으로 저장할 수 있다 | 같음 |
| NFR-3 | 개인정보 처리 범위를 고지한다 | PRD 문장은 "텍스트만 AI로"지만, 지금 범위는 방침(`legal/privacy.html`)과 `src/constants/privacy.ts`가 정본이다(제품 영역 크롭, 구매처 찾기 포함) |
| E-1 | OCR 결과가 없으면 수동 입력을 안내한다 | 텍스트가 부족하면 제품 영역 지정 시트가 먼저 열린다 |
| E-2 | AI 정제 실패·시간 초과·네트워크 오류 → 원문을 보여 주고 수동 입력 + 재시도 | 요청 한도 초과(`429`)·입력 상한(`400`)도 같은 경로 |
| E-3 | 제품명만 못 뽑으면 입력을 안내하고 저장을 막는다 | 문구는 "제품명을 인식하지 못했습니다. 직접 입력하세요." |
| E-5 | 사진 업로드가 실패하면 저장을 멈춘다(사진 없는 위시는 만들지 않음) | 같음 |

### 그 밖의 용어

| 용어 | 뜻 |
|---|---|
| 위시 | 사용자가 저장한 제품 하나. 코드·DB에서는 `item` |
| 카테고리 · 미분류 | 위시를 묶는 단위. 초기 화면 이름이 '폴더'라 일부 주석과 `FolderPickerSheet`에 그 이름이 남아 있다. 미분류 = 카테고리 없음 |
| 링크붙이기 모드 | 웹페이지 URL을 공유하면 전체 탭이 열려, 기존 위시를 골라 링크를 채우거나 새로 담는 모드 |
| 입구 채널 | 캡처에 보인 판매처 도메인 또는 쇼핑몰. 구매처 링크를 찾을 범위를 정한다 |
| 정답셋 · 홀드아웃 | 정답셋 = 사람이 정답을 붙인 캡처 44장(AI 가격 정확도 측정용). 홀드아웃 = 프롬프트를 고칠 때 보지 않고 마지막 확인에만 쓰는 몫 |
| 측정 변형 `v0`·`v1`·`v1h` | 정답셋 측정에서 비교한 프롬프트·모델 조합(`goldset/REPORT.md`) |
| 코치마크 | 화면 요소를 둥글게 비춰 설명하는 첫 실행 안내 |
| 하프시트(formSheet) | 화면 아래에서 반쯤 올라오는 iOS 시트. 위시 정보 화면이 이 방식 |
| egress | Supabase에서 밖으로 나가는 전송량(Free 플랜 월 5GB). 썸네일·URL 캐시를 두는 이유 |
| fail-open · fail-closed | 요청 한도 카운터에 오류가 나면 요청을 허용(open)할지 거절(closed)할지. AI 정제는 open(3초 넘게 걸리면 거절), 구매처 찾기는 closed |
| `ops` 스키마 | API로 노출되지 않는 운영 테이블(요청 한도 카운터·실패 기록·개발자 계정 목록·탈퇴 사유·계정 삭제 진행 상태) |
| RLS | 행 단위 접근 제어. 사용자는 자기 행만 읽고 쓴다 |
| OTA | 심사 없이 JS만 바꿔 설치된 앱에 내보내는 배포(`eas update`) |
| runtimeVersion(fingerprint) | 앱의 네이티브 구성에서 계산한 지문. 바뀌면 이후 OTA는 그 빌드를 받은 사용자에게만 간다 |
| 개발용 앱(WishShot Dev) | 스토어 앱과 한 기기에 나란히 설치되는 개발 빌드. 별도 번들 ID·익명 계정 |
| 불변식 N | 작업 기록마다 따로 번호를 매긴 '반드시 지킬 조건'. 같은 번호라도 문서마다 뜻이 다르다 |
| Step · Batch · 갈래 | 작업 기록 안의 작업 단계 이름 |
