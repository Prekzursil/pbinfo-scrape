import React from 'react';
import ReactDOM from 'react-dom/client';

import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';

import { App } from './app.js';
import './styles.css';
import './library-shell/theme/global.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Desktop renderer root element was not found.');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
