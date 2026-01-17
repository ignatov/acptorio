interface FogOverlayProps {
  explored: boolean;
  children: React.ReactNode;
}

export function FogOverlay({ explored, children }: FogOverlayProps) {
  return (
    <div
      style={{
        position: "relative",
        opacity: explored ? 1 : 0.4,
        transition: "opacity 0.3s ease",
      }}
    >
      {children}
      {!explored && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--fog-color)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
