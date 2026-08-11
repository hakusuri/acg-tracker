import { useEffect, useState } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import WorkForm from './components/WorkForm';
import { backupDatabase, toAssetUrl } from './lib/api';
import { setSetting } from './lib/db';
import { onRequestAddWork } from './lib/events';
import { SettingsProvider, useSettings } from './lib/settings';
import CalendarPage from './pages/CalendarPage';
import DetailPage from './pages/DetailPage';
import HomePage from './pages/HomePage';
import ImportPage from './pages/ImportPage';
import SettingsPage from './pages/SettingsPage';
import StatsPage from './pages/StatsPage';
import TimelinePage from './pages/TimelinePage';

function TopBar() {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => onRequestAddWork(() => setAddOpen(true)), []);

  const handleSaved = (id: number) => {
    setAddOpen(false);
    navigate(`/work/${id}`);
  };

  return (
    <>
      <header className="topbar glass">
        <div className="brand" onClick={() => navigate('/')} role="button" tabIndex={0}>
          <span className="brand-logo">◆</span>
          <span className="brand-name">ACG 记录</span>
        </div>
        <nav className="nav-links">
          <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            首页
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            日历
          </NavLink>
          <NavLink to="/activity" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            动态
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            统计
          </NavLink>
          <NavLink to="/import" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            导入
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            设置
          </NavLink>
        </nav>
      </header>
      <WorkForm open={addOpen} onClose={() => setAddOpen(false)} onSaved={handleSaved} />
    </>
  );
}

function AppInner() {
  const { settings, loaded } = useSettings();
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    void (async () => {
      if (settings.autoBackup && settings.backupCount > 0) {
        try {
          await backupDatabase(settings.backupCount, settings.dataDir);
          await setSetting('last_backup_at', new Date().toISOString());
        } catch (e) {
          console.error('自动备份失败', e);
        }
      }
      setAppReady(true);
    })();
  }, [loaded, settings.autoBackup, settings.backupCount]);

  if (!appReady) {
    return <div className="loading">正在加载设置…</div>;
  }

  return (
    <div className="app-shell">
      <div className={`bg ${settings.backgroundImage ? 'has-bg' : ''}`} aria-hidden="true">
        {settings.backgroundImage && (
          <img
            className="bg-image"
            src={/^https?:\/\//i.test(settings.backgroundImage) ? settings.backgroundImage : toAssetUrl(settings.backgroundImage)}
            alt=""
          />
        )}
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>
      <TopBar />
      <main className="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/work/:id" element={<DetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/activity" element={<TimelinePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <AppInner />
      </HashRouter>
    </SettingsProvider>
  );
}