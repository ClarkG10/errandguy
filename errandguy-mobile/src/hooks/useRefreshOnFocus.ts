import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

export function useRefreshOnFocus(refetch: () => void) {
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );
}
