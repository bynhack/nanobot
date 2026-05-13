"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { createPortal } from "react-dom";
import { cva, type VariantProps } from "class-variance-authority";
import { ImageIcon, ImageOffIcon } from "lucide-react";
import type { ImageMessagePartComponent } from "@assistant-ui/react";
import { cn } from "../../lib/utils";

const imageVariants = cva(
  "aui-image-root relative overflow-hidden rounded-lg",
  {
    variants: {
      variant: {
        outline: "",
        ghost: "",
        muted: "bg-[var(--color-bg-sunken)]",
      },
      size: {
        sm: "max-w-64",
        default: "max-w-96",
        lg: "max-w-[512px]",
        full: "w-full",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

export type ImageRootProps = React.ComponentProps<"div"> & VariantProps<typeof imageVariants>;

function ImageRoot({ className, variant, size, children, ...props }: ImageRootProps) {
  return (
    <div
      data-slot="image-root"
      data-variant={variant}
      data-size={size}
      className={cn(imageVariants({ variant, size, className }))}
      {...props}
    >
      {children}
    </div>
  );
}

type ImagePreviewProps = Omit<React.ComponentProps<"img">, "children"> & {
  containerClassName?: string;
};

function ImagePreview({
  className,
  containerClassName,
  onLoad,
  onError,
  alt = "图片内容",
  src,
  ...props
}: ImagePreviewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined);

  const loaded = loadedSrc === src;
  const error = errorSrc === src;

  useEffect(() => {
    if (
      typeof src === "string" &&
      imgRef.current?.complete &&
      imgRef.current.naturalWidth > 0
    ) {
      setLoadedSrc(src);
    }
  }, [src]);

  return (
    <div
      data-slot="image-preview"
      className={cn("relative min-h-32 bg-[var(--color-bg-sunken)]", containerClassName)}
    >
      {!loaded && !error ? (
        <div
          data-slot="image-preview-loading"
          className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-sunken)]/80"
        >
          <ImageIcon className="size-8 animate-pulse text-[var(--color-text-muted)]" />
        </div>
      ) : null}
      {error ? (
        <div
          data-slot="image-preview-error"
          className="flex min-h-32 items-center justify-center bg-[var(--color-bg-sunken)] p-4"
        >
          <ImageOffIcon className="size-8 text-[var(--color-text-muted)]" />
        </div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className={cn("block h-auto w-full object-contain", !loaded && "invisible", className)}
          onLoad={(e) => {
            if (typeof src === "string") setLoadedSrc(src);
            onLoad?.(e);
          }}
          onError={(e) => {
            if (typeof src === "string") setErrorSrc(src);
            onError?.(e);
          }}
          {...props}
        />
      )}
    </div>
  );
}

function ImageFilename({ className, children, ...props }: React.ComponentProps<"span">) {
  if (!children) return null;

  return (
    <span
      data-slot="image-filename"
      className={cn(
        "block truncate px-2 py-1.5 text-[var(--color-text-muted)] text-xs",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

type ImageZoomProps = PropsWithChildren<{
  src: string;
  alt?: string;
}>;

function ImageZoom({ src, alt = "图片预览", children }: ImageZoomProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  return (
    <>
      <div
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && setIsOpen(true)}
        role="button"
        tabIndex={0}
        className="cursor-zoom-in"
        aria-label="点击放大图片"
      >
        {children}
      </div>
      {isMounted && isOpen
        ? createPortal(
            <div
              data-slot="image-zoom-overlay"
              role="button"
              tabIndex={0}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
              onClick={() => setIsOpen(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsOpen(false)}
              aria-label="关闭图片预览"
            >
              <img
                data-slot="image-zoom-content"
                src={src}
                alt={alt}
                className="max-h-[90vh] max-w-[90vw] cursor-zoom-out object-contain"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const ImageImpl: ImageMessagePartComponent = ({ image, filename }) => {
  return (
    <ImageRoot>
      <ImageZoom src={image} alt={filename || "图片内容"}>
        <ImagePreview src={image} alt={filename || "图片内容"} />
      </ImageZoom>
      <ImageFilename>{filename}</ImageFilename>
    </ImageRoot>
  );
};

const Image = memo(ImageImpl) as unknown as ImageMessagePartComponent & {
  Root: typeof ImageRoot;
  Preview: typeof ImagePreview;
  Filename: typeof ImageFilename;
  Zoom: typeof ImageZoom;
};

Image.displayName = "Image";
Image.Root = ImageRoot;
Image.Preview = ImagePreview;
Image.Filename = ImageFilename;
Image.Zoom = ImageZoom;

export {
  Image,
  ImageRoot,
  ImagePreview,
  ImageFilename,
  ImageZoom,
  imageVariants,
};
