import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import './i18n/i18n'; // Initialize i18n
import reportWebVitals from './reportWebVitals';
import { ErrorTracker } from './lib/errorTracker';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// FE-043: Performance Monitoring
reportWebVitals(console.log);

// Start measuring performance in app
reportWebVitals((metric) => {
  ErrorTracker.captureMetric(metric);
});
