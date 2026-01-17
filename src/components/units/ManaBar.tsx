interface ManaBarProps {
  current: number;
  max: number;
}

export function ManaBar({ current, max }: ManaBarProps) {
  const percentage = Math.min((current / max) * 100, 100);

  const formatTokens = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div>
      <div className="progress-bar__label">
        <span>Tokens</span>
        <span>
          {formatTokens(current)} / {formatTokens(max)}
        </span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-bar__fill progress-bar__fill--mana"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
