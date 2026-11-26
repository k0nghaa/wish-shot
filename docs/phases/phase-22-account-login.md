# Phase 22 — 계정 로그인 (Apple·카카오)

> **이 문서 사용법**: 상위 세션(`login-workspace`)이 이 문서 전체를 기준으로 하위 워크트리 4개(login-server·login-feature·login-design·login-qa)에 Step을 나눠 맡기고(Orca), 질문·완료 보고를 사람에게 전한다. 사람은 상위 세션 하나와 대화한다. **사람** Step(콘솔 설정, 비밀 값 등록, 마이그레이션 적용, 함수 배포, EAS 빌드·제출, 실기기 확인)은 에이전트가 대신하지 않는다. 하위 브랜치 안의 커밋은 자유이고, **상위로 합칠 때** 변경 요약을 보고하고 승인을 받는다. 상위 브랜치 커밋과 dev PR은 승인을 받은 뒤 한다. 커밋 메시지에 Phase·Step 번호를 넣지 않는다.
>
> **브랜치**: 상위 `feat/phase-22-account-login`(워크트리 `login-workspace`). 익명 세션 유실 수정(`fix/anon-session-loss`, 워크트리 `anon-session-fix`)은 dev에 합쳐지고(PR #54, 2026-11-25) OTA가 나갔다. 상위는 그 뒤의 `dev`(`c861e12`) 위에 있다. 하위 4개는 Step 1 커밋 뒤 상위 브랜치에서 만든다. 하위는 같은 파일 `src/lib/queries/auth.ts`·`src/lib/supabase.ts`·`src/app/_layout.tsx`를 anon-session-fix 결과 위에서 고친다.
>
> **배포**: 네이티브 패키지를 넣으므로 OTA가 아니라 **스토어 빌드 1.2.0**(`release/v1.2.0` → production 빌드 → 제출)으로 낸다. runtimeVersion이 바뀌어 이후 OTA는 1.2.0 사용자만 받는다(1.1.0 사용자는 App Store 업데이트로만 받는다).
>
> **Phase 20과의 순서**: Phase 20(`feat/phase-20-region-candidates`)은 이 빌드가 나갈 때까지 dev에 합치지 않고, 다음 빌드에 넣는다.
>
> **네이티브 패키지(사람 승인됨, 이 빌드 하나에)**: `expo-apple-authentication` 57.0.2, `expo-crypto` 57.0.4, `@react-native-kakao/core`·`@react-native-kakao/user` 3.2.0을 추가한다. 쓰지 않는 `expo-web-browser`를 뺀다(`src`에서 쓰는 곳 없음 — 카카오를 네이티브로 정해 필요 없어짐). 미뤄 둔 네이티브 정리(`.gitignore` 템플릿 규칙·줄바꿈, 안 쓰는 의존성, `web` 스크립트·`app.json` android/web 블록, `modules/expo-vision-ocr` 문구)도 이 빌드에 넣는다. 그 밖의 네이티브 추가는 CLAUDE.md 규칙 3대로 비교·보고·승인. `expo-notifications`는 승인했다가 철회했다(푸시 알림을 넣지 않음).
>
> **근거 원칙**: 표기 [코드] = 설치된 코드·공개 서버 코드로 확인, [문서] = 공식 문서 원문 확인, [재현] = 돌려서 확인, [미확인] = 확인 못 함. [미확인]은 '확인할 것'의 Step에서 확인하고, 확인 전에는 그것에 기대는 코드를 확정하지 않는다(CLAUDE.md 규칙 6).
>
> 관련 문서: 결정 근거와 논의 경과는 저장소 밖 기록 `login-workspace/.omc/handoffs/login-design-decisions.md`(2026-11-22~25)에 있다. 익명 세션 유실 수정의 인수인계 `anon-session-fix/.omc/handoffs/anon-session-loss.md`. 2026-11-04 초안 `.omc/handoffs/phase-22-account-login.md`(메인 폴더)는 이 문서가 대체한다.

---

## 목표 (Goal)

앞으로 넣을 위시리스트 공유·커뮤니티를 위해 Apple·카카오 로그인을 넣고, **익명 사용자를 최대한 남기지 않는다.**

- 새로 설치한 사람에게 로그인 화면을 보이고, 기존 익명 사용자에게는 반시트로 한 번 권한다.
- 로그인하면 익명으로 담은 위시는 그 계정으로 옮긴다(처음 쓰는 수단이면 그 계정이 되고, 이미 계정이 있으면 합친다).
- 로그인 없이 쓰는 길은 남긴다. 근거: App Store 심사 지침 5.1.1(v) "If your app doesn't include significant account-based features, let people use it without a login." [문서], HIG 「Managing accounts」 "Ask people to create an account only if your core functionality requires it" [문서]. 위시샷의 핵심(저장)은 계정 없이 동작하고 1.0~1.1이 그렇게 출시됐다. 나중에 생길 로그인 전용 기능 앞에서는 "로그인해야 가능" 안내를 둔다.
- 앱 안에서 계정을 삭제할 수 있고, 삭제할 때 소셜 연결도 끊는다(5.1.1(v)).

## 확정된 결정

### 계정
- **로그인 수단**: Apple·카카오 둘 다. 구글은 나중.
- **이메일을 받는다**: Apple은 EMAIL 범위를 요청하고, 카카오는 비즈 앱 전환 + 이메일 **필수 동의**. 이름은 받지 않는다. 목적 문구(카카오 심사·방침 공통): "계정 식별, 중복 가입 방지, 서비스 운영 관련 중요 안내".
- **같은 이메일이면 한 계정**(Supabase 기본 자동 연결). 이메일이 다르거나 Apple에서 이메일을 가린 경우는 별도 계정.
- **한 계정에 로그인 수단은 하나만**: 같은 이메일이 다른 수단으로 이미 가입돼 있으면 막고 "이미 Apple로 가입한 이메일입니다. Apple로 로그인하세요."(수단 이름은 실제 수단). 앱이 Supabase에 보내기 전에 서버 함수 '가입 확인'을 거친다(설계 1). Apple에서 가린 이메일은 막을 수 없어 별도 계정. 나중에 구글을 넣으면 같은 자동 연결이 적용되므로 가입 확인이 구글도 막아야 한다. 계정을 지우면 이메일도 지우므로 삭제 뒤 재가입은 막지 않는다.
- **익명 계정은 사용자가 "로그인 없이 시작"을 고를 때만 만든다.** 자동 생성 금지.
- **로그인 방법 추가·연결 해제 메뉴는 없다.** 소셜 연결 끊기는 계정 삭제가 맡는다.
- **iPhone 설정에서 위시샷의 Apple 연결을 끊으면**: 로그아웃 상태로만 바꾸고 데이터는 둔다. 같은 Apple ID로 다시 로그인하면 같은 계정이다(실기기 확인). 근거: TN3194의 "Delete all user-related account data"는 계정 삭제 요청을 받았는데 토큰을 철회하지 못한 경우의 절차이고, 연결 해제만 한 경우는 「Processing changes for Sign in with Apple accounts」가 "update your server's records according to your process"라고만 한다 [문서].
- **푸시 알림은 넣지 않는다.** 공지는 이메일로(발송 수단은 보낼 일이 생길 때 정함. Apple 중계 주소로 보내려면 발송 도메인·주소 등록과 SPF/DKIM이 필요 [문서]).

### 합치기 (익명 위시 → 로그인 계정)
- 처음 쓰는 Apple·카카오: 익명 계정이 그대로 로그인 계정이 된다(`linkIdentity`, 같은 uid). 합칠 것이 없다.
- 이미 계정이 있는 수단: 익명 위시를 그 계정에 **자동으로 합치고** 알린다.
- 같은 위시(브랜드+제품명 정규화가 같음 — `UNIQUE(user_id, normalized_name)`): **로그인 계정 것을 남기고**, 비어 있는 가격·링크·메모·카테고리만 익명 위시 값으로 채운다. 태그는 합친다. 익명 쪽 사진은 지운다.
- 같은 이름 카테고리는 하나로.
- 위시는 **id를 유지한 채** 옮긴다(기기 알림 기록이 위시 id를 가리킴). 사진은 `{익명 id}/` → `{로그인 id}/`로 옮기고(Storage `move` [코드, storage-js]) `image_key`를 바꾼다. 분석 기록도 옮긴다.
- 모두 옮긴 것을 확인한 뒤에만 익명 계정을 지운다. 중간에 실패하면 다시 불러 이어서 한다(멱등).
- 익명 위시가 0개면 합치기를 부르지 않는다. 남은 빈 익명 계정은 기존 주간 작업(`0002`, 위시 0개·생성 30일+)이 지운다.
- 다른 사람이 쓴 익명 위시가 합쳐지는 경우는 드물다고 보고 그대로 둔다.

### 닉네임
- 새 계정이 만들어질 때만 닉네임 화면을 띄운다(처음 쓰는 Apple·카카오, 익명에서 연결 포함). 기존 계정 로그인·합치기에는 띄우지 않는다.
- 계정을 만들 때 추천값 "위시러" + 숫자 4자리를 **바로 저장**한다(화면을 안 누르고 앱을 꺼도 닉네임이 있다). 화면은 바꿀 기회로 한 번만. 겹치면 서버가 다시 뽑거나 자릿수를 늘린다.
- 2~12자, 한글·영문·숫자만(띄어쓰기·특수문자 없음). **닉네임 자체가 고유**(대소문자 무시, 한글은 NFC 정규화 뒤 비교). 변경 제한 없음. 바꾸거나 계정을 지우면 그 닉네임은 바로 다시 쓸 수 있다.
- 예약어는 **정확히 같을 때만** 막는다(대소문자 무시): 위시샷, wishshot, 관리자, 운영자, admin, 위시샷공식.
- 욕설 거르기는 커뮤니티 때.

### 계정 삭제
- 익명 계정도 삭제할 수 있다.
- 서버 순서(멱등, 연결 해제 먼저): ① 본인 확인 ② Apple 토큰 철회 또는 카카오 연결 해제(카카오에서 이미 끊었으면 성공 취급) ③ 사진(원본·썸네일) 삭제 — 사용자를 지워도 Storage 파일은 남으므로 ④ 실패 기록은 사용자 id를 떼어 날짜·사유별 합계로, 탈퇴 사유 기록, PostHog 프로필 삭제(이벤트는 유지 — 삭제 API에 `delete_events=true`를 붙이지 않음) ⑤ 사용자 삭제 → 위시·카테고리·분석 기록·닉네임 cascade.
- Apple 철회(카카오는 연결 해제 — qa ① 처리 P-10)에 실패하면 서버는 **스스로 삭제를 이어가지 않고 아무것도 지우지 않은 채 멈춘다.** 그 뒤 사용자가 [연결 해제 없이 삭제]를 직접 고를 때만 연결을 남긴 채 계정을 지우고, 완료 창에 직접 끊는 방법을 안내한다. 이 버튼은 연결 해제가 계속 실패해도 앱 안 삭제(심사 지침 5.1.1(v))가 막히지 않게 하는 길이다 — TN3194: 토큰을 철회하지 못해도 삭제 요청은 처리하고 수동 해제를 안내한다(2026-11-26 사람 확인).
- PostHog 프로필 삭제에 실패하면 계정 삭제는 진행하고, 지우지 못한 PostHog 식별자만 남겨 주간 정리 작업에서 다시 지운다(지우면 그 기록도 지움).
- **탈퇴 사유**는 PostHog로 보내지 않는다. 위시샷 DB의 `ops` 표 두 곳에 **사용자 id 없이** 저장한다: 날짜·사유별 횟수(계속 보관), "기타" 직접 입력 글(200자 이하, 3년 뒤 주간 작업이 지움).
- 지우는 것: 위시·사진·분석 기록·닉네임·로그인 정보·이메일. 통계로 남기는 것: 사용자 id를 뗀 실패 기록 합계, PostHog 이벤트, 탈퇴 사유 횟수.
- 삭제를 마치면 기기의 위시샷 기록과 세션을 전부 지우고 새 설치와 같은 흐름(온보딩 카드부터)으로 간다. `AsyncStorage.clear()`는 쓰지 않는다(다른 라이브러리 값까지 지움).

### 끊긴 익명 세션의 복구
- 자동 복구는 없다. 만료된 accessToken(RFC 7519 4.1.4 "MUST NOT be accepted")과 거절된 refreshToken은 증거로 쓰지 않는다.
- **문의로 되찾는다.** 대상은 서버가 세션을 거절한 경우뿐이다(앱 삭제·기기 변경은 되찾을 수 없음 — 확인창 A).
- 본인 확인은 가볍게: 문의 번호(계정 ID 앞 8자 대문자 — 그 기기에만 있고 메일도 그 기기에서 보냄) + 질문 하나(대략 위시 수나 카테고리 이름 하나). 운영자는 그 계정의 요약(만든 날짜·위시 수·카테고리 이름·최근 위시 이름 몇 개)만 보고 사진은 보지 않는다.
- 옮길 곳은 사용자가 지금 쓰는 계정이다. `user_metadata.previous_user_id`(anon-session-fix의 "새로 시작"이 남기는 값. 로그인 빌드에서는 확인창 D 뒤 "로그인 없이 시작"도 새 익명 계정에 이 값을 남긴다 — 2026-11-25 사람 결정) 또는 "의견 보내기" 메일의 문의 번호로 찾는다. 옮기기는 합치기 서버 함수를 운영자가 실행한다(설계 1).

### 계측
- 로그인 화면·반시트 노출, 건너뛰기, 로그인 결과, 합치기 결과, 닉네임 저장, 로그아웃, Apple 연결 해제 감지, 계정 삭제 이벤트를 넣는다(설계 5). 속성은 enum·boolean·수치만. 트래킹 플랜을 갱신한다.

### 방침·고지 (글은 Step 6)
| 위치 | 내용 |
|---|---|
| 1절 수집 항목 | 로그인 식별자(Apple·카카오 고유 번호), 이메일(Apple — 가린 중계 주소일 수 있음, 카카오 — 필수 동의), 닉네임, 탈퇴 사유(선택, 사용자 id 없이, 기타 글 3년) |
| 1절 기존 문장 | "이름·이메일 등 개인 식별 정보는 수집하지 않습니다" 수정 |
| 4절 앱 사용 통계 | 로그인 관련 이벤트(종류·결과 값만) |
| 6절 인증 | 익명으로 시작, 선택 로그인(Apple·카카오), 한 계정 수단 하나, 익명 위시 합치기 |
| 7절 보관 및 삭제 | 앱 안 계정 삭제(즉시), Apple 철회·카카오 연결 해제, 통계로 남는 것, 탈퇴 사유 3년 |
| 문의 처리 | 문의를 처리할 때 해당 계정 정보를 확인할 수 있음 |
| 앱 안 고지 `src/constants/privacy.ts` | "로그인" 항목 추가, "수집하지 않는 것" 수정 |
| App Store 앱 개인정보 | 사용자 ID, 이메일, 닉네임 등(분류는 글 쓸 때) |
- 동의 체크박스는 두지 않고 로그인 화면에 방침 링크만 둔다. 근거: 2023 개정 개인정보 보호법 제15조 제1항 제4호(계약 이행에 필요하면 동의 없이), 옛 제39조의3 삭제 — 해설 기사로 확인, 법 원문·위원회 안내서 [미확인].
- 이용약관은 공유 기능 때 만든다.
- 게시 순서: 카카오 동의항목 심사에 방침 URL이 필요하면 그 전에, 늦어도 빌드 제출 전에 `main` → GitHub Pages 게시 + 노션 동기화(기존 절차).

## 하지 않는 것

- 처음부터 로그인 필수(로그인 벽)
- 푸시 알림(`expo-notifications`), 구글 로그인, 이용약관
- 본인인증(실명·휴대폰). 근거: 인터넷 본인확인제 위헌(2010헌마47), 5.1.1(v) "Apps may not require users to enter personal information to function…"
- 로그인 방법 추가·연결 해제 메뉴, 계정 번호를 화면에 보이기
- Apple `consent-revoked` 서버 알림 수신 주소
- 토큰을 증거로 쓰는 자동 복구
- 소셜 토큰을 서버에 저장하기(5.1.1(v) "An app may not store credentials or tokens to social networks off of the device")
- 사용자에게 "사용 안내 다시 보기" 노출(개발용으로만 유지)
- 닉네임 욕설 거르기
- 로그인 화면의 설명 문구·제목, 동의 체크박스

---

## 흐름

### 공통
- 앱이 켜질 때 **기기에 저장된 정보만 읽고**, 첫 화면이 정해질 때까지 **스플래시를 유지**한다. 통신하지 않는다(만료 토큰 + 나쁜 통신이면 auth-js가 30초 안팎 재시도해 스플래시가 멈춘 것처럼 보인다 [코드]).
- 저장된 정보를 **읽지 못한 것은 "세션 없음"이 아니다** → 다시 시도.
- 로그인 화면과 반시트는 **통틀어 1회**다. 로그인 화면을 건너뛴 사람에게 반시트를 띄우지 않는다.
- 온보딩 카드는 아직 안 본 사람에게만.
- 판단은 써 본 흔적이 아니라 **기기 상태 기록**(설계 4 `accountState`)으로 한다.

### 1. 홈 화면 진입
| 상태 | 화면 |
|---|---|
| 세션 없음 + 로그인한 적 없음(새 설치, 재설치·새 기기 — 구분 불가) | 온보딩 카드 → 로그인 화면(로그인 없이 시작 + 확인창 A) → 전체 탭 → 사용 안내(카드를 건너뛰었거나 로그인해서 기존 위시가 있으면 생략) |
| 세션 없음 + 로그인한 적 있음(로그아웃, 로그인 세션 만료) | 로그인 화면(최근 로그인, 로그인 없이 시작 + 확인창 B) |
| 익명 세션 | 전체 탭 + 반시트(통틀어 1회) |
| 공유로 시작해 온보딩을 안 본 사람 | 온보딩 카드 → 전체 탭 → 사용 안내(로그인 화면은 다시 안 띄움) |
| 로그인 세션 | 전체 탭 |
| 지난 실행에서 서버가 익명 세션을 거절함(기기 상태 "서버 거절") | 흐름 3의 화면(알림창 C), 해결될 때까지 유지. 거절 때 위시를 저장한 흔적이 없었으면 "서버 거절"로 기록하지 않고 "로그인한 적 없음"과 같은 화면(알림창 C 없음) |
| 세션은 있는데 재발급만 실패 | 전체 탭 + 목록 실패 표시와 다시 시도. 새 계정 생성 금지 |

### 2. 공유 시트 진입 (온보딩 없음 — 지금 `OnboardingGate`가 공유 실행이면 건너뛰고 봤다는 표시를 남기지 않는다 [코드])
- 사진 공유 → 등록 폼 / 링크 공유 → 전체 탭 링크붙이기 모드.
- 세션 없음: 로그인 화면 → 로그인 또는 건너뛰기 → 위 화면. 로그인한 적 있으면 최근 로그인 + 확인창 B.
- 익명 세션: 위 화면 → **저장 성공 뒤** 반시트(1번과 합쳐 1회, 취소면 횟수를 안 씀). 저장하면 `goToSavedCategory()`로 카테고리 목록에 가므로 거기서 뜬다.
- 로그인 세션: 위 화면.
- 세션은 있는데 재발급만 실패: 위 화면을 열고, 저장에 실패하면 작성 내용을 유지한다. **등록 폼의 다시 시도는 앱 새로고침이면 안 된다**(작성 내용 소실). 재발급 실패 뒤 auth-js가 같은 refreshToken에 60초 동안 실패를 돌려주므로 통신이 돌아와도 잠시 저장이 안 될 수 있다 [코드].
- **로그인 화면이 떠 있는 동안 온 공유**: 맡아 두었다가 로그인·건너뛰기 뒤에 연다(마지막 1개, 메모리에만). `expo-share-intent`는 앱이 inactive/background가 되면 값을 지우므로(`resetOnBackground: true` [코드]) 처리기가 먼저 꺼내 맡아 둔다. 지금 처리기는 앱 스택이 약 5초 안에 없으면 공유를 버린다 → 고친다.

### 3. 실행 중 서버가 세션을 거절 (확실히 거절한 경우만 — 첫 화면은 통신 없이 정하므로 전체 탭이 먼저 뜬 뒤 바뀐다)
- 익명이었음: 로그인 화면 + 열릴 때 알림창 C + "로그인 없이 시작" + 확인창 D. 이전 계정 번호는 기기에 보관.
- 익명이었고 위시를 저장한 흔적이 없음(anon-session-fix `hasWishTrace` — 잃을 위시가 없음): 알림창 C 없이 새 설치와 같은 로그인 화면(확인창 A). 이전 계정은 기기에 보관하고, "로그인 없이 시작"이 `previous_user_id`를 남긴다. anon-session-fix의 `restarted`(화면 없이 새 익명 계정)는 불변식 1 때문에 쓰지 않는다(2026-11-26 사람 결정).
- 로그인이었음: 로그인 화면(최근 로그인, 확인창 B). 다시 로그인하면 기존 위시가 보인다.
- 등록 폼 작성 중: 폼을 닫지 않고, 저장할 때 로그인 화면을 띄우고 로그인하면 이어서 저장.

### 4. 로그인 화면으로 가는 다른 길
- 설정 '계정', 반시트, (나중에) 로그인 전용 기능 안내: "로그인 없이 시작" 대신 닫기(X), 로그인 뒤 하던 일로.
- 로그아웃(로그인 계정만): 확인창 → 로그인 화면(최근 로그인).
- 계정 삭제(익명 포함): 안내 화면 → … → 기기 기록 전부 정리 → 새 설치와 같은 흐름.

### 5. 로그인 뒤 화면 순서
- 새 계정 → 닉네임 → 원래 가려던 화면(첫 실행 = 전체 탭 → 사용 안내 / 공유 = 등록 폼 / 설정·반시트 = 하던 화면).
- 기존 계정 + 익명 위시 있음 → 합치는 중 → 원래 가려던 화면.
- 그 밖 → 원래 가려던 화면. 닉네임과 합치기는 같이 나오지 않는다.

### 6. 온보딩 순서
**카드 → 로그인 → (전체 탭) 사용 안내.** 사용 안내의 탭 바 코치마크·등록 폼 안내는 전체 탭·등록 화면이 있어야 하고 그 화면은 세션이 있어야 그려진다. 로그인 화면은 오버레이가 아니라 상태가 정하는 경로다(Expo Router `Stack.Protected` — React Navigation 「Authentication flows」 "conditionally defined the screens based on the value of isSignedIn" [문서]).

---

## 화면

모든 문구는 CLAUDE.md 규칙 4, 색은 `theme.ts` 토큰만(카카오 노랑은 브랜드 토큰으로 추가).

### 로그인 화면
- 위시샷 로고 아래 **Apple로 로그인** / **카카오 로그인**(같은 크기, 세로), "로그인 없이 시작"(작은 글자 버튼), "개인정보처리방침" 링크. 설명 문구·제목 없음.
- 버튼 규정 [문서]:
  - Apple HIG: "Make a Sign in with Apple button no smaller than other sign-in buttons, and avoid making people scroll to see the button." 문구는 Sign in/Sign up/Continue with Apple 세 가지만, 로고·글자는 검정 또는 흰색만. 시스템 버튼(`AppleAuthenticationButton`) 권장, 최소 너비 140pt.
  - 카카오 디자인 가이드: 바탕 `#FEE500`, 심볼 `#000000`, 글자 `#000000` 85%. 색 변경 금지, "버튼의 색상을 지정하지 않아 타사 로그인 버튼을 강조해서는 안 됩니다". 문구 "카카오 로그인"(완성형).
  - 카카오가 "카카오 로그인"이라 Apple도 "Apple로 로그인".
- **최근 로그인**: 마지막으로 쓴 수단 버튼에만 "최근 로그인". 기기에 기록. 로그아웃해도 남기고 계정 삭제 때 지움. 새 기기엔 없음.
- 들어온 길별 차이:

| 들어온 길 | 화면 | 아래쪽 |
|---|---|---|
| 첫 실행, 공유 | 기본 | 로그인 없이 시작 → 확인창 A |
| 로그아웃, 로그인 세션 만료, Apple 연결 해제 감지 | 썼던 버튼에 "최근 로그인" | 로그인 없이 시작 → 확인창 B |
| 익명 세션 끊김 | 기본, 열릴 때 알림창 C | 로그인 없이 시작 → 확인창 D |
| 설정, 반시트, 로그인 전용 기능 | 기본 | 닫기(X) |

- 창 문구(iOS 기본 확인창):

| 창 | 제목 | 본문 | 버튼 |
|---|---|---|---|
| A | 로그인 없이 시작할까요? | 로그인하지 않으면 앱을 삭제하거나 기기를 바꿀 때 위시를 되찾을 수 없습니다. 로그인은 설정에서 언제든 할 수 있습니다. | 취소 / 시작 |
| B | 로그인 없이 시작할까요? | 이전 계정의 위시는 다시 로그인해야 볼 수 있습니다. 지금부터 담는 위시는 나중에 로그인하면 계정에 합쳐집니다. | 취소 / 시작 |
| C (열릴 때) | 계정을 확인하지 못했습니다 | 이 기기에 저장된 계정을 서버에서 찾을 수 없습니다. | 문의하기 / 다시 시도 / 확인 |
| D | 로그인 없이 시작할까요? | 이전 위시는 문의로만 되찾을 수 있습니다. | 취소 / 시작 |

- "로그인 없이 시작"을 통신 없이 누르면: "시작하지 못했습니다" / "네트워크 연결을 확인하세요."
- 다른 수단으로 가입된 이메일: "이미 Apple로 가입한 이메일입니다. Apple로 로그인하세요."
- 기존 개발용 `src/app/login.tsx`(이메일·비밀번호, `__DEV__` 설정에서만)는 지우지 않는다. 경로를 `dev/email-login`으로 바꾸고, 화면에서 `supabase.auth.signInWithPassword`를 직접 부르는 것(규칙 11 위반)을 데이터 레이어로 옮긴다.

### 닉네임 화면
- 제목 "닉네임", 입력칸(지금 닉네임 채움, 지우기 버튼), 도움말 "2~12자, 한글·영문·숫자", 겹치면 "이미 사용 중인 닉네임입니다" + 추천 칩 2개(눌러서 채움, 예: 민지27·민지815), 키보드 위 [완료]. 설정에서 열면 [저장].
- 입력을 멈추면 확인하고, 저장 때 서버에서 한 번 더 확인한다(동시 선점).
- 오류 문구: "이미 사용 중인 닉네임입니다", "2~12자로 입력하세요", "한글·영문·숫자만 쓸 수 있습니다", "쓸 수 없는 닉네임입니다"(예약어).

### 반시트 (기존 익명 사용자 1회)
- iOS 반시트(`formSheet`, 정보 화면과 같은 방식 — 재빌드 불필요).
- 제목 "위시 12개를 계정에 보관"(개수를 모르거나 0개면 "위시를 계정에 보관") / 본문 "앱을 삭제하거나 기기를 바꿔도 위시를 다시 볼 수 있습니다." / Apple로 로그인 / 카카오 로그인 / 나중에.
- 언제: 업데이트 뒤 첫 일반 실행(전체 탭), 또는 공유 저장 성공 뒤(카테고리 목록). 위시 개수와 상관없이 — 통신 없이 판단.
- "나중에"·끌어 내림 = 닫히고 다시 안 뜸(확인창 없음). 저장 뒤 앨범 삭제 확인창이 떠 있으면 닫힌 뒤에 띄움.

### 설정 '계정' 영역 (설정 맨 위, 기존 "개인정보 안내"·"지원"은 아래로)
- 로그인했을 때: 닉네임(누르면 닉네임 화면) / 이메일(표시만, Apple에서 가렸으면 중계 주소) / 로그인 방법(예: Apple, 누를 수 없음) / 로그아웃 / 계정 삭제(빨간 글자).
- 익명일 때: 로그인(값 "로그인 안 함" ›, 로그인 화면 닫기 X) / 계정 삭제.
- 로그아웃 확인창: "로그아웃할까요?" / "다시 로그인하면 위시를 볼 수 있습니다." / [취소] [로그아웃].
- 합치기 실패가 남아 있으면 "합치지 못한 위시 12개 · 다시 시도" 행(익명 세션까지 못 쓰게 되면 "문의하기"로 바뀌고 메일에 이전 계정 번호).
- "의견 보내기" 메일 본문 맨 아래에 "문의 번호: XXXXXXXX"(`supportMail.ts` `inquiryNumber()` — 계정 ID 앞 8자 대문자, 익명·로그인 모두). 사용자는 보내기 전에 지울 수 있다.

### 계정 삭제
```
설정 > 계정 삭제 → 안내 화면(사유 선택) → [계정 삭제]
  → (Apple 계정만) Apple 재인증
  → 삭제하는 중 → 완료 확인창 "계정을 삭제했습니다"
  → 온보딩 카드부터 (새로 설치한 것과 같음)
```
- 안내 화면: "삭제하면 위시 12개와 사진이 모두 지워지며 복구할 수 없습니다." / 삭제하는 이유(선택): 잘 쓰지 않음 · 원하는 기능이 없음 · 다른 계정으로 사용 · 개인정보가 걱정됨 · 기타(고르면 200자 직접 입력칸) / [계정 삭제](빨간 글자). 추가 확인창 없음. Apple 계정이면 버튼 위에 작게 "다음 화면에서 Apple 계정을 한 번 더 확인합니다."
- Apple 재인증 **취소 = 삭제 안 함**(안내 화면으로).
- 재인증 실패·철회 실패 = 아무것도 지우지 않고 "Apple 연결을 해제하지 못했습니다" [다시 시도] [Apple 연결 해제 없이 삭제]. 연결 해제 없이 삭제하면 완료 창에 "iPhone 설정의 Apple 계정 > 로그인 및 보안에서 위시샷 연결을 해제할 수 있습니다"를 더한다(메뉴 경로는 실기기 확인). 다시 시도하면 Apple 창이 또 뜬다(인증 코드는 "single-use only and valid for five minutes" [문서]).
- 삭제 시작 때 기기에 "삭제 중"을 먼저 기록한다. 도중에 앱이 꺼지면 다음 실행에 다시 부르고, 서버가 "사용자 없음"이면 완료 처리한다.
- 완료 뒤 기기 정리: 설계 4의 '계정 삭제' 열.

### 합치기 알림
```
로그인 성공 → (익명 위시 0개) 바로 다음 화면
           → (1개 이상) "위시를 합치는 중" 전체 화면
              → 성공: 다음 화면 + 스낵바 "위시 12개를 합쳤습니다"(같은 위시로 합쳐진 것 포함, 내역은 안 씀)
              → 실패: 확인창 "위시를 합치지 못했습니다" / "이 기기의 위시는 지워지지 않았습니다. 다음에 앱을 열 때 다시 시도합니다." [확인] [다시 시도]
```
- 실패하면 기기에 "합칠 것 남음"(설계 4 `pendingMerge`)을 남기고 **앱이 켜질 때마다**, 다른 앱에서 돌아올 때(1분에 1번까지) 다시 시도한다. 앱 종료·재부팅 뒤에도 남고 앱 삭제 때만 사라진다.
- 다시 시도할 때마다 새로 받은 익명 refreshToken을 바로 저장한다(낡은 토큰을 거듭 쓰면 서버가 세션을 끝냄).
- 대상 계정으로 로그인해 있을 때만 시도한다(다른 계정이면 시도하지 않고 설정 행만 남김).

### 목록 실패 표시 (전체, 카테고리 홈, 카테고리별, 태그별, 검색)
- 지금 [코드]: 실패하면 오류창 + `setItems([])` → "아직 담은 위시가 없습니다"(0개와 구분 안 됨). 검색 탭은 오류창도 없이 빈 결과.
- 처음부터 못 불러옴: 목록 자리에 "불러오지 못했습니다" / "네트워크 연결을 확인하세요." / [다시 시도].
- 이미 불러온 목록이 있음: 목록 유지 + 스낵바 "불러오지 못했습니다" [다시 시도].
- 불러오기 실패의 오류창은 없앤다. 모든 목록에 당겨서 새로고침. 다른 앱에서 돌아올 때 다시 불러온다.
- 다시 시도 = 그 목록만 다시 불러옴(앱 새로고침 아님). 재발급 실패 직후라면 1분쯤 계속 실패할 수 있다.

---

## 설계 — 하위 워크트리 사이의 약속

이름(함수·표·키)은 하위가 더 나은 이름을 제안하면 상위가 약속을 고쳐 모두에게 전한다. 오류 응답은 기존 함수 관례대로 `{ error: "<code>" }` + HTTP 상태.

### 1. 서버 (login-server) — 서버 함수 3개 + 닉네임 DB 함수 3개
닉네임은 외부 API·비밀 키가 필요 없어 DB 함수로 한다(CLAUDE.md "API 키가 필요한 일만 Edge Function").

| 이름 | 인증 | 요청 | 응답·오류 |
|---|---|---|---|
| 가입 확인(Edge) | 앱 키로 부른다(세션이 없을 수 있음 — `verify_jwt` 설정 확인). 증거는 ID 토큰 | `{provider, idToken, nonce}` | 서명·iss·aud(운영·개발 클라이언트 ID)·exp·nonce(sha256) 검증 → `{result:'ok', account:'new'\|'existing'}` · `{result:'other_provider', provider}` · `invalid_token`(401). 토큰에 이메일이 없으면 이메일 검사를 건너뛴다. 조회는 service_role 전용 DB 함수 |
| 합치기(Edge) | `Authorization` = 로그인 계정 토큰 + 본문의 익명 access token(둘 다 검증, 익명 쪽 `is_anonymous`) | `{anonAccessToken}` · 운영자 경로: service_role + `{fromUserId, toUserId}`(from은 익명만, to는 익명·로그인 모두) | `{status:'done'\|'partial', merged, remaining}` — 정한 개수씩 처리하고 앱이 이어 부른다. 위시마다 멱등(Storage 대상이 이미 있으면 건너뜀). 끝나면 익명 사용자를 지운다. 오류: 토큰 무효(대상·익명), `not_anonymous`, `same_user`, 서버 오류 |
| 계정 삭제(Edge) | 사용자 토큰(익명 포함) | `{reason?, reasonText?(≤200), appleAuthorizationCode?, appleClientId?, skipAppleRevoke?}` | '확정된 결정 — 계정 삭제'의 순서. `deleted` · `already_deleted`(사용자 없음 — 앱은 완료 처리) · `apple_revoke_failed`(아무것도 안 지움) · `apple_code_required` |
| `ensure_profile()`(DB) | authenticated, 익명 아님 | — | 로그인 뒤 매번 부른다. 없으면 추천 닉네임으로 만들고 `{nickname, created}` — created면 닉네임 화면 |
| `check_nickname(name)`(DB) | authenticated | 닉네임 | available · taken + 추천 2개 · invalid_length · invalid_chars · reserved · unchanged |
| `set_nickname(name)`(DB) | authenticated | 닉네임 | 같은 검사 뒤 저장(UNIQUE 위반 → taken). profiles는 본인 행 읽기만, 직접 update 권한 없음 |

- Apple 철회: 재인증으로 받은 `authorizationCode`를 `/auth/token`으로 교환한 뒤 `/auth/revoke`. client secret JWT는 ES256, `kid`, `iss`=Team ID, `iat`, `exp`(최대 15777000초), `aud`=`https://appleid.apple.com`, `sub`=client_id(운영·개발 번들 ID) [문서] — 요청마다 만든다. 받은 토큰은 저장하지 않는다.
- 카카오 연결 해제: `POST https://kapi.kakao.com/v1/user/unlink`, 서비스 앱 어드민 키 + `target_id_type=user_id`·`target_id`(회원번호 = Supabase identity의 provider id) [문서]. 사용자 토큰을 서버에 두지 않는다.
- 마이그레이션 `0008`~: profiles(정규화 키 UNIQUE)·닉네임 함수·가입 확인 조회 함수·실패 기록 합계 함수(대상 `ops.parse_failures`·`ops.purchase_link_failures` 둘 다. `ops.parse_failures`는 `user_id not null` + PK(user_id, day, reason, llm_status)라 nil uuid 행으로 합치는 식 [코드])·탈퇴 사유 표 2개(3년 정리 포함)·PostHog 재시도 표. GRANT 명시, `security definer` 함수는 `set search_path = ''`(규칙 9). 되돌리기 SQL `supabase/rollback/`. `supabase/tests/rls.sql`·`audit.sql`에 새 표 기대값.
- 시크릿: Apple .p8·Key ID·Team ID, 카카오 어드민 키, PostHog 개인 API 키, 허용 클라이언트 ID(Apple 번들 ID 2개, 카카오 네이티브 앱 키 2개).

### 2. 데이터 레이어 (login-feature, design은 결과 흉내로)
| 함수 | 부르는 곳 | 결과 |
|---|---|---|
| `signIn(provider)` | 로그인 화면, 반시트 | 성공{다음: `nickname` \| `merge` \| `done`} · 취소 · 다른 수단으로 가입됨{수단} · 오류{통신·서버} |
| `startWithoutSignIn()` | "로그인 없이 시작" 확인창 뒤 | 성공 · 오류(통신). 끊긴 세션(확인창 D) 뒤면 `user_metadata.previous_user_id`에 이전 계정 번호를 남긴다 |
| `mergeAnonymousWishes()` | 합치는 중 화면, 설정 "다시 시도", 앱을 열 때 재시도 | 완료{N개} · 실패{통신·서버·익명 세션 잃음·다른 계정으로 로그인 중} |
| `getAccount()` | 설정 | 익명 / 로그인{수단, 이메일, 닉네임} + 합치지 못한 위시{N개, 문의만 가능한지} |
| `checkNickname(name)` · `saveNickname(name)` | 닉네임 화면 | 서버 검사 결과 / 저장됨 |
| `signOutAccount()` | 로그아웃 확인창 | 완료(기기 정리 포함). 이름은 기존 개발용 `auth.ts` `signOut`과 겹치지 않게 했다 — feature가 둘을 합쳐도 된다 |
| `confirmAppleForDeletion()` | 계정 삭제 안내(Apple만) | 확인됨(코드) · 취소 · 실패 |
| `deleteAccount({reason, reasonText, skipAppleRevoke?})` | 삭제하는 중 화면 | 삭제됨(기기 정리 포함) · Apple 연결 해제 실패 · 오류{통신·서버} |
| `getStartState()` · `subscribeAccountState()` | `_layout.tsx` | 새 설치 / 로그아웃됨{최근 수단} / 익명 / 로그인 / 익명 세션 끊김{이전 번호} / 삭제 중 / 읽기 실패 |
| `shouldShowSignInSheet()` · `markSignInPromptUsed()` | 전체 탭, 공유 저장 뒤 | 띄울지(로그인 화면과 합쳐 1회) |
| `needsNicknameSignup()` | 합치는 중 화면(합치기를 마친 뒤) | 가입 닉네임 화면이 남았는지(기기 기록, 통신 없음) — 합치기와 닉네임이 둘 다 해당할 때 합치기 뒤 닉네임(qa ② Q5-05, 2026-11-26 추가) |

- Apple 재인증을 삭제와 나눈 이유: "삭제하는 중" 화면이 Apple 창이 닫힌 뒤에 떠야 한다.
- nonce: 앱이 원래 값을 만들고 Apple·카카오에는 SHA-256 해시를, Supabase(`signInWithIdToken`·`linkIdentity`)와 가입 확인에는 원래 값을 보낸다(`token_oidc.go`가 넘긴 값을 sha256해 토큰과 비교 [코드]).
- 기존 계정으로 로그인하기 직전에 익명 세션을 `pendingMerge`에 남긴다. 합칠 때는 따로 만든 클라이언트(세션 저장·자동 갱신 끔)로 익명 세션을 새로 고쳐 새 refreshToken을 바로 저장한 뒤 access token을 함수에 보낸다.
- Apple 연결 상태: 앱이 켜질 때·돌아올 때 `getCredentialStateAsync`(+ `addRevokeListener`) → `REVOKED`·`NOT_FOUND`면 로그아웃 상태(데이터 유지).
- 로그인·합치기 뒤 PostHog `identify`를 로그인 uid로. 로그아웃·삭제 때 PostHog 초기화.
- design의 결과 흉내는 anon-session-fix의 `devSessionSimulation.ts`처럼 개발용 설정에서 위 결과를 골라 화면을 확인하는 방식이다. 가짜 DB는 만들지 않는다. feature가 진짜 함수를 커밋하면 상위가 design에 알리고 design이 그 화면을 진짜에 붙여 본다.

### 3. 화면 경로 (화면 파일 = design, 첫 화면 결정 = feature의 `Stack.Protected`)
| 경로 | 화면 | 띄우는 방식 | 파라미터 |
|---|---|---|---|
| `sign-in` | 로그인(세션 없을 때 첫 화면) | 전체 화면, 닫기 없음 | 없음 — A·B·C·D·최근 로그인은 기기 상태로 |
| `account/sign-in` | 로그인(설정·반시트·로그인 전용 기능) | 모달, 닫기(X) | `from`: settings / sheet / feature |
| `account/sign-in-sheet` | 반시트 | formSheet | 없음 |
| `account/nickname` | 닉네임 | 모달, 가입 때는 끌어내려도 안 닫힘 | `mode`: signup([완료]) / edit([저장]) |
| `account/merging` | 위시를 합치는 중 | 전체 화면, 닫기 없음 | 없음 |
| `account/delete` | 계정 삭제 안내 | push | 없음 |
| `account/deleting` | 삭제하는 중(다시 켰을 때 "삭제 중"이면 첫 화면) | 전체 화면, 닫기 없음 | 없음 |
| `dev/email-login` | 개발용 이메일 로그인(`login.tsx` 이름 변경) | 지금과 같음 | 없음 |

두 로그인 경로는 같은 화면 부품을 쓴다.

### 4. 기기 저장 키 (`wishshot.` 접두사)
| 키 | 내용 | 로그아웃 | 계정 삭제 |
|---|---|---|---|
| `accountState`(새) | 기기 상태: 익명 / 로그인 / 로그아웃 / 서버 거절 / 삭제 중 + 계정 번호·이전 번호·Apple 사용자 ID | "로그아웃"으로 | 지움 |
| `lastSignInProvider`(새) | 최근 로그인 | 남김 | 지움 |
| `signInPromptUsed`(새) | 로그인 화면·반시트 1회 | 남김 | 지움 |
| `pendingMerge`(새) | 익명 계정 번호·익명 refreshToken·대상 계정·개수 | 남김(대상 계정으로 다시 로그인하면 이어서) | 지움 |
| `sessionCopy`·`sessionArchive`(anon-session-fix) | 세션 사본·보관 목록 | 사본만 지움 | 지움 |
| `onboardingShown`·`privacyNoticeShown.v*`·`regionNoticeShown` | 본 표시 | 남김 | 지움 |
| `notifications`·`signedurl.*` | 알림 기록·사진 주소 캐시 | 지움 | 지움 |
| 세션 `sb-…-auth-token`·PostHog 저장값·사진 캐시(`expo-image` `clearDiskCache`) | — | 세션 지움·PostHog 초기화·사진 캐시 지움 | 같음 |

- 세션 저장 키는 supabase-js 기본값 그대로 둔다(바꾸면 기존 사용자 세션 소실).
- `accountState`가 없는 사용자(1.1.0·OTA에서 올라옴)는 첫 실행에서 한 번 지금 세션을 보고 기록한다. 그 뒤로 anon-session-fix의 "써 본 흔적" 짐작(`usedBefore`)은 쓰지 않는다.
- 합치기를 마치면 `pendingMerge`를 지우고, `signedurl.*`를 무효화하고(경로가 바뀜), 알림 기록에 `pruneMissingItems`를 한다. 로그아웃·삭제의 "알림 기록 지움"에 쓸 전체 삭제 함수는 지금 없으므로 추가한다.

### 5. 계측 이벤트 (`src/lib/analytics.ts`, 트래킹 플랜 갱신은 상위)
| 이벤트 | 속성 |
|---|---|
| `sign_in_viewed` | `surface`: screen/sheet, `entry`: first_launch/share/signed_out/expired/lost/settings/sheet/feature |
| `sign_in_skipped` | `surface`, `entry` |
| `sign_in_result` | `provider`: apple/kakao, `result`: linked/new/existing/cancelled/other_provider/error |
| `wishes_merged` | `result`: success/failed, `count`, `attempt`: first/retry |
| `nickname_saved` | `mode`: signup/edit, `changed_from_suggested` |
| `signed_out` | — |
| `apple_credential_revoked` | — |
| `account_deleted` | `account`: anonymous/apple/kakao, `apple_revoked` |

`linked`(익명 → 로그인)는 목표를 재는 핵심 숫자라 `new`와 나눈다. 탈퇴 사유는 보내지 않는다.

### 6. 파일 담당 (한 파일은 한 워크트리만)
| 담당 | 파일 |
|---|---|
| login-server | `supabase/functions/**`(새 함수), `supabase/migrations/0008~`, `supabase/rollback/`, `supabase/config.toml`, `supabase/tests/<함수명>_test.ts`, `supabase/tests/rls.sql`·`audit.sql`, `src/types/database.ts`(재생성만) |
| login-feature | `package.json`·`package-lock.json`·`app.json`·`app.config.js`·`.gitignore`·`eas.json`(runtimeVersion에 들어가는 파일은 여기만), `modules/**`(미뤄 둔 정리), `src/lib/**`, `src/hooks/**`, `src/app/_layout.tsx`, `src/app/+native-intent.ts`, `src/components/ShareIntentHandler.tsx`, `src/app/register.tsx`(저장 뒤 반시트·거절 시 저장 이어 하기), 개발용 `dev/email-login` |
| login-design | 새 화면(설계 3), `src/app/settings.tsx`, 목록 화면 5개(`(tabs)/index.tsx`·`(tabs)/categories.tsx`·`category/[id].tsx`·`tag/[name].tsx`·`(tabs)/search.tsx`), `src/components/**`(ShareIntentHandler 제외 — `SessionNotice.tsx` 포함), `src/components/Onboarding/**`, `src/constants/theme.ts` |
| login-qa | `supabase/tests/qa/**`, `docs/testing/login-qa.md`. 제품 코드는 고치지 않고 보고만 |
| 상위 | `docs/**`, `CLAUDE.md`, `README.md`, `src/constants/privacy.ts`, Step 1의 약속 코드(하위가 만들어진 뒤 담당에게 넘김) |

- 다른 워크트리 파일이 필요하면 상위에 요청하고, 상위가 약속을 고쳐 전한다.
- `_layout.tsx`(화면 등록·첫 화면 결정)는 feature. design은 설계 3의 경로에 맞춰 화면 파일만.
- 온보딩 화면 분리는 design, 띄울 시점 판단은 feature.
- `src/lib/supportMail.ts`·`devSessionSimulation.ts`는 feature.

---

## 알려진 사실

- **Supabase 자동 연결** [코드, supabase/auth]: `models/linking.go` `DetermineAccountLinking`은 확인된 이메일이 없으면 항상 새 계정, 있으면 같은 이메일 계정에 연결한다. `provider/oidc.go`의 Apple·카카오 ID 토큰 파싱이 이메일을 `Verified: true`로 처리한다.
- **서버 훅으로는 "수단 하나"를 막지 못한다** [코드]: `hooks.go` `triggerBeforeUserCreatedExternal`은 `decision.Decision != models.CreateAccount`면 통과 → 자동 연결에는 훅이 안 불린다. 그래서 가입 확인 함수를 둔다. 앱을 우회해 Supabase를 직접 부르면 본인 계정에 수단이 하나 더 붙을 뿐이다(보안 문제 아님).
- **이메일 없는 가입** [코드]: `external.go` `createAccountFromExternalIdentity`는 ① 그 공급자의 "이메일 없는 사용자 허용"(`EmailOptional`) 꺼짐 ② 프로젝트 Confirm email 켜짐 ③ `Mailer.AllowUnverifiedEmailSignIns` 꺼짐이 **모두** 해당하면 가입을 거절한다. 카카오 계정에 유효한 이메일이 없으면 동의해도 ID 토큰에 이메일이 없다 [문서] → 두 공급자 모두 ①을 켠다.
- **nonce** [코드]: `token_oidc.go`가 넘긴 nonce를 SHA-256(hex)해 토큰의 nonce와 비교한다.
- **같은 ID 토큰 재사용**을 막는 저장은 없다 [코드] → 연결 실패(`identity_already_exists`) 뒤 같은 토큰으로 `signInWithIdToken` 가능(실기기 확인 권장).
- 오류 코드 존재 [코드]: `identity_already_exists`, `manual_linking_disabled`, `email_exists`, `single_identity_not_deletable`. 수동 연결(Manual linking)은 대시보드에서 켜야 한다 [문서].
- auth-js 2.116 `linkIdentityIdToken` → `POST /token?grant_type=id_token` + `link_identity: true` [코드].
- Supabase 공급자 ClientID는 목록이다(`OAuthProviderConfiguration.ClientID []string` [코드]).
- **카카오**: `@react-native-kakao` 3.2.0은 `codegenConfig`(TurboModule), Swift AppDelegate 설정 플러그인, `login()`의 `nonce`, `KakaoLoginToken.idToken`, `unlink()`를 갖고 peer는 `expo >=52`·`react-native >=0.76` [코드, 배포본]. 비교한 `@react-native-seoul/kakao-login` 6.0.4는 codegen 없음·objc만 처리·SDK 58 URL 처리 이슈 #445. 웹 방식은 카카오톡 앱 로그인 불가. 카카오 ID 토큰 `aud`는 SDK를 초기화한 네이티브 앱 키 [문서] → Supabase 카카오 Client ID에 운영·개발 네이티브 앱 키를 모두 넣는다. 콘솔에서 OpenID Connect를 켠다 [문서].
- **개발용 카카오 앱을 따로 만든다**: 카카오톡에서 `kakao<앱 키>://`로 돌아오는데 운영·개발 앱이 같은 키면 같은 scheme → "If multiple apps register the same scheme, the app the system targets is undefined." [문서]. 개발 아이폰에 스토어 앱이 함께 있다(지우지 않음).
- **Apple**: `expo-apple-authentication` 57에 `nonce`·`authorizationCode`·`getCredentialStateAsync`·`addRevokeListener` [코드]. Supabase Apple 문서: 네이티브는 `signInWithIdToken`, Client IDs에 모든 App ID, 이름은 첫 로그인 때만 [문서]. `/auth/revoke`는 refresh 또는 access 토큰이 필요하다 [문서]. TN3194: 토큰이 없어도 삭제 요청은 처리하고 사용자에게 수동 해제를 안내한다 [문서].
- **세션** (anon-session-fix에서 확인): auth-js 2.116은 재발급 실패 뒤 같은 refreshToken에 60초 동안 저장된 실패를 돌려준다(`REFRESH_FAILURE_COOLDOWN_MS`) [코드]. 다시 시도할 수 없는 오류에 accessToken이 만료됐으면 세션을 스스로 지운다 [재현]. anon-session-fix는 이를 무시하는 저장 어댑터(`sessionVault.ts`)를 둔다.
- **스플래시**: `preventAutoHideAsync()`를 부르면 expo-router가 스플래시를 자동으로 숨기지 않는다(`SplashScreenModule.swift` `userControlledAutoHideEnabled` [코드]). Expo 문서: "keep the splash screen visible until authentication loads", 모듈 최상단에서 await 없이 호출 [문서].
- **PostHog**: distinct id = Supabase uid(`identifyUser` [코드]). 사람(person) 삭제 API에 `delete_events=true`를 안 붙이면 이벤트는 남는다 [문서].
- 심사 지침 4.8: 소셜 로그인을 쓰면 이메일을 가릴 수 있는 동등한 로그인이 필요 [문서] → Apple 로그인을 함께 둔다(지침은 Apple을 지목하지 않음 — 해석).

## 확인할 것 ([미확인] — 해당 Step에서)

| # | 내용 | 확인하는 Step |
|---|---|---|
| 1 | `@react-native-kakao` 3.2.0이 Expo SDK 57에서 빌드되는지 | Step 8(개발용 빌드) |
| 2 | Supabase 대시보드에서 카카오 Client ID를 여러 개(쉼표) 입력하는지 | Step 0 |
| 3 | Apple·카카오 "이메일 없는 사용자 허용"이 대시보드에 있는지, 프로젝트 Confirm email 설정 | Step 0 |
| 4 | Apple ID 토큰에 두 번째 로그인부터도 이메일이 들어가는지 | Step 8 |
| 5 | 대시보드에서 같은 이메일 자동 연결을 끄는 설정이 있는지(지금 계획엔 불필요) | Step 0 |
| 6 | 계정 삭제 완료 안내의 iPhone 메뉴 경로 | Step 8 |
| 7 | 카카오 개인 개발자 비즈 앱 공식 절차·심사 기간, 개발용 카카오 앱도 비즈 전환·심사가 필요한지 | Step 0 |
| 8 | Apple 연결을 끊었다 다시 로그인하면 같은 사용자 식별자인지 | Step 8 |
| 9 | 가입 확인 함수의 `verify_jwt` — 앱 키로 통과하는지 | Step 2 |
| 10 | 동의 방식의 법 원문·위원회 안내서 | Step 6 |
| 12 | 카카오 연결 해제 없이 삭제한 뒤 완료 창 안내 "카카오계정의 연결된 서비스 관리에서 위시샷 연결을 해제할 수 있습니다"의 메뉴 경로(design 제안 문구) | Step 8 |
| 11 | 카카오 연결 해제 API가 "이미 끊긴 사용자"에 돌려주는 오류 코드(server는 -101로 구현 — 문서 원문 미확인) | Step 8 전, 카카오 문서 |

---

## 불변식 (Invariants)

1. **익명 계정은 사용자가 고를 때만**: "로그인 없이 시작"(확인창 A·B·D 뒤)만 새 익명 계정을 만든다. anon-session-fix가 자동으로 만들던 두 경우(`created` 새 설치, `restarted` 흔적 없는 거절)는 로그인 화면으로, 끊긴 세션 화면과 "새로 시작"은 로그인 화면 + 알림창 C·확인창 D로 대체한다.
2. **첫 화면은 통신 없이**: 기기 상태만 읽고 스플래시를 유지한다. 읽기 실패는 "세션 없음"이 아니다. anon-session-fix의 시작 판정(`runSessionBootstrap` — `getSession`이 재발급을 기다림)과 8초 뒤 연결 실패 화면(`OfflineScreen`)은 쓰지 않는다. 재발급 실패는 흐름 1의 "세션은 있는데 재발급만 실패"(전체 탭 + 목록 실패 표시)로 다룬다.
3. **세션을 덮어쓰거나 지우지 않는다**: 사용자가 고른 로그아웃·계정 삭제만 세션을 지운다(anon-session-fix 원칙 유지). 기존 계정 로그인 전에 익명 세션을 `pendingMerge`에 남긴다.
4. **합치기는 멱등, 익명 삭제는 마지막**: 모두 옮긴 것을 확인한 뒤에만 익명 계정을 지운다. 실패하면 익명 위시는 그대로다.
5. **삭제는 연결 해제 먼저**: Apple 철회가 실패하면 아무것도 지우지 않는다(사용자가 '연결 해제 없이 삭제'를 고를 때만 예외).
6. **소셜 토큰을 서버에 저장하지 않는다**: 카카오 연결 해제는 어드민 키 + 회원번호, Apple은 받은 코드로 교환해 바로 철회.
7. **한 계정 = 수단 하나**: 앱은 가입 확인을 통과한 토큰만 Supabase에 보낸다.
8. **보내는 값 제한**: 계측은 enum·boolean·수치만(사용자 콘텐츠·이메일·닉네임 금지). 탈퇴 사유는 PostHog로 보내지 않고 사용자 id 없이 저장한다.
9. **비밀 값은 시크릿에만**: Apple .p8, 카카오 어드민 키, PostHog 개인 API 키는 Edge Function 시크릿. 앱에는 공개 값만(카카오 네이티브 앱 키는 공개 값).
10. **운영 식별자 불변**: 운영 번들 ID·App Group·scheme을 바꾸지 않는다. 개발용 카카오 앱·번들 ID는 따로.
11. **고지 선행**: 방침 게시(`main` → GitHub Pages)가 빌드 제출보다 먼저.
12. **규칙**: 문구 규칙 4, 토큰 규칙 5, 데이터 레이어 경유 규칙 11, GRANT 명시 규칙 9, 마이그레이션은 새 번호로(적용한 파일은 고치지 않음).
13. **파일 담당**: 한 파일은 한 워크트리만(설계 6).
14. **문서 정합(규칙 8)**.

---

## 오케스트레이션 운영 (Step 2~5)

### 시작 조건
- anon-session-fix가 dev에 합쳐졌고, Step 1(약속 코드)이 상위 브랜치에 커밋됐다.
- 위 둘 중 하나라도 아니면 워커를 만들지 않는다.

### 구성
- Orca run 하나에 워커 4개(agent `claude`). 상위 브랜치 `feat/phase-22-account-login`에서 하위 워크트리를 만든다.
- 하위 브랜치 이름: `feat/phase-22-login-server`, `feat/phase-22-login-feature`, `feat/phase-22-login-design`, `test/phase-22-login-qa`.
- 상위는 `orca orchestration check --wait --types "worker_done,escalation,question"`으로 기다리고, 사람의 결정이 필요한 질문은 사람에게 전한다. 약속이 바뀌면 상위가 이 문서를 고치고 관련 워커 모두에게 알린다.
- **진짜 함수 연결 신호**: 상위는 기다리는 사이 feature 브랜치의 커밋을 확인한다. 데이터 레이어 함수가 진짜로 바뀌었으면 design에 알린다.

### 약속 코드의 위치 (Step 1이 만들고, 만든 뒤 담당에게 넘김)
| 파일 | 내용 | 넘겨받는 담당 |
|---|---|---|
| `src/lib/queries/account.ts`(+ `index.ts` 배럴에 추가) | 설계 2의 함수 시그니처와 결과 타입. 처음 몸통은 흉내 결과를 돌려준다 | feature |
| `src/lib/accountSimulation.ts` | 개발용 결과 흉내(함수마다 돌려줄 결과를 고름, `__DEV__`만). `devSessionSimulation.ts`와 같은 방식. 진짜 구현 뒤에도 개발 도구로 남긴다 | feature |
| `src/lib/analytics.ts` | 설계 5의 이벤트 타입 | feature |
| 설계 3의 경로 파일 7개(`sign-in.tsx`, `account/` 아래 6개) | 빈 화면. 8번째 `dev/email-login`은 `login.tsx`의 이름 변경이라 feature가 한다 | design |
- 흉내 결과를 고르는 개발용 버튼은 `settings.tsx`의 `__DEV__` 영역에 둔다(design 담당).

### 워커별 작업 명세
각 워커에 아래 다섯 항목과 이 문서 전체를 넘긴다.

| 항목 | login-server | login-feature | login-design | login-qa |
|---|---|---|---|---|
| 대상 | `supabase/**` | 앱 로직·네이티브 설정 | 화면 | 시험·점검 |
| 만들 결과 | 설계 1 전부 | 설계 2·4, 흐름 1~6의 판단, Step 3 목록 | '화면' 전부, Step 4 목록 | Step 5 목록 |
| 제약 | 불변식 4~9·12. 운영 DB 적용·함수 배포·시크릿 등록은 하지 않음(사람) | 불변식 1~3·6~10·12. 승인된 패키지 외 추가 금지. 기존 패키지 버전 올리지 않음 | 불변식 8·12(문구·토큰). 데이터는 `@/lib/queries`만 | 제품 코드 수정 금지 |
| 수정 권한 | 설계 6의 server 행 | 설계 6의 feature 행 | 설계 6의 design 행 | 설계 6의 qa 행 |
| 완료 증거 | 아래 S1~S9 | 아래 F1~F7 | 아래 D1~D5 | 아래 Q1~Q5 |

### 고정된 평가 지표 (모두 통과해야 완료)

**login-server**
- S1 `deno check --no-lock`가 새 서버 함수 3개 모두 통과.
- S2 `deno test --no-lock`가 새 시험과 기존 시험(`find_purchase_links_test.ts`·`purchase_channel_test.ts`·`session_vault_test.ts`·`support_mail_test.ts` — 뒤 둘은 anon-session-fix 머지로 생김) 모두 통과.
- 판정 로직은 순수 모듈로 나눠 통신 없이 시험한다(`find-purchase-links/logic.ts`와 같은 방식). 꼭 있어야 할 시험 사례:
- S3 가입 확인: 서명 틀림·aud 불일치·만료·nonce 불일치는 `invalid_token`. 같은 이메일이 다른 수단이면 `other_provider`+수단. 같은 수단의 기존 identity면 `existing`. 없으면 `new`. 이메일이 없으면 이메일 검사를 건너뛴다.
- S4 합치기 규칙: 같은 위시는 로그인 계정 것을 남기고 빈 가격·링크·메모·카테고리만 채운다. 태그를 합치고 익명 쪽 사진을 지운다. 같은 이름 카테고리는 하나로. 위시 id 유지, `image_key` 경로 변경.
- S5 합치기 멱등: 중간에 실패한 뒤 다시 부르면 이어서 하고 중복이 없다. `partial` 뒤 `done`. 모두 옮긴 뒤에만 익명 사용자를 지운다. 운영자 경로에서 from이 익명이 아니면 `not_anonymous`, 같은 사용자면 `same_user`.
- S6 계정 삭제: 순서 ①~⑤. Apple 철회 실패면 아무것도 지우지 않는다. `skipAppleRevoke`면 진행. 카카오가 이미 끊겼으면 성공. 다시 부르면 `already_deleted`. PostHog 실패면 삭제는 진행하고 재시도 기록을 남긴다.
- S7 탈퇴 사유: 사용자 id 없이 저장. 기타 글 200자 초과는 거절.
- S8 닉네임: 1자·13자는 `invalid_length`. 띄어쓰기·특수문자는 `invalid_chars`. 예약어 6개(대소문자를 섞어도)는 `reserved`. `위시샷공식2`는 통과(정확 일치만 차단). NFC·대소문자만 다른 같은 이름은 `taken`. 동시에 같은 이름을 저장하면 하나만 성공. `ensure_profile` 두 번 호출에 `created`는 한 번만.
- S9 권한 SQL: `rls.sql`·`audit.sql`에 새 표의 기대값(anon 롤 접근 없음, 남의 profiles를 못 읽음, profiles 직접 update 불가, `security definer` 함수의 `search_path = ''`). SQL 실행은 사람이 SQL Editor로 한다.

**login-feature**
- F1 `npx tsc --noEmit`, `npx expo lint` 통과. `npx expo-doctor`에 새 경고 없음(기존 경고는 그대로 보고).
- F2 `npx expo config --type introspect`로 두 앱 변형(운영·`APP_VARIANT=development`)에 Apple·카카오 플러그인과 각자의 카카오 키·scheme이 들어갔는지 확인.
- F3 순수 로직 Deno 시험 통과: 첫 화면 판정(설계 2 `getStartState`의 7가지 결과 + 1.1.0 사용자 첫 기록), 기기 정리(설계 4 표의 로그아웃·계정 삭제 열과 키 단위로 일치), 합치기 재시도(1분 제한, 대상 계정일 때만, 새 refreshToken 즉시 저장), 로그인 중 공유 맡아 두기(마지막 1개).
- F4 설계 2의 결과 종류마다 처리 코드가 있다(함수·결과 대응표를 보고에 붙임).
- F5 `src/lib/analytics.ts`의 이벤트가 설계 5와 이름·속성 값까지 같다.
- F6 runtimeVersion이 바뀐 것을 확인하고 새 값을 보고한다(의도된 변경).
- F7 기존 시험(S2의 기존 목록) 통과.

**login-design**
- D1 `npx tsc --noEmit`, `npx expo lint` 통과.
- D2 개발용 결과 흉내로 아래 상태를 모두 띄울 수 있다:
  - 로그인 화면 4가지 진입 + 창 A·B·C·D + 다른 수단 가입 안내 + 시작 실패
  - 닉네임 오류 4가지 + 사용 중 추천 칩, 가입/편집 버튼
  - 반시트 개수 있음/없음
  - 설정 익명/로그인/합치지 못한 위시/문의하기
  - 삭제 안내 Apple/그 밖, 기타 입력, 삭제하는 중, Apple 연결 해제 실패 창, 완료 창
  - 합치는 중 성공/실패
  - 목록 실패 2가지 × 5개 화면
- D3 사용자 문구가 이 문서의 '화면'과 글자 단위로 같다.
- D4 새 화면 파일에 원시 hex 색이 없다(그림자 색 예외, 카카오 노랑은 토큰).
- D5 시각 확인은 이 환경에서 할 수 없으므로 Step 8 실기기 목록에 화면별 항목을 남긴다.

**login-qa**
- Q1 `docs/testing/login-qa.md`에 '흐름' 1~6의 모든 줄, 창 A~D, 합치기 성공·실패·재시도, 삭제(익명·Apple·카카오·Apple 실패·도중 종료), 닉네임 규칙, 로그아웃 뒤 기기 정리, 1.1.0에서 올라온 사용자가 각각 기대 결과와 함께 있다.
- Q2 병합 뒤 문구 대조: 코드의 사용자 문자열과 '화면'의 문구 차이 목록(파일:줄).
- Q3 병합 뒤 S1·S2·F1·D1 명령을 다시 돌린 결과.
- Q4 `audit.sql`·`rls.sql` 기대값 점검과 runtimeVersion 기록.
- Q5 찾은 문제 목록(파일:줄, 어긴 불변식·지표). 고치지 않는다.
- qa는 두 번 맡긴다: ① 병합 전 Q1 ② Step 7 병합 뒤 Q2~Q5.

### 종료 조건
- **워커 완료**: 자기 지표를 모두 통과하고, 명령 출력 요약·시험 이름 목록·커밋 해시를 담아 `worker_done`을 보낸다.
- **멈추고 상위에 묻기(escalation)** — 아래 중 하나면 하던 일을 멈춘다:
  1. 담당이 아닌 파일을 고쳐야 한다.
  2. 약속(함수·결과·경로·키·이벤트)을 바꿔야 한다.
  3. [미확인] 항목에 막혔다.
  4. 사람만 할 수 있는 일(키·배포·콘솔·운영 DB)이 필요하다.
  5. 승인된 것 외의 패키지가 필요하다.
  6. 같은 시험·명령이 원인을 바꿔 세 번 고쳐도 실패한다.
  7. 불변식을 어겨야만 지표를 통과할 수 있다.
- **전체 중단(사람에게 바로 알림)**: 운영 데이터·운영 앱에 영향을 줄 위험을 찾았을 때, 비밀 값이 코드·로그에 들어갔을 때.
- **run 종료**: 워커 4개가 모두 성공 또는 실패로 정리됐고, Step 7 병합과 qa ②가 끝났을 때. 또는 사람이 중단할 때.

---

## Step 0 — 콘솔 설정 (사람) — Step 2~5와 나란히(카카오 심사는 기간을 모르므로 일찍)

- 카카오 앱 2개: 운영 앱엔 운영 번들 ID, 개발 앱엔 개발 번들 ID(`com.k0nghaa.wishshot.dev`)를 iOS 플랫폼에 등록. 각각 OpenID Connect ON, 비즈 앱 전환, 이메일 필수 동의 신청(목적 문구는 '확정된 결정 — 계정'). 심사 기간을 모르므로 일찍 신청한다.
- Supabase: 카카오 공급자(네이티브 앱 키 2개, 이메일 없는 사용자 허용), Apple 공급자(번들 ID 2개, 이메일 없는 사용자 허용 확인), 수동 연결(Manual linking) ON.
- Apple: 두 App ID에 Sign in with Apple, 철회용 .p8 키.
- '확인할 것' 2·3·5·7을 확인해 상위에 알린다.

## Step 1 — 약속 코드 (상위)

- 상위를 최신 `dev`로 맞춘다(anon-session-fix 머지 뒤). anon-session-fix의 실제 API(`sessionVault.ts`·`queries/auth.ts`)와 설계 2·4를 다시 맞추고, 달라진 점을 이 문서에 반영한다.
  - 2026-11-26 대조 결과: 저장 키(`sessionCopy`·`sessionArchive`)·세션 보관·문의 번호(`supportMail.ts`)·`previous_user_id`(`runStartOver`)는 설계와 같다. 설계에 없던 것 — 시작 판정의 통신과 8초 연결 실패 화면(`OfflineScreen`·`connectionMailUrl`), 흔적 없는 거절의 자동 새 계정(`restarted`) — 은 불변식 1·2와 흐름 3에 처리를 적었다. feature는 `runSessionBootstrap`·`runStartOver`·`hasWishTrace`·`inquiryUserId`를 다시 쓰거나 바꿔 쓰고, 쓰지 않게 된 것(`bootstrapSession`·`startOver`·`connectionMailUrl`)은 지운다. design은 `SessionNotice.tsx`를 지운다.
- 약속을 코드로 커밋한다('오케스트레이션 운영 — 약속 코드의 위치'): 데이터 레이어 함수 타입(설계 2), 결과 흉내 구현, 계측 이벤트 타입(설계 5), 빈 화면 파일(설계 3). 이유: design이 흉내를 둘 곳이 필요하고, 화면 파일이 없으면 feature 브랜치에서 `tsc`(typed routes)가 실패한다.
- `npx tsc --noEmit`·`npx expo lint` 통과. 승인 후 커밋.
- 하위 워크트리 4개를 Orca로 만든다.

**DoD**: 약속 코드 커밋, 하위 4개 생성.

## Step 2 — 서버 (login-server)

- 마이그레이션 `0008`~ (설계 1), 되돌리기 SQL, `rls.sql`·`audit.sql` 갱신.
- 서버 함수 3개(가입 확인·합치기·계정 삭제), 닉네임 DB 함수 3개.
- Deno 시험: 토큰 검증(서명·aud·nonce·만료), 가입 확인 결과, 합치기 규칙(같은 위시·카테고리·태그·멱등·부분 처리·운영자 경로), 삭제 순서·멱등·Apple 실패 시 무삭제, 닉네임 규칙(글자 수·종류·NFC·대소문자·예약어 정확 일치·동시 선점).
- `deno check`·`deno test` 통과. 타입 재생성은 마이그레이션을 사람이 적용한 뒤.

**DoD**: S1~S9, 상위 병합 승인.

## Step 3 — 앱 로직 (login-feature)

- 네이티브 패키지·설정 플러그인(두 앱 변형 — `app.config.js`의 개발용 카카오 키·scheme), `expo-web-browser` 제거, 미뤄 둔 네이티브 정리.
- 데이터 레이어(설계 2)를 진짜로 구현한다. 서버 함수가 배포되기 전에는 서버 응답을 흉내 낸다.
- 스플래시 + `Stack.Protected` 첫 화면 결정, 기기 상태 기록(설계 4)과 1.1.0 사용자 첫 기록, 로그인 중 공유 맡아 두기(5초 버림 고침), 등록 폼의 거절 시 저장 이어 하기, 합치기 재시도, Apple 연결 상태 확인, 계측, 의견 보내기 문의 번호.
- React Compiler 주의: 컴포넌트 안에서 모듈 수준 `let`을 직접 읽거나 쓰지 않는다(CLAUDE.md).
- `tsc`·`lint`·`expo-doctor` 통과. runtimeVersion이 바뀌는 것은 의도된 것이다(스토어 빌드).
- 진짜 함수를 커밋할 때마다 상위에 알린다(design 연결 신호).

**DoD**: F1~F7, 상위 병합 승인.

## Step 4 — 화면 (login-design)

- '화면'의 전부: 로그인(두 경로)·닉네임·반시트·설정 계정 영역·계정 삭제 안내·삭제하는 중·합치는 중·목록 실패 표시 5곳·온보딩 화면 분리·카카오 브랜드 토큰. `SessionNotice.tsx`는 로그인 화면 + C·D로 대체한다.
- 결과 흉내로 모든 상태를 확인하고, feature가 진짜 함수를 커밋하면 상위의 알림에 따라 붙여 본다.
- `tsc`·`lint` 통과.

**DoD**: D1~D5, 상위 병합 승인.

## Step 5 — 시험 (login-qa)

- 흐름별 시나리오 표(`docs/testing/login-qa.md`): '흐름' 1~6의 모든 줄, 창 A~D, 합치기 성공·실패·재시도, 삭제(익명·Apple·카카오·Apple 실패·도중 종료), 닉네임 규칙, 로그아웃 뒤 기기 정리, 1.1.0에서 올라온 사용자.
- 서버·보관함 시험(`supabase/tests/qa/**`), RLS·권한 점검(`audit.sql`·`rls.sql` 기준), runtimeVersion 확인, 실기기 확인 목록(Step 8).
- 제품 코드는 고치지 않고, 찾은 문제는 상위에 보고한다.

**DoD**: ① Q1 ② 병합 뒤 Q2~Q5.

## Step 6 — 문서 (상위) — 방침 초안은 Step 1과 나란히

- 방침(`docs/legal/privacy.html`) — '방침·고지' 표. 카카오 심사에 방침 URL이 필요하면 먼저 게시한다(사람).
- `src/constants/privacy.ts`, `docs/testing/tracking-plan.md`(설계 5), `CLAUDE.md`·`docs/development.md`(인증·서버 함수·마이그레이션·시크릿·콘솔 설정·명령), App Store 앱 개인정보 항목 초안, 카카오 비즈 앱 신청 문구.

### Step 6 산출물 — 제출용 초안 (2026-11-26, 사람 검토 필요)

**App Store Connect 앱 개인정보**(현재 선언: 사용 데이터 > 제품 상호 작용, 식별자 > 사용자 ID, 진단 > 충돌·성능·기타 진단 데이터, 사용자 콘텐츠 > 기타 사용자 콘텐츠 — `docs/testing/tracking-plan.md` §5). 1.2.0에서 바꿀 것:

| 데이터 유형 | 변경 | 목적 | 사용자와 연결 | 추적 |
|---|---|---|---|---|
| 연락처 정보 > 이메일 주소 | **새로 추가** — Apple·카카오 로그인 때 받는 이메일(Apple 중계 주소 포함) | 앱 기능(계정 식별·중복 가입 방지), 그 밖(서비스 운영 관련 중요 안내 — 보낼 때) | 예 | 아니오 |
| 식별자 > 사용자 ID | 유지, **목적에 앱 기능 추가 확인**(로그인 계정 식별, Apple·카카오 고유 번호) | 앱 기능, 분석 | 예 | 아니오 |
| 사용자 콘텐츠 > 기타 사용자 콘텐츠 | 유지 — 닉네임이 여기에 들어간다고 본다(실명이 아니므로 '이름' 유형이 아님 — [판단 필요]) | 앱 기능, 분석 | 예 | 아니오 |
| 탈퇴 사유 | 선택 입력, 사용자 id 없이 저장 — 따로 선언할지 [판단 필요](Apple '기타 데이터 유형' 또는 '기타 사용자 콘텐츠'의 연결 안 됨). 같은 유형은 한 번만 선언되고 하나라도 연결되면 '연결됨'이다 | — | — | — |

- 사용 데이터 > 제품 상호 작용: 로그인 이벤트 8개가 더해지지만 유형·목적은 그대로다.
- 반영 시점: 심사 제출 전(재심사 없이 언제든 반영 가능), 방침 게시와 같은 날.

**카카오 비즈 앱 전환·동의 항목 신청 문구**(운영·개발 카카오 앱 둘 다. 개인 개발자 절차·심사 기간은 '확인할 것' 7):

- 서비스 이름: 위시샷(WishShot)
- 서비스 설명: 스크린샷으로 저장한 관심 제품을 카테고리별 개인 위시리스트로 관리하는 iOS 앱입니다. 카카오 로그인으로 계정을 만들면 앱을 지우거나 기기를 바꿔도 위시리스트를 다시 볼 수 있습니다.
- 동의 항목: 카카오계정(이메일) — **필수 동의**
- 이메일 사용 목적: 계정 식별, 중복 가입 방지, 서비스 운영 관련 중요 안내
- 수집하지 않는 항목: 이름·프로필 사진·전화번호 등 그 밖의 항목은 요청하지 않습니다.
- 개인정보처리방침 URL: https://k0nghaa.github.io/wish-shot/legal/privacy.html (심사에 방침 URL이 필요하면 이 개정본을 먼저 게시 — 사람)
- 첨부가 필요하면: 로그인 화면 스크린샷(개발용 앱, 결과 흉내로 띄움)

**방침 개정 초안**: `docs/legal/privacy.html`(§1 계정 식별자·로그인 정보·탈퇴 사유, §3 Supabase 인증·Apple·카카오, §4 로그인 이벤트·이메일 등 미수집·계정 삭제 때 프로필 삭제, §5 미수집에 이메일·닉네임, §6 인증 전면 개정, §7 계정 삭제·통계로 남는 것, §8, §10 이전 식별자·문의 처리 때 계정 정보 확인). 개정일 칸은 게시일로 채운다. 앱 안 고지 `src/constants/privacy.ts`에 '로그인'·'계정 삭제' 항목을 더했다(첫 등록 요약은 바꾸지 않아 `PRIVACY_NOTICE_KEY`는 그대로). 법 원문 확인은 '확인할 것' 10.

## Step 7 — 병합 (상위 + 사람)

순서: server → (사람: `0008`~ 적용, 함수 배포 — 이름을 붙여서, 시크릿 등록) → feature → design → qa 최종 점검. 각 병합 전에 변경 요약을 보고하고 승인을 받는다. 운영 DB 하나로 시험하므로 새 표(추가만)는 server 병합 직후 적용할 수 있다. feature가 실제 서버에 붙으려면 함수 배포가 먼저다.

## Step 8 — 개발용 빌드·실기기 확인 (사람)

- EAS development 빌드(`APP_VARIANT=development`). '확인할 것' 1·4·6·8과 Step 5의 실기기 목록.
- 개발용 앱으로 첫 가입 시험(이메일 없는 가입 설정 확인).

## Step 9 — 출시 (사람)

방침 게시 확인 → dev PR(승인 후) → `release/v1.2.0` → production 빌드(`APP_VARIANT` 지우기) → `eas submit` → 심사 제출. 반영 순서는 release → main PR, main 머지 커밋에 태그, main → dev 역머지.

---

## qa ① 지적 처리 (2026-11-26)

qa ①(`docs/testing/login-qa.md` 끝 '문서 모순·빈틈' P-01~25)의 답이다. 이 표가 위 절들과 다르면 이 표를 따른다. P-10·P-11은 사람 결정, 나머지는 상위가 기존 원칙으로 정했다.

| # | 정한 것 | 담당 |
|---|---|---|
| P-01 | "로그인 세션 만료" = 실행 중 서버가 로그인 세션의 재발급을 거절한 경우(흐름 3). 그때 기기 상태를 "로그아웃"(최근 수단 유지)으로 바꾸고, 다음 실행부터 흐름 1 둘째 행 | feature |
| P-02 | 흐름 6은 홈 화면 진입에만 해당한다. 공유로 시작한 첫 실행은 흐름 2대로 로그인 화면이 먼저(카드 없음)이고, 그다음 홈 화면 진입 때 흐름 1 넷째 행(카드 → 전체 탭 → 사용 안내, 로그인 화면 없음) | feature |
| P-03 | "삭제 중" → 삭제하는 중 화면(삭제를 다시 부름). "읽기 실패" → 스플래시를 유지하며 다시 읽고, 3번 실패하면 목록 실패 표시와 같은 문구("불러오지 못했습니다" / "다시 시도")를 첫 화면에 보인다. 이 화면은 `sign-in.tsx`가 `unreadable` 상태로 그린다 | feature·design |
| P-04 | 로그인 세션 거절 = "로그아웃"(P-01). 다른 기기에서 계정을 지운 경우 다시 로그인하면 새 계정이 되며, 문구는 바꾸지 않는다 | feature |
| P-05 | 확인창 B 뒤 "로그인 없이 시작"은 `previous_user_id`를 남기지 않는다(이전 계정은 다시 로그인하면 되므로) | feature |
| P-06 | "통틀어 1회"는 자동으로 권하는 것 — 첫 실행 로그인 화면에서 건너뛰기를 고른 것과 반시트 — 만 센다. 설정·로그인 전용 기능에서 연 로그인 화면과 로그아웃 뒤 로그인 화면은 세지 않는다. 세션이 없으면 로그인 화면은 상태로 정해지므로 횟수와 무관하게 뜬다 | feature |
| P-07 | 반시트 개수 = 전체 탭이 이미 불러온 목록의 개수(메모리). 목록을 아직 못 불러왔거나 실패했으면 "위시를 계정에 보관" | feature·design |
| P-08 | 창 C: [문의하기] = `lostAccountMailUrl(이전 계정)` 메일, [다시 시도] = 세션 재확인(통신, 데이터 레이어 `retryLostSession()` → `restored` / `still_lost` / `error`) — 살아 있으면 기기 상태를 익명으로 되돌려 전체 탭, 아니면 창을 다시 띄움(앱 새로고침이 아니다), [확인] = 창만 닫음. 기기 상태가 "서버 거절"인 동안 로그인 화면이 열릴 때마다 띄운다 | feature·design |
| P-09 | `deleteAccount` 결과에 `{kind:'apple_code_required'}`를 더한다 — 앱은 Apple 재인증부터 다시 한다. 서버는 삭제 진행 상태(연결 해제 완료 여부)를 사용자 id로 남기고, 다시 부르면 끝난 단계를 건너뛴다(연결 해제를 두 번 하지 않는다) | server·feature·design |
| P-10 | **카카오 연결 해제 실패도 Apple과 같다**(사람 결정): 아무것도 지우지 않고 멈춤. "카카오 연결을 해제하지 못했습니다" [다시 시도] [카카오 연결 해제 없이 삭제]. 결과는 `{kind:'unlink_failed', provider}`로 합치고(`apple_revoke_failed` 대신), 입력은 `skipUnlink`로(`skipAppleRevoke` 대신). 서버 응답 코드는 `unlink_failed` + provider | server·feature·design |
| P-11 | **남은 익명 위시도 함께 지운다**(사람 결정): `pendingMerge`가 있으면 앱이 로그인 계정 삭제를 마친 뒤 기기에 남은 익명 세션으로 계정 삭제를 한 번 더 부른다(익명 계정 삭제 경로). 실패해도 사용자에게는 완료로 보이고, 남은 익명 계정은 문의로 처리한다 | feature |
| P-12 | `unchanged` = 오류 문구 없이 [완료]·[저장]을 누를 수 있다(누르면 그대로 닫힘). 대소문자만 바꾼 자기 닉네임은 `available`이고 저장된다 | server·design |
| P-13 | 이메일이 없으면 설정의 이메일 행을 숨긴다 | design |
| P-14 | 가입 확인 뒤 `linkIdentity`가 `identity_already_exists`면 같은 토큰으로 `signInWithIdToken`(기존 계정 로그인 + 합치기)으로 넘어간다 | feature |
| P-15 | "위시를 저장한 흔적" = anon-session-fix의 `hasWishTrace` 그대로(정의를 새로 만들지 않는다) | feature·qa |
| P-16 | `accountState`가 없는 사용자의 첫 기록: 세션이 있으면 그 세션(익명/로그인), 세션이 없으면 `hasWishTrace`로 "서버 거절"(이전 계정 = 보관된 계정) 또는 "로그인한 적 없음". OTA를 받았는지와 무관하다(흔적 키는 1.1.0에도 있다) | feature |
| P-17 | 흐름 2의 "취소" = 등록 폼을 저장하지 않고 닫은 것. 그때는 반시트를 띄우지 않는다. 반시트의 "나중에"·끌어 내림은 횟수를 쓴다 | feature |
| P-18 | 횟수는 반시트를 보인 순간 쓴다. 반시트에서 Apple·카카오 창을 닫으면 반시트는 그대로 남는다 | feature·design |
| P-19 | 둘 다 해당하면 합치기 먼저, 그다음 닉네임 | feature |
| P-20 | 닉네임: NFC로 바꾼 뒤 앞뒤 공백도 그대로 검사(자르지 않음). 허용 글자 = 한글 완성형(가~힣)·ASCII 영문·숫자 — 자모 단독·전각·악센트는 `invalid_chars`. 검사 순서 = 글자 종류 → 길이(코드 포인트 수 2~12) → 예약어 → 중복 | server·design |
| P-21 | "기존 위시가 있으면 사용 안내 생략" = 로그인 결과가 기존 계정(`existing`)이거나 합치기를 한 경우 | feature |
| P-22 | 익명 위시 개수는 로그인 직전 익명 세션으로 조회한다(로그인도 통신이므로). 조회에 실패하면 `pendingMerge`를 남기고 합치기를 부른다(0개면 서버가 `done`, merged 0) | feature |
| P-23 | 삭제 안내의 개수는 안내 화면을 열 때 조회한다. 모르면 "삭제하면 위시와 사진이 모두 지워지며 복구할 수 없습니다." | feature·design |
| P-24 | 등록 폼 작성 중 거절 → 로그인: 흐름 5(합치기·닉네임)를 마친 뒤 폼으로 돌아와 지금 계정에 저장한다 | feature·design |
| P-25 | "시작하지 못했습니다" 창의 버튼은 [확인] 하나 | design |

## 미결 사항 (사람 결정)

1. ~~확인창 D 뒤 "로그인 없이 시작"이 `previous_user_id`를 남길지~~ → 남긴다(2026-11-25 결정). 문의 복구 때 옮길 곳을 바로 찾는다(anon-session-fix "새로 시작"과 같은 방식).
2. 그 밖의 이름(함수·표·키)과 합치기 한 번의 처리 개수는 구현하는 워크트리가 제안하고 상위가 정한다.

## 결과 기록 (구현 세션이 채움)

- **완료일**:
- **Step 0**:
- **Step 1**:
- **Step 2**:
- **Step 3**:
- **Step 4**:
- **Step 5**:
- **Step 6**:
- **Step 7**:
- **Step 8**:
- **Step 9**:
