import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImageLightbox({ src, alt, open, onOpenChange }: ImageLightboxProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-4xl p-0 bg-transparent border-none">
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <div className="relative">
          <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
            <a href={src} download target="_blank" rel="noopener noreferrer">
              <Button
                size="icon"
                variant="ghost"
                className="bg-background/80 backdrop-blur-sm"
                data-testid="button-download-lightbox"
              >
                <Download className="w-4 h-4" />
              </Button>
            </a>
            <Button
              size="icon"
              variant="ghost"
              className="bg-background/80 backdrop-blur-sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-lightbox"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <img
            src={src}
            alt={alt || "Image"}
            className="w-full h-auto max-h-[80vh] object-contain rounded-md"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface VideoLightboxProps {
  src: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoLightbox({ src, open, onOpenChange }: VideoLightboxProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-4xl p-0 bg-transparent border-none">
        <DialogTitle className="sr-only">Video preview</DialogTitle>
        <div className="relative">
          <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
            <a href={src} download target="_blank" rel="noopener noreferrer">
              <Button
                size="icon"
                variant="ghost"
                className="bg-background/80 backdrop-blur-sm"
                data-testid="button-download-video-lightbox"
              >
                <Download className="w-4 h-4" />
              </Button>
            </a>
            <Button
              size="icon"
              variant="ghost"
              className="bg-background/80 backdrop-blur-sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-close-video-lightbox"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <video
            src={src}
            controls
            autoPlay
            className="w-full max-h-[80vh] rounded-md"
            data-testid="video-lightbox-player"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ClickableImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export function ClickableImage({ src, alt, className }: ClickableImageProps) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <>
      <img
        src={src}
        alt={alt || "Image"}
        className={`cursor-pointer hover:opacity-90 transition-opacity ${className || ""}`}
        onClick={() => setOpen(true)}
        onError={() => setFailed(true)}
        data-testid="img-clickable"
      />
      <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen} />
    </>
  );
}

interface ClickableVideoProps {
  src: string;
  className?: string;
}

export function ClickableVideo({ src, className }: ClickableVideoProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className={`relative cursor-pointer group ${className || ""}`} onClick={() => setOpen(true)} data-testid="video-clickable">
        <video src={src} preload="metadata" className="w-full h-full object-cover rounded-md" muted />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md group-hover:bg-black/40 transition-colors">
          <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
            <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <VideoLightbox src={src} open={open} onOpenChange={setOpen} />
    </>
  );
}
