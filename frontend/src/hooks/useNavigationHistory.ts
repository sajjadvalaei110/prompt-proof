import { useState } from 'react';

export function useNavigationHistory() {
  const [history, setHistory] = useState<any[]>([]);
  return { history, push: (state: any) => setHistory([...history, state]) };
}
