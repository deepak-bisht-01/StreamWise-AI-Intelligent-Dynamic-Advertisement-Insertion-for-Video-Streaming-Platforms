import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Toast from './components/Toast.jsx';
import Upload from './pages/Upload.jsx';
import Watch from './pages/Watch.jsx';
import Account from './pages/Account.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import BrandManager from './pages/BrandManager.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import ViewerDashboard from './pages/ViewerDashboard.jsx';
import AdvertiserPortal from './pages/AdvertiserPortal.jsx';
import AdminAdvertiserRequests from './pages/AdminAdvertiserRequests.jsx';
import BrandReceipt from './pages/BrandReceipt.jsx';
import { useAuth } from './contexts/AuthContext.jsx';

function DashboardRedirect() {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="px-4 py-16 text-center text-slate-500">Loading your dashboard…</div>;
  if (!user) return <Navigate to="/account" replace />;
  return <Navigate to={profile?.role === 'admin' ? '/admin' : '/dashboard'} replace />;
}

function RoleRoute({ role, children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="px-4 py-16 text-center text-slate-500">Checking your access…</div>;
  if (!user) return <Navigate to="/account" replace />;
  if (role && profile?.role !== role) return <Navigate to={profile?.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  return children;
}

function SignedInRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="px-4 py-16 text-center text-slate-500">Checking your session…</div>;
  return user ? children : <Navigate to="/account" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toast />
        <div className="app-theme min-h-screen bg-slate-950 text-slate-100">
          <Navbar />
          <main>
            <Routes>
              <Route path="/" element={<DashboardRedirect />} />
              <Route path="/dashboard" element={<RoleRoute role="user"><ViewerDashboard /></RoleRoute>} />
              <Route path="/admin" element={<RoleRoute role="admin"><AdminDashboard /></RoleRoute>} />
              <Route path="/upload" element={<SignedInRoute><Upload /></SignedInRoute>} />
              <Route path="/watch/:id" element={<SignedInRoute><Watch /></SignedInRoute>} />
              <Route path="/account" element={<Account />} />
              <Route path="/brands" element={<RoleRoute role="admin"><BrandManager /></RoleRoute>} />
              <Route path="/advertise" element={<SignedInRoute><AdvertiserPortal /></SignedInRoute>} />
              <Route path="/admin/advertiser-requests" element={<RoleRoute role="admin"><AdminAdvertiserRequests /></RoleRoute>} />
              <Route path="/advertiser-receipt/:id" element={<SignedInRoute><BrandReceipt /></SignedInRoute>} />
              <Route path="*" element={<DashboardRedirect />} />
            </Routes>
          </main>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
