import { useCallback, useReducer, useRef } from 'react';

import { ocrEngine } from '@/lib/ocr';
import { parseScreenshotText, type ParseResult } from '@/lib/queries';

/** "확인이 필요해요"(FR-7a) 를 띄우는 신뢰도 임계값(잠정). */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * 분석 상태 전이(결정 문서 4.3):
 *   idle → imageReceived → ocrRunning → parsing → filled → submitted
 * 실패 시 어느 지점에서든 → error (→ 화면은 수동 입력 폴백).
 */
export type AnalysisPhase =
  | 'idle'
  | 'imageReceived'
  | 'ocrRunning'
  | 'parsing'
  | 'filled'
  | 'submitted'
  | 'error';

/** 실패 종류: OCR 결과 없음(E-1) / 정제 실패(E-2). */
export type AnalysisErrorKind = 'ocr_empty' | 'parse_failed';

export interface AnalysisState {
  phase: AnalysisPhase;
  rawText: string | null; // OCR 원문(E-2 표시·로그 기록용)
  result: ParseResult | null; // 정제 결과(filled 일 때)
  errorKind: AnalysisErrorKind | null;
}

type Action =
  | { type: 'reset' }
  | { type: 'imageReceived' }
  | { type: 'ocrRunning' }
  | { type: 'ocrDone'; rawText: string }
  | { type: 'parsing' }
  | { type: 'filled'; result: ParseResult }
  | { type: 'error'; kind: AnalysisErrorKind; rawText: string | null }
  | { type: 'reparse' }
  | { type: 'submitted' };

const initialState: AnalysisState = {
  phase: 'idle',
  rawText: null,
  result: null,
  errorKind: null,
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
    case 'filled':
      return state.phase === 'parsing'
        ? { ...state, phase: 'filled', result: action.result, errorKind: null }
        : state;
    case 'error':
      // 진행 중(ocrRunning/parsing 등)에만 error 로. idle/submitted 에선 무시.
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
      const ocr = await ocrEngine.recognize(uri);
      if (!isCurrent()) return;
      rawText = ocr.text?.trim() ?? '';

      if (!rawText) {
        // E-1: OCR 인식 결과 없음 → 수동 입력 폴백
        dispatch({ type: 'error', kind: 'ocr_empty', rawText: '' });
        return;
      }

      dispatch({ type: 'ocrDone', rawText });
      dispatch({ type: 'parsing' });

      const result = await parseScreenshotText(rawText);
      if (!isCurrent()) return;
      dispatch({ type: 'filled', result });
    } catch {
      if (!isCurrent()) return;
      // E-2: 정제 실패/타임아웃/네트워크 → 원문 유지 + 수동 입력 폴백
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
      dispatch({ type: 'filled', result });
    } catch {
      if (!isCurrent()) return;
      dispatch({ type: 'error', kind: 'parse_failed', rawText });
    }
  }, []);

  const markSubmitted = useCallback(() => dispatch({ type: 'submitted' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const needsConfirmation =
    state.phase === 'filled' &&
    state.result != null &&
    state.result.confidence < LOW_CONFIDENCE_THRESHOLD;

  return { state, analyze, reparse, markSubmitted, reset, needsConfirmation };
}
