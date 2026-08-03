import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { AppShell } from "./components/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RequireAuth } from "./pages/RequireAuth";
import { OverviewPage } from "./pages/OverviewPage";
import { TimelinePage } from "./pages/TimelinePage";
import { HabitsPage } from "./pages/HabitsPage";
import { StudyPage } from "./pages/StudyPage";
import { GoalsPage } from "./pages/GoalsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { IS_PAGES } from "./lib/deploy";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

/**
 * The GitHub Pages build is the landing page and nothing else — there is no API
 * or database behind a static host, so the app routes are not shipped at all.
 */
const routes = IS_PAGES ? (
  <Routes>
    <Route path="*" element={<LandingPage />} />
  </Routes>
) : (
  <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="habits" element={<HabitsPage />} />
        <Route path="study" element={<StudyPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        {routes}
      </BrowserRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "oklch(14% 0.014 260)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "oklch(97% 0.005 260)",
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
