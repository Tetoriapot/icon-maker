import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  detectSupportedImageType,
  validateImageDimensions,
  validateImageFile,
} from "../app/image-validation.ts";
import { getNameLayout, NAME_POSITIONS } from "../app/name-layout.ts";

test("rejects disguised or oversized files before decoding", async () => {
  assert.equal(
    detectSupportedImageType(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
  assert.equal(
    detectSupportedImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    "image/jpeg",
  );
  assert.equal(
    detectSupportedImageType(
      Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
    "image/webp",
  );
  assert.equal(
    detectSupportedImageType(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'),
    ),
    null,
  );

  const disguisedSvg = new Blob([
    '<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>',
  ]);
  assert.deepEqual(await validateImageFile(disguisedSvg), {
    ok: false,
    reason: "unsupported",
  });

  const oversizedWithoutAllocation = {
    size: MAX_IMAGE_FILE_BYTES + 1,
    slice() {
      throw new Error("size is checked before reading");
    },
  };
  assert.deepEqual(await validateImageFile(oversizedWithoutAllocation), {
    ok: false,
    reason: "too-large",
  });
});

test("allows 6000px artwork while bounding decoded image memory", () => {
  assert.equal(validateImageDimensions(6000, 6000).ok, true);
  assert.equal(validateImageDimensions(MAX_IMAGE_EDGE + 1, 1).ok, false);
  assert.ok(7000 * 6000 > MAX_IMAGE_PIXELS);
  assert.equal(validateImageDimensions(7000, 6000).ok, false);
  assert.equal(validateImageDimensions(0, 6000).ok, false);
});

async function render(extraHeaders = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", ...extraHeaders },
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
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ja"/i);
  assert.match(html, /<title>アイコンメーカー｜画像を30秒でアイコンに<\/title>/i);
  assert.match(html, /好きな画像を/);
  assert.match(html, /画像は端末内だけで処理/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /C:[\\/]Projects|\.vinext[\\/]fonts/i);
});

test("uses the canonical public origin instead of forwarded host input", async () => {
  const response = await render({
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "javascript",
  });
  const html = await response.text();
  assert.match(html, /https:\/\/icon-maker-jp\.tetoriapot\.chatgpt\.site\/og\.png/);
  assert.doesNotMatch(html, /javascript:\/\/|evil\.example/i);
});

test("ships the complete local-only editor surface", async () => {
  const [page, styles, nameLayout, layout, packageJson, manifest] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
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
  assert.equal(
    (page.match(/file\.slice\(0, file\.size, validation\.type\)/g) ?? []).length,
    2,
  );
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
  assert.match(page, /addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
  assert.match(page, /removeEventListener\("wheel", handleWheel\)/);
  assert.match(page, /event\.preventDefault\(\);\s+event\.stopPropagation\(\)/);
  assert.doesNotMatch(page, /onWheel=\{handleWheel\}/);
  assert.match(styles, /\.editor-canvas\s*\{[^}]*overscroll-behavior: contain;[^}]*touch-action: none;/s);
  assert.match(page, /const preserveCurrentSettings = imageRef\.current !== null/);
  assert.match(page, /preserveCurrentSettings\s+\? \{ \.\.\.editorRef\.current \}\s+: \{ \.\.\.INITIAL_EDITOR \}/);
  assert.match(page, /const resetSettings = \(\) => \{[^}]*commitPatch\(\{ \.\.\.INITIAL_EDITOR \}\)/s);
  assert.match(page, /設定をリセット/);
  assert.ok(page.indexOf("設定をリセット") > page.indexOf("別の画像"));
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /https:\/\/icon-maker-jp\.tetoriapot\.chatgpt\.site/);
  assert.doesNotMatch(layout, /next\/font|x-forwarded-host|x-forwarded-proto/);
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
