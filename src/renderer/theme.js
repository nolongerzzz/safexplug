'use strict';
// Applied before the page paints, so a forced Dark or Light choice never flashes the other one. "Auto" (nothing saved) follows the computer.
(function () { try { var t = localStorage.getItem('sw-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {} })();
