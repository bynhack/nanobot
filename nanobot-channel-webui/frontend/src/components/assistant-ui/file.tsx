"use client";

import { memo, useContext, type FC } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  BracesIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
} from "lucide-react";
import type { FileMessagePartComponent } from "@assistant-ui/react";
import { cn } from "../../lib/utils";
import { ImagePreview, ImageZoom } from "./image";
import { DetailPreviewContext } from "../chat/detail-preview-context";
import type { MediaItem } from "../../types";
import { STORAGE_KEYS } from "../../store";

const fileVariants = cva(
  "aui-file-root inline-flex items-center gap-3 rounded-lg transition-colors",
  {
    variants: {
      variant: {
        outline: "hover:bg-[var(--color-bg-hover)]",
        ghost: "hover:bg-[var(--color-bg-hover)]",
        muted: "bg-[var(--color-bg-sunken)] hover:bg-[var(--color-bg-hover)]",
      },
      size: {
        sm: "px-2.5 py-1.5 text-xs",
        default: "px-3 py-2 text-sm",
        lg: "px-4 py-3 text-base",
      },
    },
    defaultVariants: {
      variant: "muted",
      size: "default",
    },
  },
);

function getMimeTypeIcon(mimeType: string): FC<{ className?: string }> {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType === "application/pdf") return FileTextIcon;
  if (mimeType === "application/json") return BracesIcon;
  if (mimeType.startsWith("text/")) return FileTextIcon;
  if (mimeType.startsWith("audio/")) return MusicIcon;
  if (mimeType.startsWith("video/")) return VideoIcon;
  return FileIcon;
}

function isDirectUrl(data: string) {
  return /^(https?:\/\/|blob:|\/)/.test(data);
}

function storedAuthToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEYS.authToken) ?? "";
  } catch {
    return "";
  }
}

function withStoredAuthQuery(url: string): string {
  const token = storedAuthToken();
  if (
    !token ||
    url.startsWith("/api/public-media/") ||
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:")
  ) {
    return url;
  }
  if (!url.startsWith("/")) {
    return url;
  }
  const value = new URL(url, window.location.origin);
  value.searchParams.set("auth_token", token);
  return `${value.pathname}${value.search}`;
}

function fileHref(data: string, mimeType: string): string {
  if (data.startsWith("data:")) return data;
  if (isDirectUrl(data)) return withStoredAuthQuery(data);
  return `data:${mimeType};base64,${data}`;
}

function getBase64Size(base64: string): number | null {
  if (isDirectUrl(base64)) return null;
  const commaIndex = base64.indexOf(",");
  const base64Data = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  const padding = (base64Data.match(/=/g) || []).length;
  return Math.floor((base64Data.length * 3) / 4) - padding;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileRootProps = React.ComponentProps<"div"> & VariantProps<typeof fileVariants>;

function FileRoot({ className, variant, size, children, ...props }: FileRootProps) {
  return (
    <div
      data-slot="file-root"
      data-variant={variant}
      data-size={size}
      className={cn(fileVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type FileIconDisplayProps = React.ComponentProps<"span"> & {
  mimeType?: string;
};

function FileIconDisplay({ mimeType, className, children, ...props }: FileIconDisplayProps) {
  const IconComponent = mimeType ? getMimeTypeIcon(mimeType) : FileIcon;

  return (
    <span
      data-slot="file-icon"
      className={cn("shrink-0 text-[var(--color-text-muted)]", className)}
      {...props}
    >
      {children ?? <IconComponent className="size-5" />}
    </span>
  );
}

function FileName({ className, children, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-name"
      className={cn("min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]", className)}
      {...props}
    >
      {children || "Unnamed file"}
    </span>
  );
}

type FileSizeProps = React.ComponentProps<"span"> & {
  bytes: number;
};

function FileSize({ bytes, className, ...props }: FileSizeProps) {
  return (
    <span
      data-slot="file-size"
      className={cn("shrink-0 text-[var(--color-text-muted)]", className)}
      {...props}
    >
      {formatFileSize(bytes)}
    </span>
  );
}

type FileDownloadProps = Omit<React.ComponentProps<"a">, "href"> & {
  data: string;
  mimeType: string;
  filename?: string;
};

function FileDownload({
  data,
  mimeType,
  filename,
  className,
  children,
  ...props
}: FileDownloadProps) {
  const href = fileHref(data, mimeType);

  return (
    <a
      data-slot="file-download"
      href={href}
      download={filename || "download"}
      target={isDirectUrl(data) ? "_blank" : undefined}
      rel={isDirectUrl(data) ? "noreferrer" : undefined}
      aria-label="下载文件"
      title="下载文件"
      onClick={(event) => {
        event.stopPropagation();
      }}
      className={cn(
        "shrink-0 rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
        className,
      )}
      {...props}
    >
      {children || <DownloadIcon className="size-4" />}
    </a>
  );
}

const FileImpl: FileMessagePartComponent = ({ filename, data, mimeType }) => {
  const { openMedia } = useContext(DetailPreviewContext);
  const bytes = getBase64Size(data);
  const href = fileHref(data, mimeType);
  const item: MediaItem = {
    url: data,
    name: filename || "附件",
    mime: mimeType,
  };

  if (mimeType.startsWith("image/")) {
    return (
      <div className="aui-image-root overflow-hidden rounded-lg max-w-96">
        <ImageZoom src={href} alt={filename || "图片内容"}>
          <ImagePreview src={href} alt={filename || "图片内容"} />
        </ImageZoom>
      </div>
    );
  }

  return (
    <FileRoot
      role="button"
      tabIndex={0}
      className="cursor-pointer"
      aria-label={`预览文件 ${filename || "附件"}`}
      onClick={() => openMedia(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMedia(item);
        }
      }}
    >
      <FileIconDisplay mimeType={mimeType} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FileName>{filename}</FileName>
        {bytes != null ? <FileSize bytes={bytes} className="text-xs" /> : null}
      </div>
      <FileDownload
        data={data}
        mimeType={mimeType}
        {...(filename !== undefined ? { filename } : {})}
      />
    </FileRoot>
  );
};

const File = memo(FileImpl) as unknown as FileMessagePartComponent & {
  Root: typeof FileRoot;
  Icon: typeof FileIconDisplay;
  Name: typeof FileName;
  Size: typeof FileSize;
  Download: typeof FileDownload;
};

File.displayName = "File";
File.Root = FileRoot;
File.Icon = FileIconDisplay;
File.Name = FileName;
File.Size = FileSize;
File.Download = FileDownload;

export {
  File,
  FileRoot,
  FileIconDisplay,
  FileName,
  FileSize,
  FileDownload,
  fileVariants,
  getMimeTypeIcon,
  getBase64Size,
  formatFileSize,
};
