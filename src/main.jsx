import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { DeskProvider } from './state/DeskContext.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DeskProvider>
      <App />
    </DeskProvider>
  </StrictMode>,
);
