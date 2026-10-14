import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RequirementsWindow } from "./RequirementsWindow";
import { isRequirementsWindow } from "./windows";
import { installZoom } from "./zoom";
import "./styles.css";

installZoom();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isRequirementsWindow() ? <RequirementsWindow mode="window" /> : <App />}
  </React.StrictMode>,
);
