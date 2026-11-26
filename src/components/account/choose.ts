import { Alert } from 'react-native';

/** iOS 확인창을 기다릴 수 있는 형태로: 누른 버튼의 value 를 돌려준다. */
export function choose<T extends string>(
  title: string,
  message: string | undefined,
  options: { label: string; value: T; style?: 'cancel' | 'destructive' }[],
): Promise<T> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      options.map((o) => ({ text: o.label, style: o.style, onPress: () => resolve(o.value) })),
    );
  });
}
