import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { DocumentPage } from './pages/DocumentPage';
import ClientLogSearch from './pages/ClientLogSearch';
import PortfolioUrls from './pages/PortfolioUrls';
import PortfolioUrlsALL from './pages/PortfolioUrlsALL';
import BOApplicationPage from './pages/BOApplicationPage';
import BoPage from './pages/BoPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <nav className="app-nav">
          <NavLink to="/logs" className={({ isActive }) => (isActive ? 'active' : '')}>
            Access Logs
          </NavLink>
          <NavLink to="/urls" className={({ isActive }) => (isActive ? 'active' : '')}>
            Portfolio URLs
          </NavLink>
          {/* <NavLink to="/document" className={({ isActive }) => (isActive ? 'active' : '')}>
            Document
          </NavLink> */}

          <NavLink to="/ALL-urls" className={({ isActive }) => (isActive ? 'active' : '')}>
            ALL URLs
          </NavLink>

          <NavLink to="/bo" className={({ isActive }) => (isActive ? 'active' : '')}>
            BO
          </NavLink>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/logs" replace />} />
          <Route path="/logs" element={<ClientLogSearch />} />
          <Route path="/urls" element={<PortfolioUrls />} />
          <Route path="/bo" element={<BoPage />} />
          <Route path="/ALL-urls" element={<PortfolioUrlsALL />} />
          <Route path="/document" element={<DocumentPage />} />
          <Route path="/BOApplicationPage/:id" element={<BOApplicationPage />} />
          <Route path="*" element={<Navigate to="/logs" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;