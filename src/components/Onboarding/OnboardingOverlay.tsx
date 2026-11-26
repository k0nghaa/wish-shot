import { useState } from 'react';

import { OnboardingCards } from './OnboardingCards';
import { OnboardingGuide } from './OnboardingGuide';

type Props = { onDone: () => void };

/**
 * 카드 → 사용 안내를 이어서 보이는 묶음(옛 단일 오버레이와 같은 동작).
 * 온보딩 순서가 카드 → 로그인 → 사용 안내로 바뀌므로, 루트(_layout)는 이것 대신 OnboardingCards 와
 * OnboardingGuide 를 따로 띄운다 — 이 묶음은 루트가 바뀔 때까지 기존 호출이 깨지지 않게 남겨 둔 것이다.
 */
export function OnboardingOverlay({ onDone }: Props) {
  const [stage, setStage] = useState<'cards' | 'guide'>('cards');
  return stage === 'cards' ? (
    <OnboardingCards onDone={(result) => (result === 'skipped' ? onDone() : setStage('guide'))} />
  ) : (
    <OnboardingGuide onDone={onDone} />
  );
}
