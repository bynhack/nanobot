import { useState, useEffect, useMemo } from 'react';
import { loadSettingsSkills, loadSettingsSkillDetail, loadSettingsSkillFile, toggleSettingsSkill } from '../../../api';
import type { SettingsSkillSummary, SettingsSkillDetail, SettingsSkillFile } from '../../../types';
import { resolveSkillEnabled, buildSkillTree, SkillTree } from '../utils/skillUtils';
import { MarkdownPreview } from '../ui/MarkdownPreview';
import { SettingsSectionTitle } from '../ui/SettingsRow';

export function SkillsTab({
  token,
}: {
  token: string;
}) {
  const [skills, setSkills] = useState<SettingsSkillSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [detail, setDetail] = useState<SettingsSkillDetail | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<SettingsSkillFile | null>(null);
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  async function handleToggleSkill(
    skill: Pick<SettingsSkillSummary, 'name' | 'source' | 'enabled' | 'path'> & Partial<Pick<SettingsSkillDetail, 'files'>>,
  ) {
    const nextEnabled = !resolveSkillEnabled(skill);
    const key = `${skill.source}:${skill.name}`;
    setToggling(true);
    setTogglingKey(key);
    setError(null);
    try {
      const next = await toggleSettingsSkill(skill.name, skill.source, nextEnabled, token);
      setSkills((current) =>
        current.map((item) =>
          item.name === next.name && item.source === next.source ? { ...item, enabled: next.enabled, path: next.path } : item,
        ),
      );
      if (selectedKey === key) {
        setDetail(next);
        const defaultFile =
          next.files.find((file) => file.name === 'SKILL.md' || file.name === 'SKILL.disabled.md') ??
          next.files[0] ??
          null;
        setSelectedFilePath(defaultFile?.path ?? '');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换技能状态失败');
    } finally {
      setToggling(false);
      setTogglingKey('');
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextSkills = await loadSettingsSkills(token);
        if (!active) {
          return;
        }
        setSkills(nextSkills);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : '加载技能失败');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    const [source, ...nameParts] = selectedKey.split(':');
    const name = nameParts.join(':');
    if (!source || !name) {
      setDetail(null);
      setSelectedFilePath('');
      return;
    }
    let active = true;
    void (async () => {
      setDetailLoading(true);
      try {
        const nextDetail = await loadSettingsSkillDetail(name, source, token);
        if (active) {
          setDetail(nextDetail);
          const defaultFile = nextDetail.files.find((file) => file.name === 'SKILL.md') ?? nextDetail.files[0] ?? null;
          setSelectedFilePath(defaultFile?.path ?? '');
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : '加载技能详情失败');
        }
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedKey, token]);

  useEffect(() => {
    const [source, ...nameParts] = selectedKey.split(':');
    const name = nameParts.join(':');
    if (!source || !name || !selectedFilePath) {
      setSelectedFile(null);
      return;
    }
    let active = true;
    void (async () => {
      setFileLoading(true);
      try {
        const nextFile = await loadSettingsSkillFile(name, source, selectedFilePath, token);
        if (active) {
          setSelectedFile(nextFile);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : '加载技能文件失败');
        }
      } finally {
        if (active) {
          setFileLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedFilePath, selectedKey, token]);

  const fileTree = useMemo(() => (detail ? buildSkillTree(detail.files) : []), [detail]);
  const detailEnabled = detail ? resolveSkillEnabled(detail) : false;
  const filteredSkills = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return skills.filter((skill) => {
      const enabled = resolveSkillEnabled(skill);
      if (filter === 'enabled' && !enabled) {
        return false;
      }
      if (filter === 'disabled' && enabled) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        skill.name.toLowerCase().includes(keyword) ||
        skill.description.toLowerCase().includes(keyword)
      );
    });
  }, [filter, search, skills]);
  const enabledCount = skills.filter((skill) => resolveSkillEnabled(skill)).length;
  const disabledCount = skills.filter((skill) => !resolveSkillEnabled(skill)).length;

  return (
    <section className="settings-section">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="settings-header-title text-base font-semibold">技能管理</h3>
          <p className="settings-header-subtitle text-sm text-muted-foreground mt-1">查看和启用工作区技能或内置能力。</p>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={async () => {
            setLoading(true);
            setError(null);
            try {
              setSkills(await loadSettingsSkills(token));
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '刷新失败');
            } finally {
              setLoading(false);
            }
          }}
        >
          刷新
        </button>
      </div>

      {error ? <div className="settings-error my-4">{error}</div> : null}

      <div className="settings-skills-toolbar">
        <div className="settings-chip-row">
          <button
            type="button"
            className={`settings-filter-chip${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部 ({skills.length})
          </button>
          <button
            type="button"
            className={`settings-filter-chip${filter === 'enabled' ? ' active' : ''}`}
            onClick={() => setFilter('enabled')}
          >
            已启用 ({enabledCount})
          </button>
          <button
            type="button"
            className={`settings-filter-chip${filter === 'disabled' ? ' active' : ''}`}
            onClick={() => setFilter('disabled')}
          >
            未启用 ({disabledCount})
          </button>
        </div>
        <label className="settings-search-shell">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索技能名称或描述..." />
        </label>
      </div>

      <div className="settings-skills-list">
        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground italic">正在同步技能列表...</div>
        ) : !filteredSkills.length ? (
          <div className="p-12 text-center text-sm text-muted-foreground italic">未找到匹配的技能</div>
        ) : (
          filteredSkills.map((skill) => {
            const key = `${skill.source}:${skill.name}`;
            const enabled = resolveSkillEnabled(skill);
            return (
              <div key={key} className="settings-skill-item" onClick={() => setSelectedKey(key)}>
                <div className="settings-skill-info">
                  <div className="settings-skill-name-row">
                    <span className="settings-skill-name">{skill.name}</span>
                    <span className="settings-skill-source">{skill.source === 'workspace' ? '工作区' : '内置'}</span>
                  </div>
                  <div className="settings-skill-description">
                    {skill.description || '该技能暂无描述内容。'}
                  </div>
                </div>
                <div className="settings-skill-action" onClick={(e) => e.stopPropagation()}>
                  {skill.can_toggle ? (
                    <button
                      type="button"
                      className={`settings-modern-toggle${enabled ? ' active' : ''}`}
                      disabled={toggling && togglingKey === key}
                      onClick={() => void handleToggleSkill(skill)}
                      aria-label={enabled ? '禁用技能' : '启用技能'}
                    >
                      <div className="toggle-thumb" />
                    </button>
                  ) : (
                    <span className={`settings-skill-status-text ${enabled ? 'enabled' : ''}`}>
                      {enabled ? '已启用' : '已禁用'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      {selectedKey ? (
        <div className="settings-skill-modal-overlay" onClick={() => setSelectedKey('')}>
          <div className="settings-skill-modal-shell" onClick={(event) => event.stopPropagation()}>
            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground italic">加载详情中...</div>
            ) : detail ? (
              <>
                <div className="settings-skill-modal-header">
                  <div className="flex items-center gap-4">
                    <div className="settings-skill-icon-avatar" aria-hidden="true">
                      {detail.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold leading-tight">{detail.name}</h4>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        技能 · 作者：{detail.source === 'workspace' ? '工作区' : 'Nanobot'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {detail.can_toggle && (
                      <button
                        type="button"
                        className={`settings-modern-toggle${detailEnabled ? ' active' : ''}`}
                        disabled={toggling && togglingKey === selectedKey}
                        onClick={() => void handleToggleSkill(detail)}
                      >
                        <div className="toggle-thumb" />
                      </button>
                    )}
                    <button type="button" className="close-btn" aria-label="关闭" onClick={() => setSelectedKey('')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="settings-skill-modal-body">
                  <aside className="settings-skill-sidebar w-[240px] shrink-0 overflow-y-auto pt-6 px-3">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        className={`settings-tree-file${selectedFilePath === detail.path ? ' active' : ''}`}
                        onClick={() => setSelectedFilePath(detail.path)}
                      >
                        <svg className="w-4 h-4 shrink-0 text-muted-foreground mr-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span>{detailEnabled ? 'SKILL.md' : 'SKILL.disabled.md'}</span>
                      </button>
                      <SkillTree
                        nodes={fileTree.filter((node) => node.name !== 'SKILL.md' && node.name !== 'SKILL.disabled.md')}
                        selectedFilePath={selectedFilePath}
                        onSelect={setSelectedFilePath}
                      />
                    </div>
                  </aside>
                  <div className="settings-skill-modal-content">
                    {/* Summary Card */}
                    <div className="settings-skill-summary-card">
                      <div className="summary-row">
                        <span className="summary-label">Name</span>
                        <span className="summary-value font-semibold">{detail.name}</span>
                      </div>
                      <div className="summary-row">
                        <span className="summary-label">Description</span>
                        <span className="summary-value text-muted-foreground leading-relaxed">
                          {detail.description || '暂无详细描述。'}
                        </span>
                      </div>
                    </div>

                    {/* Content Preview */}
                    <div className="mt-10">
                      {selectedFilePath === detail.path && (
                        <h3 className="text-xl font-bold mb-4">Overview</h3>
                      )}
                      {fileLoading ? (
                        <div className="py-20 text-center text-sm text-muted-foreground italic opacity-50">读取内容中...</div>
                      ) : selectedFile ? (
                        selectedFile.is_markdown ? (
                          <div className="settings-markdown-preview skill-doc">
                            <MarkdownPreview content={selectedFile.content} />
                          </div>
                        ) : (
                          <pre className="settings-code-block mt-4">{selectedFile.content || '该文件为空。'}</pre>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
