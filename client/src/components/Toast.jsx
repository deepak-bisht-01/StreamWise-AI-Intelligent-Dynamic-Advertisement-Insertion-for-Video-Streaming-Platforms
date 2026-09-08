import { Toaster } from 'react-hot-toast';

export default function Toast() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          borderRadius: '16px',
          background: '#ffffff',
          color: '#0f172a',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #E2E8F0',
          fontFamily: 'Inter, sans-serif',
          padding: '16px',
          fontSize: '14px',
          fontWeight: '500',
        },
        success: {
          iconTheme: { 
            primary: '#10B981', 
            secondary: '#ffffff' 
          },
          style: {
            borderLeft: '4px solid #10B981',
          },
        },
        error: {
          iconTheme: { 
            primary: '#EF4444', 
            secondary: '#ffffff' 
          },
          style: {
            borderLeft: '4px solid #EF4444',
          },
        },
        loading: {
          iconTheme: { 
            primary: '#6366F1', 
            secondary: '#ffffff' 
          },
        },
      }}
      containerStyle={{
        top: 24,
        right: 24,
        left: 24,
      }}
    />
  );
}
