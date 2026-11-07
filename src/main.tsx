// import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import "./index.css";
import { registerAllAdapters } from "./lib/channels";

// Register channel adapters so the UI knows which channels are available.
registerAllAdapters();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>
);
