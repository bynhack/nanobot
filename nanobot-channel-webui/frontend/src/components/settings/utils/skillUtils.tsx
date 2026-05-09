import React from 'react';
import type { SettingsSkillDetail, SettingsSkillSummary } from '../../../types';

export type SkillTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: SkillTreeNode[];
};

export function resolveSkillEnabled(
  skill: Pick<SettingsSkillSummary, 'enabled' | 'path'> & Partial<Pick<SettingsSkillDetail, 'files'>>,
): boolean {
  if (typeof skill.path === 'string' && skill.path.endsWith('/SKILL.md')) {
    return true;
  }
  if (Array.isArray(skill.files) && skill.files.some((file) => file.name === 'SKILL.md')) {
    return true;
  }
  return skill.enabled;
}

export function buildSkillTree(files: SettingsSkillDetail['files']): SkillTreeNode[] {
  const root: SkillTreeNode[] = [];

  for (const file of files) {
    const normalizedPath =
      typeof file.relative_path === 'string' && file.relative_path.trim()
        ? file.relative_path
        : typeof file.path === 'string'
          ? file.path.split('/').filter(Boolean).slice(-1)[0] ?? file.name
          : file.name;
    const parts = normalizedPath.split('/').filter(Boolean);
    if (!parts.length) {
      continue;
    }
    let level = root;
    let currentPath = '';

    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let existing = level.find((node) => node.name === part && node.path === currentPath);
      if (!existing) {
        existing = {
          name: part,
          path: isLeaf ? file.path : currentPath,
          type: isLeaf ? 'file' : 'dir',
          ...(isLeaf ? {} : { children: [] }),
        };
        level.push(existing);
      }
      if (!isLeaf) {
        level = existing.children ?? [];
      }
    });
  }

  const sortNodes = (nodes: SkillTreeNode[]): SkillTreeNode[] =>
    nodes
      .map((node) => ({
        ...node,
        ...(node.children ? { children: sortNodes(node.children) } : {}),
      }))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'dir' ? -1 : 1;
        }
        if (left.name === 'SKILL.md' || left.name === 'SKILL.disabled.md') {
          return -1;
        }
        if (right.name === 'SKILL.md' || right.name === 'SKILL.disabled.md') {
          return 1;
        }
        return left.name.localeCompare(right.name);
      });

  return sortNodes(root);
}

export function SkillTree({
  nodes,
  selectedFilePath,
  onSelect,
  depth = 0,
}: {
  nodes: SkillTreeNode[];
  selectedFilePath: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const toggle = (path: string) => {
    setExpanded((curr) => ({ ...curr, [path]: !curr[path] }));
  };

  return (
    <div className="settings-tree">
      {nodes.map((node) => {
        const isDir = node.type === 'dir';
        const isExpanded = expanded[node.path] ?? true;
        const isActive = selectedFilePath === node.path;

        if (isDir) {
          return (
            <div key={node.path} className="settings-tree-group">
              <div
                className="settings-tree-dir"
                style={{ paddingLeft: `${depth * 20 + 8}px` }}
                onClick={() => toggle(node.path)}
              >
                <svg
                  className={`w-3 h-3 shrink-0 transition-transform mr-1 text-muted-foreground ${isExpanded ? 'rotate-90' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <svg className="w-4 h-4 shrink-0 text-muted-foreground mr-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                <span>{node.name}</span>
              </div>
              {isExpanded && (
                <SkillTree
                  nodes={node.children ?? []}
                  selectedFilePath={selectedFilePath}
                  onSelect={onSelect}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        const isMd = node.name.toLowerCase().endsWith('.md');
        const isPy = node.name.toLowerCase().endsWith('.py');
        return (
          <button
            key={node.path}
            type="button"
            className={`settings-tree-file${isActive ? ' active' : ''}`}
            style={{ paddingLeft: `${depth * 20 + 32}px` }}
            onClick={() => onSelect(node.path)}
          >
            <svg className="w-4 h-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {isMd ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              ) : isPy ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              )}
            </svg>
            <span>{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}
