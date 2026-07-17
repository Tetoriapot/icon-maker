import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Japanese icon maker", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ja"/i);
  assert.match(html, /<title>アイコンメーカー｜画像を30秒でアイコンに<\/title>/i);
  assert.match(html, /好きな画像を/);
  assert.match(html, /画像は端末内だけで処理/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the complete local-only editor surface", async () => {
  const [page, layout, packageJson, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);

  assert.match(page, /image\/png,image\/jpeg,image\/webp/);
  assert.match(page, /type BackgroundMode = [^;]+\| "image"/);
  assert.match(page, /type BorderMode = "color" \| "image"/);
  assert.match(page, /backgroundAssetId: number \| null/);
  assert.match(page, /frameAssetId: number \| null/);
  assert.match(page, /label="枠画像"/);
  assert.match(page, /label="背景画像"/);
  assert.match(page, /\{label\}をドロップ/);
  assert.match(page, /context\.drawImage\(frameAsset\.image/);
  assert.match(page, /URL\.revokeObjectURL\(asset\.url\)/);
  assert.match(
    page,
    /<h1 className="eyebrow">30秒で、ぴったりの一枚。<\/h1>/,
  );
  assert.doesNotMatch(page, /好きな画像を、/);
  assert.match(page, /canvas\.toBlob/);
  assert.match(page, /Ctrl\+Z/);
  assert.match(page, /PRESET_SIZES = \[128, 256, 512, 1024\]/);
  assert.match(page, /type="number"/);
  assert.match(page, /onPointerDown=\{beginPointer\}/);
  assert.match(page, /onWheel=\{handleWheel\}/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(layout, /og\.png/);
  assert.match(manifest, /"display": "standalone"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
