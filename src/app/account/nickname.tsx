import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  InputAccessoryView,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { leaveFlow } from '@/components/account/leaveFlow';
import { colors, radius, spacing, type } from '@/constants/theme';
import { checkNickname, getAccount, saveNickname, type NicknameCheckResult, type SaveNicknameResult } from '@/lib/queries';

// 닉네임(모달). 파라미터 mode: signup | edit — 설계 3(docs/phases/phase-22-account-login.md). 화면 등록·띄우는 시점은 login-feature 가 만든다.
// signup: 계정을 만들 때 추천값이 이미 저장돼 있다 — 이 화면은 바꿀 기회로 한 번만. 끌어내려도 닫히지 않고 [완료]로만 닫는다.
// edit: 설정에서 연 화면, [저장].

const ACCESSORY_ID = 'nickname-accessory';
const CHECK_DELAY_MS = 500;

type Problem =
  | { kind: 'taken'; suggestions: string[] }
  | { kind: 'invalid_length' }
  | { kind: 'invalid_chars' }
  | { kind: 'reserved' };

const PROBLEM_TEXT: Record<Problem['kind'], string> = {
  taken: '이미 사용 중인 닉네임입니다',
  invalid_length: '2~12자로 입력하세요',
  invalid_chars: '한글·영문·숫자만 쓸 수 있습니다',
  reserved: '쓸 수 없는 닉네임입니다',
};

// 검사·저장 결과 중 입력을 막는 것만 문제로 본다.
function problemOf(result: NicknameCheckResult | SaveNicknameResult): Problem | null {
  switch (result.kind) {
    case 'taken':
      return { kind: 'taken', suggestions: result.suggestions };
    case 'invalid_length':
    case 'invalid_chars':
    case 'reserved':
      return { kind: result.kind };
    default:
      return null;
  }
}

export default function NicknameScreen() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: 'signup' | 'edit' = modeParam === 'edit' ? 'edit' : 'signup';
  const doneLabel = mode === 'signup' ? '완료' : '저장';

  const [initial, setInitial] = useState<string | null>(null); // 지금 닉네임(null = 불러오는 중)
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [keyboardShown, setKeyboardShown] = useState(false);
  const checkSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    getAccount()
      .then((account) => {
        if (cancelled) return;
        const nickname = account.kind === 'signed_in' ? account.nickname : '';
        setInitial(nickname);
        setValue(nickname);
      })
      .catch(() => {
        if (!cancelled) setInitial('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 입력을 멈추면 서버에 확인한다(저장 때 한 번 더 확인).
  useEffect(() => {
    if (initial === null || value === initial) {
      checkSeq.current += 1;
      return;
    }
    const seq = ++checkSeq.current;
    const timer = setTimeout(() => {
      checkNickname(value)
        .then((result) => {
          if (seq === checkSeq.current) setProblem(problemOf(result));
        })
        .catch(() => {});
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, initial]);

  function change(next: string) {
    setValue(next);
    setProblem(null);
  }

  async function submit() {
    if (initial === null || saving) return;
    const name = value; // 앞뒤 공백도 그대로 검사한다(자르지 않음)
    if (name === initial && mode === 'edit') {
      router.dismiss(); // 바꾸지 않음 — 그대로 닫는다
      return;
    }
    // 가입 때는 추천값 그대로여도 저장 호출을 한다(서버가 unchanged 로 받고, 계측 nickname_saved 는 데이터 레이어가 보낸다).
    setSaving(true);
    try {
      const result = await saveNickname(name);
      if (result.kind === 'saved') {
        leaveFlow(router);
      } else if (result.kind === 'error') {
        Alert.alert('저장하지 못했습니다', result.reason === 'network' ? '네트워크 연결을 확인하세요.' : '잠시 후 다시 시도하세요.');
      } else {
        setProblem(problemOf(result));
      }
    } catch {
      Alert.alert('저장하지 못했습니다', '잠시 후 다시 시도하세요.');
    } finally {
      setSaving(false);
    }
  }

  const empty = value.length === 0;
  const doneDisabled = initial === null || saving || empty || problem !== null;
  const doneButton = (
    <TouchableOpacity
      style={[styles.doneButton, doneDisabled && styles.doneDisabled]}
      onPress={() => void submit()}
      disabled={doneDisabled}
      accessibilityRole="button"
      accessibilityLabel={doneLabel}
      accessibilityState={{ disabled: doneDisabled, busy: saving }}
    >
      <Text style={styles.doneText}>{doneLabel}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ gestureEnabled: mode === 'edit' }} />
      <View style={styles.header}>
        {mode === 'edit' ? (
          <TouchableOpacity onPress={() => router.dismiss()} hitSlop={8} accessibilityRole="button" accessibilityLabel="취소">
            <Text style={styles.cancel}>취소</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSide} />
        )}
        <Text style={styles.title} accessibilityRole="header">
          닉네임
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View style={styles.content}>
        <View style={[styles.inputRow, problem && styles.inputRowError]}>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={change}
            placeholder="닉네임"
            placeholderTextColor={colors.textDisabled}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={20}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            inputAccessoryViewID={Platform.OS === 'ios' ? ACCESSORY_ID : undefined}
            accessibilityLabel="닉네임"
          />
          {value.length > 0 ? (
            <TouchableOpacity onPress={() => change('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="지우기">
              <SymbolView name="xmark.circle.fill" size={18} tintColor={colors.silverDark} />
            </TouchableOpacity>
          ) : null}
        </View>

        {problem ? (
          <Text style={styles.error} accessibilityRole="alert">
            {PROBLEM_TEXT[problem.kind]}
          </Text>
        ) : (
          <Text style={styles.help}>2~12자, 한글·영문·숫자</Text>
        )}

        {problem?.kind === 'taken' && problem.suggestions.length > 0 ? (
          <View style={styles.chips}>
            {problem.suggestions.map((name) => (
              <TouchableOpacity
                key={name}
                style={styles.chip}
                onPress={() => change(name)}
                accessibilityRole="button"
                accessibilityLabel={name}
              >
                <Text style={styles.chipText}>{name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* 키보드를 내렸을 때를 위한 같은 버튼. 키보드가 있으면 그 위의 버튼을 쓴다. */}
        {!keyboardShown ? <View style={styles.inlineDone}>{doneButton}</View> : null}
      </View>

      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={ACCESSORY_ID}>
          <View style={styles.accessory}>{doneButton}</View>
        </InputAccessoryView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.three,
    paddingBottom: spacing.two,
  },
  headerSide: { width: 72 },
  cancel: { fontSize: 16, color: colors.primary, width: 72 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.textMain, textAlign: 'center' },
  content: { padding: spacing.three, gap: spacing.two },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.two,
    minHeight: 48,
    paddingHorizontal: spacing.three,
    borderRadius: radius.md,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.bgCard,
  },
  inputRowError: { borderColor: colors.error },
  input: { flex: 1, ...type.body, color: colors.textMain, paddingVertical: spacing.two },
  help: { ...type.footnote, color: colors.textSub, paddingHorizontal: spacing.one },
  error: { ...type.footnote, color: colors.error, paddingHorizontal: spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.two, marginTop: spacing.one },
  chip: {
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  chipText: { ...type.subhead, color: colors.textMain },
  inlineDone: { marginTop: spacing.three },
  accessory: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: spacing.three,
    paddingVertical: spacing.two,
  },
  doneButton: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneDisabled: { opacity: 0.4 },
  doneText: { ...type.headline, color: colors.bg },
});
