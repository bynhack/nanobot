import { useEffect, useState } from 'react';

import { loadSettingsSkills } from './api';
import { bootstrap } from './app-state';
import type { AuthUser } from './types';
import type { SkillCandidate } from './skill-quick-select';

export function useAvailableSkills({
  authResolved,
  authToken,
  currentUser,
}: {
  authResolved: boolean;
  authToken: string;
  currentUser: AuthUser | null;
}) {
  const [availableSkills, setAvailableSkills] = useState<SkillCandidate[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (bootstrap.authMode === 'pocketbase' && !authResolved) {
        return;
      }
      if (bootstrap.authMode === 'pocketbase' && currentUser?.role !== 'admin') {
        setAvailableSkills([]);
        return;
      }
      try {
        const skillSummaries = await loadSettingsSkills(authToken);
        if (!active) return;
        setAvailableSkills(
          skillSummaries.map((skill) => ({
            name: skill.name,
            description: skill.description,
            enabled:
              skill.enabled ||
              (typeof skill.path === 'string' && skill.path.endsWith('/SKILL.md')),
          })),
        );
      } catch {
        if (active) {
          setAvailableSkills([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authResolved, authToken, currentUser?.role]);

  return availableSkills;
}
