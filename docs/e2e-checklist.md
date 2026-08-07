# WishShot Round 1 — 수동 E2E 체크리스트

> **목적**: 소유자 전용 로그인 게이트가 jose + Supabase JWKS 경로로 올바르게 동작하는지 수동으로 확인합니다.  
> 자동화된 테스트 없이 이 체크리스트만으로 검증합니다 (AC 2 기준).

---

## 사전 준비

- [ ] 로컬 Supabase 스택이 실행 중입니다 (`supabase start` 완료)
- [ ] `.env.local` 파일이 아래 값을 포함합니다:
  - `NEXT_PUBLIC_SUPABASE_URL` — 로컬: `http://localhost:54321`
  - `SUPABASE_ANON_KEY` — `supabase status`로 확인한 `anon key`
  - `SUPABASE_SERVICE_ROLE_KEY` — `supabase status`로 확인한 `service_role key`
  - `OWNER_UID` — Supabase Studio에서 미리 생성한 소유자 계정의 UUID
- [ ] Supabase Studio(`http://localhost:54323`) → Authentication → Users에서 소유자 계정이 존재합니다
- [ ] Next.js 개발 서버가 실행 중입니다 (`npm run next-dev`, 기본 포트 3000)

---

## 시나리오 1: 비인증 사용자 리다이렉트

1. 브라우저에서 `http://localhost:3000` 접속
2. **기대 결과**: `/login`으로 자동 리다이렉트됨
3. [ ] 확인

---

## 시나리오 2: 잘못된 자격 증명으로 로그인 실패

1. `/login` 페이지에서 잘못된 이메일/비밀번호 입력 후 제출
2. **기대 결과**: "이메일 또는 비밀번호가 올바르지 않습니다" 오류 메시지 표시
3. [ ] 확인
4. 페이지 이동 없이 `/login`에 그대로 남아 있음
5. [ ] 확인

---

## 시나리오 3: 소유자 계정으로 로그인 성공

1. `/login` 페이지에서 소유자 계정 이메일/비밀번호 입력 후 제출
2. **기대 결과**: `/`(홈)로 리다이렉트됨
3. [ ] 확인
4. 브라우저 DevTools → Application → Cookies에서 `wishshot-session` 쿠키 존재 확인
   - `HttpOnly: true`
   - `SameSite: Lax`
5. [ ] 확인

---

## 시나리오 4: JWT 클레임 검증 (로그)

1. 로그인 성공 직후 Next.js 서버 콘솔을 확인합니다
2. **기대 결과**: JWT 검증 오류 없음, `[JWT 검증 오류]` 로그 없음
3. [ ] 확인
4. **검증된 클레임**:
   - `exp` — jose가 만료 시각 자동 확인 (만료 시 `JWTExpired` 오류)
   - `iss` — `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1`와 일치
   - `aud` — `authenticated`와 일치
   - `sub` — `OWNER_UID` 환경 변수와 일치
5. [ ] 확인

---

## 시나리오 5: 로그인 상태에서 보호 페이지 접근

1. 로그인 후 `http://localhost:3000` 접속
2. **기대 결과**: 홈 페이지 정상 표시, 로그아웃 버튼 보임
3. [ ] 확인

---

## 시나리오 6: 로그아웃

1. 홈 페이지에서 "로그아웃" 버튼 클릭
2. **기대 결과**: `/login`으로 리다이렉트됨
3. [ ] 확인
4. `wishshot-session` 쿠키가 삭제됨
5. [ ] 확인
6. 다시 `http://localhost:3000` 접속 시 `/login`으로 리다이렉트됨
7. [ ] 확인

---

## 시나리오 7: 만료된/변조된 토큰 차단

1. DevTools에서 `wishshot-session` 쿠키 값을 임의의 문자열로 수정
2. `http://localhost:3000` 접속
3. **기대 결과**: 미들웨어가 JWT 검증 실패를 감지하고 `/login`으로 리다이렉트
4. [ ] 확인
5. 변조된 쿠키가 삭제됨
6. [ ] 확인

---

## 시나리오 8: 비소유자 계정 차단 (선택적)

> 소유자가 아닌 Supabase Auth 계정이 존재하는 경우에만 확인

1. 비소유자 계정으로 Supabase Auth API를 직접 호출해 토큰 획득
2. 해당 토큰을 `wishshot-session` 쿠키에 수동 삽입
3. `http://localhost:3000` 접속
4. **기대 결과**: 미들웨어가 `sub ≠ OWNER_UID`를 감지하고 `/login`으로 리다이렉트
5. [ ] 확인

---

## 완료 기준

위 시나리오 1–7이 모두 통과하면 AC 2 완료 조건을 만족합니다.

| 항목 | 결과 |
|------|------|
| 비인증 리다이렉트 | ☐ 통과 |
| 잘못된 자격 증명 차단 | ☐ 통과 |
| 소유자 로그인 성공 | ☐ 통과 |
| JWT 클레임 검증 (exp/iss/aud/sub) | ☐ 통과 |
| 보호 페이지 접근 | ☐ 통과 |
| 로그아웃 | ☐ 통과 |
| 변조 토큰 차단 | ☐ 통과 |
