import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleRSS(targetUrl) {
    try {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error('Target responded with ' + res.status);
        const xml = await res.text();

        // Very lightweight Regex-based RSS parser to avoid heavy XML dependencies
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;

        while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
            const itemXml = match[1];

            const getTag = (tag) => {
                const tMatch = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\/${tag}>`).exec(itemXml);
                // Clean out CDATA tags
                return tMatch ? tMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
            };

            let image = null;
            // 1. Try media:content
            const mediaMatch = /<media:content[^>]+url="([^"]+)"/i.exec(itemXml);
            if (mediaMatch) image = mediaMatch[1];

            // 2. Try enclosure
            if (!image) {
                const encMatch = /<enclosure[^>]+url="([^"]+)"[^>]+type="image\//i.exec(itemXml);
                if (encMatch) image = encMatch[1];
            }

            // 3. Try parsing an img tag from description
            const desc = getTag('description');
            if (!image && desc) {
                const imgMatch = /<img[^>]+src=["']([^"']+)["']/i.exec(desc);
                if (imgMatch) image = imgMatch[1];
            }

            items.push({
                title: getTag('title') || 'No Title',
                link: getTag('link') || targetUrl,
                published: getTag('pubDate') || new Date().toISOString(),
                summary: desc.replace(/<[^>]+>/g, '').substring(0, 200),
                image: image ? { url: image } : null
            });
        }

        return new Response(JSON.stringify({ items }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
}

async function handleArticle(targetUrl) {
    try {
        const res = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

        // Convert to text and remove scripts/styles before parsing to save memory
        let html = await res.text();
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

        // Parse using linkedom parseHTML (returns {document} compatible with Readability)
        const { document } = parseHTML(html);

        // Run Readability
        const reader = new Readability(document);
        const article = reader.parse();

        if (!article) throw new Error('Readability could not parse the content.');

        return new Response(JSON.stringify(article), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}

export default {
    async fetch(request, env, ctx) {
        // 1. CORS Preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // 2. Health check
        if (path === "/health") {
            return new Response(JSON.stringify({ status: "ok" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
        }

        try {
            const { url: targetUrl } = await request.json();
            if (!targetUrl) throw new Error("Missing url parameter");

            // Route /top and /article
            if (path === "/top") return handleRSS(targetUrl);
            if (path === "/article") return handleArticle(targetUrl);

            return new Response("Not Found", { status: 404, headers: corsHeaders });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }
    },
};
