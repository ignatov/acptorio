interface SelectionBoxProps {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function SelectionBox({ left, top, width, height }: SelectionBoxProps) {
  return (
    <div
      className="selection-box"
      style={{
        left,
        top,
        width,
        height,
      }}
    />
  );
}
