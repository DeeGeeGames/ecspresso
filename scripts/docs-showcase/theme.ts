function applyTheme(value: string) {
	document.documentElement.dataset['theme'] = value;
	const toggle = document.getElementById('theme-toggle');
	if (toggle) toggle.textContent = value === 'dark' ? 'Light mode' : 'Dark mode';
	window.dispatchEvent(new CustomEvent('showcase-theme', { detail: value }));
}
export function initializeTheme() {
	try {
		const stored = localStorage.getItem('ecspresso-theme');
		const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		applyTheme(stored === 'light' || stored === 'dark' ? stored : system);
	} catch { applyTheme('light'); }
	document.getElementById('theme-toggle')?.addEventListener('click', function () {
		const value = document.documentElement.dataset['theme'] === 'dark' ? 'light' : 'dark';
		applyTheme(value);
		try { localStorage.setItem('ecspresso-theme', value); } catch { /* Storage can be disabled. */ }
	});
}
