import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Toast from './components/Toast.jsx';
import Home from './pages/Home.jsx';
import Upload from './pages/Upload.jsx';
import Watch from './pages/Watch.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Toast />
      <div className="min-h-screen bg-[#F8FAFC] text-slate-800">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/watch/:id" element={<Watch />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
