import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import './run.css';

const host = document.getElementById('root');
if (host === null) {
  throw new Error('index.html is missing its #root element');
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
