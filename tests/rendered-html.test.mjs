import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getNameLayout, NAME_POSITIONS } from "../app/name-layout.ts";

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
  const [page, nameLayout, layout, packageJson, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/name-layout.ts", import.meta.url), "utf8"),
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
  assert.match(nameLayout, /type NamePosition =/);
  assert.match(page, /namePosition: "outside-bottom"/);
  assert.match(page, /NAME_POSITIONS\.map/);
  assert.match(page, /名前の位置: \$\{label\}/);
  assert.match(page, /context\.strokeText\(nameText, textX, textY\)/);
  assert.match(page, /context\.fillText\(nameText, textX, textY\)/);
  assert.match(page, /<h3>名前<\/h3>/);
  assert.match(page, /placeholder="名前を入力"/);
  assert.match(page, /maxLength=\{30\}/);
  assert.match(page, /名前の縁取りの太さ/);
  assert.match(page, /usesNativeHistory && isHistoryShortcut/);
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

test("lays out all name positions safely and reserves space below the icon", () => {
  assert.equal(NAME_POSITIONS.length, 10);
  assert.equal(new Set(NAME_POSITIONS.map(({ value }) => value)).size, 10);

  for (const { value } of NAME_POSITIONS) {
    const result = getNameLayout(value, 11);
    assert.ok(result.x > 0 && result.x < 1, `${value}: x is inside the canvas`);
    assert.ok(result.y > 0 && result.y < 1, `${value}: y is inside the canvas`);
    assert.ok(result.cropSize > 0 && result.cropSize <= 1);
  }

  const outsideSmall = getNameLayout("outside-bottom", 4);
  const outsideDefault = getNameLayout("outside-bottom", 11);
  const outsideLarge = getNameLayout("outside-bottom", 24);
  assert.ok(outsideDefault.outside);
  assert.ok(outsideDefault.cropY + outsideDefault.cropSize < outsideDefault.y);
  assert.ok(outsideLarge.cropSize < outsideSmall.cropSize);
  assert.ok(outsideLarge.y < outsideSmall.y);

  const overlay = getNameLayout("bottom-center", 11);
  assert.equal(overlay.outside, false);
  assert.deepEqual(
    [overlay.cropX, overlay.cropY, overlay.cropSize],
    [0, 0, 1],
  );
});
