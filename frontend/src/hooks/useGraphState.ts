import { useState } from 'react';

export function useGraphState() {
  const [level, setLevel] = useState('CLASS');
  return { level, setLevel };
}
