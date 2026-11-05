/** Small semantic primitives share focus, disabled and accessible-name behavior. */
import {
  useState,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
/** Standard button with an optional visual priority. */
export function Button({
  children,
  primary = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...props}
      className={`${primary ? "primary " : ""}${props.className || ""}`}
    >
      {children}
    </button>
  );
}
/** Icons always retain readable accessible labels and native tooltips. */
export function IconButton({
  label,
  children,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`icon-button ${active ? "active" : ""} ${props.className || ""}`}
    >
      {children}
    </button>
  );
}
/** Keyboard hint uses the platform-independent shortcut spelling. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
/** Identity is redundant in color, initials and the full name tooltip. */
export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="avatar"
      style={{ background: color }}
      title={name}
      aria-label={name}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
/** Badge is supplementary text, never color-only status. */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
/** Segmented navigation follows tab semantics and names the selected panel. */
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item}
          role="tab"
          aria-selected={value === item}
          tabIndex={value === item ? 0 : -1}
          onKeyDown={(e) => {
            const direction =
              e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (direction) {
              e.preventDefault();
              const index =
                (items.indexOf(value) + direction + items.length) %
                items.length;
              onChange(items[index]);
              (
                e.currentTarget.parentElement?.children[index] as HTMLElement
              )?.focus();
            }
          }}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
/** Native checkbox gives switches reliable keyboard and screen-reader support. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <span>{label}</span>
      <input
        role="switch"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
/** Swatches retain hexadecimal accessible names and support arbitrary colors. */
export function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="swatches">
      {["#243E36", "#0072B2", "#D55E00", "#A23356", "#E6AF2E", "#FFFFFF"].map(
        (color) => (
          <button
            aria-label={`Color ${color}`}
            aria-pressed={value === color}
            className="swatch"
            key={color}
            style={{ background: color }}
            onClick={() => onChange(color)}
          />
        ),
      )}
      <input
        type="color"
        aria-label="Custom color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
/** Inline confirmation protects destructive actions without interrupting the whole board. */
export function ConfirmButton({
  label,
  onConfirm,
  disabled,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span className="inline-actions">
      <Button
        onClick={() => {
          onConfirm();
          setConfirm(false);
        }}
      >
        Confirm {label.toLowerCase()}
      </Button>
      <Button onClick={() => setConfirm(false)}>Cancel</Button>
    </span>
  ) : (
    <Button disabled={disabled} onClick={() => setConfirm(true)}>
      {label}
    </Button>
  );
}
/** A single labeled range primitive is shared by all property controls. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="range-label">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{value}</output>
    </label>
  );
}
/** Native title tooltip remains available without motion or a positioning dependency. */
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return <span title={label}>{children}</span>;
}
/** Disclosure popover keeps the browser's keyboard, focus and Escape conventions. */
export function Popover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="popover">
      <summary>{label}</summary>
      <div className="popover-content">{children}</div>
    </details>
  );
}
/** A menu is a labeled action disclosure; its contents retain normal button semantics. */
export function Menu(props: { label: string; children: ReactNode }) {
  return <Popover {...props} />;
}
/** Segmented choices share the same roving keyboard model as tab navigation. */
export function Segmented(props: {
  items: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return <Tabs {...props} />;
}
/** Readable toast surface is announced by its surrounding live region in the app shell. */
export function Toast({ children }: { children: ReactNode }) {
  return <div className="toast">{children}</div>;
}
/** Native dialog traps focus and restores it when dismissed. */
export function Dialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      className="panel"
      ref={ref}
      aria-label={label}
      onCancel={onClose}
      onClose={onClose}
    >
      {children}
      <Button onClick={onClose}>Close</Button>
    </dialog>
  );
}
/** A keyboard-scrollable named region avoids inaccessible clipped side panels. */
export function ScrollArea({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="scroll-area" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
/** Dock resizing uses a pointer separator and equivalent arrow-key width controls. */
export function ResizableDock({
  children,
  label = "Workspace panels",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [width, setWidth] = useState(320),
    drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <aside className="dock" aria-label={label} style={{ width }}>
      <div
        className="dock-resizer"
        role="separator"
        aria-label="Panel width"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={280}
        aria-valuemax={480}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setWidth((w) =>
              Math.max(
                280,
                Math.min(480, w + (e.key === "ArrowLeft" ? 20 : -20)),
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, width };
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setWidth(
              Math.max(
                280,
                Math.min(480, drag.current.width + drag.current.x - e.clientX),
              ),
            );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      {children}
    </aside>
  );
}
