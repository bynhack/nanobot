import type { MediaItem } from '../types';
import { DocxPreviewer } from './docx-previewer';
import { mediaMime, isPptMime, isSheetMime, isWordMime } from './media-types';
import { PdfPreviewer } from './pdf-previewer';
import { PptPreviewer } from './ppt-previewer';
import { SheetPreviewer } from './sheet-previewer';
import { HtmlPreviewer, TextPreviewer } from './text-previewer';

type MediaPreviewRouterProps = {
  item: MediaItem;
  downloadUrl: string;
  token: string;
};

export function MediaPreviewRouter({ item, downloadUrl, token }: MediaPreviewRouterProps) {
  const mime = mediaMime(item);

  if (mime.startsWith('image/')) {
    return <img src={downloadUrl} alt={item.name} className="panel-image" />;
  }
  if (mime.startsWith('audio/')) {
    return <audio src={downloadUrl} controls className="panel-media" />;
  }
  if (mime.startsWith('video/')) {
    return <video src={downloadUrl} controls className="panel-media" />;
  }
  if (mime === 'application/pdf') {
    return <PdfPreviewer item={item} token={token} />;
  }
  if (isWordMime(mime)) {
    return <DocxPreviewer item={item} token={token} />;
  }
  if (isSheetMime(mime)) {
    return <SheetPreviewer item={item} token={token} />;
  }
  if (isPptMime(mime)) {
    return <PptPreviewer item={item} token={token} />;
  }
  if (mime === 'text/markdown') {
    return <TextPreviewer item={item} token={token} markdown />;
  }
  if (mime === 'application/json') {
    return <TextPreviewer item={item} token={token} jsonText />;
  }
  if (mime === 'text/html') {
    return <HtmlPreviewer item={item} downloadUrl={downloadUrl} />;
  }
  if (mime.startsWith('text/')) {
    return <TextPreviewer item={item} token={token} />;
  }
  return <div className="panel-empty">暂不支持此类型文件预览，请直接下载查看。</div>;
}
