/** Renderer entry point mounts the app with only its context-isolated bridge available. */
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
