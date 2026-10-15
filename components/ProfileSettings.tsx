"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ProfileAvatar } from "./ProfileAvatar";
import {
  DEFAULT_MI_PROFILE,
  MAX_PROFILE_DATA_URL_LENGTH,
  PROFILE_CHANGED_EVENT,
  loadMiProfile,
  quantizeAvatarChannel,
  saveMiProfile,
  type MiProfile,
} from "./profilePreferences";

const GRID_SIZE = 16;
const AVATAR_SIZE = 128;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_INK = "#316081";

function renderImageAvatar(source: string, pixelated: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const crop = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = (image.naturalWidth - crop) / 2;
      const sy = (image.naturalHeight - crop) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Avatar canvas is unavailable."));
      context.fillStyle = "#f2f2f1";
      context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
      if (pixelated) {
        const small = document.createElement("canvas");
        small.width = GRID_SIZE;
        small.height = GRID_SIZE;
        const smallContext = small.getContext("2d");
        if (!smallContext) return reject(new Error("Avatar canvas is unavailable."));
        smallContext.drawImage(image, sx, sy, crop, crop, 0, 0, GRID_SIZE, GRID_SIZE);
        const pixels = smallContext.getImageData(0, 0, GRID_SIZE, GRID_SIZE);
        for (let index = 0; index < pixels.data.length; index += 4) {
          pixels.data[index] = quantizeAvatarChannel(pixels.data[index]);
          pixels.data[index + 1] = quantizeAvatarChannel(pixels.data[index + 1]);
          pixels.data[index + 2] = quantizeAvatarChannel(pixels.data[index + 2]);
        }
        smallContext.putImageData(pixels, 0, 0);
        context.imageSmoothingEnabled = false;
        context.drawImage(small, 0, 0, GRID_SIZE, GRID_SIZE, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      } else {
        context.drawImage(image, sx, sy, crop, crop, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      }
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("That image could not be read."));
    image.src = source;
  });
}

export function ProfileSettings() {
  const [profile, setProfile] = useState<MiProfile>(DEFAULT_MI_PROFILE);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [pixels, setPixels] = useState<Array<string | null>>(
    () => Array.from({ length: GRID_SIZE * GRID_SIZE }, () => null),
  );
  const [ink, setInk] = useState(DEFAULT_INK);
  const [erasing, setErasing] = useState(false);
  const [message, setMessage] = useState("");
  const [drawing, setDrawing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only after hydration
    setProfile(loadMiProfile(window.localStorage));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const cell = canvas.width / GRID_SIZE;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f2f2f1";
    context.fillRect(0, 0, canvas.width, canvas.height);
    pixels.forEach((color, index) => {
      if (!color) return;
      context.fillStyle = color;
      context.fillRect((index % GRID_SIZE) * cell, Math.floor(index / GRID_SIZE) * cell, cell, cell);
    });
    context.strokeStyle = "rgba(49, 96, 129, 0.14)";
    context.lineWidth = 1;
    for (let index = 1; index < GRID_SIZE; index += 1) {
      const position = index * cell;
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, canvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(0, position);
      context.lineTo(canvas.width, position);
      context.stroke();
    }
  }, [pixels]);

  function persist(next: MiProfile, status: string) {
    const saved = saveMiProfile(window.localStorage, next);
    setProfile(saved);
    setMessage(status);
    window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
  }

  function paint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(((event.clientX - bounds.left) / bounds.width) * GRID_SIZE)));
    const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * GRID_SIZE)));
    const index = y * GRID_SIZE + x;
    setPixels((current) => {
      if (current[index] === (erasing ? null : ink)) return current;
      const next = [...current];
      next[index] = erasing ? null : ink;
      return next;
    });
  }

  async function chooseImage(file: File) {
    setMessage("");
    if (!file.type.startsWith("image/") || file.size > MAX_UPLOAD_BYTES) {
      setMessage("Choose an image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSourceImage(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setMessage("That image could not be read.");
    reader.readAsDataURL(file);
  }

  async function applySource(pixelated: boolean) {
    if (!sourceImage) return;
    try {
      const avatarDataUrl = await renderImageAvatar(sourceImage, pixelated);
      if (avatarDataUrl.length > MAX_PROFILE_DATA_URL_LENGTH) throw new Error("The processed image is too large.");
      persist({ ...profile, avatarDataUrl }, pixelated ? "Pixel portrait saved locally." : "Profile portrait saved locally.");
      setSourceImage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function applyDrawing() {
    const output = document.createElement("canvas");
    output.width = AVATAR_SIZE;
    output.height = AVATAR_SIZE;
    const context = output.getContext("2d");
    if (!context) return;
    const cell = AVATAR_SIZE / GRID_SIZE;
    context.fillStyle = "#f2f2f1";
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    pixels.forEach((color, index) => {
      if (!color) return;
      context.fillStyle = color;
      context.fillRect((index % GRID_SIZE) * cell, Math.floor(index / GRID_SIZE) * cell, cell, cell);
    });
    persist({ ...profile, avatarDataUrl: output.toDataURL("image/png") }, "Pixel drawing saved locally.");
  }

  return (
    <section className="surface-depth rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">Local profile</p>
          <h2 className="mt-1 font-display text-xl font-light">Your corner of Mi</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Add a name and avatar for this computer. Mi re-encodes portraits as a small PNG;
            the original image is not retained or shared.
          </p>
        </div>
        <ProfileAvatar className="h-16 w-16" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.8fr)]">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium">Display name</span>
            <div className="mt-2 flex gap-2">
              <input
                value={profile.displayName}
                onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="Your name"
                maxLength={60}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2"
              />
              <button type="button" onClick={() => persist(profile, "Profile name saved locally.")} className="tactile-control rounded-md bg-foreground px-3 py-2 text-background">Save</button>
            </div>
          </label>

          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <p className="text-sm font-medium">Portrait</p>
            <p className="mt-1 text-xs text-muted-foreground">Upload once, then choose a clean portrait or a 16×16 pixel treatment.</p>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void chooseImage(file);
                event.target.value = "";
              }}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => fileInput.current?.click()} className="tactile-control rounded-md border border-border px-3 py-2 text-sm hover:border-accent">Choose image</button>
              {sourceImage && <button type="button" onClick={() => void applySource(true)} className="tactile-control rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">Make 8-bit</button>}
              {sourceImage && <button type="button" onClick={() => void applySource(false)} className="tactile-control rounded-md border border-border px-3 py-2 text-sm">Use clean crop</button>}
              {profile.avatarDataUrl && <button type="button" onClick={() => persist({ ...profile, avatarDataUrl: null }, "Profile image removed.")} className="tactile-control rounded-md border border-border px-3 py-2 text-sm">Remove image</button>}
            </div>
            {sourceImage && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview is never uploaded or retained
              <img src={sourceImage} alt="Selected profile preview" className="mt-3 h-24 w-24 rounded-md border border-border object-cover" />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Draw a pixel avatar</p>
              <p className="mt-1 text-xs text-muted-foreground">Drag across the grid, then use the drawing as your profile.</p>
            </div>
            <input aria-label="Drawing color" type="color" value={ink} onChange={(event) => { setInk(event.target.value); setErasing(false); }} className="h-9 w-12 cursor-pointer rounded border border-border bg-card" />
          </div>
          <canvas
            ref={canvasRef}
            width={256}
            height={256}
            aria-label="Pixel avatar drawing canvas"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDrawing(true); paint(event); }}
            onPointerMove={(event) => { if (drawing) paint(event); }}
            onPointerUp={() => setDrawing(false)}
            onPointerCancel={() => setDrawing(false)}
            className="mt-3 aspect-square w-full cursor-crosshair touch-none rounded-md border border-border bg-white [image-rendering:pixelated]"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" aria-pressed={erasing} onClick={() => setErasing((value) => !value)} className={`tactile-control rounded-md border px-3 py-2 text-sm ${erasing ? "border-accent bg-accent/10" : "border-border"}`}>Eraser</button>
            <button type="button" onClick={() => setPixels(Array.from({ length: GRID_SIZE * GRID_SIZE }, () => null))} className="tactile-control rounded-md border border-border px-3 py-2 text-sm">Clear</button>
            <button type="button" onClick={applyDrawing} className="tactile-control rounded-md bg-foreground px-3 py-2 text-sm text-background">Use drawing</button>
          </div>
        </div>
      </div>
      {message && <p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
