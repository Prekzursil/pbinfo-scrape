import React from 'react';
import ReactDOM from 'react-dom/client';

// Fonts (400 + 600) are loaded here so React hydration kicks off immediately;
// 700 + latin subsets are loaded from library-shell/theme/global.css.
// Sora was only used by the retired legacy Home hero — no library-shell
// component references it.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';

import { App } from './app.js';
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
