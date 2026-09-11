"use client";

type FoldToggleProps = {
  collapsed: boolean;
  onToggle: () => void;
  panelLabel: string;
};

// A unicode chevron character (⌄) renders off-center in most fonts —
// its glyph box has uneven padding, so flexbox-centering the character
// still looks visually off. An SVG path centers exactly regardless of
// font/OS.
export default function FoldToggle({ collapsed, onToggle, panelLabel }: FoldToggleProps) {
  return (
    <button
      type="button"
      className="panel-fold-toggle"
      onClick={onToggle}
      aria-label={collapsed ? `Expand ${panelLabel}` : `Collapse ${panelLabel}`}
      title={collapsed ? "Expand" : "Collapse"}
    >
      <svg
        className={`panel-fold-chevron${collapsed ? " panel-fold-chevron--collapsed" : ""}`}
        viewBox="0 0 12 8"
        width="12"
        height="8"
        aria-hidden="true"
      >
        <path
          d="M1.5 1.5 L6 6.25 L10.5 1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
