import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/noto-sans-bengali/wght.css';
import {createRoot} from 'react-dom/client';
import {lazy,Suspense} from 'react';
import {Capacitor} from '@capacitor/core';
import App from './App.tsx';
import './index.css';
import { AppUpdateNotice } from './components/AppUpdateNotice';
import { captureAccountCallback } from './auth/cloud/callbackLocation';
import { initializeMobileAppearance } from './appearance/mobileAppearance';
import { consumeAdminReturn } from './access/adminReturn';

initializeMobileAppearance();
const callbackCaptured=captureAccountCallback();
if(!Capacitor.isNativePlatform()&&consumeAdminReturn(callbackCaptured))window.history.replaceState(null,'','/admin');
const WebAdmin=lazy(()=>import('./components/WebAdminPage'));
const adminRoute=!Capacitor.isNativePlatform()&&location.pathname==='/admin';
createRoot(document.getElementById('root')!).render(adminRoute?<Suspense fallback={<p role="status" className="p-6">অ্যাডমিন পেজ খোলা হচ্ছে…</p>}><WebAdmin/></Suspense>:<><App /><AppUpdateNotice /></>);
