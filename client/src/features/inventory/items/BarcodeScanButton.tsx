import { ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;
const getDetectorCtor = (): DetectorCtor | undefined => (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

/**
 * Scan a barcode with the camera. This is an extra, behind the clinic's barcode switch: a handheld or
 * USB scanner works with no setup because it types into the search box, and typing the code always works.
 * The browser's own BarcodeDetector is used where it exists (Chrome and Edge, including Android).
 */
export function BarcodeScanButton({ onScan }: { onScan: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const supported = !!getDetectorCtor() && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!open || !supported) return;
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new (getDetectorCtor()!)({ formats: ["ean_13", "ean_8", "upc_a", "code_128", "qr_code"] });
        const tick = async () => {
          if (stop || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]) { onScan(found[0].rawValue); setOpen(false); return; }
          requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch {
        setMessage("The camera could not be opened. Allow camera access for this site, or type the code instead.");
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [open, supported, onScan]);

  return (
    <>
      <Button type="button" variant="secondary" size="icon" aria-label="Scan a barcode with the camera" onClick={() => { setMessage(supported ? "" : "Camera scanning is not available in this browser. Use a handheld scanner, or type the barcode."); setOpen(true); }}><ScanLine /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Scan a barcode</DialogTitle><DialogDescription>Hold the barcode in front of the camera.</DialogDescription></DialogHeader>
          {supported && !message && <video ref={video} muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />}
          {message && <p role="alert" className="rounded-md bg-warn-tint p-3 text-warn">{message}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
