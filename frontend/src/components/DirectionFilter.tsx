export type DirectionFilterValue = 'all' | 1 | 2;

interface DirectionFilterProps {
  value: DirectionFilterValue;
  onChange: (value: DirectionFilterValue) => void;
}

const OPTIONS: { value: DirectionFilterValue; label: string }[] = [
  { value: 'all', label: 'Alle bussen' },
  { value: 1, label: 'Richting Amsterdam' },
  { value: 2, label: 'Richting Zandvoort' },
];

export function DirectionFilter({ value, onChange }: DirectionFilterProps) {
  return (
    <div className="direction-filter">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`direction-filter-btn ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
