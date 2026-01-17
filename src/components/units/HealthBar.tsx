interface HealthBarProps {
  value: number;
}

export function HealthBar({ value }: HealthBarProps) {
  const getColorClass = () => {
    if (value >= 66) return "progress-bar__fill--health";
    if (value >= 33) return "progress-bar__fill--health-mid";
    return "progress-bar__fill--health-low";
  };

  return (
    <div>
      <div className="progress-bar__label">
        <span>Progress</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-bar__fill ${getColorClass()}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
