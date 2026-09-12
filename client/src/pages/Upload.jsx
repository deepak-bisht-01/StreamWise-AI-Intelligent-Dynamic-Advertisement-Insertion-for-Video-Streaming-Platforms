import UploadForm from '../components/UploadForm.jsx';

export default function Upload() {
  return (
    <div className="hero-glow min-h-screen py-12">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 text-center animate-fade-in">
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.3em] text-emerald-500">Upload</p>
          <h1 className="mt-2 text-4xl font-extrabold text-slate-900 sm:text-5xl">
            Upload Your Video
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-lg text-slate-600">
            Upload your video to StreamWise AI. The system will automatically analyze the content, detect advertisement spaces, replace them with intelligent advertisements, and prepare the processed video for streaming.
          </p>
        </div>
        <div className="card-shadow-elevated rounded-2xl border border-slate-100 bg-white p-8 sm:p-10 animate-scale-in">
          <UploadForm />
        </div>
      </div>
    </div>
  );
}
