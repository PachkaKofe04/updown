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
      className="asset-glyph"
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      {GLYPHS[assetId] ?? assetId.slice(0, 1)}
    </span>
  );
}
