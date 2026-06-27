import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './sprites.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <>
      <App />
    <footer className="sprite-attribution-footer">
      <strong>Sprite attribution.</strong> Ragnarok Online graphics and materials are copyright © Gravity Co., Ltd. &amp; Lee Myoungjin. Some Ragnarok-related graphics are copyright © GungHo Online Entertainment, Inc. Monster sprite references are sourced from <a href="https://nn.ai4rei.net/dev/npclist/" target="_blank" rel="noreferrer">nn.ai4rei.net</a>. Zenymob2 is not affiliated with, endorsed by, or authorized by Gravity, GungHo, or Ai4rei.
    </footer>
    </>
  </React.StrictMode>,
);
