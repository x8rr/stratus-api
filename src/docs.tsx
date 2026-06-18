import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Docs } from "./Docs";

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <Docs />
  </StrictMode>
);

(import.meta.hot.data.root ??= createRoot(elem)).render(app);
