// 닉네임 규칙 명세 시험 — 통신 없음.
// 정본은 DB 함수(supabase/migrations/0008_profiles.sql)다. 이 파일은 같은 규칙을 메모리 모델(참조 구현)로 적어
// 사례를 고정하고, 같은 사례를 supabase/tests/accounts.sql 이 실제 DB 에서 확인한다(사람이 SQL Editor 에서 실행).
// 규칙을 바꾸면 세 곳(0008·이 파일·accounts.sql)을 함께 고친다.
// 실행: deno test --no-lock supabase/tests/nickname_rules_test.ts

function eq(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const RESERVED = ['위시샷', 'wishshot', '관리자', '운영자', 'admin', '위시샷공식'];
const ALLOWED = /^[가-힣A-Za-z0-9]*$/;

// 메모리 모델: user_id → nickname. 고유성은 키(lower(NFC))로 판정한다.
class Model {
  profiles = new Map<string, string>();
  key(n: string): string {
    return n.normalize('NFC').toLowerCase();
  }
  verdict(uid: string, raw: string | null): { result: string; nickname?: string } {
    if (raw == null || raw.length > 1000) return { result: 'invalid_length' };
    const name = raw.normalize('NFC'); // 앞뒤 공백도 자르지 않는다
    // 검사 순서: 글자 종류 → 길이(코드 포인트 수 2~12) → 예약어 → 중복
    if (!ALLOWED.test(name)) return { result: 'invalid_chars' };
    const len = [...name].length;
    if (len < 2 || len > 12) return { result: 'invalid_length' };
    if (RESERVED.includes(name.toLowerCase())) return { result: 'reserved' };
    if (this.profiles.get(uid) === name) return { result: 'unchanged' };
    for (const [other, nick] of this.profiles) {
      if (other !== uid && this.key(nick) === this.key(name)) return { result: 'taken' };
    }
    return { result: 'available', nickname: name };
  }
  check(uid: string, raw: string | null): string {
    return this.verdict(uid, raw).result;
  }
  // set_nickname: 같은 검사 뒤 저장. unchanged 는 쓰지 않고 saved. 동시 선점은 UNIQUE 가 막는다(여기선 verdict 가 같은 효과).
  set(uid: string, raw: string | null): string {
    const v = this.verdict(uid, raw);
    if (v.result === 'unchanged') return 'saved';
    if (v.result !== 'available') return v.result;
    this.profiles.set(uid, v.nickname!);
    return 'saved';
  }
  // ensure_profile: 없으면 만들고 created=true, 있으면 false
  ensure(uid: string): { nickname: string; created: boolean } {
    const existing = this.profiles.get(uid);
    if (existing) return { nickname: existing, created: false };
    let n: string;
    do n = `위시러${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    while ([...this.profiles.values()].some((p) => this.key(p) === this.key(n)));
    this.profiles.set(uid, n);
    return { nickname: n, created: true };
  }
  drop(uid: string): void {
    this.profiles.delete(uid);
  }
}

Deno.test('글자 수: 1자·13자는 invalid_length, 2자·12자는 통과', () => {
  const m = new Model();
  eq(m.check('u1', 'a'), 'invalid_length');
  eq(m.check('u1', ''), 'invalid_length');
  eq(m.check('u1', '가'), 'invalid_length');
  eq(m.check('u1', 'abcdefghijklm'), 'invalid_length', '13자');
  eq(m.check('u1', '가나다라마바사아자차카타파'), 'invalid_length', '13자 한글');
  eq(m.check('u1', 'ab'), 'available');
  eq(m.check('u1', 'abcdefghijkl'), 'available', '12자');
  eq(m.check('u1', null), 'invalid_length');
  eq(m.check('u1', 'a'.repeat(101)), 'invalid_length');
});

Deno.test('글자 종류: 한글·영문·숫자만 — 띄어쓰기·특수문자·이모지·자모 낱글자는 invalid_chars', () => {
  const m = new Model();
  eq(m.check('u1', '민 지'), 'invalid_chars');
  eq(m.check('u1', '민지 '), 'invalid_chars', '앞뒤 공백도 막는다(자르지 않음)');
  eq(m.check('u1', 'min!ji'), 'invalid_chars');
  eq(m.check('u1', 'min_ji'), 'invalid_chars');
  eq(m.check('u1', '민지😀'), 'invalid_chars');
  eq(m.check('u1', 'ㅋㅋㅋ'), 'invalid_chars', '완성형 음절이 아닌 자모');
  eq(m.check('u1', '민지27'), 'available');
  eq(m.check('u1', 'MinJi99'), 'available');
});

Deno.test('예약어 6개는 대소문자를 섞어도 reserved, 정확히 같을 때만 막는다', () => {
  const m = new Model();
  for (const w of ['위시샷', 'wishshot', 'WishShot', 'WISHSHOT', '관리자', '운영자', 'admin', 'ADMIN', 'Admin', '위시샷공식']) {
    eq(m.check('u1', w), 'reserved', w);
  }
  eq(m.check('u1', '위시샷공식2'), 'available', '정확 일치만 차단');
  eq(m.check('u1', 'admin1'), 'available');
  eq(m.check('u1', 'myadmin'), 'available');
  eq(m.check('u1', '위시샷팬'), 'available');
});

Deno.test('검사 순서: 글자 종류가 길이보다 먼저, 둘 다 예약어보다 먼저', () => {
  const m = new Model();
  eq(m.check('u1', 'a b'), 'invalid_chars');
  eq(m.check('u1', 'a b c d e f g h i j'), 'invalid_chars', '길이도 넘지만 종류 오류가 먼저');
  eq(m.check('u1', '!'), 'invalid_chars', '1자여도 종류 오류가 먼저');
  eq(m.check('u1', 'é'), 'invalid_chars', '악센트');
  eq(m.check('u1', 'Ａbc'), 'invalid_chars', '전각');
  eq(m.check('u1', 'ㅋ'), 'invalid_chars', '자모 단독');
  eq(m.check('u1', 'a'), 'invalid_length');
  eq(m.check('u1', 'a'.repeat(13)), 'invalid_length');
  eq(m.check('u1', ''), 'invalid_length', '빈 값은 종류 오류가 없으니 길이');
  eq(m.check('u1', ' '), 'invalid_chars', '공백만');
  eq(m.check('u1', 'éx'), 'invalid_chars', 'NFC 로 바꾼 뒤에도 악센트(é)가 남는다');
});

Deno.test('코드 포인트 수로 센다: 분해형 한글도 NFC 로 바꾼 뒤 센다', () => {
  const m = new Model();
  // 분해형 한글 6자(자모 15개)는 NFC 로 6자 → 통과
  eq(m.check('u1', '민'.repeat(6)), 'available');
  eq(m.check('u1', '민'.repeat(13)), 'invalid_length');
});

Deno.test('NFC·대소문자만 다른 같은 이름은 taken, 본인은 자기 이름을 그대로 쓸 수 있다', () => {
  const m = new Model();
  const nfd = '민지'; // 민지(분해형)
  eq(m.set('u1', '민지'), 'saved');
  eq(m.check('u2', nfd), 'taken', 'NFC 정규화 뒤 비교');
  eq(m.check('u2', '민지'), 'taken');
  eq(m.set('u1', 'Minji'), 'saved');
  eq(m.check('u2', 'minji'), 'taken', '대소문자 무시');
  eq(m.check('u2', 'MINJI'), 'taken');
  eq(m.check('u1', 'Minji'), 'unchanged', '내 이름과 똑같음');
  eq(m.check('u1', 'minji'), 'available', '내 이름의 대소문자만 바꾸기');
  eq(m.set('u1', 'minji'), 'saved');
  eq(m.profiles.get('u1'), 'minji');
});

Deno.test('분해형으로 넣어도 NFC 로 저장한다', () => {
  const m = new Model();
  eq(m.set('u1', '민지'), 'saved');
  eq(m.profiles.get('u1'), '민지');
});

Deno.test('바꾸면 옛 닉네임을 바로 다시 쓸 수 있고, 계정을 지워도 마찬가지다', () => {
  const m = new Model();
  m.set('u1', '민지');
  eq(m.check('u2', '민지'), 'taken');
  m.set('u1', '지민');
  eq(m.check('u2', '민지'), 'available', '바꾼 뒤 바로');
  m.set('u2', '민지');
  m.drop('u2'); // 계정 삭제
  eq(m.check('u3', '민지'), 'available', '삭제 뒤 바로');
});

Deno.test('동시에 같은 이름을 저장하면 하나만 성공한다(저장 시점 재검사 — DB 에서는 UNIQUE 가 보장)', () => {
  const m = new Model();
  const results = [m.set('u1', '같은이름'), m.set('u2', '같은이름')];
  eq(results.filter((r) => r === 'saved').length, 1);
  eq(results.filter((r) => r === 'taken').length, 1);
});

Deno.test('ensure_profile 을 두 번 불러도 created 는 한 번만 true, 추천값은 "위시러"+숫자 4자리', () => {
  const m = new Model();
  const first = m.ensure('u1');
  const second = m.ensure('u1');
  eq([first.created, second.created], [true, false]);
  eq(first.nickname, second.nickname);
  eq(/^위시러[0-9]{4}$/.test(first.nickname), true);
  // 추천값은 규칙을 통과하는 값이다(예약어·글자 규칙)
  eq(new Model().check('x', first.nickname), 'available');
});
