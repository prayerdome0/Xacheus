import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './index.css';

/**
 * Seedwel Hub entry point.
 *
 * The router sits outside <App/> so every screen — including the public
 * document and payment pages a customer opens from WhatsApp — can read the URL
 * without prop drilling.
 *
 * StrictMode double-invokes effects in development. Every data hook in this app
 * is written to survive that: queries are cancellable and mutations are guarded
 * by a `let alive = true` flag, so a double mount never creates a second order.
 */
const container = document.getElementById('root');

if (!container) {
  throw new Error('Seedwel Hub could not start: #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
