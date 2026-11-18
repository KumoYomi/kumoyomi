import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/src/app/App';
import { applyThemeToDocument, readCachedTheme } from '@/src/core/theme/theme';
import './style.css';

const initialTheme = readCachedTheme();
applyThemeToDocument(initialTheme.themeMode, initialTheme.accentColor);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
