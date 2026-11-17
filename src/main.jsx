import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { DeskProvider } from './state/DeskContext.jsx';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Only the normal production build runs on Vercel; skip it for the Apps Script
// single-file build, e2e tests and local dev (no /_vercel endpoint there).
const onVercel = import.meta.env.MODE === 'production';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DeskProvider>
      <App />
    </DeskProvider>
    {onVercel && <SpeedInsights />}
  </StrictMode>,
);
