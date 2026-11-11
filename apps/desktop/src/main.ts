import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { mendClipboard } from './lib/clipboard';
import { core } from './lib/core';

mendClipboard(navigator.clipboard, core.copyText);

mount(App, { target: document.getElementById('app')! });
