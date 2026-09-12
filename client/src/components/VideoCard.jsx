import { Link } from 'react-router-dom';
import { HiOutlineCalendarDays, HiOutlineClock, HiOutlineServer, HiOutlinePlay } from 'react-icons/hi2';
import { formatBytes, formatDate, formatDuration } from '../utils/format.js';

export default function VideoCard({ video }) {
  return (
    <Link
      to={`/watch/${video.id}`}
      className="card-shadow group block overflow-hidden rounded-2xl border border-slate-100 bg-white transition-all duration-300 hover:-translate-y-2 hover:shadow-xl"
    >
      <div className="relative aspect-video overflow-hidden bg-slate-100">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-lg transform scale-0 group-hover:scale-100 transition-transform duration-300">
            <HiOutlinePlay className="h-6 w-6 text-emerald-500 ml-1" />
          </div>
        </div>
        <span className="absolute bottom-3 right-3 rounded-lg bg-slate-950/90 backdrop-blur-sm px-2.5 py-1 text-xs font-semibold text-white shadow-lg">
          {formatDuration(video.duration)}
        </span>
      </div>
      <div className="space-y-3 p-5">
        <h3 className="line-clamp-2 text-base font-semibold text-slate-900 group-hover:text-emerald-500 transition-colors duration-200">
          {video.title}
        </h3>
        <p className="text-xs text-slate-500 font-medium">StreamWise AI</p>
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50">
            <HiOutlineCalendarDays className="h-3.5 w-3.5" />
            {formatDate(video.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50">
            <HiOutlineServer className="h-3.5 w-3.5" />
            {formatBytes(video.fileSize)}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50">
            <HiOutlineClock className="h-3.5 w-3.5" />
            {formatDuration(video.duration)}
          </span>
        </div>
      </div>
    </Link>
  );
}
