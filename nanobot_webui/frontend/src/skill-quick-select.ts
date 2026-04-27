export type SkillCandidate = {
  name: string;
  description: string;
  enabled: boolean;
};

const SLASH_PATTERN = /^\/([^\s]*)/;
const INVOCATION_PATTERN = /^\$([^\s]+)/;

function leadingSlashToken(draft: string): string | null {
  const match = draft.match(SLASH_PATTERN);
  if (!match) {
    return null;
  }
  return match[1] ?? '';
}

export function shouldShowSkillPicker(draft: string): boolean {
  return leadingSlashToken(draft) !== null;
}

export function filterSkillSuggestions(skills: SkillCandidate[], draft: string): SkillCandidate[] {
  const query = leadingSlashToken(draft);
  if (query == null) {
    return [];
  }

  const normalized = query.trim().toLowerCase();
  return skills
    .filter((skill) => skill.enabled)
    .filter((skill) => {
      if (!normalized) {
        return true;
      }
      return skill.name.toLowerCase().includes(normalized);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function applySkillSelection(draft: string, skillName: string): string {
  const trimmedSkill = skillName.trim();
  if (!trimmedSkill) {
    return draft;
  }

  const match = draft.match(SLASH_PATTERN);
  if (!match || match.index !== 0) {
    return `$${trimmedSkill} ${draft}`;
  }

  const replacement = `$${trimmedSkill}`;
  const rest = draft.slice(match[0].length);
  return rest.startsWith(' ') ? `${replacement}${rest}` : `${replacement} ${rest}`;
}

export function activeSkillFromDraft(draft: string, skills: SkillCandidate[]): SkillCandidate | null {
  const match = draft.match(INVOCATION_PATTERN);
  if (!match?.[1]) {
    return null;
  }
  const token = match[1].toLowerCase();
  return skills.find((skill) => skill.name.toLowerCase() === token) ?? null;
}

export function draftTailAfterSlashSelection(draft: string): string {
  const match = draft.match(SLASH_PATTERN);
  if (!match || match.index !== 0) {
    return draft;
  }
  return draft.slice(match[0].length).trimStart();
}
