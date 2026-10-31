// Replace YOUR-SUBDOMAIN with the subdomain printed by Wrangler after deployment.
const deployedWorkerUrl = "https://topic-momentum-meter.michelegambino24.workers.dev";
window.WORKER_URL = location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  ? "http://127.0.0.1:8787"
  : deployedWorkerUrl;
