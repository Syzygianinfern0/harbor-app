import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import type { HarborApi } from '../shared/types';
declare global { interface Window { harbor: HarborApi } }
createRoot(document.getElementById('root')!).render(<App />);
