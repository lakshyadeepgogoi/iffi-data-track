import { useState } from 'react';
import { useDesk } from './state/DeskContext.jsx';
import { MODE } from './lib/api.js';
import { DEFAULT_FILTERS } from './lib/guests.js';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import TabBar from './components/TabBar.jsx';
import Dashboard from './components/Dashboard.jsx';
import GuestList from './components/GuestList.jsx';
import GuestSheet from './components/GuestSheet.jsx';
import Activity from './components/Activity.jsx';
import HandOver from './components/HandOver.jsx';
import Toast from './components/Toast.jsx';
import { Spinner } from './components/ui.jsx';

export default function App() {
  const { phase } = useDesk();
  const [view, setView] = useState('home');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [openKey, setOpenKey] = useState(null);

  if (phase === 'login') return <><Login /><Toast /></>;
  if (phase === 'booting') return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;

  const go = (v) => { setView(v); window.scrollTo(0, 0); };
  const showGuests = (patch) => { setFilters({ ...DEFAULT_FILTERS, ...patch }); go('guests'); };

  return (
    <div className="min-h-dvh">
      {MODE === 'demo' && (
        <div className="bg-gold px-2 py-1 text-center text-xs font-bold text-[#2a1d00]">
          DEMO MODE — fake data · PIN 2026 · a simulated colleague makes changes every few seconds
        </div>
      )}
      <Header view={view} onChange={go} />
      <main className="mx-auto max-w-3xl px-3 pt-3 pb-32 lg:max-w-6xl lg:px-6 lg:pt-5 lg:pb-12">
        {view === 'home' && <Dashboard onFilter={showGuests} />}
        {view === 'guests' && <GuestList filters={filters} setFilters={setFilters} onOpen={setOpenKey} />}
        {view === 'hand' && <HandOver onOpen={setOpenKey} />}
        {view === 'log' && <Activity onOpen={setOpenKey} />}
      </main>
      <TabBar view={view} onChange={go} />
      <GuestSheet guestKey={openKey} onClose={() => setOpenKey(null)} />
      <Toast />
    </div>
  );
}
