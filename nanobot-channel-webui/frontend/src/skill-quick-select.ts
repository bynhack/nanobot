export type SkillCandidate = {
  name: string;
  description: string;
  enabled: boolean;
};

export type SkillRunConfig = {
  readonly custom?: Record<string, unknown>;
};

const SLASH_PATTERN = /^\/([^\s]*)/;
const INVOCATION_PATTERN = /^\$([^\s]+)/;
const SELECTED_SKILL_RUN_CONFIG_KEY = 'nanobotSelectedSkill';

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
    return draft;
  }

  return draftTailAfterSlashSelection(draft);
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

export function runConfigWithSelectedSkill(
  runConfig: SkillRunConfig | undefined,
  skillName: string,
): SkillRunConfig {
  const trimmedSkill = skillName.trim();
  if (!trimmedSkill) {
    return runConfig ?? {};
  }

  return {
    ...runConfig,
    custom: {
      ...(runConfig?.custom ?? {}),
      [SELECTED_SKILL_RUN_CONFIG_KEY]: trimmedSkill,
    },
  };
}

export function runConfigWithoutSelectedSkill(
  runConfig: SkillRunConfig | undefined,
): SkillRunConfig {
  const { [SELECTED_SKILL_RUN_CONFIG_KEY]: _removed, ...custom } = runConfig?.custom ?? {};
  return {
    ...runConfig,
    custom,
  };
}

export function selectedSkillNameFromRunConfig(
  runConfig: SkillRunConfig | undefined,
): string | null {
  const selected = runConfig?.custom?.[SELECTED_SKILL_RUN_CONFIG_KEY];
  return typeof selected === 'string' && selected.trim() ? selected.trim() : null;
}

export function selectedSkillFromRunConfig(
  runConfig: SkillRunConfig | undefined,
  skills: SkillCandidate[],
): SkillCandidate | null {
  const selected = selectedSkillNameFromRunConfig(runConfig);
  if (!selected) {
    return null;
  }

  return skills.find((skill) => skill.name.toLowerCase() === selected.toLowerCase()) ?? null;
}

export function messageContentWithSelectedSkill(
  content: string,
  runConfig: SkillRunConfig | undefined,
): string {
  const selected = selectedSkillNameFromRunConfig(runConfig);
  if (!selected) {
    return content;
  }

  const trimmedContent = content.trim();
  const legacyPrefix = `$${selected}`;
  const displayPrefix = `使用 ${selected} 技能`;
  const normalizedLower = trimmedContent.toLowerCase();
  if (!trimmedContent) {
    return displayPrefix;
  }
  if (normalizedLower.startsWith(`${displayPrefix.toLowerCase()} `)) {
    return trimmedContent;
  }
  if (normalizedLower === displayPrefix.toLowerCase()) {
    return trimmedContent;
  }
  if (normalizedLower.startsWith(`${legacyPrefix.toLowerCase()} `)) {
    return `${displayPrefix} ${trimmedContent.slice(legacyPrefix.length).trimStart()}`;
  }
  if (normalizedLower === legacyPrefix.toLowerCase()) {
    return displayPrefix;
  }
  return `${displayPrefix} ${trimmedContent}`;
}
