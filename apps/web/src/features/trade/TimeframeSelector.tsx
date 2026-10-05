'use client';

import { type AssetDto, DURATIONS, type DurationSec } from '@updown/contracts';
import { DURATION_LABEL } from '@/shared/lib/format';
import { useTrade } from '@/shared/state/trade';
import { Segmented } from '@/shared/ui/Segmented';

export function TimeframeSelector({ asset }: { asset: AssetDto }) {
  const duration = useTrade((s) => s.duration);
  const setDuration = useTrade((s) => s.setDuration);
  return (
    <Segmented<DurationSec>
      label="Интервал прогноза"
      value={duration}
      onChange={setDuration}
      options={DURATIONS.map((d) => ({ value: d, label: DURATION_LABEL[d], disabled: !asset.durations.includes(d) }))}
    />
  );
}
