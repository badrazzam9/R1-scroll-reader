import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { JSDOM } from "https://esm.sh/jsdom@22.1.0";
import { Readability } from "https://esm.sh/@mozilla/readability@0.5.0";
import { parseFeed } from "https://deno.land/x/rss@0.5.8/mod.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req) => {
    // Handle CORS Pre-flight checks from browsers
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const path = url.pathname;

        // 1. Health Check for the Frontend Boot
        if (path === "/health") {
            return new Response(JSON.stringify({ status: "ok" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (req.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
        }

        // Both /top and /article require a JSON body with a URL
        const { url: targetUrl } = await req.json();

        if (!targetUrl) {
            return new Response(JSON.stringify({ error: "Missing url parameter" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 2. Fetching and Parsing RSS Feeds (Top Headlines)
        if (path === "/top") {
            console.log("Fetching RSS:", targetUrl);
            const res = await fetch(targetUrl);
            if (!res.ok) throw new Error("Failed to fetch RSS: " + res.statusText);

            const xml = await res.text();
            const feed = await parseFeed(xml);

            const items = feed.entries.slice(0, 20).map(entry => {
                let image = null;

                // Try to find image in enclosures or media extensions
                const media = entry.attachments?.find(a => a.mimeType?.startsWith("image/"));
                if (media) image = media.url;

                // Fallback: Check if there's an image embedded in the HTML description
                if (!image && entry.description?.value) {
                    const match = entry.description.value.match(/<img[^>]+src="([^">]+)"/);
                    if (match) image = match[1];
                }

                return {
                    title: entry.title?.value || "No Title",
                    link: entry.links[0]?.href || targetUrl,
                    published: entry.published || new Date(),
                    summary: entry.description?.value?.replace(/<[^>]+>/g, '')?.substring(0, 200) || "",
                    image: image ? { url: image } : null
                };
            });

            return new Response(JSON.stringify({ items }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 3. Fetching and Extracting Article Content using Mozilla Readability
        if (path === "/article") {
            console.log("Fetching Article:", targetUrl);
            // Pretend to be a normal browser to avoid simple blocks
            const res = await fetch(targetUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
            });
            if (!res.ok) throw new Error("Failed to fetch article: " + res.statusText);
            const html = await res.text();

            // Readability requires a DOM environment (JSDOM provides this in Deno)
            const doc = new JSDOM(html, { url: targetUrl });
            const reader = new Readability(doc.window.document);
            const article = reader.parse();

            if (!article) {
                throw new Error("Could not parse article content. Site may be incompatible.");
            }

            return new Response(JSON.stringify(article), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
