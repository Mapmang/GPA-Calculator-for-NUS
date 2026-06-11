import { NUS } from './nus-api.js';

const statusEl = document.getElementById('api-status');
const button = document.getElementById('check-api');

button.addEventListener('click', async () => {
    statusEl.textContent = 'Checking NUSMods API...';

    try {
        const result = await NUS.init();
        statusEl.textContent = result.enabled
            ? 'Shared NUSMods cache backend reachable.'
            : 'Shared cache backend not reachable. Run python server.py and open http://localhost:8000.';
    } catch (_) {
        statusEl.textContent = 'Failed to probe the NUSMods API.';
    }
});
