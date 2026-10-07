'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { RealtimeBridge } from '@/shared/state/bridge';
import { Toasts } from '@/shared/ui/Toasts';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <RealtimeBridge />
        {children}
        <Toasts />
      </MotionConfig>
    </QueryClientProvider>
  );
}
