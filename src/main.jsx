import React, {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import template from './template.js';
import '../styles.css';
import {initCircuitLab} from '../app.js';

function App(){
  useEffect(()=>{
    // The interaction layer is intentionally isolated from the visual shell so the
    // simulation engine can later replace these DOM adapters without redesigning UI.
    initCircuitLab();
    window.dispatchEvent(new Event('circuitlab:ready'));
  },[]);
  return <div dangerouslySetInnerHTML={{__html: template}} />;
}
createRoot(document.getElementById('root')).render(<App />);
