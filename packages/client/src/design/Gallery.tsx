/** Hidden component gallery exposes every shared primitive in both shipped themes. */
import { useState } from "react";
import { Pen } from "lucide-react";
import {
  Button,
  IconButton,
  Tooltip,
  Popover,
  Menu,
  Tabs,
  Switch,
  Slider,
  ColorSwatchPicker,
  Segmented,
  Avatar,
  Badge,
  Toast,
  Dialog,
  Kbd,
  ScrollArea,
  ResizableDock,
} from "../components/ui";
/** A local-only inspection route, excluded from the ordinary user journey. */
export function Gallery() {
  const [tab, setTab] = useState("Chat"),
    [on, setOn] = useState(false),
    [size, setSize] = useState(3),
    [color, setColor] = useState("#243E36"),
    [dialog, setDialog] = useState(false);
  return (
    <main className="gallery">
      <h1>Canvas components</h1>
      {["light", "dark"].map((theme) => (
        <section
          data-theme={theme}
          key={theme}
          style={{
            background: "var(--paper)",
            color: "var(--ink)",
            padding: 24,
          }}
        >
          <h2>{theme}</h2>
          <Button primary>Primary</Button>
          <Button>Button</Button>
          <Button disabled>Disabled</Button>
          <Tooltip label="Pen">
            <IconButton label="Pen">
              <Pen />
            </IconButton>
          </Tooltip>
          <Popover label="Popover">
            <Button>Action</Button>
          </Popover>
          <Menu label="Menu">
            <Button>Menu action</Button>
          </Menu>
          <Tabs
            items={["Chat", "People", "History"]}
            value={tab}
            onChange={setTab}
          />
          <Segmented
            items={["One", "Two"]}
            value={on ? "One" : "Two"}
            onChange={(v) => setOn(v === "One")}
          />
          <Switch label="Enable" checked={on} onChange={setOn} />
          <Slider
            label="Width"
            min={1}
            max={40}
            value={size}
            onChange={setSize}
          />
          <ColorSwatchPicker value={color} onChange={setColor} />
          <Avatar name="Ada" color="#0072B2" />
          <Badge>Editor</Badge>
          <Kbd>Ctrl Z</Kbd>
          <Toast>Version saved</Toast>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <ScrollArea label="Scrollable example">
            <p>Named region with keyboard scrolling.</p>
          </ScrollArea>
          <div style={{ height: 100, width: 350 }}>
            <ResizableDock>
              <p>Resizable panel</p>
            </ResizableDock>
          </div>
        </section>
      ))}
      {dialog && (
        <Dialog label="Example dialog" onClose={() => setDialog(false)}>
          Protected focus with Escape support.
        </Dialog>
      )}
    </main>
  );
}
