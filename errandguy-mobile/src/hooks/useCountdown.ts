import { useState, useEffect, useCallback, useRef } from 'react';

export function useCountdown(initialSeconds: number, autoStart = false) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(autoStart);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(
    (newSeconds?: number) => {
      setSeconds(newSeconds ?? initialSeconds);
      setIsRunning(false);
    },
    [initialSeconds],
  );

  useEffect(() => {
    if (isRunning && seconds > 0) {
      intervalRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, seconds]);

  return {
    seconds,
    isRunning,
    isExpired: seconds === 0,
    start,
    stop,
    reset,
    formatted: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  };
}
