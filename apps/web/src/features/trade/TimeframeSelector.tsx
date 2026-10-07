'use client';

import { type AssetDto, DURATIONS, type DurationSec } from '@updown/contracts';
import { track } from '@/shared/lib/analytics';
import { DURATION_LABEL, DURATION_LONG } from '@/shared/lib/format';
import { useTrade } from '@/shared/state/trade';
import { Segmented } from '@/shared/ui/Segmented';

export function TimeframeSelector({ asset }: { asset: AssetDto }) {
  const duration = useTrade((s) => s.duration);
  const setDuration = useTrade((s) => s.setDuration);
  return (
    <div>
      <div className="field-caption"><span>Интервал прогноза</span><span>{DURATION_LONG[duration]}</span></div>
      <Segmented<DurationSec>
        label="Интервал прогноза"
        value={duration}
        onChange={(d) => {
          setDuration(d);
          track('duration_selected', { duration: d });
        }}
        options={DURATIONS.map((d) => ({ value: d, label: DURATION_LABEL[d], disabled: !asset.durations.includes(d) }))}
      />
    </div>
  );
}
