export type NamePosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "outside-bottom";

export type NameHorizontal = "left" | "center" | "right";
export type NameVertical = "top" | "middle" | "bottom";

export const NAME_POSITIONS: { value: NamePosition; label: string }[] = [
  { value: "top-left", label: "左上" },
  { value: "top-center", label: "上中央" },
  { value: "top-right", label: "右上" },
  { value: "middle-left", label: "左中央" },
  { value: "middle-center", label: "中央" },
  { value: "middle-right", label: "右中央" },
  { value: "bottom-left", label: "左下" },
  { value: "bottom-center", label: "下中央" },
  { value: "bottom-right", label: "右下" },
  { value: "outside-bottom", label: "アイコンの下" },
];

export type NameLayout = {
  outside: boolean;
  horizontal: NameHorizontal;
  vertical: NameVertical;
  x: number;
  y: number;
  cropX: number;
  cropY: number;
  cropSize: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getNameLayout(
  position: NamePosition,
  requestedSize: number,
): NameLayout {
  const nameSize = clamp(requestedSize, 4, 24);
  if (position === "outside-bottom") {
    const labelBand = clamp(nameSize / 100 + 0.08, 0.18, 0.34);
    const cropSize = 1 - labelBand;
    return {
      outside: true,
      horizontal: "center",
      vertical: "bottom",
      x: 0.5,
      y: 1 - nameSize / 200 - 0.025,
      cropX: (1 - cropSize) / 2,
      cropY: 0.03,
      cropSize,
    };
  }

  const [vertical, horizontal] = position.split("-") as [
    NameVertical,
    NameHorizontal,
  ];
  const edgeInset = clamp(0.14 + nameSize / 300, 0.16, 0.23);
  return {
    outside: false,
    horizontal,
    vertical,
    x:
      horizontal === "left"
        ? edgeInset
        : horizontal === "right"
          ? 1 - edgeInset
          : 0.5,
    y:
      vertical === "top"
        ? edgeInset
        : vertical === "bottom"
          ? 1 - edgeInset
          : 0.5,
    cropX: 0,
    cropY: 0,
    cropSize: 1,
  };
}
