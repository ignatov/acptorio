interface TokenMeterProps {
  label: string;
  current: number;
  max: number;
}

export function TokenMeter({ label, current, max }: TokenMeterProps) {
  const percentage = Math.min((current / max) * 100, 100);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="resource-bar__item">
      <span className="resource-bar__label">{label}</span>
      <span className="resource-bar__value">{formatNumber(current)}</span>
      <div
        style={{
          width: 60,
          height: 6,
          background: "var(--bg-primary)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: "100%",
            background: "var(--mana-color)",
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}
