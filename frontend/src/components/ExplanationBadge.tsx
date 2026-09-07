import { ExplanationStatus } from '@/types';

interface Props {
  status: ExplanationStatus;
}

export function ExplanationBadge({ status }: Props) {
  return (
    <span style={{ fontSize: '0.8em', padding: '2px 6px', borderRadius: '4px', background: '#eee' }}>
      {status === 'READY' ? 'AI Explained' : status === 'PENDING' ? 'Pending' : 'Failed'}
    </span>
  );
}
