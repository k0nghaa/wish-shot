import { supabase } from '@/lib/supabase';
import type { Json, Tables } from '@/types/database';

import { getCurrentUserId } from './auth';

export type AnalysisLog = Tables<'analysis_logs'>;

/**
 * 분석 로그 상태(개발자용). 4종:
 * - ocr_empty      : OCR 인식 결과 없음 (E-1)
 * - parsed         : 정제 성공
 * - parse_failed   : LLM 정제 실패/타임아웃 (E-2)
 * - low_confidence : 정제는 됐으나 신뢰도가 낮음 (FR-7a)
 */
export type AnalysisStatus = 'ocr_empty' | 'parsed' | 'parse_failed' | 'low_confidence';

export interface NewAnalysisLog {
  rawText: string | null;
  parsed?: Json | null;
  status: AnalysisStatus;
  failReason?: string | null;
  itemId?: string | null;
}

/**
 * 분석 로그 1건 기록. **로그 기록은 저장을 막지 않는다** — insert 실패는 삼키고 null 을 돌려줘
 * 사용자 흐름에 영향이 없게 한다. `user_id` 는 편의로 채우되 RLS 가 강제한다.
 * 성공 시 생성된 로그 id 를 반환한다(저장 후 item_id 연결용).
 */
export async function createAnalysisLog(input: NewAnalysisLog): Promise<string | null> {
  try {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('analysis_logs')
      .insert({
        user_id: userId,
        raw_text: input.rawText,
        parsed: input.parsed ?? null,
        status: input.status,
        fail_reason: input.failReason ?? null,
        item_id: input.itemId ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  } catch (e) {
    console.warn('[analysisLogs] 로그 기록 실패(무시):', e);
    return null;
  }
}

/**
 * 저장 성공 후 로그에 item_id 를 연결한다(Step 4). 실패는 삼킨다.
 * 저장 전 이탈이면 이 호출이 없어 item_id 는 null 로 남는다.
 */
export async function linkAnalysisLogToItem(logId: string, itemId: string): Promise<void> {
  try {
    const { error } = await supabase.from('analysis_logs').update({ item_id: itemId }).eq('id', logId);
    if (error) throw error;
  } catch (e) {
    console.warn('[analysisLogs] item_id 연결 실패(무시):', e);
  }
}
