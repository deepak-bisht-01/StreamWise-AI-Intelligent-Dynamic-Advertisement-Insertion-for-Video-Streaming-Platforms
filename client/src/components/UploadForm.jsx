import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { HiOutlinePhoto, HiOutlineVideoCamera, HiOutlineCloudArrowUp, HiOutlineCheck, HiOutlineXMark } from 'react-icons/hi2';
import { getErrorMessage, uploadVideo } from '../services/api.js';
import { formatBytes } from '../utils/format.js';
import Button from './Button.jsx';
import Input from './Input.jsx';
import ProgressBar from './ProgressBar.jsx';
import Textarea from './Textarea.jsx';

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function hasAllowedExtension(file, extensions) {
  const name = file.name.toLowerCase();
  return extensions.some((extension) => name.endsWith(extension));
}

function FileDrop({
  label,
  hint,
  accept,
  file,
  preview,
  icon: Icon,
  onFile,
  onRemove,
}) {
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(files) {
    const nextFile = files?.[0];
    if (nextFile) {
      onFile(nextFile);
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      className={`relative rounded-2xl border-2 border-dashed p-6 transition-all duration-300 ${
        isDragging 
          ? 'border-primary bg-primary/5 scale-[1.02]' 
          : file 
            ? 'border-emerald-300 bg-emerald-50/50' 
            : 'border-slate-200 bg-slate-50 hover:border-primary/50 hover:bg-slate-100'
      }`}
    >
      {file && (
        <button
          type="button"
          onClick={() => onRemove()}
          className="absolute top-3 right-3 p-2 rounded-lg bg-white/80 backdrop-blur-sm hover:bg-white text-slate-500 hover:text-rose-500 transition-colors shadow-sm"
        >
          <HiOutlineXMark className="h-4 w-4" />
        </button>
      )}
      
      <label className="flex cursor-pointer flex-col items-center gap-4 text-center">
        {preview ? (
          <div className="relative">
            <img src={preview} alt={label} className="h-32 w-full rounded-xl object-cover shadow-md" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl opacity-0 hover:opacity-100 transition-opacity">
              <span className="text-white text-sm font-medium">Change image</span>
            </div>
          </div>
        ) : file ? (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
            <HiOutlineCheck className="h-8 w-8" />
          </div>
        ) : (
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${isDragging ? 'bg-primary text-white' : 'bg-white text-primary'} shadow-sm transition-colors`}>
            <Icon className="h-8 w-8" />
          </div>
        )}
        
        <div className="space-y-1">
          <span className={`block text-sm font-semibold ${file ? 'text-emerald-700' : 'text-slate-800'}`}>
            {file ? 'File selected' : label}
          </span>
          <span className="block text-xs text-slate-500">{hint}</span>
        </div>
        
        {file ? (
          <div className="space-y-1">
            <span className="text-xs font-medium text-emerald-600 truncate max-w-full block">
              {file.name}
            </span>
            <span className="text-xs text-slate-500">
              {formatBytes(file.size)}
            </span>
          </div>
        ) : null}
        
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </label>
    </div>
  );
}

const initialForm = {
  title: '',
  description: '',
  video: null,
  thumbnail: null,
};

export default function UploadForm() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const thumbnailPreview = useMemo(() => {
    if (!form.thumbnail) {
      return '';
    }
    return URL.createObjectURL(form.thumbnail);
  }, [form.thumbnail]);

  useEffect(() => {
    return () => {
      if (thumbnailPreview) {
        URL.revokeObjectURL(thumbnailPreview);
      }
    };
  }, [thumbnailPreview]);

  function validate() {
    const nextErrors = {};

    if (form.title.trim().length < 3) {
      nextErrors.title = 'Title must be at least 3 characters';
    }
    if (form.description.trim().length < 10) {
      nextErrors.description = 'Description must be at least 10 characters';
    }
    if (!form.video) {
      nextErrors.video = 'A video file is required';
    } else if (
      !VIDEO_TYPES.includes(form.video.type) &&
      !hasAllowedExtension(form.video, VIDEO_EXTENSIONS)
    ) {
      nextErrors.video = 'Use mp4, mov, avi, or mkv';
    } else if (form.video.size > MAX_VIDEO_BYTES) {
      nextErrors.video = 'Video cannot exceed 500MB';
    }
    if (!form.thumbnail) {
      nextErrors.thumbnail = 'A thumbnail is required';
    } else if (
      !IMAGE_TYPES.includes(form.thumbnail.type) &&
      !hasAllowedExtension(form.thumbnail, IMAGE_EXTENSIONS)
    ) {
      nextErrors.thumbnail = 'Use jpg, jpeg, png, or webp';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    setIsSubmitting(true);
    setProgress(1);

    try {
      const video = await uploadVideo({
        title: form.title.trim(),
        description: form.description.trim(),
        video: form.video,
        thumbnail: form.thumbnail,
        onProgress: setProgress,
      });
      toast.success('Video published to the library');
      navigate(`/watch/${video.id}`);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setProgress(0);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-6">
        <Input
          id="title"
          label="Title"
          placeholder="Studio lighting walkthrough"
          value={form.title}
          onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          error={errors.title}
          hint="3-120 characters"
          required
        />
        <Textarea
          id="description"
          label="Description"
          placeholder="Summarize what this recording covers and who it is for."
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          error={errors.description}
          hint="10-2000 characters"
          rows={4}
          required
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <FileDrop
            label="Drop video here"
            hint="mp4, mov, avi, mkv · max 500MB"
            accept=".mp4,.mov,.avi,.mkv,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska"
            file={form.video}
            icon={HiOutlineVideoCamera}
            onFile={(video) => setForm((current) => ({ ...current, video }))}
            onRemove={() => setForm((current) => ({ ...current, video: null }))}
          />
          {errors.video ? <p className="text-sm text-rose-500 px-1">{errors.video}</p> : null}
        </div>
        <div className="space-y-2">
          <FileDrop
            label="Drop thumbnail here"
            hint="jpg, jpeg, png, webp"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            file={form.thumbnail}
            preview={thumbnailPreview}
            icon={HiOutlinePhoto}
            onFile={(thumbnail) => setForm((current) => ({ ...current, thumbnail }))}
            onRemove={() => setForm((current) => ({ ...current, thumbnail: null }))}
          />
          {errors.thumbnail ? <p className="text-sm text-rose-500 px-1">{errors.thumbnail}</p> : null}
        </div>
      </div>

      {isSubmitting ? (
        <div className="space-y-4">
          <ProgressBar value={progress} />
          <p className="text-center text-sm text-slate-500">
            Please don't close this window while uploading...
          </p>
        </div>
      ) : null}

      <Button 
        type="submit" 
        variant="gradient" 
        size="lg" 
        className="w-full py-4"
        disabled={isSubmitting}
      >
        <HiOutlineCloudArrowUp className="h-5 w-5" />
        {isSubmitting ? 'Publishing...' : 'Publish to library'}
      </Button>
    </form>
  );
}
