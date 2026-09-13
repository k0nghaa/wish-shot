import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { uuid } from 'expo-modules-core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OverwriteDialog } from '@/components/OverwriteDialog';
import { colors, spacing } from '@/constants/theme';
import { useAnalysis, type AnalysisState } from '@/hooks/useAnalysis';
import { readImageBytes } from '@/lib/imageBytes';
import {
  createAnalysisLog,
  createCategory,
  createItem,
  DuplicateItemError,
  findDuplicateItem,
  getCurrentUserId,
  getItemImageSignedUrl,
  listCategories,
  updateItem,
  uploadItemImage,
  type AnalysisStatus,
  type Category,
  type Item,
} from '@/lib/queries';
import type { Json } from '@/types/database';

const emptyToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

// 개인정보 고지(NFR-3)를 최초 1회만 보여주기 위한 플래그.
const PRIVACY_NOTICE_KEY = 'wishshot.privacyNoticeShown';

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/** 분석 상태를 사용자용 문구·색으로 매핑(NFR-1). idle/submitted 에선 표시 안 함(null). */
function analysisStatusInfo(
  state: AnalysisState,
  needsConfirmation: boolean,
): { text: string; color: string; loading: boolean } | null {
  switch (state.phase) {
    case 'imageReceived':
    case 'ocrRunning':
      return { text: '이미지에서 글자를 읽고 있어요…', color: colors.textSub, loading: true };
    case 'parsing':
      return { text: 'AI가 제품 정보를 정리하고 있어요…', color: colors.textSub, loading: true };
    case 'filled':
      return needsConfirmation
        ? { text: '확인이 필요해요 — AI가 채운 값을 확인해 주세요.', color: colors.accent, loading: false }
        : { text: 'AI가 제품 정보를 채웠어요. 확인해 주세요.', color: colors.primary, loading: false };
    case 'error':
      return {
        text:
          state.errorKind === 'ocr_empty'
            ? '글자를 인식하지 못했어요. 직접 입력해 주세요.'
            : '정보를 정리하지 못했어요. 직접 입력해 주세요.',
        color: colors.error,
        loading: false,
      };
    default:
      return null;
  }
}

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ imageUri?: string; imageMime?: string }>();

  const [imageUri, setImageUri] = useState<string | null>(params.imageUri ?? null);
  const [contentType, setContentType] = useState<string>(params.imageMime ?? 'image/jpeg');

  // 자동채움과 공존시키기 위해 "사용자 편집분"만 상태로 둔다. null = 아직 손대지 않음.
  const [productNameEdit, setProductNameEdit] = useState<string | null>(null);
  const [brandEdit, setBrandEdit] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState<string | null>(null);
  const [sourceLink, setSourceLink] = useState('');
  const [memo, setMemo] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null); // null = 미분류

  const [saving, setSaving] = useState(false);

  // 중복 덮어쓰기 모달 상태
  const [dupItem, setDupItem] = useState<Item | null>(null);
  const [dupThumb, setDupThumb] = useState<string | null>(null);
  const [dupVisible, setDupVisible] = useState(false);
  const [overwriteBusy, setOverwriteBusy] = useState(false);

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(() => {
        /* 카테고리 로드 실패는 저장을 막지 않는다(미분류로 저장 가능) */
      });
  }, []);

  // 분석(OCR → LLM 정제) 상태머신. 이미지가 들어오면 즉시 시작한다.
  const { analyze, reparse, state: analysisState, needsConfirmation, markSubmitted } = useAnalysis();
  const productNameRef = useRef<TextInput>(null);

  useEffect(() => {
    if (imageUri) analyze(imageUri);
  }, [imageUri, analyze]);

  // 개인정보 고지(NFR-3): 첫 이미지 업로드 시 1회만. 플래그를 먼저 세워 중복 노출을 막는다.
  useEffect(() => {
    if (!imageUri) return;
    let cancelled = false;
    (async () => {
      try {
        if (await AsyncStorage.getItem(PRIVACY_NOTICE_KEY)) return;
        await AsyncStorage.setItem(PRIVACY_NOTICE_KEY, '1');
        if (cancelled) return;
        Alert.alert(
          '이미지 분석 안내',
          '이미지는 기기에서 분석되고 비공개 저장소에만 저장돼요. AI 정제에는 인식한 텍스트만 전송돼요.',
          [{ text: '확인' }],
        );
      } catch {
        /* 고지 실패는 저장 흐름을 막지 않는다 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageUri]);

  // E-3(제품명 미인식): 정제는 됐으나 제품명이 없고 사용자가 아직 입력 안 했으면 입력란에 포커스.
  useEffect(() => {
    if (analysisState.phase === 'filled' && !analysisState.result?.productName && productNameEdit === null) {
      productNameRef.current?.focus();
    }
  }, [analysisState, productNameEdit]);

  // 자동채움은 "복사"가 아니라 "파생"으로 처리한다(effect·setState 불필요):
  // 손대지 않은 필드(*Edit === null)는 AI 값을, 손댄 필드는 사용자 값을 보여준다.
  // 사용자가 편집하면 *Edit 이 채워져 자연히 "AI가 채움" 표시가 사라진다.
  const aiResult = analysisState.phase === 'filled' ? analysisState.result : null;
  const productName = productNameEdit ?? aiResult?.productName ?? '';
  const brand = brandEdit ?? aiResult?.brand ?? '';
  const price = priceEdit ?? (aiResult?.price != null ? String(aiResult.price) : '');
  const aiFilled = {
    productName: productNameEdit === null && !!aiResult?.productName,
    brand: brandEdit === null && !!aiResult?.brand,
    price: priceEdit === null && aiResult?.price != null,
  };

  // 이번 분석 결과의 로그 상태(4종). 분석이 없었으면 null.
  function analysisLogStatus(): AnalysisStatus | null {
    if (analysisState.phase === 'error') {
      return analysisState.errorKind === 'ocr_empty' ? 'ocr_empty' : 'parse_failed';
    }
    if (analysisState.result) return needsConfirmation ? 'low_confidence' : 'parsed';
    return null;
  }

  // 저장 성공 후 분석 로그를 남기고 item_id 를 연결한다. 실패는 삼켜져 저장 흐름을 막지 않는다.
  function recordAnalysisLog(itemId: string) {
    const status = analysisLogStatus();
    if (!status) return;
    void createAnalysisLog({
      rawText: analysisState.rawText,
      parsed: (analysisState.result as unknown as Json) ?? null,
      status,
      itemId,
    });
  }

  // 재시도: 정제 실패(E-2, OCR 원문 있음)면 정제만 다시, 그 외(E-1)엔 처음부터 다시.
  function retryAnalysis() {
    if (analysisState.errorKind === 'parse_failed' && analysisState.rawText) {
      reparse(analysisState.rawText);
    } else if (imageUri) {
      analyze(imageUri);
    }
  }

  const canSave = Boolean(imageUri) && productName.trim().length > 0 && !saving;
  const analysisStatus = imageUri ? analysisStatusInfo(analysisState, needsConfirmation) : null;

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('사진 접근이 필요해요', '설정에서 사진 접근을 허용하면 이미지를 담을 수 있어요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setImageUri(asset.uri);
    if (asset.mimeType) setContentType(asset.mimeType);
  }

  function handleCreateCategory() {
    Alert.prompt('새 카테고리', '카테고리 이름을 입력해요.', async (input) => {
      const name = input?.trim();
      if (!name) return;
      try {
        const created = await createCategory(name);
        setCategories((prev) => [...prev, created]);
        setCategoryId(created.id);
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : '카테고리를 만들지 못했어요.');
      }
    });
  }

  async function openDuplicate(existing: Item) {
    const url = await getItemImageSignedUrl(existing.image_key).catch(() => null);
    setDupItem(existing);
    setDupThumb(url);
    setDupVisible(true);
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const existing = await findDuplicateItem(brand, productName.trim());
      if (existing) {
        setSaving(false);
        await openDuplicate(existing);
        return;
      }
      await performNewSave();
    } catch (e) {
      setSaving(false);
      Alert.alert('오류', e instanceof Error ? e.message : '저장에 실패했어요.');
    }
  }

  async function performNewSave() {
    const userId = await getCurrentUserId();
    const id = uuid.v4();
    const bytes = await readImageBytes(imageUri!);
    // Storage 업로드 실패 시 여기서 throw → 아이템 행을 만들지 않는다(E-5: 이미지 없는 아이템 금지).
    const imageKey = await uploadItemImage(userId, id, bytes, contentType);
    try {
      await createItem({
        id,
        categoryId,
        imageKey,
        productName: productName.trim(),
        brand: emptyToNull(brand),
        price: parsePrice(price),
        sourceLink: emptyToNull(sourceLink),
        memo: emptyToNull(memo),
      });
    } catch (e) {
      // 사전조회를 놓친 경합(23505) → 덮어쓰기 모달로 폴백
      if (e instanceof DuplicateItemError) {
        const existing = await findDuplicateItem(brand, productName.trim());
        setSaving(false);
        if (existing) await openDuplicate(existing);
        return;
      }
      throw e;
    }
    recordAnalysisLog(id);
    markSubmitted();
    setSaving(false);
    router.replace('/');
  }

  async function handleOverwrite() {
    const existing = dupItem;
    if (!existing) return;
    setOverwriteBusy(true);
    try {
      const userId = await getCurrentUserId();
      const bytes = await readImageBytes(imageUri!);
      // 같은 Storage 키에 새 스크린샷 덮어쓰기(upsert) + 필드 갱신. 새 행 추가 아님.
      await uploadItemImage(userId, existing.id, bytes, contentType);
      await updateItem(existing.id, {
        categoryId,
        productName: productName.trim(),
        brand: emptyToNull(brand),
        price: parsePrice(price),
        sourceLink: emptyToNull(sourceLink),
        memo: emptyToNull(memo),
      });
      recordAnalysisLog(existing.id);
      markSubmitted();
      setDupVisible(false);
      setOverwriteBusy(false);
      router.replace('/');
    } catch (e) {
      setOverwriteBusy(false);
      Alert.alert('오류', e instanceof Error ? e.message : '덮어쓰기에 실패했어요.');
    }
  }

  function handleViewExisting() {
    const existing = dupItem;
    setDupVisible(false);
    if (existing) {
      router.replace({ pathname: '/item/[id]', params: { id: existing.id } });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="뒤로">
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.title}>위시 담기</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* 이미지 미리보기 / 선택 */}
          <TouchableOpacity style={styles.imageBox} onPress={pickImage} accessibilityRole="button">
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderText}>사진 선택</Text>
                <Text style={styles.imageHint}>스크린샷을 골라 담아요</Text>
              </View>
            )}
          </TouchableOpacity>
          {imageUri ? (
            <TouchableOpacity onPress={pickImage} accessibilityRole="button">
              <Text style={styles.changeImage}>다른 사진 선택</Text>
            </TouchableOpacity>
          ) : null}

          {/* 분석 상태 인디케이터 (인식 중 / 정리 중 / 완료 / 확인 필요 / 실패) */}
          {analysisStatus ? (
            <View style={styles.status} accessibilityLiveRegion="polite">
              {analysisStatus.loading ? <ActivityIndicator size="small" color={colors.textSub} /> : null}
              <Text style={[styles.statusText, { color: analysisStatus.color }]}>{analysisStatus.text}</Text>
            </View>
          ) : null}

          {/* 실패(E-1/E-2) 상세: E-2 는 인식한 원문을 보여주고, 둘 다 재시도 버튼 제공 */}
          {analysisState.phase === 'error' ? (
            <View style={styles.errorBox}>
              {analysisState.errorKind === 'parse_failed' && analysisState.rawText ? (
                <>
                  <Text style={styles.errorHint}>인식한 원문(참고용)</Text>
                  <Text style={styles.errorRaw} numberOfLines={4}>
                    {analysisState.rawText}
                  </Text>
                </>
              ) : null}
              <TouchableOpacity
                onPress={retryAnalysis}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel="AI 분석 다시 시도"
              >
                <Text style={styles.retryBtnText}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 폼 */}
          <Field label="제품명" required ai={aiFilled.productName}>
            <TextInput
              ref={productNameRef}
              style={styles.input}
              placeholder="예: 무선 이어폰"
              placeholderTextColor={colors.textDisabled}
              value={productName}
              onChangeText={setProductNameEdit}
            />
          </Field>
          <Field label="브랜드" ai={aiFilled.brand}>
            <TextInput
              style={styles.input}
              placeholder="예: 소니"
              placeholderTextColor={colors.textDisabled}
              value={brand}
              onChangeText={setBrandEdit}
            />
          </Field>
          <Field label="가격 (원)" ai={aiFilled.price}>
            <TextInput
              style={styles.input}
              placeholder="예: 189000"
              placeholderTextColor={colors.textDisabled}
              keyboardType="number-pad"
              value={price}
              onChangeText={setPriceEdit}
            />
          </Field>
          <Field label="링크">
            <TextInput
              style={styles.input}
              placeholder="https://"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={sourceLink}
              onChangeText={setSourceLink}
            />
          </Field>
          <Field label="메모">
            <TextInput
              style={[styles.input, styles.memo]}
              placeholder="메모를 남겨요"
              placeholderTextColor={colors.textDisabled}
              multiline
              value={memo}
              onChangeText={setMemo}
            />
          </Field>

          {/* 카테고리 선택 */}
          <Text style={styles.fieldLabel}>카테고리</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="미분류" selected={categoryId === null} onPress={() => setCategoryId(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
            <Chip label="+ 새 카테고리" selected={false} onPress={handleCreateCategory} />
          </ScrollView>

          <TouchableOpacity
            style={[styles.save, !canSave && styles.saveDisabled]}
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator color={colors.bgCard} />
            ) : (
              <Text style={styles.saveText}>저장</Text>
            )}
          </TouchableOpacity>
          {!imageUri ? (
            <Text style={styles.saveNote}>사진을 선택해야 저장할 수 있어요.</Text>
          ) : productName.trim().length === 0 ? (
            <Text style={styles.saveNote}>제품명을 입력해주세요.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <OverwriteDialog
        visible={dupVisible}
        item={dupItem}
        thumbnailUrl={dupThumb}
        busy={overwriteBusy}
        onOverwrite={handleOverwrite}
        onView={handleViewExisting}
        onCancel={() => setDupVisible(false)}
      />
    </SafeAreaView>
  );
}

function Field({
  label,
  required,
  ai,
  children,
}: {
  label: string;
  required?: boolean;
  ai?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {ai ? (
          <View style={styles.aiBadge} accessibilityLabel="AI가 채운 값이에요">
            <Text style={styles.aiBadgeText}>AI가 채움</Text>
          </View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.three,
    paddingTop: spacing.two,
    paddingBottom: spacing.two,
  },
  back: { fontSize: 16, color: colors.primary, width: 72 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.textMain, textAlign: 'center' },
  headerSpacer: { width: 72 },
  content: {
    padding: spacing.three,
    gap: spacing.three,
    paddingBottom: spacing.six,
  },
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.one,
  },
  imagePlaceholderText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  imageHint: { fontSize: 13, color: colors.textSub },
  changeImage: { fontSize: 14, color: colors.primary, textAlign: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.two,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  statusText: { flex: 1, fontSize: 13, fontWeight: '500' },
  errorBox: {
    gap: spacing.two,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.three,
  },
  errorHint: { fontSize: 12, color: colors.textSub },
  errorRaw: { fontSize: 13, color: colors.textMain },
  retryBtn: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  field: { gap: spacing.one },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.two },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.textMain },
  aiBadge: {
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingVertical: 2,
    paddingHorizontal: spacing.two,
  },
  aiBadgeText: { fontSize: 11, fontWeight: '600', color: colors.bgCard },
  required: { color: colors.error },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: 10,
    paddingVertical: spacing.three,
    paddingHorizontal: spacing.three,
    fontSize: 16,
    color: colors.textMain,
  },
  memo: { minHeight: 80, textAlignVertical: 'top' },
  chips: { gap: spacing.two, paddingVertical: spacing.one },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.silver,
    backgroundColor: colors.bgCard,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textSub },
  chipTextSelected: { color: colors.bgCard, fontWeight: '600' },
  save: {
    marginTop: spacing.two,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { fontSize: 16, fontWeight: '600', color: colors.bgCard },
  saveNote: { fontSize: 12, color: colors.textSub, textAlign: 'center' },
});
