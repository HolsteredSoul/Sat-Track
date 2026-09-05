import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const site = new URL(process.argv[2]);
const builtHTML = await readFile(new URL('../../dist/index.html', import.meta.url), 'utf8');
const modules = [...builtHTML.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map((match) => match[1])
    .filter((src) => src.includes('/assets/') && src.endsWith('.js'));
if (!modules.length) throw new Error('The local build contains no bundled entry point');

// Pages/CDN propagation can briefly return the preceding deployment.
let failure;
for (let attempt = 0; attempt < 6; attempt++) {
    try {
        const url = new URL(site);
        url.searchParams.set('deployment-check', `${process.env.GITHUB_SHA || 'local'}-${attempt}`);
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Published HTML: HTTP ${response.status}`);
        const html = await response.text();
        if (html.includes('src="src/main.js"') || modules.some((src) => !html.includes(src))) {
            throw new Error(
                'Pages is not serving the expected Vite build. Check Pages source is GitHub Actions.'
            );
        }
        for (const src of modules) {
            const asset = await fetch(new URL(src, site), { signal: AbortSignal.timeout(10000) });
            if (!asset.ok || !/javascript/.test(asset.headers.get('content-type') || '')) {
                throw new Error(`Published JavaScript is unavailable: ${src}`);
            }
            await asset.arrayBuffer();
        }
        console.log(`Verified published Vite entry point at ${site}`);
        failure = null;
        break;
    } catch (error) {
        failure = error;
        if (attempt < 5) await setTimeout(5000);
    }
}
if (failure) throw failure;
