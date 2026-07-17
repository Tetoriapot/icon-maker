"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

type CropShape = "circle" | "square";
type BackgroundMode = "transparent" | "white" | "black" | "custom" | "image";
type BorderMode = "color" | "image";
type OutputFormat = "png" | "jpg" | "webp";
type LayerKind = "frame" | "background";

type EditorState = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  shape: CropShape;
  background: BackgroundMode;
  backgroundColor: string;
  backgroundAssetId: number | null;
  borderEnabled: boolean;
  borderMode: BorderMode;
  borderColor: string;
  borderWidth: number;
  frameAssetId: number | null;
  size: number;
  format: OutputFormat;
  quality: number;
};

type ImageInfo = {
  name: string;
  width: number;
  height: number;
};

type LayerAsset = ImageInfo & {
  id: number;
  image: HTMLImageElement;
  url: string;
};

type Gesture = {
  origin: EditorState;
  startX: number;
  startY: number;
  pinchDistance?: number;
  pinchMidX?: number;
  pinchMidY?: number;
};

const LOGICAL_SIZE = 1000;
const MAX_HISTORY = 50;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PRESET_SIZES = [128, 256, 512, 1024];

const INITIAL_EDITOR: EditorState = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  shape: "circle",
  background: "transparent",
  backgroundColor: "#8b5cf6",
  backgroundAssetId: null,
  borderEnabled: true,
  borderMode: "color",
  borderColor: "#ffffff",
  borderWidth: 12,
  frameAssetId: null,
  size: 512,
  format: "png",
  quality: 0.92,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stateEquals(a: EditorState, b: EditorState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function CheckerIcon() {
  return (
    <span className="checker-icon" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

type LayerUploadProps = {
  asset?: LayerAsset;
  active: boolean;
  disabled?: boolean;
  label: string;
  help: string;
  onOpen: () => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnter: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onRemove: () => void;
};

function LayerUpload({
  asset,
  active,
  disabled = false,
  label,
  help,
  onOpen,
  onDrop,
  onDragEnter,
  onDragLeave,
  onRemove,
}: LayerUploadProps) {
  return (
    <div className="layer-upload-wrap">
      <div
        className={`layer-upload ${active ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={asset ? `${label}を差し替え` : `${label}を選択またはドロップ`}
        onClick={() => {
          if (!disabled) onOpen();
        }}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpen();
          }
        }}
        onDragEnter={(event) => {
          if (!disabled) onDragEnter(event);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          if (!disabled) onDragLeave();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) onDrop(event);
        }}
      >
        {asset ? (
          <>
            <span className="layer-upload-thumb checkerboard" aria-hidden="true">
              <img src={asset.url} alt="" />
            </span>
            <span className="layer-upload-copy">
              <strong title={asset.name}>{asset.name}</strong>
              <small>
                {asset.width} × {asset.height}px
              </small>
            </span>
            <span className="layer-upload-action">差し替え</span>
          </>
        ) : (
          <>
            <span className="layer-upload-mark" aria-hidden="true">＋</span>
            <span className="layer-upload-copy">
              <strong>{label}をドロップ</strong>
              <small>{help}</small>
            </span>
            <span className="layer-upload-action">選ぶ</span>
          </>
        )}
      </div>
      {asset && (
        <button
          className="layer-remove-button"
          type="button"
          onClick={onRemove}
          disabled={disabled}
        >
          画像を解除
        </button>
      )}
    </div>
  );
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const layerAssetsRef = useRef(new Map<number, LayerAsset>());
  const nextLayerAssetIdRef = useRef(1);
  const layerLoadTokensRef = useRef<Record<LayerKind, number>>({
    frame: 0,
    background: 0,
  });
  const pendingLayerUrlsRef = useRef(new Set<string>());
  const editorCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<EditorState[]>([{ ...INITIAL_EDITOR }]);
  const historyIndexRef = useRef(0);
  const editorRef = useRef<EditorState>({ ...INITIAL_EDITOR });

  const [editor, setEditor] = useState<EditorState>({ ...INITIAL_EDITOR });
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [historyPosition, setHistoryPosition] = useState(0);
  const [historyLength, setHistoryLength] = useState(1);
  const [isDropActive, setIsDropActive] = useState(false);
  const [activeLayerDrop, setActiveLayerDrop] = useState<LayerKind | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const applyState = useCallback((next: EditorState) => {
    editorRef.current = next;
    setEditor(next);
  }, []);

  const pruneLayerAssets = useCallback(
    (history: EditorState[], current: EditorState) => {
      const retainedIds = new Set<number>();
      [...history, current].forEach((snapshot) => {
        if (snapshot.frameAssetId) retainedIds.add(snapshot.frameAssetId);
        if (snapshot.backgroundAssetId) retainedIds.add(snapshot.backgroundAssetId);
      });
      layerAssetsRef.current.forEach((asset, id) => {
        if (!retainedIds.has(id)) {
          URL.revokeObjectURL(asset.url);
          layerAssetsRef.current.delete(id);
        }
      });
    },
    [],
  );

  const pushHistory = useCallback((snapshot?: EditorState) => {
    const next = { ...(snapshot ?? editorRef.current) };
    const currentHistory = historyRef.current;
    const current = currentHistory[historyIndexRef.current];
    if (stateEquals(current, next)) return;

    let updated = currentHistory.slice(0, historyIndexRef.current + 1);
    updated.push(next);
    if (updated.length > MAX_HISTORY) updated = updated.slice(-MAX_HISTORY);
    historyRef.current = updated;
    historyIndexRef.current = updated.length - 1;
    setHistoryPosition(historyIndexRef.current);
    setHistoryLength(updated.length);
    pruneLayerAssets(updated, next);
  }, [pruneLayerAssets]);

  const commitPatch = useCallback(
    (patch: Partial<EditorState>) => {
      const next = { ...editorRef.current, ...patch };
      applyState(next);
      pushHistory(next);
    },
    [applyState, pushHistory],
  );

  const draftPatch = useCallback(
    (patch: Partial<EditorState>) => {
      applyState({ ...editorRef.current, ...patch });
    },
    [applyState],
  );

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    applyState({ ...historyRef.current[historyIndexRef.current] });
    setHistoryPosition(historyIndexRef.current);
  }, [applyState]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    applyState({ ...historyRef.current[historyIndexRef.current] });
    setHistoryPosition(historyIndexRef.current);
  }, [applyState]);

  useEffect(() => {
    const stored = window.localStorage.getItem("icon-maker-theme");
    const nextTheme =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA";
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        redo();
      } else if (event.key === "Escape" && !isTyping) {
        if (gestureRef.current) {
          applyState(gestureRef.current.origin);
          pointersRef.current.clear();
          gestureRef.current = null;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyState, redo, undo]);

  useEffect(() => {
    return () => {
      layerLoadTokensRef.current.frame += 1;
      layerLoadTokensRef.current.background += 1;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      pendingLayerUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      pendingLayerUrlsRef.current.clear();
      layerAssetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.url));
      layerAssetsRef.current.clear();
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, []);

  const resetHistory = useCallback(
    (next: EditorState) => {
      historyRef.current = [{ ...next }];
      historyIndexRef.current = 0;
      setHistoryPosition(0);
      setHistoryLength(1);
      applyState(next);
      pruneLayerAssets([next], next);
    },
    [applyState, pruneLayerAssets],
  );

  const loadFile = useCallback(
    (file?: File) => {
      if (!file) return;
      setError("");
      setNotice("");
      const extension = file.name.split(".").pop()?.toLowerCase();
      const validExtension = ["png", "jpg", "jpeg", "webp"].includes(
        extension ?? "",
      );
      if (!ACCEPTED_TYPES.includes(file.type) && !validExtension) {
        setError("この形式には対応していません。PNG・JPG・WebPを選んでください。");
        return;
      }

      const url = URL.createObjectURL(file);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        try {
          if (!image.naturalWidth || !image.naturalHeight) {
            throw new Error("invalid image");
          }
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = url;
          imageRef.current = image;
          setImageInfo({
            name: file.name,
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
          resetHistory({ ...INITIAL_EDITOR });
        } catch {
          URL.revokeObjectURL(url);
          setError("画像を読み込めませんでした。ファイルが破損していないか確認してください。");
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        setError("画像を読み込めませんでした。ファイルが破損している可能性があります。");
      };
      image.src = url;
    },
    [resetHistory],
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    loadFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDropActive(false);
    loadFile(event.dataTransfer.files?.[0]);
  };

  const loadLayerFile = useCallback(
    (kind: LayerKind, file?: File) => {
      if (!file) return;
      setError("");
      setNotice("");
      const label = kind === "frame" ? "枠画像" : "背景画像";
      const extension = file.name.split(".").pop()?.toLowerCase();
      const validExtension = ["png", "jpg", "jpeg", "webp"].includes(
        extension ?? "",
      );
      if (!ACCEPTED_TYPES.includes(file.type) && !validExtension) {
        setError(`${label}にはPNG・JPG・WebPを使用してください。`);
        return;
      }

      const url = URL.createObjectURL(file);
      const requestToken = ++layerLoadTokensRef.current[kind];
      pendingLayerUrlsRef.current.add(url);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        pendingLayerUrlsRef.current.delete(url);
        if (requestToken !== layerLoadTokensRef.current[kind]) {
          URL.revokeObjectURL(url);
          return;
        }
        if (!image.naturalWidth || !image.naturalHeight) {
          URL.revokeObjectURL(url);
          setError(`${label}を読み込めませんでした。画像が破損していないか確認してください。`);
          return;
        }
        const id = nextLayerAssetIdRef.current++;
        layerAssetsRef.current.set(id, {
          id,
          image,
          url,
          name: file.name,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        if (kind === "frame") {
          commitPatch({
            borderEnabled: true,
            borderMode: "image",
            frameAssetId: id,
          });
        } else {
          commitPatch({ background: "image", backgroundAssetId: id });
        }
        setActiveLayerDrop(null);
        setNotice(`${label}を設定しました`);
        window.setTimeout(() => setNotice(""), 1800);
      };
      image.onerror = () => {
        pendingLayerUrlsRef.current.delete(url);
        if (requestToken !== layerLoadTokensRef.current[kind]) {
          URL.revokeObjectURL(url);
          return;
        }
        URL.revokeObjectURL(url);
        setError(`${label}を読み込めませんでした。画像が破損している可能性があります。`);
      };
      image.src = url;
    },
    [commitPatch],
  );

  const handleLayerFileChange = (
    kind: LayerKind,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    loadLayerFile(kind, event.target.files?.[0]);
    event.target.value = "";
  };

  const handleLayerDrop = (
    kind: LayerKind,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveLayerDrop(null);
    loadLayerFile(kind, event.dataTransfer.files?.[0]);
  };

  const handleLayerDragEnter = (
    kind: LayerKind,
    event: ReactDragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveLayerDrop(kind);
  };

  const resolveBackground = useCallback(
    (state: EditorState, forceOpaque: boolean) => {
      if (state.background === "white") return "#ffffff";
      if (state.background === "black") return "#111111";
      if (state.background === "custom") return state.backgroundColor;
      return forceOpaque ? "#ffffff" : null;
    },
    [],
  );

  const drawIcon = useCallback(
    (
      canvas: HTMLCanvasElement,
      dimension: number,
      state: EditorState,
      forceOpaque = false,
    ) => {
      const image = imageRef.current;
      if (!image) return;
      if (canvas.width !== dimension) canvas.width = dimension;
      if (canvas.height !== dimension) canvas.height = dimension;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) return;

      context.clearRect(0, 0, dimension, dimension);
      if (forceOpaque) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, dimension, dimension);
      }
      context.save();
      context.beginPath();
      if (state.shape === "circle") {
        context.arc(dimension / 2, dimension / 2, dimension / 2, 0, Math.PI * 2);
      } else {
        context.rect(0, 0, dimension, dimension);
      }
      context.clip();

      const background = resolveBackground(state, forceOpaque);
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, dimension, dimension);
      }

      const backgroundAsset = state.backgroundAssetId
        ? layerAssetsRef.current.get(state.backgroundAssetId)
        : undefined;
      if (state.background === "image" && backgroundAsset) {
        const backgroundScale = Math.max(
          dimension / backgroundAsset.image.naturalWidth,
          dimension / backgroundAsset.image.naturalHeight,
        );
        const backgroundWidth = backgroundAsset.image.naturalWidth * backgroundScale;
        const backgroundHeight = backgroundAsset.image.naturalHeight * backgroundScale;
        context.drawImage(
          backgroundAsset.image,
          (dimension - backgroundWidth) / 2,
          (dimension - backgroundHeight) / 2,
          backgroundWidth,
          backgroundHeight,
        );
      }

      const coverScale = Math.max(
        dimension / image.naturalWidth,
        dimension / image.naturalHeight,
      );
      const scale = coverScale * state.zoom;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const x =
        dimension / 2 - width / 2 + (state.offsetX / LOGICAL_SIZE) * dimension;
      const y =
        dimension / 2 - height / 2 + (state.offsetY / LOGICAL_SIZE) * dimension;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, x, y, width, height);
      context.restore();

      const frameAsset = state.frameAssetId
        ? layerAssetsRef.current.get(state.frameAssetId)
        : undefined;
      if (state.borderEnabled && state.borderMode === "image" && frameAsset) {
        context.save();
        context.beginPath();
        if (state.shape === "circle") {
          context.arc(dimension / 2, dimension / 2, dimension / 2, 0, Math.PI * 2);
        } else {
          context.rect(0, 0, dimension, dimension);
        }
        context.clip();
        context.drawImage(frameAsset.image, 0, 0, dimension, dimension);
        context.restore();
      } else if (
        state.borderEnabled &&
        state.borderMode === "color" &&
        state.borderWidth > 0
      ) {
        const lineWidth = clamp(
          state.borderWidth * (dimension / Math.max(state.size, 1)),
          1,
          dimension / 3,
        );
        context.save();
        context.strokeStyle = state.borderColor;
        context.lineWidth = lineWidth;
        context.lineJoin = "round";
        context.beginPath();
        if (state.shape === "circle") {
          context.arc(
            dimension / 2,
            dimension / 2,
            dimension / 2 - lineWidth / 2,
            0,
            Math.PI * 2,
          );
        } else {
          context.rect(
            lineWidth / 2,
            lineWidth / 2,
            dimension - lineWidth,
            dimension - lineWidth,
          );
        }
        context.stroke();
        context.restore();
      }
    },
    [resolveBackground],
  );

  useEffect(() => {
    if (!imageInfo) return;
    const frame = window.requestAnimationFrame(() => {
      if (editorCanvasRef.current) {
        drawIcon(editorCanvasRef.current, LOGICAL_SIZE, editor);
      }
      if (previewCanvasRef.current) {
        drawIcon(previewCanvasRef.current, 512, editor);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawIcon, editor, imageInfo]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("icon-maker-theme", next);
  };

  const beginPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const rect = event.currentTarget.getBoundingClientRect();
    const pointers = Array.from(pointersRef.current.values());
    if (pointers.length === 1) {
      gestureRef.current = {
        origin: { ...editorRef.current },
        startX: event.clientX,
        startY: event.clientY,
      };
    } else if (pointers.length === 2) {
      const [a, b] = pointers;
      gestureRef.current = {
        origin: { ...editorRef.current },
        startX: a.x,
        startY: a.y,
        pinchDistance: Math.hypot(b.x - a.x, b.y - a.y),
        pinchMidX: (((a.x + b.x) / 2 - rect.left) / rect.width) * LOGICAL_SIZE,
        pinchMidY: (((a.y + b.y) / 2 - rect.top) / rect.height) * LOGICAL_SIZE,
      };
    }
  };

  const movePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const rect = event.currentTarget.getBoundingClientRect();
    const pointers = Array.from(pointersRef.current.values());
    const gesture = gestureRef.current;

    if (pointers.length >= 2 && gesture.pinchDistance) {
      const [a, b] = pointers;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const ratio = distance / Math.max(gesture.pinchDistance, 1);
      const zoom = clamp(gesture.origin.zoom * ratio, 0.5, 4);
      const actualRatio = zoom / gesture.origin.zoom;
      const midX = (((a.x + b.x) / 2 - rect.left) / rect.width) * LOGICAL_SIZE;
      const midY = (((a.y + b.y) / 2 - rect.top) / rect.height) * LOGICAL_SIZE;
      const startMidX = gesture.pinchMidX ?? LOGICAL_SIZE / 2;
      const startMidY = gesture.pinchMidY ?? LOGICAL_SIZE / 2;
      const oldCenterX = LOGICAL_SIZE / 2 + gesture.origin.offsetX;
      const oldCenterY = LOGICAL_SIZE / 2 + gesture.origin.offsetY;
      draftPatch({
        zoom,
        offsetX: midX + (oldCenterX - startMidX) * actualRatio - LOGICAL_SIZE / 2,
        offsetY: midY + (oldCenterY - startMidY) * actualRatio - LOGICAL_SIZE / 2,
      });
    } else if (pointers.length === 1) {
      const point = pointers[0];
      draftPatch({
        offsetX:
          gesture.origin.offsetX +
          ((point.x - gesture.startX) / rect.width) * LOGICAL_SIZE,
        offsetY:
          gesture.origin.offsetY +
          ((point.y - gesture.startY) / rect.height) * LOGICAL_SIZE,
      });
    }
  };

  const endPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      pushHistory();
      gestureRef.current = null;
      return;
    }
    const remaining = Array.from(pointersRef.current.values())[0];
    gestureRef.current = {
      origin: { ...editorRef.current },
      startX: remaining.x,
      startY: remaining.y,
    };
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointX = ((event.clientX - rect.left) / rect.width) * LOGICAL_SIZE;
    const pointY = ((event.clientY - rect.top) / rect.height) * LOGICAL_SIZE;
    const current = editorRef.current;
    const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0015), 0.5, 4);
    const ratio = nextZoom / current.zoom;
    const anchorX = pointX - LOGICAL_SIZE / 2;
    const anchorY = pointY - LOGICAL_SIZE / 2;
    draftPatch({
      zoom: nextZoom,
      offsetX: anchorX + (current.offsetX - anchorX) * ratio,
      offsetY: anchorY + (current.offsetY - anchorY) * ratio,
    });
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => pushHistory(), 180);
  };

  const resetView = () => {
    commitPatch({ zoom: 1, offsetX: 0, offsetY: 0 });
    setNotice("位置とズームをリセットしました");
    window.setTimeout(() => setNotice(""), 1800);
  };

  const saveImage = async () => {
    const canvas = exportCanvasRef.current;
    if (!canvas || !imageRef.current) return;
    const size = clamp(Math.round(editorRef.current.size), 16, 4096);
    const state = { ...editorRef.current, size };
    setIsSaving(true);
    setError("");
    try {
      drawIcon(canvas, size, state, state.format === "jpg");
      const mime =
        state.format === "jpg" ? "image/jpeg" : `image/${state.format}`;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, state.quality),
      );
      if (!blob) throw new Error("encode failed");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const baseName = imageInfo?.name.replace(/\.[^.]+$/, "") || "icon";
      anchor.href = url;
      anchor.download = `${baseName}-icon-${size}.${state.format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${size}pxの${state.format.toUpperCase()}を保存しました`);
      window.setTimeout(() => setNotice(""), 2600);
    } catch (saveError) {
      console.error(saveError);
      setError(
        "画像を保存できませんでした。サイズを小さくするか、他のタブを閉じてもう一度お試しください。",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const canUndo = historyPosition > 0;
  const canRedo = historyPosition < historyLength - 1;
  const isTransparentJpg =
    editor.format === "jpg" && editor.background === "transparent";
  const currentFrameAsset = editor.frameAssetId
    ? layerAssetsRef.current.get(editor.frameAssetId)
    : undefined;
  const currentBackgroundAsset = editor.backgroundAssetId
    ? layerAssetsRef.current.get(editor.backgroundAssetId)
    : undefined;

  return (
    <div className="app-root">
      <a className="skip-link" href="#main-content">
        メインコンテンツへ
      </a>
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => {
            if (imageInfo) fileInputRef.current?.click();
          }}
          aria-label="アイコンメーカー"
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">アイコンメーカー</span>
          <span className="beta-badge">BETA</span>
        </button>
        <div className="header-actions">
          <span className="privacy-note">
            <span className="privacy-dot" aria-hidden="true" />
            画像は端末内だけで処理
          </span>
          <button
            className="icon-button theme-button"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "ダークモードに切り替え" : "ライトモードに切り替え"}
            title={theme === "light" ? "ダークモード" : "ライトモード"}
          >
            <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
          </button>
        </div>
      </header>

      <main id="main-content">
        {!imageInfo ? (
          <section className="landing-section">
            <div className="hero-copy">
              <h1 className="eyebrow">30秒で、ぴったりの一枚。</h1>
              <p className="hero-description">
                切り抜いて、整えて、すぐ保存。
                <br />
                難しい操作も、画像のアップロードもありません。
              </p>
              <div className="feature-chips" aria-label="主な特徴">
                <span>登録不要</span>
                <span>完全無料</span>
                <span>ブラウザで完結</span>
              </div>
            </div>

            <div className="upload-column">
              <div
                className={`drop-zone ${isDropActive ? "is-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDropActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDropActive(false)}
                onDrop={handleDrop}
                aria-label="画像を選択またはドロップ"
              >
                <div className="drop-visual" aria-hidden="true">
                  <span className="drop-picture">
                    <i />
                  </span>
                  <span className="drop-plus">＋</span>
                </div>
                <h2>ここに画像をドロップ</h2>
                <p>または</p>
                <span className="primary-upload-button">画像を選ぶ</span>
                <small>PNG / JPG / WebP</small>
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.jpg,.jpeg"
                  onChange={handleFileChange}
                />
              </div>
              <p className="safe-caption">
                <span aria-hidden="true">⌁</span>
                選んだ画像が外部に送信されることはありません
              </p>
            </div>

            <div className="hero-orbit hero-orbit-one" aria-hidden="true">
              <span className="avatar-shape avatar-one" />
            </div>
            <div className="hero-orbit hero-orbit-two" aria-hidden="true">
              <span className="avatar-shape avatar-two" />
            </div>
          </section>
        ) : (
          <section className="editor-page" aria-label="アイコン編集画面">
            <div className="editor-topbar">
              <div className="file-summary">
                <span className="file-thumb" aria-hidden="true">▧</span>
                <span>
                  <strong title={imageInfo.name}>{imageInfo.name}</strong>
                  <small>
                    {imageInfo.width.toLocaleString()} × {imageInfo.height.toLocaleString()} px
                  </small>
                </span>
              </div>
              <div className="topbar-actions">
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  title="元に戻す (Ctrl+Z)"
                >
                  <span aria-hidden="true">↶</span> 元に戻す
                </button>
                <button
                  className="toolbar-button compact"
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  title="やり直す (Ctrl+Y)"
                >
                  <span aria-hidden="true">↷</span>
                  <span className="desktop-only">やり直す</span>
                </button>
                <button
                  className="toolbar-button replace-button"
                  type="button"
                  onClick={() => replaceInputRef.current?.click()}
                >
                  別の画像
                </button>
                <input
                  ref={replaceInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.jpg,.jpeg"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            <div className="editor-layout">
              <div
                className={`canvas-panel ${isDropActive ? "is-drop-active" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDropActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setIsDropActive(false)}
                onDrop={handleDrop}
              >
                <div className="canvas-heading">
                  <div>
                    <p className="section-kicker">EDIT</p>
                    <h2>画像を動かして位置を調整</h2>
                  </div>
                  <button className="text-button" type="button" onClick={resetView}>
                    <span aria-hidden="true">↺</span> 位置をリセット
                  </button>
                </div>

                <div className="canvas-stage">
                  <div
                    className={`canvas-wrap checkerboard ${editor.shape}`}
                    data-label={isDropActive ? "画像をドロップして差し替え" : undefined}
                  >
                    <canvas
                      ref={editorCanvasRef}
                      className="editor-canvas"
                      onPointerDown={beginPointer}
                      onPointerMove={movePointer}
                      onPointerUp={endPointer}
                      onPointerCancel={endPointer}
                      onWheel={handleWheel}
                      onDoubleClick={resetView}
                      aria-label="切り抜き位置を調整するキャンバス。ドラッグで移動、ホイールで拡大縮小できます"
                    />
                    <span className="crop-guide" aria-hidden="true" />
                  </div>
                </div>

                <div className="zoom-control" aria-label="ズーム操作">
                  <button
                    type="button"
                    onClick={() =>
                      commitPatch({ zoom: clamp(editorRef.current.zoom - 0.1, 0.5, 4) })
                    }
                    aria-label="縮小"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="50"
                    max="400"
                    step="1"
                    value={Math.round(editor.zoom * 100)}
                    onChange={(event) =>
                      draftPatch({ zoom: Number(event.target.value) / 100 })
                    }
                    onPointerUp={() => pushHistory()}
                    onKeyUp={() => pushHistory()}
                    onBlur={() => pushHistory()}
                    aria-label="ズーム"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      commitPatch({ zoom: clamp(editorRef.current.zoom + 0.1, 0.5, 4) })
                    }
                    aria-label="拡大"
                  >
                    ＋
                  </button>
                  <output>{Math.round(editor.zoom * 100)}%</output>
                </div>
                <p className="canvas-help">
                  <span>ドラッグで移動</span>
                  <i aria-hidden="true" />
                  <span>ホイール / ピンチで拡大・縮小</span>
                  <i aria-hidden="true" />
                  <span>ダブルクリックで等倍</span>
                </p>
              </div>

              <aside className="settings-panel" aria-label="アイコン設定">
                <section className="preview-card">
                  <div className="panel-title-row">
                    <div>
                      <p className="section-kicker">PREVIEW</p>
                      <h2>仕上がり</h2>
                    </div>
                    <span className="live-badge">
                      <i aria-hidden="true" /> LIVE
                    </span>
                  </div>
                  <div className={`preview-frame checkerboard ${editor.shape}`}>
                    <canvas ref={previewCanvasRef} aria-label="完成アイコンのプレビュー" />
                  </div>
                  <p className="preview-meta">
                    {editor.size} × {editor.size} px ・ {editor.format.toUpperCase()}
                  </p>
                </section>

                <section className="setting-section">
                  <h3>切り抜き</h3>
                  <div className="segmented-control two-up">
                    <button
                      type="button"
                      className={editor.shape === "circle" ? "is-selected" : ""}
                      onClick={() => commitPatch({ shape: "circle" })}
                      aria-pressed={editor.shape === "circle"}
                    >
                      <span className="shape-dot" aria-hidden="true" /> 円形
                    </button>
                    <button
                      type="button"
                      className={editor.shape === "square" ? "is-selected" : ""}
                      onClick={() => commitPatch({ shape: "square" })}
                      aria-pressed={editor.shape === "square"}
                    >
                      <span className="shape-square" aria-hidden="true" /> 正方形
                    </button>
                  </div>
                </section>

                <section className="setting-section">
                  <div className="setting-heading-row">
                    <h3>縁取り</h3>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={editor.borderEnabled}
                        onChange={(event) =>
                          commitPatch({ borderEnabled: event.target.checked })
                        }
                      />
                      <span aria-hidden="true" />
                      <em>{editor.borderEnabled ? "ON" : "OFF"}</em>
                    </label>
                  </div>
                  <div
                    className={`border-options-stack ${editor.borderEnabled ? "" : "is-disabled"}`}
                  >
                    <div className="segmented-control two-up border-mode-control">
                      <button
                        type="button"
                        className={editor.borderMode === "color" ? "is-selected" : ""}
                        onClick={() => commitPatch({ borderMode: "color" })}
                        aria-pressed={editor.borderMode === "color"}
                        disabled={!editor.borderEnabled}
                      >
                        <span className="border-mode-color-icon" aria-hidden="true" />
                        色
                      </button>
                      <button
                        type="button"
                        className={editor.borderMode === "image" ? "is-selected" : ""}
                        onClick={() => commitPatch({ borderMode: "image" })}
                        aria-pressed={editor.borderMode === "image"}
                        disabled={!editor.borderEnabled}
                      >
                        <span className="border-mode-image-icon" aria-hidden="true" />
                        画像
                      </button>
                    </div>

                    {editor.borderMode === "color" ? (
                      <div className="border-controls">
                        <label className="color-field">
                          <span>色</span>
                          <span className="color-input-wrap">
                            <input
                              type="color"
                              value={editor.borderColor}
                              onChange={(event) =>
                                draftPatch({ borderColor: event.target.value })
                              }
                              onBlur={() => pushHistory()}
                              disabled={!editor.borderEnabled}
                              aria-label="縁取りの色"
                            />
                            <code>{editor.borderColor.toUpperCase()}</code>
                          </span>
                        </label>
                        <label className="range-field">
                          <span>
                            太さ <output>{editor.borderWidth}px</output>
                          </span>
                          <input
                            type="range"
                            min="1"
                            max="64"
                            value={editor.borderWidth}
                            onChange={(event) =>
                              draftPatch({ borderWidth: Number(event.target.value) })
                            }
                            onPointerUp={() => pushHistory()}
                            onKeyUp={() => pushHistory()}
                            onBlur={() => pushHistory()}
                            disabled={!editor.borderEnabled}
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        <LayerUpload
                          asset={currentFrameAsset}
                          active={activeLayerDrop === "frame"}
                          disabled={!editor.borderEnabled}
                          label="枠画像"
                          help="透過PNG / WebP推奨"
                          onOpen={() => frameInputRef.current?.click()}
                          onDrop={(event) => handleLayerDrop("frame", event)}
                          onDragEnter={(event) => handleLayerDragEnter("frame", event)}
                          onDragLeave={() => setActiveLayerDrop(null)}
                          onRemove={() =>
                            commitPatch({ frameAssetId: null, borderMode: "color" })
                          }
                        />
                        <input
                          ref={frameInputRef}
                          className="visually-hidden"
                          type="file"
                          accept="image/png,image/jpeg,image/webp,.jpg,.jpeg"
                          onChange={(event) => handleLayerFileChange("frame", event)}
                        />
                      </>
                    )}
                  </div>
                </section>

                <section className="setting-section">
                  <h3>背景</h3>
                  <div className="background-options">
                    {(
                      [
                        ["transparent", "透明"],
                        ["white", "白"],
                        ["black", "黒"],
                        ["custom", "自由色"],
                        ["image", "画像"],
                      ] as [BackgroundMode, string][]
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={editor.background === value ? "is-selected" : ""}
                        onClick={() => commitPatch({ background: value })}
                        aria-pressed={editor.background === value}
                      >
                        {value === "transparent" ? (
                          <CheckerIcon />
                        ) : value === "custom" ? (
                          <span
                            className="background-swatch custom"
                            style={{ backgroundColor: editor.backgroundColor }}
                          />
                        ) : value === "image" ? (
                          <span className="background-swatch image" aria-hidden="true">
                            <i />
                          </span>
                        ) : (
                          <span className={`background-swatch ${value}`} />
                        )}
                        {label}
                      </button>
                    ))}
                  </div>
                  {editor.background === "custom" && (
                    <label className="custom-background-field">
                      <span>背景色</span>
                      <input
                        type="color"
                        value={editor.backgroundColor}
                        onChange={(event) =>
                          draftPatch({ backgroundColor: event.target.value })
                        }
                        onBlur={() => pushHistory()}
                      />
                      <code>{editor.backgroundColor.toUpperCase()}</code>
                    </label>
                  )}
                  {editor.background === "image" && (
                    <>
                      <LayerUpload
                        asset={currentBackgroundAsset}
                        active={activeLayerDrop === "background"}
                        label="背景画像"
                        help="PNG / JPG / WebP"
                        onOpen={() => backgroundInputRef.current?.click()}
                        onDrop={(event) => handleLayerDrop("background", event)}
                        onDragEnter={(event) =>
                          handleLayerDragEnter("background", event)
                        }
                        onDragLeave={() => setActiveLayerDrop(null)}
                        onRemove={() =>
                          commitPatch({
                            backgroundAssetId: null,
                            background: "transparent",
                          })
                        }
                      />
                      <input
                        ref={backgroundInputRef}
                        className="visually-hidden"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,.jpg,.jpeg"
                        onChange={(event) =>
                          handleLayerFileChange("background", event)
                        }
                      />
                    </>
                  )}
                </section>

                <section className="setting-section output-section">
                  <h3>保存設定</h3>
                  <div className="size-presets" aria-label="出力サイズのプリセット">
                    {PRESET_SIZES.map((size) => (
                      <button
                        type="button"
                        key={size}
                        className={editor.size === size ? "is-selected" : ""}
                        onClick={() => commitPatch({ size })}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                  <label className="custom-size-field">
                    <span>カスタム</span>
                    <span>
                      <input
                        type="number"
                        min="16"
                        max="4096"
                        value={editor.size}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value)) draftPatch({ size: value });
                        }}
                        onBlur={() => {
                          draftPatch({ size: clamp(Math.round(editorRef.current.size), 16, 4096) });
                          pushHistory({
                            ...editorRef.current,
                            size: clamp(Math.round(editorRef.current.size), 16, 4096),
                          });
                        }}
                        aria-label="出力サイズ"
                      />
                      px
                    </span>
                  </label>
                  <div className="format-row">
                    <label>
                      <span>形式</span>
                      <select
                        value={editor.format}
                        onChange={(event) =>
                          commitPatch({ format: event.target.value as OutputFormat })
                        }
                      >
                        <option value="png">PNG</option>
                        <option value="jpg">JPG</option>
                        <option value="webp">WebP</option>
                      </select>
                    </label>
                    {editor.format !== "png" && (
                      <label className="quality-control">
                        <span>品質 {Math.round(editor.quality * 100)}%</span>
                        <input
                          type="range"
                          min="40"
                          max="100"
                          value={Math.round(editor.quality * 100)}
                          onChange={(event) =>
                            draftPatch({ quality: Number(event.target.value) / 100 })
                          }
                          onPointerUp={() => pushHistory()}
                          onKeyUp={() => pushHistory()}
                          onBlur={() => pushHistory()}
                        />
                      </label>
                    )}
                  </div>
                  {isTransparentJpg && (
                    <p className="inline-note">JPGでは透明部分が白になります。</p>
                  )}
                </section>

                <button
                  className="save-button"
                  type="button"
                  onClick={saveImage}
                  disabled={isSaving}
                >
                  <span aria-hidden="true">↓</span>
                  {isSaving ? "画像を作成中…" : "アイコンを保存"}
                </button>
                <p className="save-caption">サーバーへのアップロードは行いません</p>
              </aside>
            </div>
          </section>
        )}
      </main>

      {error && (
        <div className="toast error-toast" role="alert">
          <span aria-hidden="true">!</span>
          {error}
          <button type="button" onClick={() => setError("")} aria-label="閉じる">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="toast success-toast" role="status">
          <span aria-hidden="true">✓</span>
          {notice}
        </div>
      )}
      <canvas ref={exportCanvasRef} className="visually-hidden" aria-hidden="true" />
    </div>
  );
}
