import { useEffect, useState } from 'react';
import App from './App.jsx';
import Scenarios2035 from './Scenarios2035.jsx';
import Footer from './components/Footer.jsx';
import DataTab from './DataTab.jsx';
import './Scenarios2035.css';

const TABS = [
  ['explorer', 'PFC explorer'],
  ['scenarios', 'Scenarios 2035 (ML)'],
  ['whatif', 'What if?'],
  ['quality', 'Model quality'],
  ['data', 'Data'],
];
const fromHash = () => {
  const h = window.location.hash.replace('#', '');
  return TABS.some(([id]) => id === h) ? h : 'explorer';
};

export default function Root() {
  const [tab, setTab] = useState(fromHash);
  useEffect(() => { window.history.replaceState(null, '', `#${tab}`); }, [tab]);
  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <>
      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {/* one Scenarios2035 instance for the three ML tabs keeps data, selection and what-if state when switching */}
      {tab === 'explorer' ? <App /> : tab === 'data' ? <DataTab /> : <Scenarios2035 view={tab} />}
      <Footer />
    </>
  );
}
