import '../ui/styles/theme.css';
import { mount } from 'svelte';
import WhatsNew from './WhatsNew.svelte';

const target = document.getElementById('app')!;
const app = mount(WhatsNew, { target });

export default app;
