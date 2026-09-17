import { useCallback, useReducer, useRef } from 'react';

import { ensureFileReady, ImageNotReadyError } from '@/lib/imageBytes';
import { ocrEngine } from '@/lib/ocr';
import { parseScreenshotText, type ParseImage, type ParseResult } from '@/lib/queries';

/** "확인이 필요해요"(FR-7a) 를 띄우는 신뢰도 임계값(잠정). */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * 이미지 폴백 트리거 임계값(Phase 6): OCR 원문이 이보다 짧으면 텍스트 정제를 건너뛰고
 * "제품 영역 지정" 시트로 유도한다(텍스트가 거의 없는 제품 사진). 실기기 샘플로 조정 가능.
 */
export const OCR_MIN_CHARS = 20;

/**
 * 분석 상태 전이(결정 문서 4.3 + Phase 6 이미지 폴백):
 *   idle → imageReceived → ocrRunning → (parsing | regionSelect → imageParsing) → filled → submitted
 * 실패 시 어느 지점에서든 → error (→ 화면은 수동 입력 폴백).
 */
export type AnalysisPhase =
  | 'idle'
  | 'imageReceived'
  | 'ocrRunning'
  | 'parsing'
  | 'regionSelect' // OCR 텍스트 부족 → 사용자가 제품 영역을 고르는 중(시트)
  | 'imageParsing' // 선택 영역 크롭을 Edge Function 으로 보내 정제 중
  | 'filled'
  | 'submitted'
  | 'error';

/**
 * 실패 종류: OCR 결과 없음(E-1) / 정제 실패(E-2) / 사진 미준비(iCloud 미다운로드) / 이미지 분석 실패.
 * image_not_ready·image_parse_failed 는 막다른 상태가 아니라 재시도로 회복되는 상태다(수동 입력도 가능).
 */
export type AnalysisErrorKind = 'ocr_empty' | 'parse_failed' | 'image_not_ready' | 'image_parse_failed';

export interface AnalysisState {
  phase: AnalysisPhase;
  rawText: string | null; // OCR 원문(E-2 표시·로그 기록용)
  result: ParseResult | null; // 정제 결과(filled 일 때)
  errorKind: AnalysisErrorKind | null;
  via: 'text' | 'image_region' | null; // filled 가 어느 경로로 채워졌는지(로그 source 기록용)
}

type Action =
  | { type: 'reset' }
  | { type: 'imageReceived' }
  | { type: 'ocrRunning' }
  | { type: 'ocrDone'; rawText: string }
  | { type: 'parsing' }
  | { type: 'regionSelect' }
  | { type: 'imageParsing' }
  | { type: 'filled'; result: ParseResult; via: 'text' | 'image_region' }
  | { type: 'error'; kind: AnalysisErrorKind; rawText: string | null }
  | { type: 'reparse' }
  | { type: 'submitted' };

const initialState: AnalysisState = {
  phase: 'idle',
  rawText: null,
  result: null,
  errorKind: null,
  via: null,
};

// 불가능한 상태 조합을 리듀서에서 차단한다. 유효하지 않은 전이는 상태를 그대로 둔다.
function reducer(state: AnalysisState, action: Action): AnalysisState {
  switch (action.type) {
    case 'reset':
      return initialState;
    case 'imageReceived':
      // 새 이미지가 들어오면 언제든 처음부터 시작.
      return { ...initialState, phase: 'imageReceived' };
    case 'ocrRunning':
      return state.phase === 'imageReceived' ? { ...state, phase: 'ocrRunning' } : state;
    case 'ocrDone':
      return state.phase === 'ocrRunning' ? { ...state, rawText: action.rawText } : state;
    case 'parsing':
      return state.phase === 'ocrRunning' ? { ...state, phase: 'parsing' } : state;
    case 'regionSelect':
      // OCR 후(텍스트 부족) 또는 이미지 분석 실패 후 재시도 시 시트를 (다시) 연다.
      return state.phase === 'ocrRunning' || state.phase === 'error'
        ? { ...state, phase: 'regionSelect', errorKind: null }
        : state;
    case 'imageParsing':
      return state.phase === 'regionSelect' ? { ...state, phase: 'imageParsing' } : state;
    case 'filled':
      return state.phase === 'parsing' || state.phase === 'imageParsing'
        ? { ...state, phase: 'filled', result: action.result, errorKind: null, via: action.via }
        : state;
    case 'error':
      // 진행 중(ocrRunning/parsing/regionSelect/imageParsing 등)에만 error 로. idle/submitted 에선 무시.
      if (state.phase === 'idle' || state.phase === 'submitted') return state;
      return { ...state, phase: 'error', errorKind: action.kind, rawText: action.rawText };
    case 'reparse':
      // E-2 재시도: OCR 원문이 남아 있을 때만 error → parsing 으로 되돌린다.
      return state.phase === 'error' && state.rawText ? { ...state, phase: 'parsing', errorKind: null } : state;
    case 'submitted':
      return state.phase === 'filled' ? { ...state, phase: 'submitted' } : state;
    default:
      return state;
  }
}

/**
 * 이미지 → OCR → LLM 정제 흐름을 관리하는 훅.
 *
 * - `analyze(uri)`: 이미지가 들어오면 호출. OCR → (텍스트 있으면) Edge Function 정제 →
 *   filled, 없으면/실패면 error. 개발/시뮬레이터에선 MockOcrEngine 이 쓰인다(@/lib/ocr).
 * - `markSubmitted()`: 저장 성공 후 호출(Step 4).
 * - `reset()`: 초기화.
 * - `needsConfirmation`: filled 이고 신뢰도가 임계값 미만이면 true(FR-7a).
 */
export function useAnalysis() {
  const [state, dispatch] = useReducer(reducer, initialState);
  // 이미지를 연달아 바꿀 때, 이전(스테일) 분석 결과가 최신 상태를 덮어쓰지 않게 하는 토큰.
  const runRef = useRef(0);

  const analyze = useCallback(async (uri: string) => {
    const run = ++runRef.current;
    const isCurrent = () => runRef.current === run;

    dispatch({ type: 'imageReceived' });
    dispatch({ type: 'ocrRunning' });

    let rawText = '';
    try {
      // OCR·업로드가 같은 준비 게이트를 보게 한다. iCloud 미다운로드는 여기서 재시도·흡수.
      await ensureFileReady(uri);
      const ocr = await ocrEngine.recognize(uri);
      if (!isCurrent()) return;
      rawText = ocr.text?.trim() ?? '';
      dispatch({ type: 'ocrDone', rawText });

      // 텍스트가 거의 없으면(제품 단독 사진 등) 텍스트 정제를 건너뛰고 "제품 영역 지정" 시트로 유도(Phase 6).
      // 사용자가 시트를 취소하면 기존 E-1(수동 입력) 경로로 떨어진다.
      if (rawText.length < OCR_MIN_CHARS) {
        dispatch({ type: 'regionSelect' });
        return;
      }

      dispatch({ type: 'parsing' });
      const result = await parseScreenshotText(rawText);
      if (!isCurrent()) return;
      dispatch({ type: 'filled', result, via: 'text' });
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ImageNotReadyError) {
        // 사진이 아직 로컬에 없음(iCloud 최적화) → 재시도 안내. rawText 없음.
        if (__DEV__) console.warn('[WishShot/analyze] 사진 미준비', e);
        dispatch({ type: 'error', kind: 'image_not_ready', rawText: '' });
        return;
      }
      // E-2: 정제 실패/타임아웃/네트워크, 또는 OCR 모듈 실패 → 원문 유지 + 수동 입력 폴백.
      if (__DEV__) console.warn('[WishShot/analyze] 실패', { hadRawText: !!rawText }, e);
      dispatch({ type: 'error', kind: 'parse_failed', rawText });
    }
  }, []);

  // E-2 재시도: OCR 은 성공했으나 정제가 실패한 경우, OCR 을 다시 돌리지 않고 정제만 재시도한다.
  const reparse = useCallback(async (rawText: string) => {
    const run = ++runRef.current;
    const isCurrent = () => runRef.current === run;
    dispatch({ type: 'reparse' });
    try {
      const result = await parseScreenshotText(rawText);
      if (!isCurrent()) return;
      dispatch({ type: 'filled', result, via: 'text' });
    } catch {
      if (!isCurrent()) return;
      dispatch({ type: 'error', kind: 'parse_failed', rawText });
    }
  }, []);

  // 이미지 폴백: 사용자가 고른 제품 영역 크롭을 rawText 와 함께 Edge Function 으로 보내 정제한다.
  const submitRegion = useCallback(async (image: ParseImage, rawText: string) => {
    const run = ++runRef.current;
    const isCurrent = () => runRef.current === run;
    dispatch({ type: 'imageParsing' });
    try {
      const result = await parseScreenshotText(rawText, image);
      if (!isCurrent()) return;
      dispatch({ type: 'filled', result, via: 'image_region' });
    } catch {
      if (!isCurrent()) return;
      // 실패/타임아웃 → "다시 시도(시트 재열기)" 가능한 error. 수동 입력도 열려 있다.
      dispatch({ type: 'error', kind: 'image_parse_failed', rawText });
    }
  }, []);

  // 시트 취소 → 수동 입력 폴백(E-1 경로).
  const cancelRegion = useCallback((rawText: string) => dispatch({ type: 'error', kind: 'ocr_empty', rawText }), []);

  // 이미지 분석 실패 후 "다시 시도" → 시트 재열기.
  const reopenRegion = useCallback(() => dispatch({ type: 'regionSelect' }), []);

  const markSubmitted = useCallback(() => dispatch({ type: 'submitted' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const needsConfirmation =
    state.phase === 'filled' &&
    state.result != null &&
    state.result.confidence < LOW_CONFIDENCE_THRESHOLD;

  return { state, analyze, reparse, submitRegion, cancelRegion, reopenRegion, markSubmitted, reset, needsConfirmation };
}
