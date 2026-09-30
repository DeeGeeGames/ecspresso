import { resolve } from 'node:path';

const directory = resolve(import.meta.dir, '../docs');
const port = Number(process.env['DOCS_PORT'] ?? 3220);
const server = Bun.serve({
	port, hostname: '0.0.0.0',
	async fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname);
		if (path === '/') return Response.redirect('/ecspresso/');
		if (!path.startsWith('/ecspresso/')) return new Response('Not found', { status: 404 });
		const relative = path.slice('/ecspresso/'.length);
		const filePath = resolve(directory, relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative);
		if (!filePath.startsWith(`${directory}/`)) return new Response('Not found', { status: 404 });
		const file = Bun.file(filePath);
		if (!await file.exists()) return new Response('Not found', { status: 404 });
		return new Response(file);
	},
});
console.log(`Documentation preview: http://localhost:${server.port}/ecspresso/`);
