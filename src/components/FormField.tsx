import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { Children, useCallback, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type TextInputProps,
} from 'react-native';

import { colors, hairlineWidth, radius, spacing, type } from '@/constants/theme';

/**
 * iOS 설정 톤의 그룹 카드 폼 프리미티브(M3). 등록·편집 화면이 공유한다.
 * - FormCard: 그룹 카드 컨테이너. 직계 자식 사이에 헤어라인 구분선을 자동 삽입.
 * - FormRow: 라벨 좌 / 값 우(children) 한 줄. required(*) 표시 지원.
 * - FormLineInput: FormRow 안의 한 줄 입력. 넘치면 앞부분을 보이고 오른쪽 끝을 페이드로 흐린다(옆으로 밀어 볼 수 있음).
 * - FormBlock: 라벨 위 / 전체폭 children 아래(메모·태그 등).
 * - DisclosureRow: 라벨 좌 / 값 + › 우, 탭 가능(폴더 선택 등).
 */

export function FormCard({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.card}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={styles.sep} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function FormRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <View style={styles.value}>{children}</View>
    </View>
  );
}

// 끝 페이드 폭. 글자 한두 개가 흐려질 만큼만.
const FADE_WIDTH = 28;

/**
 * FormRow 안의 한 줄 입력(등록·편집 공용 — 제품명·브랜드·가격·링크).
 * - 값이 칸에 들어가면 지금처럼 오른쪽 정렬.
 * - 넘치면(포커스 밖) 앞부분부터 한 줄로 보이고, 오른쪽 끝을 카드 배경색으로 페이드해 글자가 이어져 있음을 표시한다.
 *   표시는 입력 위에 덮은 가로 스크롤 한 줄이라, 입력하지 않고도 옆으로 밀어 잘린 부분을 볼 수 있다
 *   (민 만큼 왼쪽 끝도 흐리고, 끝까지 밀면 오른쪽 흐림은 사라진다). 탭하면 입력을 시작한다.
 *   iOS 입력 칸의 말줄임 대신 직접 그려 페이드와 겹치지 않게 했다.
 * - 포커스 중에는 기본 입력 동작(커서 위치로 스크롤)이고 덮개는 없다.
 * 넘침은 같은 글꼴의 숨은 한 줄 텍스트 폭과 칸 폭을 비교해 판단한다.
 */
export function FormLineInput({
  ref,
  value,
  onFocus,
  onBlur,
  style,
  ...rest
}: TextInputProps & { ref?: Ref<TextInput> }) {
  const [boxWidth, setBoxWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  // 덮개를 민 상태(흐림 표시용 — 경계를 넘을 때만 바꿔 다시 그리기를 줄인다). 값이 바뀌면 처음 상태로 본다.
  const [scrolled, setScrolled] = useState<{ text: string; left: boolean; atEnd: boolean } | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  // 호출부 ref(예: 제품명 칸 자동 포커스)와 덮개 탭 포커스용 ref 를 함께 건다.
  const setInputRef = useCallback(
    (node: TextInput | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const text = value ?? '';
  // 1pt 여유: 반올림 차이로 딱 맞는 값이 넘친 것으로 보이지 않게.
  const overflow = text.length > 0 && boxWidth > 0 && textWidth > boxWidth + 1;
  // 포커스 중에 입력이 잠기면(저장 중 editable=false) blur 가 안 올 수 있어, 잠긴 동안은 포커스 밖으로 본다.
  const isFocused = focused && rest.editable !== false;
  const showCover = overflow && !isFocused;
  const scrollState = scrolled && scrolled.text === text ? scrolled : null;
  const fadeLeft = scrollState?.left ?? false;
  const fadeRight = !(scrollState?.atEnd ?? false);

  return (
    <View style={styles.lineBox} onLayout={(e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width)}>
      <TextInput
        ref={setInputRef}
        {...rest}
        value={value}
        style={[formInput.rowInput, style, overflow && styles.alignLeft]}
        onFocus={(e) => {
          setFocused(true);
          setScrolled(null); // 덮개가 다시 그려지면 처음(앞부분)부터 보인다
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
      {showCover ? (
        <View style={styles.lineCover} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ScrollView
            key={text} // 값이 바뀌면 처음(앞부분)부터
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              const left = x > 1;
              const atEnd = x + boxWidth >= textWidth - 1;
              if (scrollState?.left === left && scrollState?.atEnd === atEnd) return;
              if (!scrollState && !left && !atEnd) return;
              setScrolled({ text, left, atEnd });
            }}
            contentContainerStyle={styles.lineScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable onPress={() => inputRef.current?.focus()} disabled={rest.editable === false}>
              <Text style={[formInput.rowInput, style, styles.lineCoverText]} numberOfLines={1}>
                {text}
              </Text>
            </Pressable>
          </ScrollView>
          {fadeLeft ? (
            <LinearGradient
              colors={[colors.bgCard, colors.bgCardClear]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.lineFade, styles.lineFadeLeft]}
              pointerEvents="none"
            />
          ) : null}
          {fadeRight ? (
            <LinearGradient
              colors={[colors.bgCardClear, colors.bgCard]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.lineFade, styles.lineFadeRight]}
              pointerEvents="none"
            />
          ) : null}
        </View>
      ) : null}
      {/* 넘침 판정용 숨은 한 줄 텍스트(폭 제한 없이 글자 폭만 잰다). */}
      <View style={styles.measureBox} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text
          style={[formInput.rowInput, style, styles.measureText]}
          numberOfLines={1}
          onLayout={(e: LayoutChangeEvent) => setTextWidth(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

export function FormBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function DisclosureRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.discValueWrap}>
        <Text style={styles.discValue} numberOfLines={1}>
          {value}
        </Text>
        <SymbolView name="chevron.right" size={14} tintColor={colors.silverDark} weight="semibold" />
      </View>
    </TouchableOpacity>
  );
}

/** 폼 입력(TextInput) 공용 스타일. 등록·편집이 공유한다. */
export const formInput = StyleSheet.create({
  // 그룹 카드 행 안의 단일 라인 입력: 테두리 없이 값은 우측 정렬.
  rowInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textMain,
    textAlign: 'right',
    paddingVertical: 0,
  },
  // 메모 등 전체폭 여러 줄 입력.
  memo: {
    minHeight: 72,
    fontSize: 16,
    color: colors.textMain,
    textAlignVertical: 'top',
  },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    paddingHorizontal: spacing.three,
    overflow: 'hidden',
  },
  sep: {
    height: hairlineWidth,
    backgroundColor: colors.silver,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.three,
    minHeight: 48,
    paddingVertical: spacing.two,
  },
  label: { ...type.body, color: colors.textMain },
  required: { color: colors.error },
  value: { flex: 1 },
  // 한 줄 입력: 넘침 판정·덮개를 위해 칸을 잘라 둔다. 가로 줄(링크 칸의 스피너 옆)에서는 남은 폭을 채운다.
  lineBox: { flexGrow: 1, flexShrink: 1, justifyContent: 'center', overflow: 'hidden' },
  alignLeft: { textAlign: 'left' },
  // 포커스 밖 넘침 표시: 입력 위를 카드 배경으로 덮고 가로 스크롤 한 줄 + 끝 페이드.
  lineCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
  },
  lineScrollContent: { flexGrow: 1, alignItems: 'center' },
  lineCoverText: { flex: 0, textAlign: 'left' },
  lineFade: { position: 'absolute', top: 0, bottom: 0, width: FADE_WIDTH },
  lineFadeLeft: { left: 0 },
  lineFadeRight: { right: 0 },
  // 숨은 측정 텍스트: 폭 제한이 없도록 아주 넓은 상자 안에서 글자 폭만큼만 자란다.
  measureBox: { position: 'absolute', left: 0, top: 0, width: 10000, flexDirection: 'row', opacity: 0 },
  measureText: { flex: 0, flexShrink: 0, textAlign: 'left' },
  block: { paddingVertical: spacing.three, gap: spacing.two },
  discValueWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.one, flexShrink: 1 },
  discValue: { ...type.body, color: colors.textSub, flexShrink: 1, textAlign: 'right' },
});
