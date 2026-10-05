// Монограмма актива: монохромно, без цветного шума (цвет в интерфейсе только с функцией).
const GLYPHS: Record<string, string> = {
  BTCUSD: '₿',
  ETHUSD: 'Ξ',
  SOLUSD: 'S',
  XRPUSD: 'X',
  DOGEUSD: 'Ð',
  EURUSD: '€',
  GBPUSD: '£',
  USDCAD: '$',
};

export function AssetGlyph({ assetId, size = 28 }: { assetId: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full border border-hairline-strong bg-surface-3 font-semibold text-text-1"
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      {GLYPHS[assetId] ?? assetId.slice(0, 1)}
    </span>
  );
}
