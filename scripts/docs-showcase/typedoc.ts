const script = document.currentScript;
if (script instanceof HTMLScriptElement) {
	const home = new URL('../../', script.src);
	const title = document.querySelector('.tsd-page-toolbar .title');
	if (title instanceof HTMLAnchorElement) {
		title.href = home.href;
		title.textContent = 'ECSpresso';
		title.setAttribute('aria-label', 'ECSpresso documentation home');
	}
	const toolbar = document.querySelector('.tsd-toolbar-contents');
	const link = document.createElement('a');
	link.className = 'docs-home'; link.href = home.href; link.textContent = 'Play & learn';
	toolbar?.append(link);
	try {
		const theme = localStorage.getItem('ecspresso-theme');
		if (theme === 'light' || theme === 'dark') document.documentElement.dataset['theme'] = theme;
	} catch { /* Storage is optional. */ }
}
