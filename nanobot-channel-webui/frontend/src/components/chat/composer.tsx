import {
  AuiIf,
  ComposerPrimitive,
  unstable_useSlashCommandAdapter,
  useAui,
  useAuiEvent,
  useAuiState,
  type Unstable_SlashCommand,
} from '@assistant-ui/react';
import { ArrowUpIcon, PlusIcon, SquareIcon } from 'lucide-react';
import { useMemo, type FC } from 'react';

import { summarizeSkillDescription } from '../../app-helpers';
import type { SkillCandidate } from '../../skill-quick-select';
import {
  runConfigWithSelectedSkill,
  runConfigWithoutSelectedSkill,
  selectedSkillFromRunConfig,
} from '../../skill-quick-select';
import { ComposerTriggerPopover } from '../assistant-ui/composer-trigger-popover';
import { ComposerAttachmentChip } from './messages';

function SelectedSkillChip({ skills }: { skills: SkillCandidate[] }) {
  const aui = useAui();
  const runConfig = useAuiState((state) => state.composer.runConfig);
  const selectedSkill = useMemo(
    () => selectedSkillFromRunConfig(runConfig, skills),
    [runConfig, skills],
  );

  if (!selectedSkill) {
    return null;
  }

  return (
    <button
      type="button"
      className="composer-selected-skill-chip"
      onClick={() => {
        aui.composer().setRunConfig(runConfigWithoutSelectedSkill(aui.composer().getState().runConfig));
      }}
      aria-label={`移除技能 ${selectedSkill.name}`}
    >
      <span>{selectedSkill.name}</span>
      <span className="composer-selected-skill-remove">×</span>
    </button>
  );
}

const ComposerAction: FC<{ onSend?: () => void }> = ({ onSend }) => {
  return (
    <div className="composer-action-row">
      <ComposerPrimitive.AddAttachment asChild>
        <button type="button" className="composer-attach" aria-label="添加附件">
          <PlusIcon size={18} />
        </button>
      </ComposerPrimitive.AddAttachment>

      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <button type="button" className="composer-send" aria-label="发送消息" onClick={onSend}>
            <ArrowUpIcon size={16} />
          </button>
        </ComposerPrimitive.Send>
      </AuiIf>

      <AuiIf condition={(state) => state.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <button type="button" className="composer-cancel" aria-label="停止生成">
            <SquareIcon size={12} fill="currentColor" />
          </button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

export function Composer({
  skills,
  compact = false,
  placeholder = '输入问题、任务或 / 选择技能…',
  compactPlaceholder = '发消息…',
}: {
  skills: SkillCandidate[];
  compact?: boolean;
  placeholder?: string;
  compactPlaceholder?: string;
}) {
  const aui = useAui();
  const composerText = useAuiState((state) => state.composer.text);
  const clearSelectedSkill = () => {
    aui.composer().setRunConfig(runConfigWithoutSelectedSkill(aui.composer().getState().runConfig));
  };
  const slashCommands = useMemo<readonly Unstable_SlashCommand[]>(
    () =>
      skills
        .filter((skill) => skill.enabled)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((skill) => ({
          id: skill.name,
          label: `/${skill.name}`,
          description: summarizeSkillDescription(skill.description),
          execute: () => {
            const currentRunConfig = aui.composer().getState().runConfig;
            aui.composer().setRunConfig(runConfigWithSelectedSkill(currentRunConfig, skill.name));
          },
        })),
    [aui, skills],
  );

  const slash = unstable_useSlashCommandAdapter({
    commands: slashCommands,
    removeOnExecute: true,
  });

  useAuiEvent('composer.send', () => {
    clearSelectedSkill();
    if (window.localStorage.getItem('nanobot_channel_webui_debug_composer') === '1') {
      console.debug('[nanobot-webui] composer.send', { text: composerText });
    }
  });

  return (
    <div className={`composer-host${compact ? ' compact' : ''}`}>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        {slashCommands.length ? (
          <ComposerTriggerPopover
            char="/"
            adapter={slash.adapter}
            aria-label="技能建议"
            className="max-h-[320px] overflow-y-auto"
            backLabel="返回"
            emptyCategoriesLabel="暂无可用分类"
            emptyItemsLabel="没有匹配的技能"
            action={slash.action}
          />
        ) : null}

        <ComposerPrimitive.Root className="relative flex w-full flex-col">
          <ComposerPrimitive.AttachmentDropzone asChild>
            <div className="composer-surface">
              <div className="composer-attachments-row">
                <SelectedSkillChip skills={skills} />
                <ComposerPrimitive.Attachments>
                  {() => <ComposerAttachmentChip />}
                </ComposerPrimitive.Attachments>
              </div>
              <ComposerPrimitive.Input
                className="composer-input"
                placeholder={compact ? compactPlaceholder : placeholder}
                submitMode="enter"
                rows={1}
                aria-label="消息输入"
                unstable_focusOnRunStart={false}
                unstable_focusOnScrollToBottom={false}
                unstable_focusOnThreadSwitched={false}
              />
              <ComposerAction onSend={() => window.setTimeout(clearSelectedSkill, 0)} />
            </div>
          </ComposerPrimitive.AttachmentDropzone>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </div>
  );
}
