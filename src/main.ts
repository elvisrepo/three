import './style.css';
import { Game } from './core/Game';

const container = document.getElementById('game-container');
if (!container) {
  throw new Error('#game-container missing in index.html');
}

// eslint-disable-next-line no-new
new Game(container);

console.log('%c3jsgame prototype ready — left-click to move, WASD also works', 'color:#ffd479');
