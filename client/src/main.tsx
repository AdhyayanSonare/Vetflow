import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./vetflow/design.css";

// The UI runs entirely on local demo data, so the tRPC / React Query client is
// not mounted. When the first real API route lands, restore the providers from
// git history (see `lib/trpc.ts`) and only forward the sessionStorage bearer
// fallback in development previews.
createRoot(document.getElementById("root")!).render(<App />);
