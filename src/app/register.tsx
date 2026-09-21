import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { uuid } from 'expo-modules-core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { DisclosureRow, FormBlock, FormCard, FormRow, formInput } from '@/components/FormField';
import { useOnboardingTarget, type Measurable } from '@/components/Onboarding/onboardingTarget';
import { ImageZoomModal } from '@/components/ImageZoomModal';
import { OverwriteDialog } from '@/components/OverwriteDialog';
import { RegionSelectSheet } from '@/components/RegionSelectSheet';
import { TagInput } from '@/components/TagInput';
import { PRIVACY_NOTICE } from '@/constants/privacy';
import { colors, radius, spacing, type } from '@/constants/theme';
import { useAnalysis, type AnalysisState } from '@/hooks/useAnalysis';
import { ImageNotReadyError, logImageDiag, readImageBytes } from '@/lib/imageBytes';
import { canOfferAlbumDelete, deletePhotoAsset, getRecentPhotoAsset } from '@/lib/photoLibrary';
import {
  createAnalysisLog,
  createCategory,
  createItem,
  DuplicateItemError,
  findDuplicateItem,
  getCurrentUserId,
  getItemImageSignedUrl,
  listAllTags,
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
// "제품 영역 지정" 시트의 선택 영역 전송 고지를 최초 1회만 보여주기 위한 플래그.
const REGION_NOTICE_KEY = 'wishshot.regionNoticeShown';

function parsePrice(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

// 최근 사진 uri 확장자로 콘텐츠 타입을 추정한다(iOS 스크린샷은 png). picker 결과와 달리 mimeType 이 없다.
function guessContentType(uri: string): string {
  return /\.png(\?|$)/i.test(uri) ? 'image/png' : 'image/jpeg';
}

/** 분석 상태를 사용자용 문구·색으로 매핑(NFR-1). idle/submitted 에선 표시 안 함(null). */
function analysisStatusInfo(
  state: AnalysisState,
  needsConfirmation: boolean,
): { text: string; color: string; loading: boolean } | null {
  switch (state.phase) {
    case 'imageReceived':
    case 'ocrRunning':
      return { text: '글자를 읽는 중…', color: colors.textSub, loading: true };
    case 'parsing':
    case 'imageParsing':
      return { text: 'AI가 정보를 정리하는 중…', color: colors.textSub, loading: true };
    case 'filled':
      // E-3(부분 성공): 정제는 됐으나 제품명을 못 뽑음 → 제품명 입력을 명시적으로 안내.
      if (state.result && !state.result.productName) {
        return { text: '제품명을 인식하지 못했습니다. 직접 입력하세요.', color: colors.textMain, loading: false };
      }
      return needsConfirmation
        ? { text: 'AI가 채운 값을 확인하세요.', color: colors.textMain, loading: false }
        : { text: 'AI가 채웠습니다. 확인하세요.', color: colors.textMain, loading: false };
    case 'error':
      return {
        text:
          state.errorKind === 'ocr_empty'
            ? '글자를 인식하지 못했습니다. 직접 입력하세요.'
            : state.errorKind === 'image_not_ready'
              ? '사진을 아직 내려받지 못했습니다. 잠시 후 다시 시도하세요.'
              : state.errorKind === 'image_parse_failed'
                ? '이미지 분석에 실패했습니다. 다시 시도하세요.'
                : '정보를 정리하지 못했습니다. 직접 입력하세요.',
        color: colors.error,
        loading: false,
      };
    default:
      return null;
  }
}

export default function RegisterScreen() {
  const router = useRouter();
  // sourceLink: 링크붙이기 모드(기능 1) "새로 담기"로 넘어온 공유 URL 프리필.
  const params = useLocalSearchParams<{ imageUri?: string; imageMime?: string; sourceLink?: string }>();

  // 온보딩 코치마크 대상 등록(첫 실행 투어). 온보딩이 없을 땐 아무 영향 없음.
  const { register: registerTarget } = useOnboardingTarget();
  const setImageBoxRef = useCallback((n: Measurable | null) => registerTarget('register.imageBox', n), [registerTarget]);
  const setRecentRef = useCallback((n: Measurable | null) => registerTarget('register.recentPhoto', n), [registerTarget]);

  const [imageUri, setImageUri] = useState<string | null>(params.imageUri ?? null);
  const [contentType, setContentType] = useState<string>(params.imageMime ?? 'image/jpeg');
  // 앨범 원본 삭제(기능 2): 앱 내에서 고른 사진의 자산 id(picker·"방금 캡처한 사진"). 전체 접근이 아니면
  // picker 결과가 null 일 수 있어 그 경우 삭제 옵션 비노출. 공유 시트(params.imageUri)는 원본 참조가
  // 없어 이 값을 세우지 않아 자연히 제외된다.
  const [pickedAssetId, setPickedAssetId] = useState<string | null>(null);
  // "방금 캡처한 사진" 제안(기능 1): 최근 사진 로드 중 표시 / 실패 시 숨김.
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentHidden, setRecentHidden] = useState(false);

  // 자동채움과 공존시키기 위해 "사용자 편집분"만 상태로 둔다. null = 아직 손대지 않음.
  const [productNameEdit, setProductNameEdit] = useState<string | null>(null);
  const [brandEdit, setBrandEdit] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState<string | null>(null);
  const [sourceLink, setSourceLink] = useState(params.sourceLink ?? '');
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]); // 기존 태그(선택 칩용)

  const [categories, setCategories] = useState<Category[]>([]);
  // 카테고리도 자동채움처럼 "파생"으로 다룬다(FR-8 추천 미리선택).
  // undefined = 사용자가 아직 안 고름(추천을 따름), null = 사용자가 미분류 선택, id = 특정 카테고리.
  const [categoryIdEdit, setCategoryIdEdit] = useState<string | null | undefined>(undefined);
  const [folderSheet, setFolderSheet] = useState(false);

  const [saving, setSaving] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false); // 원본 확대 보기(롱프레스)

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
    listAllTags()
      .then(setAllTags)
      .catch(() => {
        /* 기존 태그 로드 실패는 태그 선택 칩만 비운다 */
      });
  }, []);

  // 분석(OCR → LLM 정제) 상태머신. 이미지가 들어오면 즉시 시작한다.
  const { analyze, reparse, submitRegion, cancelRegion, reopenRegion, state: analysisState, needsConfirmation, markSubmitted } =
    useAnalysis();
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
        Alert.alert(PRIVACY_NOTICE.title, PRIVACY_NOTICE.body, [{ text: '확인' }]);
      } catch {
        /* 고지 실패는 저장 흐름을 막지 않는다 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageUri]);

  // 제품 영역 지정 최초 고지: 텍스트를 못 찾아 시트가 처음 열릴 때만 1회. 선택 영역만 전송됨을 설명.
  useEffect(() => {
    if (analysisState.phase !== 'regionSelect') return;
    let cancelled = false;
    (async () => {
      try {
        if (await AsyncStorage.getItem(REGION_NOTICE_KEY)) return;
        await AsyncStorage.setItem(REGION_NOTICE_KEY, '1');
        if (cancelled) return;
        Alert.alert(
          '제품 영역 지정',
          '텍스트를 찾지 못했습니다. 제품이 잘 보이는 부분을 사각형으로 선택하면, 그 영역만 AI 분석에 전송됩니다. 이 영역은 분석에만 쓰이며, 사진은 원본 그대로 저장됩니다.',
          [{ text: '확인' }],
        );
      } catch {
        /* 고지 실패는 흐름을 막지 않는다 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisState.phase]);

  // E-3(제품명 미인식): 정제는 됐으나 제품명이 없고 사용자가 아직 입력 안 했으면 입력란에 포커스.
  useEffect(() => {
    if (analysisState.phase === 'filled' && !analysisState.result?.productName && productNameEdit === null) {
      productNameRef.current?.focus();
    }
  }, [analysisState, productNameEdit]);

  // 자동채움은 "복사"가 아니라 "파생"으로 처리한다(effect·setState 불필요).
  const aiResult = analysisState.phase === 'filled' ? analysisState.result : null;
  const productName = productNameEdit ?? aiResult?.productName ?? '';
  const brand = brandEdit ?? aiResult?.brand ?? '';
  const price = priceEdit ?? (aiResult?.price != null ? String(aiResult.price) : '');
  const aiFilled = {
    productName: productNameEdit === null && !!aiResult?.productName,
    brand: brandEdit === null && !!aiResult?.brand,
    price: priceEdit === null && aiResult?.price != null,
  };

  // FR-8: AI가 추천한 카테고리(목록 내 이름)를 id 로 환산. 사용자가 아직 안 골랐으면 추천을 미리선택한다.
  const suggestedCategoryId = aiResult?.suggestedCategory
    ? (categories.find((c) => c.name === aiResult.suggestedCategory)?.id ?? null)
    : null;
  const categoryId = categoryIdEdit !== undefined ? categoryIdEdit : suggestedCategoryId; // null = 미분류
  const categoryIsSuggested = categoryIdEdit === undefined && suggestedCategoryId != null;
  const folderName = categoryId ? (categories.find((c) => c.id === categoryId)?.name ?? '미분류') : '미분류';

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
    // 이미지 폴백으로 채워진 경우 parsed 에 source:'image_region' 을 남긴다(분석 경로 추적).
    const parsed =
      analysisState.result != null
        ? { ...analysisState.result, ...(analysisState.via === 'image_region' ? { source: 'image_region' } : {}) }
        : null;
    void createAnalysisLog({
      rawText: analysisState.rawText,
      parsed: (parsed as unknown as Json) ?? null,
      status,
      itemId,
    });
  }

  // 재시도: 이미지 분석 실패면 시트 재열기, 정제 실패(E-2, OCR 원문 있음)면 정제만 다시, 그 외(E-1)엔 처음부터.
  function retryAnalysis() {
    if (analysisState.errorKind === 'image_parse_failed') {
      reopenRegion();
    } else if (analysisState.errorKind === 'parse_failed' && analysisState.rawText) {
      reparse(analysisState.rawText);
    } else if (imageUri) {
      analyze(imageUri);
    }
  }

  const canSave = Boolean(imageUri) && productName.trim().length > 0 && !saving;
  const analysisStatus = imageUri ? analysisStatusInfo(analysisState, needsConfirmation) : null;

  async function pickImage() {
    // PHPicker 는 권한이 없어도 열린다 — 사전 권한 요청을 하지 않아 불필요한 권한창을 없앤다.
    // (앨범 삭제·최근사진 읽기 권한은 각 기능에서 필요 시점에 별도 요청한다.)
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 1, exif: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    logImageDiag('pickImage', asset.uri, { fileSize: asset.fileSize, mimeType: asset.mimeType });
    setImageUri(asset.uri);
    if (asset.mimeType) setContentType(asset.mimeType);
    // assetId 는 전체 접근이 아니면 null 일 수 있다(문서: limited 권한 시 null). null 이면 삭제 옵션을 감춘다.
    setPickedAssetId(asset.assetId ?? null);
  }

  // "방금 캡처한 사진 담기"(기능 1): 탭할 때만 최근 사진 읽기 권한을 요청한다(HIG 적시 요청).
  // 권한 거부·제한이거나 사진이 없으면 제안을 감추고 일반 "사진 선택"만 남긴다.
  async function useRecentPhoto() {
    if (recentLoading) return;
    setRecentLoading(true);
    try {
      const recent = await getRecentPhotoAsset();
      if (!recent) {
        setRecentHidden(true);
        Alert.alert('최근 사진 없음', "최근 사진을 불러오지 못했습니다. '사진 선택'으로 담거나, 설정에서 사진 접근을 허용하세요.");
        return;
      }
      logImageDiag('recentPhoto', recent.uri);
      setContentType(guessContentType(recent.uri));
      // "방금 캡처한 사진"도 원본 assetId 가 있으므로 저장 후 앨범 삭제 대상에 포함한다(기능 2 취지에 부합).
      setPickedAssetId(recent.assetId);
      setImageUri(recent.uri); // 설정되면 기존 OCR/AI 파이프라인이 자동으로 돈다.
    } finally {
      setRecentLoading(false);
    }
  }

  // 폴더 시트의 인라인 생성 — 만든 폴더를 목록에 추가하고 반환한다(시트가 선택·닫기 처리).
  async function createCategoryInline(name: string): Promise<Category> {
    const created = await createCategory(name);
    setCategories((prev) => [...prev, created]);
    return created;
  }

  async function openDuplicate(existing: Item) {
    const url = await getItemImageSignedUrl(existing.image_key).catch(() => null);
    setDupItem(existing);
    setDupThumb(url);
    setDupVisible(true);
  }

  // 저장 성공 직후 원본 스크린샷 앨범 삭제를 제안한다(기능 2). picker 로 고른 사진(assetId 있음)만.
  // 공유 시트·최근사진 경로는 pickedAssetId 가 null 이라 자연히 제외된다. 이미 저장된 뒤라 삭제는 선택.
  async function offerAlbumDelete() {
    if (!pickedAssetId) return;
    // 제한/거부한 사용자에겐 제안 자체를 건너뛴다(무프롬프트 판별). 매 저장마다 헛제안 방지.
    if (!(await canOfferAlbumDelete())) return;
    const wantsDelete = await new Promise<boolean>((resolve) => {
      Alert.alert(
        '앨범에서 삭제',
        '이 스크린샷을 아이폰 앨범에서도 삭제할까요?',
        [
          { text: '유지', style: 'cancel', onPress: () => resolve(false) },
          { text: '삭제', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!wantsDelete) return;
    const result = await deletePhotoAsset(pickedAssetId);
    if (result === 'denied') {
      Alert.alert('앨범 삭제 불가', "앨범 삭제는 '모든 사진' 접근이 필요합니다. 설정 > 위시샷 > 사진에서 허용하세요.");
    }
    // 'deleted' 는 OS 확인창으로 충분(별도 안내 없음), 'error'(취소 포함)는 위시가 이미 저장돼 조용히 넘긴다.
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
      if (e instanceof ImageNotReadyError) {
        Alert.alert('사진 준비 중', e.message);
        return;
      }
      Alert.alert('오류', e instanceof Error ? e.message : '저장하지 못했습니다.');
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
        tags: tags.length ? tags : null,
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
    await offerAlbumDelete(); // 원본 앨범 삭제 제안(모달) → 결정 후 이동
    goToSavedCategory();
  }

  // 저장한 카테고리 화면으로 이동(미분류면 미분류 목록).
  function goToSavedCategory() {
    const targetId = categoryId ?? 'uncategorized';
    const targetName = categoryId ? (categories.find((c) => c.id === categoryId)?.name ?? '카테고리') : '미분류';
    router.replace({ pathname: '/category/[id]', params: { id: targetId, name: targetName } });
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
        tags: tags.length ? tags : null,
      });
      recordAnalysisLog(existing.id);
      markSubmitted();
      setDupVisible(false);
      setOverwriteBusy(false);
      await offerAlbumDelete(); // 원본 앨범 삭제 제안(모달) → 결정 후 이동
      goToSavedCategory();
    } catch (e) {
      setOverwriteBusy(false);
      if (e instanceof ImageNotReadyError) {
        Alert.alert('사진 준비 중', e.message);
        return;
      }
      Alert.alert('오류', e instanceof Error ? e.message : '덮어쓰지 못했습니다.');
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="취소">
          <Text style={styles.cancel}>취소</Text>
        </TouchableOpacity>
        <Text style={styles.title}>위시 담기</Text>
        <TouchableOpacity onPress={handleSave} disabled={!canSave} hitSlop={8} accessibilityRole="button" accessibilityLabel="저장">
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}>저장</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
          {/* 이미지 미리보기 / 선택 (중앙 정사각) */}
          <TouchableOpacity
            ref={setImageBoxRef}
            style={styles.imageBox}
            onPress={pickImage}
            onLongPress={() => imageUri && setZoomVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="사진 선택"
            accessibilityHint={imageUri ? '길게 누르면 원본을 확대해 봅니다' : undefined}
          >
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <SymbolView name="photo" size={32} tintColor={colors.silverDark} />
                <Text style={styles.imageHint}>사진 선택</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* "방금 캡처한 사진 담기"(기능 1): 이미지가 없을 때만. 탭 시점에만 사진 접근을 요청한다. */}
          {!imageUri && !recentHidden ? (
            <TouchableOpacity
              ref={setRecentRef}
              onPress={useRecentPhoto}
              disabled={recentLoading}
              style={styles.recentBtn}
              accessibilityRole="button"
              accessibilityLabel="방금 캡처한 사진 담기"
            >
              {recentLoading ? (
                <ActivityIndicator size="small" color={colors.primary} style={styles.statusSpinner} />
              ) : (
                <SymbolView name="clock.arrow.circlepath" size={15} tintColor={colors.primary} />
              )}
              <Text style={styles.recentBtnText}>방금 캡처한 사진 담기</Text>
            </TouchableOpacity>
          ) : null}

          {/* 제품 영역으로 분석: OCR 성공/실패와 무관하게 언제든 영역을 골라 AI 분석(제품 여럿·오채움 대비). */}
          {imageUri ? (
            <TouchableOpacity
              onPress={reopenRegion}
              style={styles.regionBtn}
              accessibilityRole="button"
              accessibilityLabel="제품 영역으로 분석"
            >
              <SymbolView name="crop" size={15} tintColor={colors.primary} />
              <Text style={styles.regionBtnText}>제품 영역으로 분석</Text>
            </TouchableOpacity>
          ) : null}

          {/* 분석 상태 인디케이터 (인라인) */}
          {analysisStatus ? (
            <View style={styles.status} accessibilityLiveRegion="polite">
              {/* 로딩: 스피너+문구를 한 그룹으로 가운데 정렬(스피너는 문구 바로 옆). */}
              {analysisStatus.loading ? (
                <ActivityIndicator size="small" color={colors.textSub} style={styles.statusSpinner} />
              ) : null}
              <Text style={[styles.statusText, { color: analysisStatus.color }]}>{analysisStatus.text}</Text>
            </View>
          ) : null}

          {/* 실패(E-1/E-2) 상세 */}
          {analysisState.phase === 'error' ? (
            <View style={styles.errorBox}>
              {analysisState.errorKind === 'parse_failed' && analysisState.rawText ? (
                <>
                  <Text style={styles.errorHint}>제품명인 줄을 탭하면 제품명 칸에 들어갑니다.</Text>
                  <ScrollView style={styles.errorRawBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {analysisState.rawText.split('\n').map((line, i) => {
                      const t = line.trim();
                      if (!t) return null;
                      const picked = t === productName.trim() && productName.trim().length > 0;
                      return (
                        <TouchableOpacity
                          key={`${i}-${t}`}
                          onPress={() => setProductNameEdit(t)}
                          style={[styles.errorRawLine, picked && styles.errorRawLinePicked]}
                          accessibilityRole="button"
                          accessibilityLabel={`제품명에 넣기: ${t}`}
                        >
                          <Text style={styles.errorRawText} selectable>
                            {t}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}
              <TouchableOpacity onPress={retryAnalysis} style={styles.retryBtn} accessibilityRole="button" accessibilityLabel="다시 시도">
                <Text style={styles.retryBtnText}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 그룹 카드 1: 제품명·브랜드·가격·링크 */}
          <FormCard>
            <FormRow label="제품명" required ai={aiFilled.productName}>
              <TextInput
                ref={productNameRef}
                style={formInput.rowInput}
                placeholder="예: 무선 이어폰"
                placeholderTextColor={colors.textDisabled}
                value={productName}
                onChangeText={setProductNameEdit}
              />
            </FormRow>
            <FormRow label="브랜드" ai={aiFilled.brand}>
              <TextInput
                style={formInput.rowInput}
                placeholder="예: 소니"
                placeholderTextColor={colors.textDisabled}
                value={brand}
                onChangeText={setBrandEdit}
              />
            </FormRow>
            <FormRow label="가격" ai={aiFilled.price}>
              <TextInput
                style={formInput.rowInput}
                placeholder="₩ 0"
                placeholderTextColor={colors.textDisabled}
                keyboardType="number-pad"
                value={price}
                onChangeText={setPriceEdit}
              />
            </FormRow>
            <FormRow label="링크">
              <TextInput
                style={formInput.rowInput}
                placeholder="https://"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={sourceLink}
                onChangeText={setSourceLink}
              />
            </FormRow>
          </FormCard>

          {/* 추천 문구는 항상 렌더하고 추천이 없을 땐 투명 처리 — 폴더 섹션 위치를 고정(점프 방지). */}
          <Text
            style={[styles.suggestHint, !categoryIsSuggested && styles.suggestHintHidden]}
            accessible={categoryIsSuggested}
            accessibilityLabel="AI가 추천한 카테고리"
          >
            AI가 추천한 카테고리입니다. 바꾸려면 눌러 선택하세요.
          </Text>

          {/* 그룹 카드 2: 폴더·메모 */}
          <FormCard>
            <DisclosureRow label="카테고리" value={folderName} onPress={() => setFolderSheet(true)} />
            <FormBlock label="메모">
              <TextInput
                style={formInput.memo}
                placeholder="메모"
                placeholderTextColor={colors.textDisabled}
                multiline
                value={memo}
                onChangeText={setMemo}
              />
            </FormBlock>
          </FormCard>

          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

          {!imageUri ? (
            <Text style={styles.saveNote}>사진을 선택하세요.</Text>
          ) : productName.trim().length === 0 ? (
            <Text style={styles.saveNote}>제품명을 입력하세요.</Text>
          ) : null}
      </ScrollView>

      <FolderPickerSheet
        visible={folderSheet}
        onClose={() => setFolderSheet(false)}
        categories={categories}
        selectedId={categoryId}
        onSelect={setCategoryIdEdit}
        onCreateCategory={createCategoryInline}
      />

      <OverwriteDialog
        visible={dupVisible}
        item={dupItem}
        thumbnailUrl={dupThumb}
        busy={overwriteBusy}
        onOverwrite={handleOverwrite}
        onView={handleViewExisting}
        onCancel={() => setDupVisible(false)}
      />

      {/* 원본 확대 보기(롱프레스) — 텍스트를 직접 읽고 입력할 때 */}
      <ImageZoomModal visible={zoomVisible} uri={imageUri} onClose={() => setZoomVisible(false)} />

      {/* 제품 영역 지정(Phase 6): OCR 텍스트 부족 시 열림. 선택 영역만 크롭해 전송. */}
      <RegionSelectSheet
        visible={analysisState.phase === 'regionSelect' || analysisState.phase === 'imageParsing'}
        imageUri={imageUri}
        busy={analysisState.phase === 'imageParsing'}
        onSubmit={(image) => submitRegion(image, analysisState.rawText ?? '')}
        onCancel={() => cancelRegion(analysisState.rawText ?? '')}
      />
    </SafeAreaView>
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
    paddingTop: spacing.three,
    paddingBottom: spacing.two,
  },
  cancel: { fontSize: 16, color: colors.primary },
  title: { ...type.headline, color: colors.textMain },
  saveBtn: { fontSize: 16, fontWeight: '700', color: colors.primary },
  saveBtnDisabled: { color: colors.textDisabled },
  content: { padding: spacing.three, gap: spacing.three, paddingBottom: spacing.six },
  imageBox: {
    alignSelf: 'center',
    width: '52%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.one },
  imageHint: { fontSize: 13, color: colors.textSub },
  regionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.one,
    alignSelf: 'center',
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  regionBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  recentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.one,
    alignSelf: 'center',
    paddingVertical: spacing.one,
    paddingHorizontal: spacing.three,
  },
  recentBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  changeImage: { fontSize: 14, color: colors.primary, textAlign: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.two,
    paddingVertical: spacing.one,
  },
  // 좁은 공간에 맞춰 스피너를 살짝 축소(약 -2px).
  statusSpinner: { transform: [{ scale: 0.9 }] },
  statusText: { fontSize: 13, fontWeight: '500' },
  errorBox: {
    gap: spacing.two,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.three,
  },
  errorHint: { fontSize: 12, color: colors.textSub },
  errorRawBox: { maxHeight: 140, borderRadius: 8, backgroundColor: colors.bgCard, padding: spacing.two },
  errorRawLine: { paddingVertical: spacing.one, paddingHorizontal: spacing.two, borderRadius: 6 },
  errorRawLinePicked: { backgroundColor: colors.silver },
  errorRawText: { fontSize: 13, color: colors.textMain },
  retryBtn: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.two,
    paddingHorizontal: spacing.three,
  },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  saveNote: { fontSize: 12, color: colors.textSub, textAlign: 'center' },
  // 폴더/메모 카드 위 FR-8 추천 안내 문구. 위 간격 축소(marginTop) + 폴더 섹션을 위로 당김(marginBottom).
  suggestHint: { fontSize: 13, color: colors.textSub, marginTop: 5, marginBottom: -4, paddingHorizontal: spacing.one },
  suggestHintHidden: { opacity: 0 },
});
