import { useCallback, useRef, useState, type ReactNode } from 'react';
import { BUCKETS, storagePath, uploadFile, removeFile, type Bucket } from '@/lib/supabase';
import { Icon, Spinner } from './Icon';
import { Button } from './Primitives';
import { useAuth } from '@/context/AuthContext';

/**
 * Image upload → Supabase Storage.
 *
 * Client-side downscale before upload: product photos arrive from phones at
 * 4–8 MB, and a marketplace grid of those would be unusable on Zambian mobile
 * data. We resize to a sane maximum and upload a JPEG/WEBP instead.
 */

const MAX_BYTES = 12 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function downscaleImage(file: File, maxSize = 1600, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return file; }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return file;
  // Only use the downscaled version when it actually saved space.
  if (blob.size >= file.size && scale === 1) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

export interface UploadedImage {
  url: string;
  path: string;
  name: string;
  size: number;
  type?: string;
}

interface ImageUploaderProps {
  bucket?: Bucket;
  scope: string;
  sub?: string;
  value?: UploadedImage | null;
  images?: UploadedImage[];
  multiple?: boolean;
  max?: number;
  maxSize?: number;
  quality?: number;
  label?: string;
  hint?: string;
  aspect?: 'square' | 'wide' | 'logo';
  onChange?: (image: UploadedImage | null) => void;
  onImagesChange?: (images: UploadedImage[]) => void;
  disabled?: boolean;
}

export function ImageUploader({
  bucket = BUCKETS.products, scope, sub = 'general', value, images, multiple, max = 8,
  maxSize = 1600, quality = 0.85, label, hint, aspect = 'square', onChange, onImagesChange, disabled,
}: ImageUploaderProps) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const aspectClass = aspect === 'wide' ? 'aspect-[16/9]' : aspect === 'logo' ? 'aspect-[2/1]' : 'aspect-square';

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || disabled) return;
    setError(null);

    if (!user) { setError('Sign in to upload images.'); return; }

    const files = Array.from(fileList).slice(0, multiple ? max : 1);
    setBusy(true);
    try {
      const uploaded: UploadedImage[] = [];
      for (const file of files) {
        if (!ACCEPTED.includes(file.type)) {
          setError(`${file.name}: use JPG, PNG, WEBP or GIF.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is larger than 12 MB.`);
          continue;
        }
        const resized = await downscaleImage(file, maxSize, quality);
        const path = storagePath(scope, sub, resized.name);
        const res = await uploadFile(bucket, path, resized, { contentType: resized.type });
        if (!res.url) throw new Error('That bucket is private; images must go to a public bucket.');
        uploaded.push({ url: res.url, path: res.path, name: file.name, size: resized.size, type: 'image' });
      }

      if (uploaded.length === 0) return;
      if (multiple && onImagesChange) {
        onImagesChange([...(images ?? []), ...uploaded].slice(0, max));
      } else if (onChange) {
        // Replace the previous image and clean up its storage object.
        if (value?.path) void removeFile(bucket, value.path).catch(() => {});
        onChange(uploaded[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }, [bucket, scope, sub, user, multiple, max, maxSize, quality, value, images, onChange, onImagesChange, disabled]);

  const drop = (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFiles(e.dataTransfer.files); }}
      className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors disabled:opacity-50 ${
        dragOver ? 'border-brand-500 bg-brand-50' : 'border-ink-300 bg-ink-50/60 hover:border-brand-400 hover:bg-brand-50/40'
      }`}
    >
      {busy ? <Spinner size={22} className="text-brand-600" /> : <Icon name="camera" size={24} className="text-ink-500" />}
      <span className="text-sm font-semibold text-ink-700">
        {busy ? 'Uploading…' : multiple ? 'Tap or drop photos' : 'Tap or drop a photo'}
      </span>
      <span className="text-xs text-ink-500">
        {hint ?? 'JPG, PNG or WEBP · resized automatically for fast loading'}
      </span>
    </button>
  );

  return (
    <div>
      {label && <span className="sh-field-label">{label}</span>}

      <input
        ref={input} type="file" accept={ACCEPTED.join(',')} multiple={multiple}
        className="hidden" onChange={(e) => void handleFiles(e.target.files)}
      />

      {multiple ? (
        <div className="space-y-3">
          {(images?.length ?? 0) > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images!.map((img, i) => (
                <li key={img.path} className={`relative overflow-hidden rounded-xl border border-ink-200 ${aspectClass}`}>
                  <img src={img.url} alt={img.name} className="h-full w-full object-cover" loading="lazy" />
                  {i === 0 && (
                    <span className="absolute left-1 top-1 rounded-md bg-ink-950/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      Main
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      void removeFile(bucket, img.path).catch(() => {});
                      onImagesChange?.(images!.filter((_, idx) => idx !== i));
                    }}
                    className="absolute right-1 top-1 rounded-lg bg-white/90 p-1 text-red-600 shadow"
                    aria-label={`Remove ${img.name}`}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(images?.length ?? 0) < max && drop}
        </div>
      ) : value?.url ? (
        <div className="flex items-start gap-3">
          <div className={`relative w-28 shrink-0 overflow-hidden rounded-xl border border-ink-200 ${aspectClass}`}>
            <img src={value.url} alt={value.name} className="h-full w-full object-cover" />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center bg-white/70">
                <Spinner size={20} className="text-brand-600" />
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Button type="button" variant="outline" size="sm" icon="refresh" disabled={disabled || busy}
              onClick={() => input.current?.click()}>
              Replace
            </Button>
            <Button type="button" variant="ghost" size="sm" icon="trash" className="text-red-600" disabled={disabled || busy}
              onClick={() => {
                void removeFile(bucket, value.path).catch(() => {});
                onChange?.(null);
              }}>
              Remove
            </Button>
          </div>
        </div>
      ) : drop}

      {error && <p className="sh-error-text">{error}</p>}
    </div>
  );
}

/** Simple avatar picker used on the profile and business screens. */
export function AvatarUploader({ bucket = BUCKETS.avatars, scope, value, onChange, size = 96, rounded = 'full', label }: {
  bucket?: Bucket; scope: string; value?: UploadedImage | null; onChange: (img: UploadedImage | null) => void;
  size?: number; rounded?: 'full' | 'xl'; label?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const pick = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file || !user) return;
    setBusy(true);
    try {
      const resized = await downscaleImage(file, 640, 0.9);
      const res = await uploadFile(bucket, storagePath(scope, user.id.slice(0, 8), resized.name), resized,
        { contentType: resized.type });
      if (res.url) onChange({ url: res.url, path: res.path, name: file.name, size: resized.size });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={`relative overflow-hidden border border-ink-200 bg-ink-100 ${rounded === 'full' ? 'rounded-full' : 'rounded-2xl'}`}
        style={{ width: size, height: size }}
        aria-label={label ? undefined : 'Change image'}
      >
        {value?.url
          ? <img src={value.url} alt="" className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-ink-400"><Icon name="camera" size={size / 3.4} /></span>}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Spinner size={20} className="text-brand-600" />
          </span>
        )}
      </button>
      <div className="min-w-0">
        {label && <div className="text-sm font-semibold text-ink-800">{label}</div>}
        <input ref={input} type="file" accept={ACCEPTED.join(',')} className="hidden"
          onChange={(e) => void pick(e.target.files)} />
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className="text-sm font-semibold text-brand-700 hover:underline">
          {value?.url ? 'Change photo' : 'Upload photo'}
        </button>
        {value?.url && (
          <button type="button" onClick={() => onChange(null)} disabled={busy}
            className="ml-3 text-sm font-medium text-ink-500 hover:text-red-600">
            Remove
          </button>
        )}
        <p className="mt-0.5 text-xs text-ink-500">Square works best. Resized automatically.</p>
      </div>
    </div>
  );
}
