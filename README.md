<p align="center">
  <img src="docs/readme/banner.png" width="100%" alt="WishShot" />
</p>

# 위시샷 - 스크린샷으로 시작되는 개인 위시리스트

### 캡처만 해두고 잊어버린 그 물건, 위시샷에 담아보세요!

*ZARA 26SS 추천, 다이소 자취생 필수템* 등 추천 콘텐츠가 쏟아지는 요즘, 마음에 드는 제품을 캡처해 놓지만, 정작 필요할 때 다시 찾기 어려운 경험에서 시작되었습니다.

**WishShot**은 스크린샷으로 저장한 관심 아이템을 개인 위시리스트로 정리하고 관리할 수 있는 서비스입니다. 추억은 앨범에 그대로 두고, 구매를 고민하던 기록만 따로 모아 언제든 다시 확인할 수 있도록 돕습니다.

흩어진 캡처를 단순한 사진이 아닌 내 취향과 관심사 리스트로 바꿔보면 어떨까요?

👉 [App Store에서 다운로드](https://apps.apple.com/app/apple-store/id6812149556?pt=129399010&ct=github_readme_about&mt=8)

## 서비스 소개

### 스크린샷을 등록하면 정보가 알아서 채워져요 🔗
<p align="center">
  <img src="docs/readme/add-wish.gif" width="300" alt="위시를 등록하는 화면" />
</p>

***캡처하고, 공유하면 끝!***

사진 속 글자를 읽어 제품명·가격·브랜드를 채우고, 어울리는 카테고리도 골라요.

SNS에서 찍은 스크린샷을 공유 시트로 바로 보내면 더 간편하게 저장할 수 있어요.

***사고 싶을 때 바로 이동!***

제품을 파는 곳을 찾아 링크를 넣고, 안전이 확인된 링크만 넣어요.

저장한 뒤에 링크를 찾으면 앱 안 알림 탭에서 알려 드려요.




## 기술 스택

### 모바일

<p align="left">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&amp;logo=typescript&amp;logoColor=white" height="28" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React_Native-61DAFB?style=for-the-badge&amp;logo=react&amp;logoColor=black" height="28" alt="React Native" />
  <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&amp;logo=expo&amp;logoColor=white" height="28" alt="Expo" />
  <img src="https://img.shields.io/badge/Swift-F05138?style=for-the-badge&amp;logo=swift&amp;logoColor=white" height="28" alt="Swift" />
  <img src="https://img.shields.io/badge/ESLint-4B32C3?style=for-the-badge&amp;logo=eslint&amp;logoColor=white" height="28" alt="ESLint" />
</p>

### 백엔드

<p align="left">
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&amp;logo=supabase&amp;logoColor=white" height="28" alt="Supabase" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&amp;logo=postgresql&amp;logoColor=white" height="28" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Deno-70FFAF?style=for-the-badge&amp;logo=deno&amp;logoColor=black" height="28" alt="Deno" />
  <img src="https://img.shields.io/badge/Claude-D97757?style=for-the-badge&amp;logo=claude&amp;logoColor=white" height="28" alt="Claude" />
</p>

### 인프라

<p align="left">
  <img src="https://img.shields.io/badge/EAS-4630EB?style=for-the-badge&amp;logo=expo&amp;logoColor=white" height="28" alt="EAS" />
</p>

### 모니터링

<p align="left">
  <img src="https://img.shields.io/badge/PostHog-000000?style=for-the-badge&amp;logo=posthog&amp;logoColor=white" height="28" alt="PostHog" />
  <img src="https://img.shields.io/badge/Sentry-362D59?style=for-the-badge&amp;logo=sentry&amp;logoColor=white" height="28" alt="Sentry" />
</p>

## 프로젝트 구조

| 폴더 | 내용 |
| :--- | :--- |
| [src](src/) | Expo Router 화면, 컴포넌트, 훅, 데이터 레이어 |
| [modules/expo-vision-ocr](modules/expo-vision-ocr/) | Apple Vision으로 글자를 읽는 로컬 네이티브 모듈 |
| [supabase](supabase/) | DB 마이그레이션, Edge Function, 정책 검증 SQL |
| [docs](docs/) | 개발 가이드, 작업 기록, 디자인 명세, 개인정보처리방침 |
| [assets](assets/) | 앱 아이콘과 스플래시 이미지 |
| [.github](.github/) | PR·이슈 템플릿 |

## 개발 문서

로컬 실행 방법과 배포·운영 절차 등 자세한 개발 정보는 아래 문서를 참고해 주세요.

| 주제 | 문서 |
| :--- | :--- |
| 읽는 순서, 작업 기록 목록, 용어 | [문서 안내](docs/README.md) |
| 로컬 실행, 빌드·출시, DB, Edge Function 배포·운영 | [개발 가이드](docs/development.md) |
| 단계별 작업 지시와 결과 | [작업 기록](docs/phases/) |
| 디자인 명세 | [비주얼 스펙](docs/design/phase-5-visual-spec.md) |
| 계측 이벤트 정의 | [트래킹 플랜](docs/testing/tracking-plan.md) |
| 저장소 작업 규칙 | [CLAUDE.md](CLAUDE.md) |

## 프로젝트 아키텍처

별도 서버 없이 앱이 Supabase를 직접 호출하고, API 키가 필요한 작업만 Edge Function에서 처리합니다.

```mermaid
flowchart LR
  subgraph iPhone
    Share[공유 시트 · 앨범] --> App[WishShot 앱<br/>Expo · React Native]
    App --> OCR[Apple Vision OCR<br/>온디바이스]
  end

  subgraph Supabase
    Auth[Auth<br/>Apple · 카카오 · 익명]
    DB[(Postgres + RLS)]
    Storage[(Storage<br/>이미지)]
    Parse[Edge Function<br/>parse-screenshot-text]
    Links[Edge Function<br/>find-purchase-links]
    Account[Edge Function<br/>계정: 가입 확인 · 합치기 · 삭제]
  end

  App --> Auth
  App --> DB
  App --> Storage
  App -->|OCR 텍스트 · 필요 시 제품 영역| Parse
  App -->|제품명 · 브랜드 · 판매처| Links
  App -->|ID 토큰 · 계정 요청| Account
  Account --> Social[Apple · 카카오<br/>연결 해제]
  Parse --> Claude[Claude Haiku]
  Links --> Search[Claude 웹 검색]
  Links --> Risk[Google Web Risk]
  App -.-> PostHog[PostHog<br/>계측]
  App -.-> Sentry[Sentry<br/>오류 수집]
```

### 빌드·배포

```mermaid
flowchart LR
  Dev[dev 브랜치] --> Release[release/vX.Y.Z]
  Release --> Build[EAS Build]
  Build -->|제출 · 심사| Store[App Store]
  Dev -->|JS만 바뀐 수정| Update[EAS Update] --> OTA[설치된 앱에 OTA 반영]
  Dev -->|함수 변경| Deploy[supabase functions deploy] --> Edge[Edge Function]
```

## 만든 사람

<table>
  <tr>
    <td align="left"><img src="https://github.com/k0nghaa.png" width="120" alt="경하 GitHub 프로필" /></td>
  </tr>
  <tr>
    <td align="left"><a href="https://github.com/k0nghaa">경하</a></td>
  </tr>
</table>
