import { ResolutionStatus } from '@/types';

interface Props {
  status: ResolutionStatus;
}

export function StatusBadge({ status }: Props) {
  const getStyle = () => {
    switch (status) {
      case 'RESOLVED': return { border: '1px solid var(--color-selection)', color: 'var(--color-selection)' };
      case 'CANDIDATE': return { border: '1px dashed var(--color-uncertainty)', color: 'var(--color-uncertainty)' };
      case 'UNRESOLVED': return { border: '1px dotted red', color: 'red' };
      default: return {};
    }
  };

  return (
    <span style={{ padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '0.8em', ...getStyle() }}>
      {status}
    </span>
  );
}
