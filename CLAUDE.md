# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code (claude.ai/code)에게 제공하는 가이드입니다.

## 프로젝트 개요

WishShot(위시샷)은 개인 위시리스트 앱입니다: 사용자가 제품(스크린샷/이미지 포함)을 카테고리별로 저장합니다. 루트에 공유 스크립트가 없는 2개 패키지 모노레포로, 프론트엔드와 백엔드를 각각 독립적으로 실행/빌드합니다.

## 예정된 마이그레이션

이 프로젝트는 현재 구조(Vite + Express + SQLite)에서 **Next.js + Supabase**로 전환한 뒤, 사용량이 실제로 임계치에 도달하면 **Neon / Cloudflare R2 / Auth.js**로 부분 전환하는 마이그레이션을 계획 중입니다. 아래 "아키텍처" 절은 **마이그레이션 이전, 현재 코드 기준 설명**입니다. 결정 배경, 채택하지 않은 대안, 모니터링 트리거 조건, 마이그레이션 순서는 `docs/architecture-plan.md`를 참고하세요.

## 명령어

### 프론트엔드 (루트 디렉터리)
- `npm run dev` — Vite 개발 서버 실행 (http://localhost:5173)
- `npm run build` — 타입 체크(`tsc -b`) 후 Vite로 빌드
- `npm run lint` — ESLint 실행
- `npm run format` — 저장소 전체에 Prettier 적용
- 테스트 러너는 설정되어 있지 않습니다.

### 백엔드 (`backend/`)
- `npm run dev` — nodemon + ts-node로 API 서버 실행 (http://localhost:4000)
- `npm run build` — `tsc`로 `backend/dist`에 컴파일
- `npm start` — 컴파일된 서버 실행 (`node dist/index.js`)
- 백엔드에는 lint나 테스트 스크립트가 설정되어 있지 않습니다.

두 패키지는 `node_modules`/`package-lock.json`이 각각 독립적입니다. 의존성은 각 디렉터리에서 따로 설치해야 합니다.

## 아키텍처

**프론트엔드** (`src/`): React 19 + TypeScript + Vite + Tailwind CSS v4 (설정은 `tailwind.config.js`가 아니라 `src/index.css`의 `@theme`에 인라인으로 존재).

- `src/main.tsx` → `src/App.tsx`: 현재 `App.tsx`는 dev 모드(`import.meta.env.DEV`)에서만 `TestPage`를 렌더링하고 프로덕션에서는 아무것도 렌더링하지 않습니다 — 아직 라우터나 프로덕션 진입점이 구성되어 있지 않습니다. `TestPage`(`src/pages/TestPage.tsx`)는 페이지 컴포넌트를 수동으로 주석 처리/해제하며 수동 테스트하는 임시 하네스입니다.
- `src/pages/`: `CategoryPage`, `ProductPage`, `UploadPage`가 실제 화면 3개입니다(카테고리 목록, 특정 카테고리의 제품 목록, 새 제품 업로드). 각 페이지는 UI만 담당하고 데이터 fetching/mutation은 대응하는 훅에 위임합니다.
- `src/hooks/`: `useCategories`, `useProducts`, `useImageUpload`는 각각 독립적으로 백엔드에 `fetch`하고, 자체 `isLoading`/`error`/데이터 상태를 가지며, `API_URL = 'http://localhost:4000'`을 하드코딩하고 있습니다. 공유 API 클라이언트, React Query/SWR, 전역 상태는 없습니다 — 각 훅이 독립적입니다. 새 API 호출을 추가할 때는 별도 요청이 없는 한 공유 클라이언트를 도입하지 말고 이 훅별 fetch 패턴을 따르세요.
- 스타일링은 `src/index.css`에 정의된 커스텀 테마(세이지 그린 primary, 테라코타 accent, 실버 그레이 뉴트럴)를 사용한 Tailwind 유틸리티 클래스로 이루어집니다. 디자인 시스템 일관성을 위해 원시 Tailwind 팔레트 색상 대신 시맨틱 컬러 토큰(`text-main`, `text-sub`, `text-disabled`, `bg-card`, `silver`, `primary`, `accent`, `error` 등)을 사용하세요.

**백엔드** (`backend/src/`): Express 5 + TypeScript (dev에서는 ts-node/nodemon으로 실행, 프로덕션은 tsc로 컴파일) + better-sqlite3 (동기식 SQLite, ORM 없음).

- `db.ts`: 시작 시 `backend/wishlist.db`를 열거나 생성하고 `categories`, `products` 테이블에 대해 `CREATE TABLE IF NOT EXISTS`를 실행합니다 — 별도의 마이그레이션 파일은 없습니다. 스키마 변경은 `CREATE TABLE` 문을 직접 수정해서 하며, `IF NOT EXISTS`는 기존 테이블에는 아무 효과가 없으므로 기존 DB는 스키마 변경 사항을 자동으로 반영하지 않습니다.
- `index.ts`: 앱 진입점 — CORS(`http://localhost:5173`로 고정), JSON 바디 파싱, `/uploads`(업로드된 이미지) 정적 파일 서빙, 두 라우터를 마운트합니다.
- `routes/categories.ts`: 카테고리 목록 조회(`LEFT JOIN`/`GROUP BY`로 제품 `item_count` 포함), 카테고리 생성(이름 unique, 중복 시 409).
- `routes/products.ts`: 제품 목록 조회(선택적으로 `category_id`로 필터링), 제품 생성(`multer`를 통한 multipart 업로드, 이미지는 타임스탬프+랜덤 파일명으로 `backend/uploads/`에 저장, jpeg/png/webp만 허용), 제품 삭제. `db.prepare(...).run/all()`을 사용한 raw SQL — 새 쿼리를 추가할 때도 이 패턴(prepared statement, 쿼리 빌더 없음)을 따르세요.
- 사용자에게 노출되는 모든 문자열(에러, 라벨)은 한국어입니다 — 일관성을 위해 새로 추가하는 백엔드 에러 메시지와 프론트엔드 UI 텍스트도 한국어로 작성하세요.

### 데이터 흐름
프론트엔드 훅 → `http://localhost:4000/<resource>`로 `fetch` → Express 라우터 → `better-sqlite3` prepared statement → SQLite 파일(`backend/wishlist.db`). 업로드된 이미지는 `backend/uploads/` 디스크에 저장되고 `/uploads/<filename>`으로 정적 서빙됩니다. DB에는 상대 경로(예: `/uploads/abc.jpg`)만 저장되며, 프론트엔드에서 `<img>` 태그를 렌더링할 때 하드코딩된 백엔드 origin을 앞에 붙입니다.

프론트엔드와 백엔드가 동시에 실행되어야 앱이 동작합니다(`vite.config.ts`에 프록시 설정이 없어 프론트엔드가 백엔드의 절대 URL을 직접 호출합니다).
