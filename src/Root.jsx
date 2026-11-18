import { useEffect, useState } from 'react';
import App from './App.jsx';
import Scenarios2035 from './Scenarios2035.jsx';
import './Scenarios2035.css';

const TABS = [
  ['explorer', 'PFC explorer'],
  ['scenarios', 'Scenarios 2035 (ML)'],
];

export default function Root() {
  const [tab, setTab] = useState(() => (window.location.hash === '#scenarios' ? 'scenarios' : 'explorer'));
  useEffect(() => { window.history.replaceState(null, '', `#${tab}`); }, [tab]);
  return (
    <>
      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === 'explorer' ? <App /> : <Scenarios2035 />}
    </>
  );
}
