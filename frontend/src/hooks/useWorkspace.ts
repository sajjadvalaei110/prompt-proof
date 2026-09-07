import { useState } from 'react';
import { Workspace } from '../types';

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  return { workspace, setWorkspace };
}
