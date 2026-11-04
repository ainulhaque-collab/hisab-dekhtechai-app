import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/noto-sans-bengali/wght.css';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AppUpdateNotice } from './components/AppUpdateNotice';
import { captureAccountCallback } from './auth/cloud/callbackLocation';

captureAccountCallback();
createRoot(document.getElementById('root')!).render(<><App /><AppUpdateNotice /></>);
