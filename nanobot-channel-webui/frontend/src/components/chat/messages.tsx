import {
  AttachmentPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  useAttachment,
  useMessageAttachment,
  useMessagePartText,
  type EmptyMessagePartProps,
  type FileMessagePartProps,
  type ImageMessagePartProps,
  type TextMessagePartProps,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown';
import { cjk } from '@streamdown/cjk';
import { useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { showToolResult, toolStatusText } from '../../app-helpers';
import { streamdownZhTranslations } from '../../streamdown-i18n';
import { File as AssistantUiFile } from '../assistant-ui/file';
import { Image as AssistantUiImage } from '../assistant-ui/image';
import { MermaidDiagram } from '../assistant-ui/mermaid-diagram';
import { DetailPreviewContext } from './detail-preview-context';
import type { MediaItem } from '../../types';

function FileTypeGlyph({ mime }: { mime: string }) {
  if (mime.startsWith('audio/')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
      </svg>
    );
  }
  if (mime.startsWith('video/')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.867v6.266a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mime === 'application/pdf') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function ToolStatusIcon({ status }: { status: 'pending' | 'ok' | 'error' }) {
  if (status === 'pending') {
    return <span className="tool-icon spinner" />;
  }
  if (status === 'ok') {
    return (
      <svg className="tool-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="tool-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function UserTextPart(_props: TextMessagePartProps) {
  return (
    <div className="message-plain-text">
      <MessagePartPrimitive.Text />
    </div>
  );
}

function AssistantTextPart(_props: TextMessagePartProps) {
  const streamdownPlugins = useMemo(() => ({ cjk }), []);
  const componentsByLanguage = useMemo(
    () => ({
      mermaid: {
        SyntaxHighlighter: MermaidDiagram,
      },
    }),
    [],
  );

  return (
    <div className="streamdown-body">
      <StreamdownTextPrimitive
        componentsByLanguage={componentsByLanguage}
        plugins={streamdownPlugins}
        translations={streamdownZhTranslations}
      />
    </div>
  );
}

function AssistantEmptyPart(_props: EmptyMessagePartProps) {
  return null;
}

function MediaInline({ children }: PropsWithChildren) {
  return <span className="media-inline">{children}</span>;
}

function AssistantImagePart(props: ImageMessagePartProps) {
  return (
    <MediaInline>
      <AssistantUiImage {...props} />
    </MediaInline>
  );
}

function AssistantFilePart(props: FileMessagePartProps) {
  return (
    <MediaInline>
      <AssistantUiFile {...props} />
    </MediaInline>
  );
}

function ToolGroup({ children }: PropsWithChildren<{ startIndex: number; endIndex: number }>) {
  return <div className="tool-list">{children}</div>;
}

function ThinkingAccordion({ children }: PropsWithChildren) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`chain-of-thought-card${expanded ? '' : ' is-collapsed'}`}>
      <button
        type="button"
        className="chain-of-thought-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <svg className="chain-of-thought-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5 10 12.5 15 7.5" />
        </svg>
        <span>思考与工具调用</span>
      </button>
      {expanded ? <div className="chain-of-thought-body">{children}</div> : null}
    </div>
  );
}

function ReasoningGroup({ children }: PropsWithChildren) {
  return <div className="reasoning-group">{children}</div>;
}

function ReasoningPart(props: { text?: string }) {
  return (
    <div className="reasoning-part">
      <span className="reasoning-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 3.5c-2.35 0-4.25 1.73-4.25 3.86 0 1.23.63 2.32 1.61 3.03.38.27.64.67.72 1.13l.08.48h3.68l.08-.48c.08-.46.34-.86.72-1.13.98-.71 1.61-1.8 1.61-3.03 0-2.13-1.9-3.86-4.25-3.86Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.4 14h3.2M8.9 16h2.2" />
        </svg>
      </span>
      <span>{props.text ?? ''}</span>
    </div>
  );
}

function groupAssistantPart(part: { type: string }) {
  if (part.type === 'reasoning') {
    return ['group-chainOfThought', 'group-reasoning'];
  }
  if (part.type === 'tool-call') {
    return ['group-chainOfThought', 'group-tool'];
  }
  return null;
}

function ToolCallPart(
  props: ToolCallMessagePartProps<Record<string, unknown>, unknown> & { durationMs?: number },
) {
  const { openTool } = useContext(DetailPreviewContext);
  const pending = props.status.type === 'running' || props.result === undefined;
  const status = pending ? 'pending' : props.isError ? 'error' : 'ok';

  return (
    <button
      type="button"
      className="tool-row"
      onClick={() =>
        openTool(props.toolName, {
          args: props.args,
          result: showToolResult(props.result),
          status: props.isError ? 'error' : pending ? undefined : 'ok',
          durationMs: props.durationMs,
        })
      }
    >
      <span className="tool-left">
        <ToolStatusIcon status={status} />
        <strong>{props.toolName}</strong>
      </span>
      <span className="tool-hint">{`(${JSON.stringify(props.args)})`}</span>
      <span className="tool-row-status">
        {props.durationMs && !pending
          ? `${props.durationMs} 毫秒 · ${toolStatusText(props.isError ? 'error' : 'ok')}`
          : toolStatusText(pending ? undefined : props.isError ? 'error' : 'ok')}
      </span>
    </button>
  );
}

function MessageAttachmentChip() {
  const attachment = useMessageAttachment();
  const { openMedia } = useContext(DetailPreviewContext);
  const mime = attachment.contentType ?? 'application/octet-stream';
  const firstPart = attachment.content?.[0];
  const url = firstPart?.type === 'image' ? firstPart.image : firstPart?.type === 'file' ? firstPart.data : '';
  const item: MediaItem = { url: url ?? '', name: attachment.name, mime };

  if (mime.startsWith('image/') && item.url) {
    return (
      <button type="button" className="message-image-thumb" onClick={() => openMedia(item)}>
        <img src={item.url} alt={item.name} className="message-image-thumb-image" />
      </button>
    );
  }

  return (
    <AttachmentPrimitive.Root asChild>
      <button type="button" className="message-attachment-chip" onClick={() => openMedia(item)}>
        <span className="icon">
          <FileTypeGlyph mime={mime} />
        </span>
        <span className="label">
          <AttachmentPrimitive.Name />
        </span>
      </button>
    </AttachmentPrimitive.Root>
  );
}

export function ComposerAttachmentChip() {
  const attachment = useAttachment();
  const previewUrl = useMemo(() => {
    if (!attachment.file || !(attachment.contentType ?? '').startsWith('image/')) {
      return '';
    }
    return URL.createObjectURL(attachment.file);
  }, [attachment]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if ((attachment.contentType ?? '').startsWith('image/') && previewUrl) {
    return (
      <AttachmentPrimitive.Root className="composer-media-thumb-shell">
        <img src={previewUrl} alt={attachment.name} className="composer-media-thumb-image" />
        <AttachmentPrimitive.Remove className="composer-attachment-remove">
          ×
        </AttachmentPrimitive.Remove>
      </AttachmentPrimitive.Root>
    );
  }

  return (
    <AttachmentPrimitive.Root className="composer-attachment-chip">
      <span className="composer-attachment-icon">
        <FileTypeGlyph mime={attachment.contentType ?? ''} />
      </span>
      <span className="composer-attachment-label">
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove className="composer-attachment-remove inline">
        ×
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="message-row user">
      <div className="bubble user">
        <MessagePrimitive.Attachments>
          {() => <MessageAttachmentChip />}
        </MessagePrimitive.Attachments>
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === 'text') return <UserTextPart {...part} />;
            return null;
          }}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message-row assistant">
      <div className="assistant-stack">
        <div className="bubble assistant">
          <MessagePrimitive.GroupedParts
            groupBy={groupAssistantPart}
          >
            {({ part, children }) => {
              switch (part.type) {
                case 'group-chainOfThought':
                  return <ThinkingAccordion>{children}</ThinkingAccordion>;
                case 'group-reasoning':
                  return <ReasoningGroup>{children}</ReasoningGroup>;
                case 'group-tool':
                  return <ToolGroup startIndex={0} endIndex={0}>{children}</ToolGroup>;
                case 'text':
                  return <AssistantTextPart {...part} />;
                case 'image':
                  return <AssistantImagePart {...part} />;
                case 'file':
                  return <AssistantFilePart {...part} />;
                case 'reasoning':
                  return <ReasoningPart {...part} />;
                case 'tool-call':
                  return part.toolUI ?? <ToolCallPart {...part} />;
                default:
                  return <AssistantEmptyPart {...part} />;
              }
            }}
          </MessagePrimitive.GroupedParts>
          <MessagePrimitive.Error>
            <div className="tool-meta">发生错误</div>
          </MessagePrimitive.Error>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}
