import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import { Readability } from "https://esm.sh/@mozilla/readability@0.5.0";
import { parseFeed } from "https://deno.land/x/rss@0.5.8/mod.ts";

const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req) => {
        if (req.method === "OPTIONS") {
                    return new Response(null, { headers: corsHeaders });
        }

          try {
                      const url = new URL(req.url);
                      const path = url.pathname;

            if (path === "/health") {
                            return new Response(JSON.stringify({ status: "ok" }), {
                                                headers: { ...corsHeaders, "Content-Type": "application/json" },
                            });
            }

            if (req.method !== "POST") {
                            return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
            }

            const { url: targetUrl } = await req.json();
                      if (!targetUrl) {
                                      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
                                                          status: 400,
                                                          headers: { ...corsHeaders, "Content-Type": "application/json" },
                                      });
                      }

            if (path === "/top") {
                            const res = await fetch(targetUrl);
                            const xml = await res.text();
                            const feed = await parseFeed(xml);
                            const items = feed.entries.slice(0, 20).map(entry => ({
                                                title: entry.title?.value || "No Title",
                                                link: entry.links[0]?.href || targetUrl,
                                                published: entry.published || new Date(),
                                                summary: entry.description?.value?.replace(/<[^>]+>/g, '')?.substring(0, 200) || "",
                                                image: null
                            }));
                            return new Response(JSON.stringify({ items }), {
                                                headers: { ...corsHeaders, "Content-Type": "application/json" },
                            });
            }

            if (path === "/article") {
                            const res = await fetch(targetUrl, {
                                                headers: { "User-Agent": "Mozilla/5.0" }
                            });
                            const html = await res.text();
                            const doc = new DOMParser().parseFromString(html, "text/html");
                            const reader = new Readability(doc);
                            const article = reader.parse();
                            return new Response(JSON.stringify(article), {
                                                headers: { ...corsHeaders, "Content-Type": "application/json" },
                            });
            }

            return new Response("Not Found", { status: 404, headers: corsHeaders });
          } catch (err) {
                      return new Response(JSON.stringify({ error: err.message }), {
                                      status: 500,
                                      headers: { ...corsHeaders, "Content-Type": "application/json" },
                      });
          }
});
