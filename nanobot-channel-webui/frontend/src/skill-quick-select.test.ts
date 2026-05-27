import { describe, expect, it } from 'vitest';

import {
  applySkillSelection,
  draftTailAfterSlashSelection,
  filterSkillSuggestions,
  messageContentWithSelectedSkill,
  runConfigWithSelectedSkill,
  runConfigWithoutSelectedSkill,
  selectedSkillFromRunConfig,
  shouldShowSkillPicker,
  type SkillCandidate,
} from './skill-quick-select';

const skills: SkillCandidate[] = [
  { name: 'ralph', description: '持续执行直到完成', enabled: true },
  { name: 'ralplan', description: '先做一致性计划', enabled: true },
  { name: 'team', description: '多代理协作', enabled: true },
  { name: 'disabled', description: '禁用技能', enabled: false },
];

describe('skill quick select', () => {
  it('shows picker when draft starts with slash command token', () => {
    expect(shouldShowSkillPicker('/')).toBe(true);
    expect(shouldShowSkillPicker('/ra')).toBe(true);
    expect(shouldShowSkillPicker('/ra 继续做')).toBe(true);
  });

  it('hides picker when slash is not the leading token', () => {
    expect(shouldShowSkillPicker(' /ra')).toBe(false);
    expect(shouldShowSkillPicker('hello /ra')).toBe(false);
    expect(shouldShowSkillPicker('')).toBe(false);
  });

  it('filters enabled skills by slash prefix', () => {
    const candidates = filterSkillSuggestions(skills, '/ral');
    expect(candidates.map((item) => item.name)).toEqual(['ralph', 'ralplan']);
  });

  it('keeps all enabled skills when only slash is typed', () => {
    const candidates = filterSkillSuggestions(skills, '/');
    expect(candidates.map((item) => item.name)).toEqual(['ralph', 'ralplan', 'team']);
  });

  it('removes slash token after skill selection and keeps tail content', () => {
    expect(applySkillSelection('/ralp 帮我修复', 'ralph')).toBe('帮我修复');
    expect(applySkillSelection('/ra', 'ralph')).toBe('');
  });

  it('returns tail text after slash selection', () => {
    expect(draftTailAfterSlashSelection('/ralph 帮我修复')).toBe('帮我修复');
    expect(draftTailAfterSlashSelection('/ralph')).toBe('');
    expect(draftTailAfterSlashSelection('普通文本')).toBe('普通文本');
  });

  it('stores the selected skill outside of composer text', () => {
    const selected = runConfigWithSelectedSkill({}, 'ralph');

    expect(selectedSkillFromRunConfig(selected, skills)?.name).toBe('ralph');
    expect(runConfigWithoutSelectedSkill(selected)).toEqual({ custom: {} });
  });

  it('formats the selected skill only when sending', () => {
    const selected = runConfigWithSelectedSkill({}, 'ralph');

    expect(messageContentWithSelectedSkill('帮我修复', selected)).toBe('使用 ralph 技能 帮我修复');
    expect(messageContentWithSelectedSkill('$ralph 帮我修复', selected)).toBe('使用 ralph 技能 帮我修复');
    expect(messageContentWithSelectedSkill('使用 ralph 技能 帮我修复', selected)).toBe('使用 ralph 技能 帮我修复');
    expect(messageContentWithSelectedSkill('', selected)).toBe('使用 ralph 技能');
    expect(messageContentWithSelectedSkill('普通文本', {})).toBe('普通文本');
  });

  it('uses the Chinese display name for the case graph analyst skill', () => {
    const selected = runConfigWithSelectedSkill({}, 'case-graph-analyst');

    expect(messageContentWithSelectedSkill('总结刚刚的图谱变化', selected)).toBe('使用 图谱研判助手 技能 总结刚刚的图谱变化');
  });

  it('uses the Chinese display name for the case graph operator skill', () => {
    const selected = runConfigWithSelectedSkill({}, 'case-graph-operator');

    expect(messageContentWithSelectedSkill('恢复全部已取消上图的主体', selected)).toBe('使用 图谱操作助手 技能 恢复全部已取消上图的主体');
  });
});
