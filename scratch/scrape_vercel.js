const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

async function scrape() {
  try {
    const html = await get("https://precisegroup-pk-main-ior5f7qzw-precise5.vercel.app/");

    // Find script tags
    const scriptRegex = /<script type="module" crossorigin src="([^"]+)"><\/script>/g;
    let match;
    const scripts = [];
    while ((match = scriptRegex.exec(html)) !== null) {
      scripts.push(match[1]);
    }

    console.log("Found scripts:", scripts);

    for (const src of scripts) {
      const jsUrl = src.startsWith("http")
        ? src
        : `https://precisegroup-pk-main-ior5f7qzw-precise5.vercel.app${src}`;
      console.log(`Fetching ${jsUrl}...`);
      const js = await get(jsUrl);

      const supabaseUrlMatch = js.match(/https:\/\/[a-zA-Z0-9_-]+\.supabase\.co/);
      if (supabaseUrlMatch) {
        console.log(`Found Supabase URL: ${supabaseUrlMatch[0]}`);
      }

      const anonKeyMatch = js.match(/sb_publishable_[A-Za-z0-9_-]+/);
      if (anonKeyMatch) {
        console.log(`Found Anon Key: ${anonKeyMatch[0]}`);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

scrape();
