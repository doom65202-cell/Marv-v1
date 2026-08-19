const http = require("http");

const startTime = Date.now();

// Render's Free instance type only exists for Web Services — background
// workers aren't available on the free plan. Web services also need to
// bind to $PORT and respond to HTTP, and Render spins down a free service
// after 15 minutes with no inbound traffic (dropping the WhatsApp socket
// and wiping the session on next restart). This tiny server exists so
// Render has something to route to, and so an external uptime pinger
// (e.g. UptimeRobot, cron-job.org) can hit it periodically to keep the
// service — and the WhatsApp connection — alive.
function startKeepAliveServer() {
  const port = process.env.PORT || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`MARV-C V1 is running. Uptime: ${getUptimeString()}`);
    })
    .listen(port, () => {
      console.log(`Keep-alive server listening on port ${port}`);
    });
}

function getUptimeString() {
  const diffMs = Date.now() - startTime;
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}hrs${pad(minutes)}min${pad(seconds)}sec`;
}

module.exports = { getUptimeString, startKeepAliveServer };
